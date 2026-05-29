import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Activity } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Activities data hooks — definition layer only. Schedule rules live in
 * `useActivitySchedule.ts`; the per-week resolved view comes from
 * `useWeekActivities.ts` which fans these together.
 *
 * `familyId` always comes from `useProfile()` so the RLS guard is honored.
 */

export type CreateActivityInput = {
  name: string;
  description?: string | null;
  active_from?: string | null;
  active_to?: string | null;
  is_paused?: boolean;
  notes?: string | null;
  remind_minutes_before?: number | null;
};

export type UpdateActivityInput = Partial<
  Pick<
    Activity,
    | "name"
    | "description"
    | "active_from"
    | "active_to"
    | "is_paused"
    | "notes"
    | "remind_minutes_before"
  >
>;

async function fetchActivities(familyId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("family_id", familyId)
    .order("name", { ascending: true });
  if (error) return [];
  return (data as Activity[]) ?? [];
}

export function useActivities() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  // Unique per hook invocation so the page + `useWeekActivities` can each
  // subscribe without colliding on the same Supabase channel name.
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["activities", familyId],
    queryFn: () => fetchActivities(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`activities-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activities",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["activities", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}

export function useCreateActivity() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateActivityInput): Promise<Activity> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("activities")
        .insert({ family_id: familyId, ...payload })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Activity;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activities", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju aktivnosti");
    },
  });
}

export function useUpdateActivity() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateActivityInput }): Promise<Activity> => {
      const { data, error } = await supabase
        .from("activities")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Activity;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activities", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni aktivnosti");
    },
  });
}

export function useDeleteActivity() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("activities").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activities", familyId] });
      // Schedule + participants + overrides cascade-delete in the DB; the
      // cached queries for those don't know that — invalidate too.
      void queryClient.invalidateQueries({ queryKey: ["activity_schedule", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["activity_participants", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["activity_overrides", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju aktivnosti");
    },
  });
}
