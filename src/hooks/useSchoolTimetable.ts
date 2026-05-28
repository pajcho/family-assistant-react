import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SchoolTimetableEntry, TimetableVariant } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * School timetable entries for the whole family, loaded as one set so the
 * week view resolves without fanning out per-child queries (same approach as
 * `useActivitySchedule`).
 *
 * Writes go through `useReplaceTimetableDay`: the fast-entry editor sends the
 * full ordered subject list for one (person, variant, day); the mutation
 * deletes that day's existing entries and re-inserts, so `period_index` always
 * matches the list order (1-based).
 */

export type TimetableSubjectInput = {
  subject: string;
  room?: string | null;
};

async function fetchTimetable(familyId: string): Promise<SchoolTimetableEntry[]> {
  const { data, error } = await supabase
    .from("school_timetable_entries")
    .select("*")
    .eq("family_id", familyId)
    .order("day_of_week", { ascending: true })
    .order("period_index", { ascending: true });
  if (error) return [];
  return (data as SchoolTimetableEntry[]) ?? [];
}

export function useSchoolTimetable() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["school_timetable", familyId],
    queryFn: () => fetchTimetable(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`school-timetable-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_timetable_entries",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["school_timetable", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}

/**
 * Replace one (person, variant, day) column with an ordered subject list.
 * Empty subjects are dropped; the remaining ones map to `period_index` 1..N
 * in order. An empty list clears that day.
 */
export function useReplaceTimetableDay() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      personId: string;
      variant: TimetableVariant;
      dayOfWeek: number;
      subjects: ReadonlyArray<TimetableSubjectInput>;
    }): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");

      const { error: deleteError } = await supabase
        .from("school_timetable_entries")
        .delete()
        .eq("person_id", args.personId)
        .eq("variant", args.variant)
        .eq("day_of_week", args.dayOfWeek);
      if (deleteError) throw new Error(deleteError.message);

      const rows = args.subjects
        .map((s) => ({ subject: s.subject.trim(), room: s.room?.trim() || null }))
        .filter((s) => s.subject.length > 0)
        .map((s, i) => ({
          family_id: familyId,
          person_id: args.personId,
          variant: args.variant,
          day_of_week: args.dayOfWeek,
          period_index: i + 1,
          subject: s.subject,
          room: s.room,
        }));

      if (rows.length === 0) return;

      const { error: insertError } = await supabase
        .from("school_timetable_entries")
        .insert(rows);
      if (insertError) throw new Error(insertError.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["school_timetable", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri snimanju rasporeda");
    },
  });
}
