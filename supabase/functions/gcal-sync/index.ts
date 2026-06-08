// supabase/functions/gcal-sync/index.ts
//
// Mirrors events from every shared Google calendar (sharing != 'none') into
// external_calendar_events. Read-only against Google. Invoked by pg_cron with an
// X-Cron-Secret header (verify_jwt = false), the same pattern as send-due-pushes.
//
// Per calendar: take a short-lived lock (so overlapping cron runs don't race on
// the same syncToken), pull changes incrementally via the stored syncToken
// (full window sync when there's no token), upsert events, delete cancelled /
// declined ones, and persist the new nextSyncToken. On HTTP 410 (expired token)
// we wipe the calendar's events and full-resync. Recurring events are expanded
// by Google (singleEvents=true), so we store concrete dated instances.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  getFreshAccessToken,
  googleGet,
  GoogleApiError,
  ReauthRequiredError,
} from "../_shared/google.ts";

const LOCK_STALE_MS = 10 * 60 * 1000; // a lock older than this is considered dead
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 365;
const DEFAULT_TZ = "Europe/Belgrade";

interface GCalConnection {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

interface GCalCalendar {
  id: string;
  google_calendar_id: string;
  sharing: string;
  family_id: string;
  owner_user_id: string;
  sync_token: string | null;
  connection: GCalConnection;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  iCalUID?: string;
  recurringEventId?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  source?: { url?: string };
}

interface EventsPage {
  items?: GEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || req.headers.get("X-Cron-Secret") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: calendars, error: calErr } = await admin
    .from("google_calendars")
    .select(
      "id, google_calendar_id, sharing, family_id, owner_user_id, sync_token, connection:google_connections(id, access_token, refresh_token, token_expires_at)",
    )
    .neq("sharing", "none");
  if (calErr) console.error("gcal-sync calendars query failed:", calErr.message);

  const summary = { synced: 0, skipped: 0, reauth: 0, errors: 0 };
  for (const cal of (calendars ?? []) as unknown as GCalCalendar[]) {
    if (!(await acquireLock(admin, cal.id))) {
      summary.skipped++;
      continue;
    }
    try {
      const outcome = await syncCalendar(admin, cal);
      if (outcome === "reauth") summary.reauth++;
      else summary.synced++;
    } catch (e) {
      summary.errors++;
      console.error(`gcal-sync calendar ${cal.id} failed:`, e instanceof Error ? e.message : e);
      await unlock(admin, cal.id);
    }
  }

  return json({ ok: true, ...summary });
});

/** Takes the per-calendar lock; returns false if another run holds a fresh one. */
async function acquireLock(admin: Admin, calendarId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  // Use count, NOT .select(): an UPDATE that combines an or() filter with a
  // RETURNING/select makes PostgREST emit SQL that errors 42703 ("column
  // locked_at does not exist"). Counting the affected rows avoids that. The
  // timestamp is quoted so PostgREST doesn't mis-parse the ':'/'.' in the value.
  const { count, error } = await admin
    .from("google_calendars")
    .update({ locked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", calendarId)
    .or(`locked_at.is.null,locked_at.lt."${staleBefore}"`);
  if (error) console.error("gcal-sync lock failed:", error.message);
  return (count ?? 0) > 0;
}

async function unlock(admin: Admin, calendarId: string): Promise<void> {
  await admin.from("google_calendars").update({ locked_at: null }).eq("id", calendarId);
}

async function syncCalendar(admin: Admin, cal: GCalCalendar): Promise<"synced" | "reauth"> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(admin, cal.connection);
  } catch (e) {
    if (e instanceof ReauthRequiredError) {
      await unlock(admin, cal.id);
      return "reauth";
    }
    throw e;
  }

  const visibility = cal.sharing === "family" ? "family" : "private";
  const tz = await getOwnerTz(admin, cal.owner_user_id);

  try {
    const newToken = await pull(admin, accessToken, cal, visibility, tz, cal.sync_token);
    await finishSync(admin, cal.id, newToken);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 410) {
      // Expired syncToken: drop everything for this calendar and full-resync.
      await admin.from("external_calendar_events").delete().eq("calendar_id", cal.id);
      const newToken = await pull(admin, accessToken, cal, visibility, tz, null);
      await finishSync(admin, cal.id, newToken);
    } else {
      throw e;
    }
  }
  return "synced";
}

