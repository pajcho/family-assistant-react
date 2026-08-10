// supabase/functions/send-due-pushes/index.ts
//
// Cron-triggered every minute. Six dispatch paths (digests, event / payment /
// activity / external-calendar / task reminders) all decided by `plan.ts`, which
// is pure and unit-tested. This file is only the I/O shell:
//
//   1. one Promise.all of bulk reads -> every row the job could need
//   2. planDispatch() -> the exact list of pushes due this minute
//   3. one `notification_log` upsert -> claims every slot at once
//   4. send whatever the claim granted
//   5. one delete for subscriptions the push services reported as gone
//
// That is a fixed ~15 queries per tick no matter how many families exist. The
// shape before this rewrite was N+1 per user per item: 512 PostgREST requests
// per tick at 40 users, growing linearly with the number of families.
//
// Idempotency is unchanged and still enforced by Postgres: `notification_log`
// has UNIQUE(user_id, kind, ref_id), and the claim upsert runs with
// `ignoreDuplicates`, so its RETURNING clause hands back exactly the rows this
// invocation won. Anything not returned was already sent by an earlier tick.
//
// Manual testing knobs (only when X-Cron-Secret matches):
//   ?force=morning   → ignore the time check, always try the morning digest
//   ?force=evening   → ignore the time check, always try the evening digest
//
// Auth: verify_jwt is disabled (see supabase/config.toml). We require an
// `X-Cron-Secret: <CRON_SECRET>` header. The cron job in Postgres sets the same
// header; manual tests use `curl -H "X-Cron-Secret: …"`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

import type { TaskOccurrenceRecord } from "../_shared/expandTask.ts";
import {
  addDays,
  type ActivityOverrideRow,
  type ActivityRow,
  type BirthdayRow,
  type DigestKind,
  type EventRow,
  EVENT_WINDOW_DAYS_AFTER,
  EVENT_WINDOW_DAYS_BEFORE,
  type ExternalEventRow,
  type ExternalLocalRow,
  type ParticipantRow,
  PAYMENT_WINDOW_DAYS_AFTER,
  type PaymentRow,
  type PlannedClaim,
  planDispatch,
  type PrefsRow,
  type ProfileRow,
  type PushSubRow,
  type ScheduleRuleRow,
  type ShiftAnchorRow,
  TASK_WINDOW_DAYS_AFTER,
  type TaskRow,
  utcDateOf,
} from "./plan.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// SERVICE_KEY override mirrors the other functions: local dev's auto-injected
// SUPABASE_SERVICE_ROLE_KEY can be the legacy HS256 JWT that the new auth service
// rejects (so RLS-scoped reads come back empty); the override is the correct key.
// SERVICE_KEY is unset in prod, so we fall back to the injected key there.
const SERVICE_ROLE = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

/**
 * How many pushes are in flight at once. The old code awaited every send in
 * sequence, so a morning digest for the whole user base serialised into one
 * long tail; the claim is already taken by then, so overlapping the network
 * waits changes nothing about what gets sent.
 */
const SEND_CONCURRENCY = 8;

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

  // One instant for the whole tick. The old code called `new Date()` inside
  // every clock comparison, so a slow invocation could straddle a minute
  // boundary and fire two different minutes' worth of reminders.
  const now = new Date();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let context;
  try {
    context = await loadDispatchContext(supabase, now);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const claims = planDispatch({ now, force, ...context });
  const processed = await claimAndSend(supabase, claims);

  return Response.json({ ok: true, force, processed });
});

// ---------------------------------------------------------------------------
// 1. Bulk reads
// ---------------------------------------------------------------------------

