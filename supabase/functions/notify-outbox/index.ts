// supabase/functions/notify-outbox/index.ts
//
// Cron-triggered every minute (see 20260812000000_task_notify_outbox.sql). Sends
// the "somebody added tasks" pushes that the INSERT trigger queued, grouped so
// that one sitting at the keyboard costs one notification per person.
//
// The flow, and why each step is where it is:
//
//   1. read the queue rows that have sat for GROUPING_WINDOW_MINUTES. The wait
//      is the whole point: it is what lets several tasks arrive together AND
//      what makes `task_assignees` readable, since the app writes assignees in
//      a second request after the task row (so at trigger time every task still
//      looks unassigned).
//   2. bulk-read everything the decision needs, in one Promise.all
//   3. plan.ts decides who gets what - pure, and unit-tested next door
//   4. claim each (user, task) slot in `notification_log` before sending
//   5. send one push per person, then mark the queue rows processed
//
// An empty queue costs exactly ONE query and returns - which matters, because
// this runs 1440 times a day and the queue is empty for almost all of them.
//
// Auth: `verify_jwt = false` in config.toml, X-Cron-Secret instead, same as
// send-due-pushes and notify-on-create.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

import {
  batchBody,
  batchTitle,
  planOutboxPushes,
  type OutboxRow,
  type QueuedTask,
} from "./plan.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// SERVICE_KEY override mirrors the other functions: local dev's auto-injected
// key can be the legacy HS256 JWT the new auth service rejects.
const SERVICE_ROLE = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

/**
 * How long a queued task waits before it is announced. Long enough to gather a
 * burst and to let the assignee rows land; short enough that "what did my
 * partner just add" is still news when it arrives.
 */
const GROUPING_WINDOW_MINUTES = 2;

/** How long processed rows stay before the flush sweeps them. */
const RETENTION_DAYS = 7;

/** The kind `notification_log` dedupes on - unchanged, so history stays one series. */
const KIND = "task_create";

/**
 * One notification tag for every task push. A second batch REPLACES the first on
 * the lock screen instead of stacking under it, which is the visible half of not
 * being spam (the grouping window is the other half).
 */
