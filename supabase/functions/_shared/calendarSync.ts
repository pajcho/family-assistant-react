// supabase/functions/_shared/calendarSync.ts
//
// Per-calendar event sync, shared by gcal-sync (the cron worker - all shared
// calendars) and gcal-calendars (an immediate one-calendar sync right after the
// user shares it, so events show up without waiting for the cron). Pulls changes
// incrementally via the stored syncToken (full window when there's none), upserts
// events, deletes cancelled / self-declined ones, and persists the new
// nextSyncToken - all under a short-lived per-calendar lock.
//
// The event half is split in two so it stays cheap and testable:
//
//   • `decideEvent` is pure - it turns one Google event into a decision
//     (skip / delete / upsert these rows) and owns every rule about WHICH rows
//     are affected. It has direct unit tests (calendarSync.test.ts).
//   • `applyPageDecisions` is the IO half - it writes a whole page of decisions
//     with a small constant number of statements. It owns only WHEN the writes
//     are issued, never which rows they target.
//
// Before that split every event cost two sequential round-trips (an upsert plus
// an unconditional prune-delete), so a first connect - which expands recurring
// series into hundreds of instances - spent thousands of round-trips inside one
// invocation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getFreshAccessToken, googleGet, GoogleApiError, ReauthRequiredError } from "./google.ts";
import { expandWhen } from "./expandEvent.ts";

type Admin = ReturnType<typeof createClient>;

const LOCK_STALE_MS = 10 * 60 * 1000; // a lock older than this is considered dead
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 365;
const DEFAULT_TZ = "Europe/Belgrade";

/** How many google_event_ids go into one PostgREST `in.()` filter. The filter
 *  travels in the URL, so a whole 250-event page in a single filter would build
 *  a request line long enough for a proxy to reject; 100 ids keeps every URL a
 *  few KB while still costing only a couple of statements per page. */
const IDS_PER_FILTER = 100;

/** Columns (incl. the connection embed) syncOneCalendar needs - shared by both callers. */
export const CALENDAR_SELECT =
  "id, google_calendar_id, sharing, family_id, owner_user_id, sync_token, color, connection:google_connections(id, access_token, refresh_token, token_expires_at)";

export interface SyncCalendarRow {
  id: string;
  google_calendar_id: string;
  sharing: string;
  family_id: string;
  owner_user_id: string;
  sync_token: string | null;
  color: string | null;
  connection: {
    id: string;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: string | null;
  };
}

export interface GEvent {
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

export type SyncOutcome = "synced" | "reauth" | "skipped";

/** One day-row of a mirrored event, exactly as `external_calendar_events`
 *  stores it. */
export interface ExternalEventRow {
  calendar_id: string;
  family_id: string;
  owner_user_id: string;
  visibility: "family" | "private";
  google_event_id: string;
  ical_uid: string | null;
  recurring_event_id: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  color: string | null;
  event_type: string;
  status: string | null;
  html_link: string | null;
  source_url: string | null;
  synced_at: string;
  start_at: string | null;
  end_at: string | null;
  local_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
}

/** What one Google event should do to the mirror. `skip` is a genuine no-op
 *  (an event with no usable start); dropping an event the member cancelled,
 *  declined or chose not to import is a `delete`, not a `skip`. */
export type EventDecision =
  | { kind: "skip" }
  | { kind: "delete"; googleEventId: string }
  | {
      kind: "upsert";
      googleEventId: string;
      rows: ExternalEventRow[];
      /** The days this event now occupies - every other stored day is stale. */
      keepLocalDates: string[];
    };

type WriteDecision = Exclude<EventDecision, { kind: "skip" }>;
type UpsertDecision = Extract<EventDecision, { kind: "upsert" }>;

/**
 * Sync one calendar end-to-end under its lock. Safe to call concurrently - a
 * calendar already being synced by another run returns "skipped". On HTTP 410
 * (expired syncToken) the calendar's events are wiped and full-resynced.
 */
export async function syncOneCalendar(admin: Admin, cal: SyncCalendarRow): Promise<SyncOutcome> {
  if (!(await acquireLock(admin, cal.id))) return "skipped";

  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(admin, cal.connection);
  } catch (e) {
    await unlock(admin, cal.id);
    if (e instanceof ReauthRequiredError) return "reauth";
    throw e;
  }