interface DispatchContext {
  prefs: PrefsRow[];
  profiles: ProfileRow[];
  subs: PushSubRow[];
  events: EventRow[];
  payments: PaymentRow[];
  birthdays: BirthdayRow[];
  externalLocals: ExternalLocalRow[];
  externalEvents: ExternalEventRow[];
  activities: ActivityRow[];
  schedule: ScheduleRuleRow[];
  participants: ParticipantRow[];
  overrides: ActivityOverrideRow[];
  anchors: ShiftAnchorRow[];
  tasks: TaskRow[];
  taskOccurrences: TaskOccurrenceRecord[];
}

/**
 * Every row any dispatch path could need, in one round trip.
 *
 * The date windows are deliberately wide: the exact fire minute is decided
 * per recipient timezone in `plan.ts`, and local dates span UTC-12..UTC+14.
 * At 150 users this is a few hundred rows; paginating only becomes relevant
 * somewhere north of 10.000 users.
 */
async function loadDispatchContext(
  supabase: ReturnType<typeof createClient>,
  now: Date,
): Promise<DispatchContext> {
  const utcToday = utcDateOf(now);
  const windowStart = addDays(utcToday, -EVENT_WINDOW_DAYS_BEFORE);
  const eventWindowEnd = addDays(utcToday, EVENT_WINDOW_DAYS_AFTER);
  const paymentWindowEnd = addDays(utcToday, PAYMENT_WINDOW_DAYS_AFTER);
  const taskWindowEnd = addDays(utcToday, TASK_WINDOW_DAYS_AFTER);

  const [
    prefsRes,
    profilesRes,
    subsRes,
    eventsRes,
    paymentsRes,
    birthdaysRes,
    localsRes,
    externalRes,
    actsRes,
    schedRes,
    partsRes,
    ovRes,
    anchorsRes,
    tasksRes,
    taskOccRes,
  ] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone"),
    supabase.from("profiles").select("id, family_id, first_name, last_name"),
    supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth"),
    // Unfiltered on remind_minutes_before: the digest counts every event on
    // its target date, the reminder path filters the same rows in memory.
    //
    // Span-overlap window, same filter `useEventsList` uses: an event belongs
    // to [windowStart, windowEnd] when its whole span intersects it. Filtering
    // on `date` alone hid an in-progress multi-day event from every digest
    // after its first day. `end_date > date` whenever set, so "last day >=
    // windowStart" is exactly "date >= windowStart OR end_date >= windowStart"
    // (PostgREST filters can't call COALESCE).
    supabase
      .from("events")
      .select("id, family_id, name, date, end_date, start_time, remind_minutes_before, canceled_at")
      .or(`date.gte.${windowStart},end_date.gte.${windowStart}`)
      .lte("date", eventWindowEnd),
    supabase
      .from("payments")
      .select("id, family_id, name, amount, due_date, remind_days_before")
      .eq("is_paid", false)
      .eq("is_paused", false)
      .gte("due_date", windowStart)
      .lte("due_date", paymentWindowEnd),
    supabase.from("birthdays").select("id, family_id, name, birth_date"),
    supabase
      .from("external_event_local")
      .select("family_id, ical_uid, remind_minutes_before")
      .not("remind_minutes_before", "is", null),
    // Every mirrored event in the window, not just the ones carrying a
    // reminder: the digest counts them too, all-day ones included. `visibility`
    // and `owner_user_id` are what let plan.ts re-apply the RLS rule this
    // service-role read bypasses.
    supabase
      .from("external_calendar_events")
      .select("id, family_id, title, local_date, start_time, ical_uid, visibility, owner_user_id")
      .gte("local_date", windowStart)
      .lte("local_date", eventWindowEnd),
    // Unfiltered on remind_minutes_before, like events: the digest counts
    // every occurrence of an active activity, and the reminder path filters
    // for an offset in memory. `is_paused` stays a query filter because a
    // paused activity is invisible to both (it never reaches the agenda
    // either).
    supabase
      .from("activities")
      .select(
        "id, family_id, name, active_from, active_to, is_paused, remind_minutes_before, created_at",
      )
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
      .select("person_id, anchor_week_start, anchor_shift, flip_interval_weeks, is_alternating"),
    // Dated tasks only: a `tasks` row with no due_date is a plain list item (a
    // shopping list is a few hundred of them) and reaches neither the agenda nor
    // a digest.
    //
    // The window cannot be a simple `due_date >= windowStart` the way payments
    // is, because a recurring task's `due_date` is the series ANCHOR and never
    // advances: a chore set up last year is still due every Tuesday. So the
    // filter is "starts on or before the window ends" AND either the date itself
    // falls in the window (one-offs) or the row repeats and plan.ts projects it.
    //
    // `is_completed` is the payments `is_paid = false` prefilter: a finished
    // one-off neither counts nor reminds, and a RECURRING task is structurally
    // forbidden from setting the column at all (tasks_recurring_not_completed),
    // so this drops nothing that recurrence would have rescued. `scope` and
    // `owner_id` come along so plan.ts can re-apply the RLS rule this
    // service-role read bypasses.
    supabase
      .from("tasks")
      .select(
        "id, family_id, name, scope, owner_id, due_date, due_time, recurrence_period, recurrence_interval, recurrence_weekdays, recurrence_until, completion_mode, is_completed, remind_minutes_before, remind_days_before",
      )
      .eq("is_completed", false)
      .not("due_date", "is", null)
      .lte("due_date", taskWindowEnd)
      .or(`due_date.gte.${windowStart},recurrence_period.in.(daily,weekly,monthly)`),
    // Occurrence rows for the window, plus the ones a move relocated INTO it -
    // those key on their original date, which can sit outside the window
    // entirely.
    supabase
      .from("task_occurrences")
      .select("task_id, occurrence_date, person_id, status, moved_to_date")
      .or(
        `and(occurrence_date.gte.${windowStart},occurrence_date.lte.${taskWindowEnd}),and(moved_to_date.gte.${windowStart},moved_to_date.lte.${taskWindowEnd})`,
      ),
  ]);

  // Everything the digest counts has to throw rather than degrade to []: a
  // swallowed error would send a "nothing_to_send" digest and burn the day's
  // claim, which is indistinguishable from the day genuinely being empty.
  for (const res of [
    prefsRes,
    profilesRes,
    subsRes,
    eventsRes,
    paymentsRes,
    birthdaysRes,
    externalRes,
    actsRes,
    schedRes,
    partsRes,
    tasksRes,
    // An occurrence read that silently degraded to [] would count and nag about
    // occurrences somebody already ticked off or skipped.
    taskOccRes,
  ]) {
    if (res.error) throw new Error(res.error.message);
  }

  return {
    prefs: (prefsRes.data ?? []) as PrefsRow[],
    profiles: (profilesRes.data ?? []) as ProfileRow[],
    subs: (subsRes.data ?? []) as PushSubRow[],
    events: (eventsRes.data ?? []) as EventRow[],
    payments: (paymentsRes.data ?? []) as PaymentRow[],
    birthdays: (birthdaysRes.data ?? []) as BirthdayRow[],
    externalLocals: (localsRes.data ?? []) as ExternalLocalRow[],
    externalEvents: (externalRes.data ?? []) as ExternalEventRow[],
    activities: (actsRes.data ?? []) as ActivityRow[],
    schedule: (schedRes.data ?? []) as ScheduleRuleRow[],
    participants: (partsRes.data ?? []) as ParticipantRow[],
    overrides: (ovRes.data ?? []) as ActivityOverrideRow[],
    anchors: (anchorsRes.data ?? []) as ShiftAnchorRow[],
    tasks: (tasksRes.data ?? []) as TaskRow[],
    taskOccurrences: (taskOccRes.data ?? []) as TaskOccurrenceRecord[],
  };
}

