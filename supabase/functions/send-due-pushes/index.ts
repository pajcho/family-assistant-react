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

  // Per-payment reminders work like event reminders but anchor on
  // `due_date - remind_days_before` at each recipient's `morning_time`.
  const paymentResults = await processPaymentReminders(supabase);
  results.push(...paymentResults);

  // Per-activity reminders — same idea as event reminders but the
  // "occurrence" is computed by walking weekly schedule rules per
  // participant (respecting A/B shift patterns, every-N-week intervals,
  // active-from/to seasons, and per-person overrides).
  const activityResults = await processActivityReminders(supabase);
  results.push(...activityResults);

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

// ---------------------------------------------------------------------------
// Per-payment reminders
// ---------------------------------------------------------------------------

interface PaymentRow {
  id: string;
  family_id: string;
  name: string;
  amount: number;
  due_date: string;
  remind_days_before: number;
}

async function processPaymentReminders(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<unknown[]> {
  // Pull unpaid / unpaused payments whose due_date is close enough to
  // potentially fire today. We keep the window generous (covers the
  // longest preset + a day of tz buffer) and narrow the actual fire
  // decision per-user below.
  const utcToday = new Date().toISOString().slice(0, 10);
  const windowStart = addDays(utcToday, -1);
  const windowEnd = addDays(utcToday, 14);

  const { data: payments, error } = await supabase
    .from("payments")
    .select("id, family_id, name, amount, due_date, remind_days_before")
    .not("remind_days_before", "is", null)
    .eq("is_paid", false)
    .eq("is_paused", false)
    .gte("due_date", windowStart)
    .lte("due_date", windowEnd);
  if (error) return [{ kind: "payment_reminder", error: error.message }];

  const out: unknown[] = [];
  for (const pay of (payments ?? []) as PaymentRow[]) {
    out.push(...(await dispatchPaymentReminder(supabase, pay)));
  }
  return out;
}

async function dispatchPaymentReminder(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  pay: PaymentRow,
): Promise<unknown[]> {
  // Payments are family-scoped — everyone in the family gets the
  // reminder. The fire time is anchored on each recipient's
  // `morning_time` (in their tz), so two members in different zones can
  // see the same reminder at different absolute instants.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("family_id", pay.family_id);
  const memberIds = ((profiles ?? []) as { id: string }[]).map((p) => p.id);
  if (memberIds.length === 0) return [];

  const fireDate = addDays(pay.due_date, -pay.remind_days_before);
  const out: unknown[] = [];

  for (const userId of memberIds) {
    // morning_time + timezone live on notification_preferences. If the
    // user never opened the settings page we still want a sane fallback
    // (08:00 Europe/Belgrade matches the table defaults).
    const { data: pref } = await supabase
      .from("notification_preferences")
      .select("morning_time, timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const tz = (pref as { timezone?: string } | null)?.timezone ?? "Europe/Belgrade";
    const fireHHMM =
      ((pref as { morning_time?: string } | null)?.morning_time ?? "08:00").slice(0, 5);

    if (localDateISO(tz) !== fireDate || localTime(tz) !== fireHHMM) continue;

    // ref_id ties the log row to (payment, occurrence). For recurring
    // payments, when due_date rolls forward the ref_id changes, so the
    // next occurrence gets its own log row and can fire again.
    const refId = `${pay.id}:${pay.due_date}`;
    const { error: logError } = await supabase
      .from("notification_log")
      .insert({ user_id: userId, kind: "payment_reminder", ref_id: refId });
    if (logError) {
      if (logError.code === "23505") {
        out.push({
          user_id: userId,
          kind: "payment_reminder",
          payment_id: pay.id,
          status: "already_sent",
        });
        continue;
      }
      out.push({
        user_id: userId,
        kind: "payment_reminder",
        payment_id: pay.id,
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
        kind: "payment_reminder",
        payment_id: pay.id,
        status: "no_subscriptions",
      });
      continue;
    }

    const body = paymentReminderBody(pay);
    const payload = JSON.stringify({
      title: pay.name,
      body,
      url: "/payments",
      tag: `payment-reminder-${pay.id}-${pay.due_date}`,
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
    out.push({ user_id: userId, kind: "payment_reminder", payment_id: pay.id, sent, dead });
  }
  return out;
}

function paymentReminderBody(pay: PaymentRow): string {
  const amount = formatAmount(pay.amount);
  if (pay.remind_days_before === 0) return `Dospeva danas: ${amount} RSD.`;
  if (pay.remind_days_before === 1) return `Dospeva sutra: ${amount} RSD.`;
  return `Dospeva za ${pay.remind_days_before} dana: ${amount} RSD.`;
}

function formatAmount(amount: number): string {
  // Serbian thousands separator is ".", and these amounts are always
  // whole-RSD in this app — keep formatting minimal and locale-correct.
  return new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 }).format(amount);
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

// ---------------------------------------------------------------------------
// Per-activity reminders
// ---------------------------------------------------------------------------
//
// Activities are weekly recurring schedules with multi-person participants
// and per-occurrence overrides. To decide if a reminder fires *now*, we
// replicate the frontend resolver inline (Deno can't import frontend
// utils) and then match against each participant's local clock.
//
// Idempotency key extends the event_reminder pattern with the date and
// person — `<schedule_id>:<YYYY-MM-DD>:<person_id>` — so the same rule
// firing in different weeks logs independently and each participant
// claims their own slot.

interface ActivityRow {
  id: string;
  family_id: string;
  name: string;
  active_from: string | null;
  active_to: string | null;
  is_paused: boolean;
  remind_minutes_before: number;
  created_at: string;
}

interface ScheduleRuleRow {
  id: string;
  activity_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  week_pattern: "every" | "A" | "B";
  recurrence_interval_weeks: number;
}

interface ParticipantRow {
  activity_id: string;
  person_id: string;
}

interface ActivityOverrideRow {
  id: string;
  schedule_id: string;
  person_id: string;
  date: string;
  action: "cancel" | "reschedule";
  override_start_time: string | null;
  override_end_time: string | null;
  override_date: string | null;
}

interface ShiftAnchorRow {
  person_id: string;
  anchor_week_start: string;
  anchor_shift: "morning" | "afternoon";
  flip_interval_weeks: number;
  is_alternating: boolean;
}

interface PrefsTzRow {
  user_id: string;
  timezone: string;
}

interface ProfileLiteRow {
  id: string;
  family_id: string;
  first_name: string | null;
  last_name: string | null;
}

const FAMILY_TZ_DEFAULT = "Europe/Belgrade";

async function processActivityReminders(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<unknown[]> {
  // One round trip for each table — small datasets per family, plenty fast.
  // Profile + push-subscription bulk pulls let us dispatch each reminder
  // to every push-subscribed family member without per-occurrence queries.
  const [actsRes, schedRes, partsRes, ovRes, anchorsRes, prefsRes, profilesRes, subsRes] =
    await Promise.all([
      supabase
        .from("activities")
        .select(
          "id, family_id, name, active_from, active_to, is_paused, remind_minutes_before, created_at",
        )
        .not("remind_minutes_before", "is", null)
        .eq("is_paused", false),
      supabase
        .from("activity_schedule")
        .select(
          "id, activity_id, day_of_week, start_time, end_time, week_pattern, recurrence_interval_weeks",
        ),
      supabase.from("activity_participants").select("activity_id, person_id"),
      supabase
        .from("activity_overrides")
        .select(
          "id, schedule_id, person_id, date, action, override_start_time, override_end_time, override_date",
        ),
      supabase
        .from("school_shift_anchors")
        .select(
          "person_id, anchor_week_start, anchor_shift, flip_interval_weeks, is_alternating",
        ),
      supabase.from("notification_preferences").select("user_id, timezone"),
      supabase.from("profiles").select("id, family_id, first_name, last_name"),
      supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth"),
    ]);

  const activities = (actsRes.data ?? []) as ActivityRow[];
  if (activities.length === 0) return [];

  const schedule = (schedRes.data ?? []) as ScheduleRuleRow[];
  const participants = (partsRes.data ?? []) as ParticipantRow[];
  const overrides = (ovRes.data ?? []) as ActivityOverrideRow[];
  const anchors = (anchorsRes.data ?? []) as ShiftAnchorRow[];
  const prefs = (prefsRes.data ?? []) as PrefsTzRow[];
  const profiles = (profilesRes.data ?? []) as ProfileLiteRow[];
  const subs = (subsRes.data ?? []) as (PushSub & { user_id: string })[];

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const ruleById = new Map(schedule.map((r) => [r.id, r]));
  const anchorByPerson = new Map(anchors.map((a) => [a.person_id, a]));
  const tzByUser = new Map(prefs.map((p) => [p.user_id, p.timezone]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const profilesByFamily = new Map<string, ProfileLiteRow[]>();
  for (const p of profiles) {
    const arr = profilesByFamily.get(p.family_id);
    if (arr) arr.push(p);
    else profilesByFamily.set(p.family_id, [p]);
  }
  const subsByUser = new Map<string, (PushSub & { user_id: string })[]>();
  for (const s of subs) {
    const arr = subsByUser.get(s.user_id);
    if (arr) arr.push(s);
    else subsByUser.set(s.user_id, [s]);
  }
  // Index for O(1) override lookup by (schedule_id, date, person_id).
  const overrideKey = (sid: string, date: string, pid: string) =>
    `${sid}|${date}|${pid}`;
  const overrideByKey = new Map<string, ActivityOverrideRow>();
  for (const o of overrides) {
    overrideByKey.set(overrideKey(o.schedule_id, o.date, o.person_id), o);
  }
  const personsByActivity = new Map<string, string[]>();
  for (const p of participants) {
    const arr = personsByActivity.get(p.activity_id);
    if (arr) arr.push(p.person_id);
    else personsByActivity.set(p.activity_id, [p.person_id]);
  }

  // Pick a "family timezone" for day-of-week / today computations. Any
  // auth user's tz works because we assume family members share locale;
  // falls back to Belgrade so kid-only activities still resolve.
  function familyTz(familyId: string): string {
    const familyProfiles = profilesByFamily.get(familyId) ?? [];
    for (const p of familyProfiles) {
      const tz = tzByUser.get(p.id);
      if (tz) return tz;
    }
    return FAMILY_TZ_DEFAULT;
  }

  const out: unknown[] = [];

  // Pass 1 — walk rules × participants. We use the family's timezone
  // for the day-of-week and override lookup (the rule's day-of-week
  // is in the family's wall clock, not any individual user's), then
  // dispatch to every push-subscribed user in the family with the
  // per-recipient tz check happening inside the dispatch helper.
  for (const rule of schedule) {
    const activity = activityById.get(rule.activity_id);
    if (!activity) continue;
    const persons = personsByActivity.get(activity.id);
    if (!persons || persons.length === 0) continue;

    const tz = familyTz(activity.family_id);
    const familyToday = localDateISO(tz);

    for (const personId of persons) {
      if (
        !matchesRuleOnDate(
          activity,
          rule,
          anchorByPerson.get(personId),
          familyToday,
          personId,
        )
      ) {
        continue;
      }

      const override = overrideByKey.get(overrideKey(rule.id, familyToday, personId));
      let effectiveStart = rule.start_time.slice(0, 5);
      if (override) {
        if (override.action === "cancel") continue;
        if (override.action === "reschedule") {
          const movedAway =
            !!override.override_date && override.override_date !== familyToday;
          if (movedAway) continue; // fires on a different day; pass 2 handles it
          if (override.override_start_time) {
            effectiveStart = override.override_start_time.slice(0, 5);
          }
        }
      }

      out.push(
        ...(await dispatchActivityReminder(
          supabase,
          activity,
          personId,
          rule.id,
          familyToday,
          effectiveStart,
          profileById,
          profilesByFamily,
          subsByUser,
          tzByUser,
        )),
      );
    }
  }

  // Pass 2 — moved-here overrides whose new date is today in the family tz.
  for (const ov of overrides) {
    if (ov.action !== "reschedule") continue;
    if (!ov.override_date) continue;
    if (ov.override_date === ov.date) continue; // same-day handled in pass 1
    if (!ov.override_start_time) continue;

    const rule = ruleById.get(ov.schedule_id);
    if (!rule) continue;
    const activity = activityById.get(rule.activity_id);
    if (!activity) continue;
    if (!activity.remind_minutes_before) continue;

    const tz = familyTz(activity.family_id);
    const familyToday = localDateISO(tz);
    if (ov.override_date !== familyToday) continue;

    if (activity.active_from && ov.override_date < activity.active_from) continue;
    if (activity.active_to && ov.override_date > activity.active_to) continue;
    // Participant might have been removed from the activity after the
    // override was set — same silent-skip-and-reactivate semantic.
    const persons = personsByActivity.get(activity.id);
    if (!persons?.includes(ov.person_id)) continue;

    const effectiveStart = ov.override_start_time.slice(0, 5);

    out.push(
      ...(await dispatchActivityReminder(
        supabase,
        activity,
        ov.person_id,
        rule.id,
        ov.override_date,
        effectiveStart,
        profileById,
        profilesByFamily,
        subsByUser,
        tzByUser,
      )),
    );
  }

  return out;
}

/**
 * Returns true if `rule` fires on `localDate` for `personId`, ignoring any
 * override row (override application happens after this check so a cancel
 * can still see the underlying "would have fired" state).
 */
function matchesRuleOnDate(
  activity: ActivityRow,
  rule: ScheduleRuleRow,
  shiftAnchor: ShiftAnchorRow | undefined,
  localDate: string,
  _personId: string,
): boolean {
  // Day-of-week
  const localDow = mondayFirstDowFor(localDate);
  if (rule.day_of_week !== localDow) return false;

  // Active window
  if (activity.active_from && localDate < activity.active_from) return false;
  if (activity.active_to && localDate > activity.active_to) return false;

  // Every-N-weeks modulo against the activity's anchor (Monday of
  // active_from or created_at).
  const interval = Math.max(1, Math.floor(rule.recurrence_interval_weeks || 1));
  if (interval > 1) {
    const anchorSource = (activity.active_from ?? activity.created_at).slice(0, 10);
    const diff = weeksBetweenMondays(mondayOfWeek(anchorSource), mondayOfWeek(localDate));
    if (diff < 0 || diff % interval !== 0) return false;
  }

  // A/B pattern via this person's shift anchor.
  if (rule.week_pattern !== "every") {
    if (!shiftAnchor) return false;
    const shift = deriveShiftForWeek(shiftAnchor, mondayOfWeek(localDate));
    if (rule.week_pattern === "A" && shift !== "morning") return false;
    if (rule.week_pattern === "B" && shift !== "afternoon") return false;
  }

  return true;
}

/**
 * Send the reminder to every push-subscribed family member. The
 * participant is who the activity is FOR (often a kid without a login);
 * the recipients are whoever in the family actually has push subscriptions
 * (typically the parents). Each recipient gets their own idempotency log
 * row keyed by user_id + ref_id so the UNIQUE constraint allows multiple
 * parents to receive the same occurrence.
 *
 * Body wording flips based on whether the recipient is also the
 * participant — "Trening fudbala" for self, "Lucija • Trening fudbala"
 * for a parent receiving a kid's reminder.
 */
async function dispatchActivityReminder(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  activity: ActivityRow,
  participantPersonId: string,
  scheduleId: string,
  occurrenceDate: string,
  effectiveStart: string,
  profileById: ReadonlyMap<string, ProfileLiteRow>,
  profilesByFamily: ReadonlyMap<string, ProfileLiteRow[]>,
  subsByUser: ReadonlyMap<string, (PushSub & { user_id: string })[]>,
  tzByUser: ReadonlyMap<string, string>,
): Promise<unknown[]> {
  const refId = `${scheduleId}:${occurrenceDate}:${participantPersonId}`;
  const familyProfiles = profilesByFamily.get(activity.family_id) ?? [];
  const out: unknown[] = [];

  const participant = profileById.get(participantPersonId);
  const participantName = participant
    ? [participant.first_name, participant.last_name].filter(Boolean).join(" ").trim()
    : "";

  for (const recipient of familyProfiles) {
    const recipientId = recipient.id;
    const subList = subsByUser.get(recipientId);
    if (!subList || subList.length === 0) continue; // no push → not a recipient

    const recipientTz = tzByUser.get(recipientId) ?? FAMILY_TZ_DEFAULT;
    const fire = eventLocalFireTime(
      occurrenceDate,
      effectiveStart,
      activity.remind_minutes_before,
    );
    if (
      localDateISO(recipientTz) !== fire.date ||
      localTime(recipientTz) !== fire.time
    ) {
      continue;
    }

    const { error: logError } = await supabase
      .from("notification_log")
      .insert({ user_id: recipientId, kind: "activity_reminder", ref_id: refId });
    if (logError) {
      if (logError.code === "23505") {
        out.push({
          user_id: recipientId,
          kind: "activity_reminder",
          ref_id: refId,
          status: "already_sent",
        });
        continue;
      }
      out.push({
        user_id: recipientId,
        kind: "activity_reminder",
        ref_id: refId,
        error: logError.message,
      });
      continue;
    }

    const isForSelf = recipientId === participantPersonId;
    const title =
      isForSelf || !participantName ? activity.name : `${participantName} • ${activity.name}`;
    const payload = JSON.stringify({
      title,
      body: `Počinje za ${activity.remind_minutes_before} min (u ${effectiveStart}).`,
      url: "/activities",
      tag: `activity-reminder-${refId}-${recipientId}`,
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
    out.push({
      user_id: recipientId,
      kind: "activity_reminder",
      ref_id: refId,
      sent,
      dead,
    });
  }
  return out;
}

// --- activity resolver helpers (ported from src/utils/activity.ts) ---------

function mondayFirstDowFor(yyyymmdd: string): number {
  // JS Date.getUTCDay returns 0=Sun..6=Sat; the frontend uses 0=Mon..6=Sun.
  const d = new Date(yyyymmdd + "T12:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

function mondayOfWeek(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function weeksBetweenMondays(fromMondayISO: string, toMondayISO: string): number {
  const from = Date.parse(fromMondayISO + "T12:00:00Z");
  const to = Date.parse(toMondayISO + "T12:00:00Z");
  return Math.round((to - from) / (7 * 24 * 60 * 60 * 1000));
}

function deriveShiftForWeek(
  anchor: ShiftAnchorRow,
  targetMondayISO: string,
): "morning" | "afternoon" {
  if (!anchor.is_alternating) return anchor.anchor_shift;
  const interval = Math.max(1, Math.floor(anchor.flip_interval_weeks || 1));
  const diff = weeksBetweenMondays(anchor.anchor_week_start, targetMondayISO);
  const flips = Math.floor(diff / interval);
  const flipsMod = ((flips % 2) + 2) % 2;
  if (flipsMod === 0) return anchor.anchor_shift;
  return anchor.anchor_shift === "morning" ? "afternoon" : "morning";
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