  const visibility = cal.sharing === "family" ? "family" : "private";
  const tz = await getOwnerTz(admin, cal.owner_user_id);
  const skipTypes = await getSkipTypes(admin, cal.owner_user_id);

  try {
    const newToken = await pull(admin, accessToken, cal, visibility, tz, skipTypes, cal.sync_token);
    await finishSync(admin, cal.id, newToken);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 410) {
      // Expired syncToken: drop everything for this calendar and full-resync.
      await admin.from("external_calendar_events").delete().eq("calendar_id", cal.id);
      const newToken = await pull(admin, accessToken, cal, visibility, tz, skipTypes, null);
      await finishSync(admin, cal.id, newToken);
    } else {
      await unlock(admin, cal.id);
      throw e;
    }
  }
  return "synced";
}

/**
 * Counts events in the sync window for a calendar (one page, capped at 2500),
 * using `fields=items/id` so only event ids come over the wire - for the
 * picker's "events found" hint. Same window/expansion as the real sync so the
 * number reflects what would be mirrored. Returns null on error.
 */
export async function fetchEventCount(
  accessToken: string,
  googleCalendarId: string,
): Promise<{ count: number; capped: boolean } | null> {
  const now = Date.now();
  const p = new URLSearchParams({
    singleEvents: "true",
    maxResults: "2500",
    timeMin: new Date(now - WINDOW_PAST_DAYS * 86_400_000).toISOString(),
    timeMax: new Date(now + WINDOW_FUTURE_DAYS * 86_400_000).toISOString(),
    fields: "items/id,nextPageToken",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events?${p.toString()}`;
  try {
    const page = await googleGet<{ items?: { id: string }[]; nextPageToken?: string }>(
      accessToken,
      url,
    );
    return { count: (page.items ?? []).length, capped: !!page.nextPageToken };
  } catch {
    return null;
  }
}

/** Takes the per-calendar lock; returns false if another run holds a fresh one. */
async function acquireLock(admin: Admin, calendarId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  // Use count, NOT .select(): an UPDATE combining an or() filter with a
  // RETURNING/select makes PostgREST emit SQL that errors 42703 ("column
  // locked_at does not exist"). Counting the affected rows avoids that. The
  // timestamp is quoted so PostgREST doesn't mis-parse the ':'/'.' in the value.
  const { count, error } = await admin
    .from("google_calendars")
    .update({ locked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", calendarId)
    .or(`locked_at.is.null,locked_at.lt."${staleBefore}"`);
  if (error) console.error("gcal sync lock failed:", error.message);
  return (count ?? 0) > 0;
}

async function unlock(admin: Admin, calendarId: string): Promise<void> {
  await admin.from("google_calendars").update({ locked_at: null }).eq("id", calendarId);
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
  cal: SyncCalendarRow,
  visibility: "family" | "private",
  tz: string,
  skipTypes: Set<string>,
  syncToken: string | null,
): Promise<string | null> {
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const page = await googleGet<EventsPage>(
      accessToken,
      eventsUrl(cal.google_calendar_id, syncToken, pageToken),
    );
    // One `synced_at` for the whole page instead of one per event. Nothing reads
    // the column - it is bookkeeping - and a single stamp keeps a page's rows
    // consistent with each other.
    const syncedAt = new Date().toISOString();
    const decisions = (page.items ?? []).map((ev) =>
      decideEvent(cal, visibility, tz, skipTypes, ev, syncedAt),
    );
    await applyPageDecisions(admin, cal.id, decisions);
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

/**
 * The pure half of the sync: what one Google event should do to the mirror.
 * Every rule about WHICH rows are affected lives here - cancelled / declined /
 * skipped-type events are deleted, `visibility` rides along on every row, and a
 * multi-day event is sliced into one row per day. No IO, so it is unit-tested
 * directly.
 */
export function decideEvent(
  cal: SyncCalendarRow,
  visibility: "family" | "private",
  tz: string,
  skipTypes: Set<string>,
  ev: GEvent,
  syncedAt: string,
): EventDecision {
  // Cancelled, an invite the connecting member declined, or an event type they
  // chose not to import (contact birthdays / work markers / Gmail travel) →
  // ensure it's gone (it may have been stored before the rule changed).
  const selfDeclined = (ev.attendees ?? []).some((a) => a.self && a.responseStatus === "declined");
  if (ev.status === "cancelled" || selfDeclined || (ev.eventType && skipTypes.has(ev.eventType))) {
    return { kind: "delete", googleEventId: ev.id };
  }

  // A Google event spanning several days becomes one row per day - we have no
  // multi-day model locally, and the agenda buckets purely on local_date.
  const whens = expandWhen(ev, tz);
  if (whens.length === 0) return { kind: "skip" }; // no usable start - shouldn't happen with singleEvents=true

  // Fields shared by every day-row of this event.
  const common = {
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
    color: cal.color,
    event_type: ev.eventType ?? "default",
    status: ev.status ?? null,
    html_link: ev.htmlLink ?? null,
    source_url: ev.source?.url ?? null,
    synced_at: syncedAt,
  };
  const rows = whens.map((w) => ({
    ...common,
    start_at: w.startAt,
    end_at: w.endAt,
    local_date: w.localDate,
    start_time: w.startTime,
    end_time: w.endTime,
    is_all_day: w.isAllDay,
  }));

  return {
    kind: "upsert",
    googleEventId: ev.id,
    rows,
    keepLocalDates: whens.map((w) => w.localDate),
  };
}

/**
 * The IO half: writes a whole page of decisions with a small constant number of
 * statements instead of two per event.
 *
 *   1. one delete covering every `delete` decision (`google_event_id in (...)`)
 *   2. one upsert carrying every row of every `upsert` decision
 *   3. the prune, which no single statement can express - each event keeps its
 *      OWN day list - so we read the stored days for the page in one query and
 *      then prune only the events that actually shrank. A normal re-sync shrinks
 *      nothing and issues no prune at all; if that read fails we prune every
 *      event, which is exactly what the old per-event path always did.
 *
 * Decisions for the same google_event_id collapse to the last one, which is
 * what awaiting them one at a time used to do - and it keeps the batched upsert
 * free of duplicate conflict keys, which Postgres rejects outright.
 */
export async function applyPageDecisions(
  admin: Admin,
  calendarId: string,
  decisions: EventDecision[],
): Promise<void> {
  const byId = new Map<string, WriteDecision>();
  for (const d of decisions) {
    if (d.kind !== "skip") byId.set(d.googleEventId, d);
  }

  const deleteIds: string[] = [];
  const upserts: UpsertDecision[] = [];
  for (const d of byId.values()) {
    if (d.kind === "delete") deleteIds.push(d.googleEventId);
    else upserts.push(d);
  }

  // Read the stored days BEFORE the upsert: what comes back is exactly the state
  // the old per-event prune ran against. (The per-calendar lock means no other
  // sync is writing these rows meanwhile.)
  const stored =
    upserts.length > 0
      ? await storedLocalDates(
          admin,
          calendarId,
          upserts.map((u) => u.googleEventId),
        )
      : null;

  for (const part of chunked(deleteIds, IDS_PER_FILTER)) {
    const { error } = await admin
      .from("external_calendar_events")
      .delete()
      .eq("calendar_id", calendarId)
      .in("google_event_id", part);
    if (error) console.error("gcal sync delete failed:", error.message);
  }

  if (upserts.length > 0) {
    const { error } = await admin.from("external_calendar_events").upsert(
      upserts.flatMap((u) => u.rows),
      { onConflict: "calendar_id,google_event_id,local_date" },
    );
    if (error) {
      // The rows we mean to keep are not in place, so pruning now could drop
      // days that are still valid. Leave the mirror alone; the next sync (or the
      // 410 full resync) repairs it.
      console.error("gcal sync upsert failed:", error.message);
      return;
    }
  }

  // Prune day-rows left over from a previously longer span (e.g. the event was
  // shortened from 11-14 to 11-12): drop this event's rows whose day is no
  // longer part of it. Normal re-syncs match exactly here and delete nothing.
  for (const u of upserts) {
    if (stored && !hasStaleDay(stored.get(u.googleEventId), u.keepLocalDates)) continue;
    const keep = u.keepLocalDates.map((d) => `"${d}"`).join(",");
    const { error } = await admin
      .from("external_calendar_events")
      .delete()
      .eq("calendar_id", calendarId)
      .eq("google_event_id", u.googleEventId)
      .not("local_date", "in", `(${keep})`);
    if (error) console.error("gcal sync prune failed:", error.message);
  }
}

/** True when any day already stored for an event is no longer part of it. */
function hasStaleDay(storedDays: Set<string> | undefined, keepLocalDates: string[]): boolean {
  if (!storedDays || storedDays.size === 0) return false;
  const keep = new Set(keepLocalDates);
  for (const day of storedDays) {
    if (!keep.has(day)) return true;
  }
  return false;
}

/**
 * `google_event_id -> the local_dates currently stored`, or null when that state
 * could not be read in full (an error, or a result PostgREST truncated to the
 * project's max-rows). Null means "prune every event" - slower, never wrong.
 */
async function storedLocalDates(
  admin: Admin,
  calendarId: string,
  ids: string[],
): Promise<Map<string, Set<string>> | null> {
  const out = new Map<string, Set<string>>();
  for (const part of chunked(ids, IDS_PER_FILTER)) {
    const { data, error, status } = await admin
      .from("external_calendar_events")
      .select("google_event_id, local_date")
      .eq("calendar_id", calendarId)
      .in("google_event_id", part);
    if (error) {
      console.error("gcal sync prune probe failed:", error.message);
      return null;
    }
    // 206 Partial Content means max-rows cut the result off, so we cannot tell
    // which days are really stored.
    if (status === 206) {
      console.warn("gcal sync prune probe truncated - pruning every event");
      return null;
    }
    for (const row of (data ?? []) as { google_event_id: string; local_date: string }[]) {
      let days = out.get(row.google_event_id);
      if (!days) {
        days = new Set<string>();
        out.set(row.google_event_id, days);
      }
      days.add(row.local_date);
    }
  }
  return out;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function getOwnerTz(admin: Admin, ownerUserId: string): Promise<string> {
  const { data } = await admin
    .from("notification_preferences")
    .select("timezone")
    .eq("user_id", ownerUserId)
    .maybeSingle();
  return data?.timezone || DEFAULT_TZ;
}

interface SyncPrefs {
  import_from_gmail: boolean;
  import_birthdays: boolean;
  import_work_markers: boolean;
}

// Member with no prefs row uses these - Gmail travel ON, the rest OFF (noise).
const DEFAULT_PREFS: SyncPrefs = {
  import_from_gmail: true,
  import_birthdays: false,
  import_work_markers: false,
};

/** The set of eventTypes NOT to mirror, from the owner's import prefs. `default`
 *  (and any unknown/future type) is never skipped - skip-list, not allow-list. */
async function getSkipTypes(admin: Admin, ownerUserId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("google_sync_preferences")
    .select("import_from_gmail, import_birthdays, import_work_markers")
    .eq("user_id", ownerUserId)
    .maybeSingle();
  const p = (data as SyncPrefs | null) ?? DEFAULT_PREFS;
  const skip = new Set<string>();
  if (!p.import_from_gmail) skip.add("fromGmail");
  if (!p.import_birthdays) skip.add("birthday");
  if (!p.import_work_markers) {
    skip.add("outOfOffice");
    skip.add("focusTime");
    skip.add("workingLocation");
  }
  return skip;
}