const TAG = "task_create";

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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();
  const cutoff = new Date(now - GROUPING_WINDOW_MINUTES * 60_000).toISOString();

  const { data: queued, error: queueError } = await supabase
    .from("notification_outbox")
    .select("id, entity_id, actor_id, family_id")
    .is("processed_at", null)
    .eq("entity_type", "task")
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(500);
  if (queueError) {
    return Response.json({ error: queueError.message }, { status: 500 });
  }

  const rows = (queued ?? []) as Array<OutboxRow & { family_id: string }>;
  if (rows.length === 0) {
    return Response.json({ ok: true, processed: 0, reason: "nothing ripe" });
  }

  const taskIds = [...new Set(rows.map((row) => row.entity_id))];
  const familyIds = [...new Set(rows.map((row) => row.family_id))];

  // One round of bulk reads. `tasks` is re-checked rather than trusted from the
  // queue: inside the window a task can be deleted, moved to a personal scope or
  // have its date cleared, and none of those should still be announced.
  const [tasksRes, assigneesRes, membersRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, name, family_id, scope, due_date")
      .in("id", taskIds)
      .eq("scope", "family")
      .not("due_date", "is", null),
    supabase.from("task_assignees").select("task_id, person_id").in("task_id", taskIds),
    supabase
      .from("profiles")
      .select("id, family_id, first_name, last_name")
      .in("family_id", familyIds),
  ]);

  const tasksById = new Map<string, QueuedTask>();
  for (const row of (tasksRes.data ?? []) as QueuedTask[]) {
    tasksById.set(row.id, { id: row.id, name: row.name, family_id: row.family_id });
  }

  const assigneesByTask = new Map<string, string[]>();
  for (const row of (assigneesRes.data ?? []) as Array<{ task_id: string; person_id: string }>) {
    const list = assigneesByTask.get(row.task_id);
    if (list) list.push(row.person_id);
    else assigneesByTask.set(row.task_id, [row.person_id]);
  }

  type MemberRow = {
    id: string;
    family_id: string;
    first_name: string | null;
    last_name: string | null;
  };
  const members = (membersRes.data ?? []) as MemberRow[];
  const membersByFamily = new Map<string, string[]>();
  const nameById = new Map<string, string>();
  for (const member of members) {
    const list = membersByFamily.get(member.family_id);
    if (list) list.push(member.id);
    else membersByFamily.set(member.family_id, [member.id]);
    const name = [member.first_name ?? "", member.last_name ?? ""]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
    if (name) nameById.set(member.id, name);
  }

  const memberIds = members.map((member) => member.id);
  // A child with a kid login only ever sees what is assigned to them, so a
  // family-wide task is one they could not open even if we told them.
  //
  // Subscriptions are read for the whole family in ONE query rather than per
  // recipient inside the send loop: it keeps the tick's query count flat, and
  // the set of people who have any is exactly the set a push can reach - which
  // is the honest filter for a family whose members include profiles with no
  // login behind them at all (`notification_log` references `auth.users`, so
  // claiming a slot for one of those is a foreign-key error, not a message).
  const [kidRes, prefsRes, subsRes] = await Promise.all([
    supabase.from("kid_access").select("profile_id").in("profile_id", memberIds),
    supabase
      .from("notification_preferences")
      .select("user_id, notify_on_task_create")
      .in("user_id", memberIds),
    supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", memberIds),
  ]);

  const subsByUser = new Map<string, PushSub[]>();
  for (const sub of (subsRes.data ?? []) as Array<PushSub & { user_id: string }>) {
    const list = subsByUser.get(sub.user_id);
    if (list) list.push(sub);
    else subsByUser.set(sub.user_id, [sub]);
  }

  const kidProfileIds = new Set(
    ((kidRes.data ?? []) as Array<{ profile_id: string }>).map((row) => row.profile_id),
  );
  const optedOut = new Set(
    ((prefsRes.data ?? []) as Array<{ user_id: string; notify_on_task_create: boolean }>)
      .filter((row) => row.notify_on_task_create === false)
      .map((row) => row.user_id),
  );

  const batches = planOutboxPushes({
    rows,
    tasksById,
    assigneesByTask,
    membersByFamily,
    kidProfileIds,
    pushableIds: new Set(subsByUser.keys()),
    optedOut,
    nameById,
  });

  const results: unknown[] = [];

  for (const batch of batches) {
    // Claim every (user, task) slot before sending. The UNIQUE constraint is
    // what makes a retried flush safe: whatever comes back from the insert is
    // exactly what this run won, and anything already logged was announced by an
    // earlier one and is dropped from the push.
    const { data: claimed, error: claimError } = await supabase
      .from("notification_log")
      .upsert(
        batch.taskIds.map((taskId) => ({ user_id: batch.userId, kind: KIND, ref_id: taskId })),
        { onConflict: "user_id,kind,ref_id", ignoreDuplicates: true },
      )
      .select("ref_id");
    if (claimError) {
      // One tick's worth of noise, never a failed tick: the batch is dropped and
      // the queue row is still marked processed below, so nothing loops.
      results.push({ user_id: batch.userId, error: claimError.message });
      continue;
    }
    const granted = new Set(
      ((claimed ?? []) as Array<{ ref_id: string }>).map((row) => row.ref_id),
    );
    if (granted.size === 0) {
      results.push({ user_id: batch.userId, status: "already_sent" });
      continue;
    }

    // Non-empty by construction - `pushableIds` is built from these very keys.
    const subList = subsByUser.get(batch.userId) ?? [];

    // Compose on what was actually granted, not on what was planned: a retry
    // that only won one of three slots must not announce "3 nova zadatka", and
    // must not list the two somebody already read.
    const names = batch.taskNames.filter((_, index) => granted.has(batch.taskIds[index]));
    const payload = JSON.stringify({
      title: batchTitle(names.length),
      body: batchBody(names, batch.actorName),
      url: "/tasks",
      tag: TAG,
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
        const status = (e as { statusCode?: number } | null)?.statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          dead++;
        }
      }
    }
    results.push({ user_id: batch.userId, tasks: names.length, sent, dead });
  }

  // Mark the queue done whatever the sends did. A push that failed to reach one
  // device is not a reason to announce the same tasks again next minute.
  await supabase
    .from("notification_outbox")
    .update({ processed_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((row) => row.id),
    );

  // Cheap retention sweep, on the tick that already had work to do.
  await supabase
    .from("notification_outbox")
    .delete()
    .not("processed_at", "is", null)
    .lt("processed_at", new Date(now - RETENTION_DAYS * 86_400_000).toISOString());

  return Response.json({ ok: true, queued: rows.length, batches: results });
});