async function finishSync(
  admin: Admin,
  calendarId: string,
  syncToken: string | null,
): Promise<void> {
  await admin
    .from("google_calendars")
    .update({ sync_token: syncToken, last_synced_at: new Date().toISOString(), locked_at: null })
    .eq("id", calendarId);
}

/** Pages through events.list and applies each change; returns the new syncToken. */
async function pull(
  admin: Admin,
  accessToken: string,
  cal: GCalCalendar,
  visibility: "family" | "private",
  tz: string,
  syncToken: string | null,
): Promise<string | null> {
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const page = await googleGet<EventsPage>(
      accessToken,
      eventsUrl(cal.google_calendar_id, syncToken, pageToken),
    );
    for (const ev of page.items ?? []) {
      await applyEvent(admin, cal, visibility, tz, ev);
    }
    pageToken = page.nextPageToken;
    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
  } while (pageToken);
  return nextSyncToken;
}

function eventsUrl(
  calendarId: string,
  syncToken: string | null,
  pageToken: string | undefined,
): string {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const p = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" });
  if (syncToken) {
    p.set("syncToken", syncToken);
  } else {
    const now = Date.now();
    p.set("timeMin", new Date(now - WINDOW_PAST_DAYS * 86_400_000).toISOString());
    p.set("timeMax", new Date(now + WINDOW_FUTURE_DAYS * 86_400_000).toISOString());
  }
  if (pageToken) p.set("pageToken", pageToken);
  return `${base}?${p.toString()}`;
}

async function applyEvent(
  admin: Admin,
  cal: GCalCalendar,
  visibility: "family" | "private",
  tz: string,
  ev: GEvent,
): Promise<void> {
  // Cancelled, or an invite the connecting member declined → ensure it's gone.
  const selfDeclined = (ev.attendees ?? []).some((a) => a.self && a.responseStatus === "declined");
  if (ev.status === "cancelled" || selfDeclined) {
    await admin
      .from("external_calendar_events")
      .delete()
      .eq("calendar_id", cal.id)
      .eq("google_event_id", ev.id);
    return;
  }

  const when = mapWhen(ev, tz);
  if (!when) return; // no start time — shouldn't happen with singleEvents=true

  await admin.from("external_calendar_events").upsert(
    {
      calendar_id: cal.id,
      family_id: cal.family_id,
      owner_user_id: cal.owner_user_id,
      visibility,
      google_event_id: ev.id,
      ical_uid: ev.iCalUID ?? null,
      recurring_event_id: ev.recurringEventId ?? null,
      title: ev.summary ?? null,
      description: ev.description ?? null,
      location: ev.location ?? null,
      start_at: when.startAt,
      end_at: when.endAt,
      local_date: when.localDate,
      start_time: when.startTime,
      end_time: when.endTime,
      is_all_day: when.isAllDay,
      event_type: ev.eventType ?? "default",
      status: ev.status ?? null,
      html_link: ev.htmlLink ?? null,
      source_url: ev.source?.url ?? null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "calendar_id,google_event_id" },
  );
}

interface When {
  startAt: string | null;
  endAt: string | null;
  localDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
}

function mapWhen(ev: GEvent, tz: string): When | null {
  // All-day: Google uses `date` (no time). Bucket on the start date as-is.
  if (ev.start?.date) {
    return {
      startAt: null,
      endAt: null,
      localDate: ev.start.date,
      startTime: null,
      endTime: null,
      isAllDay: true,
    };
  }
  if (!ev.start?.dateTime) return null;

  const startAt = new Date(ev.start.dateTime);
  const startParts = partsInTz(startAt, tz);
  let endTime: string | null = null;
  let endAt: string | null = null;
  if (ev.end?.dateTime) {
    const e = new Date(ev.end.dateTime);
    endAt = e.toISOString();
    endTime = partsInTz(e, tz).time;
  }
  return {
    startAt: startAt.toISOString(),
    endAt,
    localDate: startParts.date,
    startTime: startParts.time,
    endTime,
    isAllDay: false,
  };
}

/** Formats an instant into the family timezone's wall-clock date + HH:MM. */
function partsInTz(date: Date, tz: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour; // some runtimes emit 24 at midnight
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

async function getOwnerTz(admin: Admin, ownerUserId: string): Promise<string> {
  const { data } = await admin
    .from("notification_preferences")
    .select("timezone")
    .eq("user_id", ownerUserId)
    .maybeSingle();
  return data?.timezone || DEFAULT_TZ;
}

type Admin = ReturnType<typeof createClient>;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
