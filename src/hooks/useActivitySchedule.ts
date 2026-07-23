import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ActivitySchedule, WeekPattern } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Schedule rules ("when does this activity happen") for activities. Loaded
 * as one big set per family so the week view doesn't need to fan out N
 * queries (one per activity).
 *
 * Writes are done via `replaceActivitySchedule()` - the form sends the full
 * new ruleset for an activity, the mutation deletes the existing rules and
 * inserts the new ones inside a single Supabase round-trip. Brief
 * inconsistency window is acceptable for MVP (no concurrent edits expected).
 */

export type ScheduleRuleInput = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  week_pattern: WeekPattern;
  /** "Every N weeks". 1 = each matching week. Defaults to 1 if omitted. */
  recurrence_interval_weeks?: number;
};

async function fetchSchedule(familyId: string): Promise<ActivitySchedule[]> {
  const { data, error } = await supabase
    .from("activity_schedule")
    .select("*")
    .eq("family_id", familyId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) return [];
  return (data as ActivitySchedule[]) ?? [];
}

export function useActivitySchedule() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["activity_schedule", familyId],
    queryFn: () => fetchSchedule(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`activity-schedule-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_schedule",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["activity_schedule", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}

/**
 * Replace all schedule rules for one activity with the new ruleset. Deletes
 * existing rules first, then inserts the new ones in a single batch.
 *
 * `rules` may be empty (deletes all rules without re-inserting anything).
 */
export function useReplaceActivitySchedule() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      activityId: string;
      rules: ReadonlyArray<ScheduleRuleInput>;
    }): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");

      const { error: deleteError } = await supabase
        .from("activity_schedule")
        .delete()
        .eq("activity_id", args.activityId);
      if (deleteError) throw new Error(deleteError.message);

      if (args.rules.length === 0) return;

      const rows = args.rules.map((rule) => ({
        activity_id: args.activityId,
        family_id: familyId,
        day_of_week: rule.day_of_week,
        start_time: rule.start_time,
        end_time: rule.end_time,
        week_pattern: rule.week_pattern,
        recurrence_interval_weeks: rule.recurrence_interval_weeks ?? 1,
      }));

      const { error: insertError } = await supabase.from("activity_schedule").insert(rows);
      if (insertError) throw new Error(insertError.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activity_schedule", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri snimanju termina");
    },
  });
}
