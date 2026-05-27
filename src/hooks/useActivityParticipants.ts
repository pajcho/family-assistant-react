import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ActivityParticipant } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Junction-table rows linking activities to family members. The week
 * resolver fans `rules × participants` to emit one block per person per
 * occurrence.
 *
 * Writes go through `useReplaceActivityParticipants` — the form sends the
 * full new set of person ids for one activity, the mutation deletes the
 * existing rows and inserts the new ones in a single Supabase round-trip.
 * Same pattern as `useReplaceActivitySchedule` for consistency.
 */
async function fetchParticipants(familyId: string): Promise<ActivityParticipant[]> {
  const { data, error } = await supabase
    .from("activity_participants")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as ActivityParticipant[]) ?? [];
}

export function useActivityParticipants() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["activity_participants", familyId],
    queryFn: () => fetchParticipants(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`activity-participants-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_participants",
          filter: `family_id=eq.${familyId}`,
        },
        () =>
          queryClient.invalidateQueries({ queryKey: ["activity_participants", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}

/**
 * Replace all participants for one activity with the new set. Deletes
 * existing rows first, then inserts the new ones in a single batch. Empty
 * input is rejected — every activity must have at least one participant.
 */
export function useReplaceActivityParticipants() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      activityId: string;
      personIds: ReadonlyArray<string>;
    }): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      if (args.personIds.length === 0) {
        throw new Error("Aktivnost mora imati bar jednog učesnika");
      }

      const { error: deleteError } = await supabase
        .from("activity_participants")
        .delete()
        .eq("activity_id", args.activityId);
      if (deleteError) throw new Error(deleteError.message);

      const rows = args.personIds.map((personId) => ({
        activity_id: args.activityId,
        family_id: familyId,
        person_id: personId,
      }));

      const { error: insertError } = await supabase
        .from("activity_participants")
        .insert(rows);
      if (insertError) throw new Error(insertError.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["activity_participants", familyId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri snimanju učesnika");
    },
  });
}
