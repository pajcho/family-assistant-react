// supabase/functions/send-due-pushes/index.ts
//
// Cron-triggered every minute. Two independent dispatch paths:
//
//   1. Digests — for each user with `morning_enabled` / `evening_enabled`,
//      check if the current minute in their timezone matches their
//      configured time and (if so + nothing logged for today) send a
//      summary push.
//
//   2. Per-event reminders — for each `events` row with a non-null
//      `remind_minutes_before` AND `start_time`, compute the wall-clock
//      reminder time. Every family member with a push subscription gets
//      the reminder when their local clock hits that minute.
//
// Idempotency for both paths via `notification_log` UNIQUE(user_id,
// kind, ref_id). Dead subscriptions (410 / 404) are deleted on the way
// out so we don't keep round-tripping to nonexistent push endpoints.
//
// Manual testing knobs (only when X-Cron-Secret matches):
//   ?force=morning   → ignore the time check, always try the morning digest
//   ?force=evening   → ignore the time check, always try the evening digest
//
// Auth: verify_jwt is disabled (see supabase/config.toml). We require
// an `X-Cron-Secret: <CRON_SECRET>` header. The cron job in Postgres
// sets the same header; manual tests use `curl -H "X-Cron-Secret: …"`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

type DigestKind = "morning_digest" | "evening_digest";

interface NotificationPrefs {
  user_id: string;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  timezone: string;
}

interface PushSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  const cronHeader = req.headers.get("X-Cron-Secret");
  if (!CRON_SECRET || cronHeader !== CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const forceParam = url.searchParams.get("force");
  const force: DigestKind | null =
    forceParam === "morning"
      ? "morning_digest"
      : forceParam === "evening"
        ? "evening_digest"
        : null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: prefs, error: prefsError } = await supabase
    .from("notification_preferences")
    .select("user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone")
    .or("morning_enabled.eq.true,evening_enabled.eq.true");

  if (prefsError) {
    return Response.json({ error: prefsError.message }, { status: 500 });
  }

  const results: unknown[] = [];
  for (const pref of (prefs ?? []) as NotificationPrefs[]) {
    if (pref.morning_enabled || force === "morning_digest") {
      if (force === "morning_digest" || isCurrentMinute(pref.timezone, pref.morning_time)) {
        results.push(await processDigest(supabase, pref, "morning_digest"));
      }
    }
    if (pref.evening_enabled || force === "evening_digest") {
      if (force === "evening_digest" || isCurrentMinute(pref.timezone, pref.evening_time)) {
        results.push(await processDigest(supabase, pref, "evening_digest"));
      }
    }
  }

  // Per-event reminders run on every tick regardless of force= mode —
  // they don't have a "force" semantic; the reminder time is encoded
  // on the event itself.
  const reminderResults = await processEventReminders(supabase);
  results.push(...reminderResults);

  return Response.json({ ok: true, force, processed: results });
});

async function processDigest(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  pref: NotificationPrefs,
  kind: DigestKind,
) {
  const todayLocal = localDateISO(pref.timezone);
  const targetDate = kind === "morning_digest" ? todayLocal : addDays(todayLocal, 1);
  const summaryNoun = kind === "morning_digest" ? "Danas" : "Sutra";
  const title = kind === "morning_digest" ? "Dobro jutro" : "Pregled za sutra";

  // Idempotency: try to insert the log row first. If the UNIQUE
  // (user_id, kind, ref_id) constraint trips, another invocation
  // already handled this exact digest. We bail without sending.
  const { error: logError } = await supabase
    .from("notification_log")
    .insert({ user_id: pref.user_id, kind, ref_id: targetDate });
  if (logError) {
    if (logError.code === "23505") {
      return { user_id: pref.user_id, kind, status: "already_sent" };
    }
    return { user_id: pref.user_id, kind, error: logError.message };
  }

  // Resolve the user's family — events / payments / birthdays are
  // family-scoped, not user-scoped.
  const { data: profile } = await supabase
    .from("profiles")
    .select("family_id")
    .eq("id", pref.user_id)
    .maybeSingle();
  if (!profile?.family_id) {
    return { user_id: pref.user_id, kind, status: "no_family" };
  }

  const [eventsRes, paymentsRes, birthdaysRes] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, start_time")
      .eq("family_id", profile.family_id)
      .eq("date", targetDate)
      .order("start_time", { ascending: true, nullsFirst: false }),
    supabase
      .from("payments")
      .select("id, name, amount")
      .eq("family_id", profile.family_id)
      .eq("due_date", targetDate)
      .eq("is_paid", false)
      .eq("is_paused", false),
    supabase.from("birthdays").select("id, name, birth_date").eq("family_id", profile.family_id),
  ]);

  const events = (eventsRes.data ?? []) as { id: string; name: string }[];
  const payments = (paymentsRes.data ?? []) as { id: string; name: string }[];
  const birthdays = (
    (birthdaysRes.data ?? []) as { id: string; name: string; birth_date: string }[]
  ).filter((b) => sameMonthDay(b.birth_date, targetDate));

  if (events.length === 0 && payments.length === 0 && birthdays.length === 0) {
    return { user_id: pref.user_id, kind, status: "nothing_to_send" };
  }

  const counts: string[] = [];
  if (events.length)
    counts.push(`${events.length} ${plural(events.length, "događaj", "događaja")}`);
  if (payments.length)
    counts.push(`${payments.length} ${plural(payments.length, "plaćanje", "plaćanja")}`);
  if (birthdays.length)
    counts.push(`${birthdays.length} ${plural(birthdays.length, "rođendan", "rođendana")}`);

  const body = `${summaryNoun}: ${counts.join(", ")}.`;

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", pref.user_id);
  const subList = (subs ?? []) as PushSub[];

  if (subList.length === 0) {
    return { user_id: pref.user_id, kind, status: "no_subscriptions" };
  }

  const payload = JSON.stringify({ title, body, url: "/", tag: `${kind}-${targetDate}` });

  let sent = 0;
  let dead = 0;
  for (const sub of subList) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const status = (e as any)?.statusCode as number | undefined;
      if (status === 404 || status === 410) {
        // Subscription is gone — drop it so we don't keep paying for
        // dead push-service round-trips on every cron tick.
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        dead++;
      }
    }
  }

  return { user_id: pref.user_id, kind, ref_id: targetDate, sent, dead, body };
}