// ---------------------------------------------------------------------------
// 2. Claim, send, sweep
// ---------------------------------------------------------------------------

function claimKey(userId: string, kind: string, refId: string): string {
  return `${userId}|${kind}|${refId}`;
}

async function claimAndSend(
  supabase: ReturnType<typeof createClient>,
  claims: PlannedClaim[],
): Promise<unknown[]> {
  if (claims.length === 0) return [];

  // Two paths can plan the same slot in one tick (e.g. a mirrored event that
  // appears twice under one ical_uid). Sequential inserts used to let the
  // first win and report the rest as already_sent; deduping here keeps that.
  const firstByKey = new Map<string, PlannedClaim>();
  for (const c of claims) {
    const key = claimKey(c.userId, c.kind, c.refId);
    if (!firstByKey.has(key)) firstByKey.set(key, c);
  }

  const upsertOpts = { onConflict: "user_id,kind,ref_id", ignoreDuplicates: true };
  const rows = [...firstByKey.values()].map((c) => ({
    user_id: c.userId,
    kind: c.kind,
    ref_id: c.refId,
  }));

  let { data: inserted, error } = await supabase
    .from("notification_log")
    .upsert(rows, upsertOpts)
    .select("user_id, kind, ref_id");

  // The batched claim is all-or-nothing: one row Postgres rejects voids every
  // push of the tick (it did, in prod - kid profiles have no auth.users row
  // behind notification_log's user_id FK). plan.ts no longer plans such rows,
  // but if a bad one slips through again, re-claim row by row so it only
  // costs itself, not the whole minute.
  const claimErrors = new Map<string, string>();
  if (error) {
    inserted = [];
    for (const row of rows) {
      const { data: one, error: rowError } = await supabase
        .from("notification_log")
        .upsert(row, upsertOpts)
        .select("user_id, kind, ref_id");
      if (rowError) {
        claimErrors.set(claimKey(row.user_id, row.kind, row.ref_id), rowError.message);
      } else if (one) {
        inserted.push(...one);
      }
    }
  }

  // RETURNING on an ON CONFLICT DO NOTHING insert only yields the rows that
  // were actually written - exactly the slots this tick owns.
  const granted = new Set(
    ((inserted ?? []) as { user_id: string; kind: string; ref_id: string }[]).map((r) =>
      claimKey(r.user_id, r.kind, r.ref_id),
    ),
  );

  const deadSubIds = new Set<string>();
  const results = Array.from<unknown>({ length: claims.length });

  await runWithConcurrency(claims, SEND_CONCURRENCY, async (claim, i) => {
    const key = claimKey(claim.userId, claim.kind, claim.refId);
    const claimError = claimErrors.get(key);
    if (claimError) {
      results[i] = { ...claim.result, error: claimError };
      return;
    }
    if (!granted.has(key) || firstByKey.get(key) !== claim) {
      results[i] = { ...claim.result, status: "already_sent" };
      return;
    }
    if (claim.push === null) {
      results[i] = { ...claim.result, status: claim.emptyStatus };
      return;
    }
    if (claim.subs.length === 0) {
      results[i] = { ...claim.result, status: "no_subscriptions" };
      return;
    }

    const payload = JSON.stringify(claim.push);
    let sent = 0;
    let dead = 0;
    for (const sub of claim.subs) {
      // A push service that already 410'd earlier in this tick stays dead for
      // the rest of it - no point re-dialling an endpoint we are about to drop.
      if (deadSubIds.has(sub.id)) {
        dead++;
        continue;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        // web-push rejects with an error carrying the push service's HTTP status.
        const status = (e as { statusCode?: number } | null)?.statusCode;
        if (status === 404 || status === 410) {
          deadSubIds.add(sub.id);
          dead++;
        }
      }
    }
    results[i] = { ...claim.result, ...claim.sentResult, sent, dead };
  });

  if (deadSubIds.size > 0) {
    // Subscription is gone - drop it so we don't keep paying for dead
    // push-service round-trips on every cron tick.
    await supabase
      .from("push_subscriptions")
      .delete()
      .in("id", [...deadSubIds]);
  }

  return results;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}
