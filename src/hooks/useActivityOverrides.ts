import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ActivityOverride, ActivityOverrideAction } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Per-occurrence overrides on activity_schedule rules. The hook surface
 * mirrors the other activity hooks — list query with realtime + a single
 * `upsert` mutation that the action menu uses for both "create override"
 * and "change existing override". The UNIQUE(schedule_id, date) constraint
 * means there is only ever one override per occurrence; replacing it
 * (e.g. cancel → reschedule, or new times) goes through the same path.
 */

export type UpsertOverrideInput = {
  schedule_id: string;
  /** Original date the rule would have fired on — the override's lookup key. */
  date: string;
  action: ActivityOverrideAction;
  override_start_time?: string | null;
  override_end_time?: string | null;
  /**
   * When a reschedule moves the termin to a different day, set this to
   * the new date. Leave NULL / equal to `date` for same-day reschedules.
   */
  override_date?: string | null;
  note?: string | null;
};

async function fetchOverrides(familyId: string): Promise<ActivityOverride[]> {
  const { data, error } = await supabase
    .from("activity_overrides")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as ActivityOverride[]) ?? [];
}

export function useActivityOverrides() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["activity_overrides", familyId],
    queryFn: () => fetchOverrides(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`activity-overrides-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_overrides",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["activity_overrides", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}

/**
 * Create-or-replace an override for `(schedule_id, date)`. The UNIQUE
 * constraint means we route through `upsert` with that composite as the
 * conflict target so a follow-up edit (e.g. switching from cancel to
 * reschedule) doesn't error out with a duplicate-key violation.
 */
export function useUpsertActivityOverride() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpsertOverrideInput): Promise<ActivityOverride> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("activity_overrides")
        .upsert(
          {
            schedule_id: payload.schedule_id,
            family_id: familyId,
            date: payload.date,
            action: payload.action,
            // Always send both — null clears them, which is the right state
            // when switching a previously-reschedule override to cancel.
            override_start_time:
              payload.action === "reschedule" ? (payload.override_start_time ?? null) : null,
            override_end_time:
              payload.action === "reschedule" ? (payload.override_end_time ?? null) : null,
            // Normalize "moved to the same day" to NULL so the resolver
            // treats it as a same-day reschedule instead of a date shift.
            override_date:
              payload.action === "reschedule" &&
              payload.override_date &&
              payload.override_date !== payload.date
                ? payload.override_date
                : null,
            note: payload.note ?? null,
          },
          { onConflict: "schedule_id,date" },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as ActivityOverride;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activity_overrides", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri postavljanju izuzetka");
    },
  });
}

export function useDeleteActivityOverride() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (overrideId: string): Promise<void> => {
      const { error } = await supabase
        .from("activity_overrides")
        .delete()
        .eq("id", overrideId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["activity_overrides", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri uklanjanju izuzetka");
    },
  });
}
