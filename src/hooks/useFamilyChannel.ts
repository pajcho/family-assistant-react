import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
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
/** payment_history is keyed by payment id as well as by family + month. */
const paymentHistoryKey: QueryKeyFor = () => ["payment_history"];

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
  income_entries: [familyKey("income_entries")],
  incomes: [familyKey("incomes")],
  list_items: [familyKey("lists")],
  lists: [familyKey("lists")],
  payment_history: [familyKey("payments"), paymentHistoryKey],
  payment_overrides: [familyKey("payment_overrides")],
  payment_participants: [familyKey("payment_participants")],
  payments: [familyKey("payments"), paymentHistoryKey],
  school_break_members: [familyKey("school_break_members")],
  school_breaks: [familyKey("school_breaks")],
  school_shift_anchors: [familyKey("school_shift_anchors")],
  school_timetable_entries: [familyKey("school_timetable")],
};

interface ChangeMessage {
  table?: string;
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

    const channel = supabase
      .channel(`family:${familyId}`, { config: { private: true } })
      .on("broadcast", { event: "change" }, (message) => {
        const table = (message.payload as ChangeMessage | undefined)?.table;
        if (!table) return;
        for (const key of TABLE_INVALIDATIONS[table] ?? []) {
          void queryClient.invalidateQueries({ queryKey: key(familyId) });
        }
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (hasSubscribed.current) {
          void queryClient.invalidateQueries({ refetchType: "active" });
        }
        hasSubscribed.current = true;
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient]);
}
