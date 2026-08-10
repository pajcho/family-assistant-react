import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { resumeRefresh } from "@/lib/resumeRefresh";
import { useProfile } from "@/hooks/useProfile";

/**
 * The app's single realtime subscription.
 *
 * Every family-scoped table has an AFTER trigger
 * (`public.broadcast_family_change`, see
 * supabase/migrations/20260729010000_family_broadcast_channel.sql) that sends
 * `{ table, op }` to the private `family:<family_id>` topic. This hook holds
 * that one channel open and turns each message into the matching
 * `invalidateQueries` call.
 *
 * It replaces 20 per-table `postgres_changes` channels. Those cost one channel
 * join each (the agenda mounted 14 at once) and made Postgres re-run RLS for
 * every subscriber on every change - the pattern Supabase explicitly tells you
 * to move off for anything at scale.
 *
 * Mounted once, in the `_app` layout route. Do NOT add a second mount: two
 * channels on the same topic is exactly the collision the old per-hook
 * `useId()` topic suffixes existed to work around.
 */

type QueryKeyFor = (familyId: string) => readonly unknown[];

const familyKey =
  (root: string): QueryKeyFor =>
  (familyId) => [root, familyId];
/** For queries keyed by something other than the family - a payment, a receipt,
 *  an expense - the root alone is the right prefix to invalidate. */
const rootKey =
  (root: string): QueryKeyFor =>
  () => [root];
/** payment_history is keyed by payment id as well as by family + month. */
const paymentHistoryKey: QueryKeyFor = rootKey("payment_history");

/**
 * Table name (as sent by the trigger) to the query keys it invalidates.
 *
 * Keep in sync with the trigger list in the migration above. The values mirror
 * exactly what each hook's old realtime block used to invalidate, so a change
 * reaches the same screens it always did.
 */
const TABLE_INVALIDATIONS: Record<string, readonly QueryKeyFor[]> = {
  activities: [familyKey("activities")],
  activity_overrides: [familyKey("activity_overrides")],
  activity_participants: [familyKey("activity_participants")],
  activity_schedule: [familyKey("activity_schedule")],
  bell_schedules: [familyKey("bell_schedule")],
  birthday_visibility: [familyKey("birthday_visibility")],
  birthdays: [familyKey("birthdays")],
  event_participants: [familyKey("event_participants")],
  events: [familyKey("events")],
  expense_categories: [familyKey("expense_categories")],
  expenses: [familyKey("expenses")],
  external_calendar_events: [familyKey("external_calendar_events")],
  external_event_local: [familyKey("external_event_local")],
  // The family row is fetched as part of the profile query (useProfile), which
  // is what `useRenameFamily` and the currency settings invalidate too.
  families: [rootKey("profile")],
  income_entries: [familyKey("income_entries")],
  incomes: [familyKey("incomes")],
  lists: [familyKey("lists")],
  payment_history: [familyKey("payments"), paymentHistoryKey],
  payment_overrides: [familyKey("payment_overrides")],
  payment_participants: [familyKey("payment_participants")],
  payments: [familyKey("payments"), paymentHistoryKey],
  // Renaming a member (or changing their emoji / color) redraws every screen
  // that paints participants, and `useProfile` caches the caller's own row.
  profiles: [familyKey("family-members"), rootKey("profile")],
  // Claiming a receipt line writes only here, so without this entry another
  // member's open receipt keeps stale line ownership until they reload - and
  // then loses the PT409 race they never saw coming. Keyed by expense id.
  receipt_items: [rootKey("receipt_items")],
  // Keyed by receipt id; the split also moves what each expense is worth.
  receipts: [rootKey("receipt-context"), familyKey("expenses")],
  school_break_members: [familyKey("school_break_members")],
  school_breaks: [familyKey("school_breaks")],
  school_shift_anchors: [familyKey("school_shift_anchors")],
  school_timetable_entries: [familyKey("school_timetable")],
  task_assignees: [familyKey("task_assignees")],
  task_occurrences: [familyKey("task_occurrences")],
  // Task rows live in TWO caches - the flat family list and the nested
  // lists-with-tasks select - so a change has to reach both or a row shows
  // ticked on Danas and unticked inside its list. See hooks/useTasks.ts.
  tasks: [familyKey("tasks"), familyKey("lists")],
};

interface ChangeMessage {
  table?: string;
}

/** How long incoming table names pile up before one flush invalidates them. */
const COALESCE_MS = 200;

/**
 * Table names collected in one flush window -> the DISTINCT query keys to
 * invalidate, in first-seen order.
 *
 * Pure and exported so the coalescing rule can be tested without a timer. One
 * user action fans out across tables that SHARE a key: marking a payment paid
 * writes `payment_history` and `payments`, and a trigger touches `expenses` -
 * three messages, but `["payments", familyId]` and `["payment_history"]` each
 * need invalidating exactly once.
 */
export function invalidationKeysFor(
  tables: Iterable<string>,
  familyId: string,
): readonly (readonly unknown[])[] {
  const seen = new Set<string>();
  const keys: (readonly unknown[])[] = [];
  for (const table of tables) {
    for (const keyFor of TABLE_INVALIDATIONS[table] ?? []) {
      const queryKey = keyFor(familyId);
      // Keys are flat arrays of strings, so a JSON stringify is a sound
      // identity here (and cheaper than a deep-equal scan of the list).
      const identity = JSON.stringify(queryKey);
      if (seen.has(identity)) continue;
      seen.add(identity);
      keys.push(queryKey);
    }
  }
  return keys;
}

export function useFamilyChannel(): void {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  // A rejoin means the socket was down, and anything broadcast during the gap
  // is gone for good - broadcast has no replay. Refetch what's on screen.
  const hasSubscribed = useRef(false);

  useEffect(() => {
    if (!familyId) return;
    hasSubscribed.current = false;

    // Messages arrive in bursts: one mark-as-paid tap writes
    // `payment_history` + `payments` and a trigger touches `expenses`, so an
    // uncoalesced handler refetched the payments list 4-5 times for one tap.
    // Buffer the table names and invalidate each distinct key ONCE per flush.
    const pending = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      flushTimer = undefined;
      // Snapshot then clear, both synchronously: JS runs this to completion, so
      // no broadcast handler can slip in between and lose its table name. A
      // message that lands after this point re-arms the timer for a new window.
      const tables = [...pending];
      pending.clear();
      for (const queryKey of invalidationKeysFor(tables, familyId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const channel = supabase
      .channel(`family:${familyId}`, { config: { private: true } })
      .on("broadcast", { event: "change" }, (message) => {
        const table = (message.payload as ChangeMessage | undefined)?.table;
        if (!table) return;
        // Add first, arm second - a message arriving while a timer is already
        // running joins the window that timer will flush.
        pending.add(table);
        flushTimer ??= setTimeout(flush, COALESCE_MS);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (hasSubscribed.current) {
          // Same path the visibility listener takes - throttled, and it
          // respects each query's staleTime. On iOS a foreground fires both.
          resumeRefresh(queryClient);
        }
        hasSubscribed.current = true;
      });

    return () => {
      // Dropping a buffered window here loses nothing: this cleanup only runs
      // when the family scope itself goes away (sign-out, kid-mode switch) or
      // the app layout unmounts, and those families' queries are discarded or
      // refetched from scratch anyway.
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      pending.clear();
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient]);
}