// ---------------------------------------------------------------------------
// Per-event reminders
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  family_id: string;
  name: string;
  date: string;
  start_time: string;
  remind_minutes_before: number;
}

async function processEventReminders(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<unknown[]> {
  // Pull events whose date is within ±1 day of UTC "today". The actual
  // fire time is timezone-dependent so this is a deliberately wide
  // filter — the per-event check below narrows down to the exact
  // minute in each recipient's local clock.
  const utcDate = new Date().toISOString().slice(0, 10);
  const window = [addDays(utcDate, -1), utcDate, addDays(utcDate, 1)];

  const { data: events, error } = await supabase
    .from("events")
    .select("id, family_id, name, date, start_time, remind_minutes_before")
    .not("remind_minutes_before", "is", null)
    .not("start_time", "is", null)
    .in("date", window);
  if (error) return [{ kind: "event_reminder", error: error.message }];

  const out: unknown[] = [];
  for (const ev of (events ?? []) as EventRow[]) {
    out.push(...(await dispatchEventReminder(supabase, ev)));
  }
  return out;
}

async function dispatchEventReminder(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ev: EventRow,
): Promise<unknown[]> {
  // Everyone in this family is a candidate recipient — the reminder is
  // stored on the event itself, so it isn't tied to one user.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("family_id", ev.family_id);
  const memberIds = ((profiles ?? []) as { id: string }[]).map((p) => p.id);
  if (memberIds.length === 0) return [];

  const fire = eventLocalFireTime(ev.date, ev.start_time, ev.remind_minutes_before);
  const out: unknown[] = [];

  for (const userId of memberIds) {
    // Resolve the user's timezone (default if they never opened settings).
    const { data: pref } = await supabase
      .from("notification_preferences")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const tz = (pref as { timezone?: string } | null)?.timezone ?? "Europe/Belgrade";

    if (localDateISO(tz) !== fire.date || localTime(tz) !== fire.time) continue;

    // Idempotent: claim the slot before sending. UNIQUE(user_id, kind,
    // ref_id) means a parallel cron retry can't double-fire.
    const { error: logError } = await supabase
      .from("notification_log")
      .insert({ user_id: userId, kind: "event_reminder", ref_id: ev.id });
    if (logError) {
      if (logError.code === "23505") {
        out.push({
          user_id: userId,
          kind: "event_reminder",
          event_id: ev.id,
          status: "already_sent",
        });
        continue;
      }
      out.push({
        user_id: userId,
        kind: "event_reminder",
        event_id: ev.id,
        error: logError.message,
      });
      continue;
    }

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    const subList = (subs ?? []) as PushSub[];

    if (subList.length === 0) {
      out.push({
        user_id: userId,
        kind: "event_reminder",
        event_id: ev.id,
        status: "no_subscriptions",
      });
      continue;
    }

    const startHHMM = ev.start_time.slice(0, 5);
    const payload = JSON.stringify({
      title: ev.name,
      body: `Počinje za ${ev.remind_minutes_before} min (u ${startHHMM}).`,
      url: "/events",
      tag: `event-reminder-${ev.id}`,
    });

    let sent = 0;
    let dead = 0;
    for (const sub of subList) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const status = (e as any)?.statusCode as number | undefined;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          dead++;
        }
      }
    }
    out.push({ user_id: userId, kind: "event_reminder", event_id: ev.id, sent, dead });
  }
  return out;
}

/**
 * Given an event's date + start_time + offset, return the wall-clock
 * date+time of the reminder. Handles day-rollover when an event near
 * midnight has an offset that crosses the previous day boundary
 * (e.g. event at 00:15 with `remind_minutes_before=30` → previous-day 23:45).
 */
function eventLocalFireTime(
  eventDate: string,
  startTimeHHMMSS: string,
  remindMinutesBefore: number,
): { date: string; time: string } {
  const [h, m] = startTimeHHMMSS.split(":").map(Number);
  const totalMinutes = h * 60 + m - remindMinutesBefore;
  if (totalMinutes >= 0) {
    return {
      date: eventDate,
      time: `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`,
    };
  }
  const prev = addDays(eventDate, -1);
  const prevMinutes = 24 * 60 + totalMinutes;
  return { date: prev, time: `${pad2(Math.floor(prevMinutes / 60))}:${pad2(prevMinutes % 60)}` };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// --- helpers ---------------------------------------------------------------

function isCurrentMinute(tz: string, pgTime: string): boolean {
  // Postgres TIME can come back as "HH:MM:SS"; the digest setting is
  // a wall-clock time, so we only care about the HH:MM portion.
  return localTime(tz) === pgTime.slice(0, 5);
}

function localTime(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return "";
  }
}

function localDateISO(tz: string): string {
  // en-CA gives us YYYY-MM-DD, which lines up with Postgres DATE
  // representation regardless of the user's locale preferences.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sameMonthDay(birthISO: string, dateISO: string): boolean {
  // birthISO can be "YYYY-MM-DD"; we only compare MM-DD so birthdays
  // recur every year.
  return birthISO.slice(5) === dateISO.slice(5);
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}
