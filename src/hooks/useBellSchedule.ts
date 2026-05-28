import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BellSchedule } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * One bell schedule per family — the source of truth for class/break lengths
 * and per-band start times. The migration seeds a default row for every
 * existing family; new families get one written on first save.
 *
 * `useBellSchedule` always hands back a usable `bell` object: the stored row
 * if present, otherwise a default synthesized in-memory so the week grid can
 * derive class times before the user ever opens the settings dialog.
 */

/** Field defaults — kept in sync with the column defaults in the migration. */
export const BELL_DEFAULTS = {
  period_minutes: 45,
  small_break_minutes: 5,
  big_break_minutes: 20,
  max_periods: 7,
  morning_start: "08:00",
  morning_big_break_after: 2,
  afternoon_start: "14:00",
  afternoon_big_break_after: 2,
  afternoon_predcas_start: "13:00",
  afternoon_predcas_big_break_after: 3,
} as const;

export type BellScheduleInput = {
  period_minutes: number;
  small_break_minutes: number;
  big_break_minutes: number;
  max_periods: number;
  morning_start: string;
  morning_big_break_after: number;
  afternoon_start: string;
  afternoon_big_break_after: number;
  afternoon_predcas_start: string;
  afternoon_predcas_big_break_after: number;
};

function synthesizeDefault(familyId: string): BellSchedule {
  return { family_id: familyId, ...BELL_DEFAULTS, created_at: "", updated_at: "" };
}

async function fetchBellSchedule(familyId: string): Promise<BellSchedule | null> {
  const { data, error } = await supabase
    .from("bell_schedules")
    .select("*")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) return null;
  return (data as BellSchedule | null) ?? null;
}

export function useBellSchedule() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["bell_schedule", familyId],
    queryFn: () => fetchBellSchedule(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`bell-schedule-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bell_schedules",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["bell_schedule", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  // Always usable: stored row, or a synthesized default so the grid can
  // derive times immediately. `raw` exposes whether a row actually exists.
  const bell = useMemo<BellSchedule>(
    () => query.data ?? synthesizeDefault(familyId ?? ""),
    [query.data, familyId],
  );

  return { ...query, bell, raw: query.data ?? null };
}

export function useUpsertBellSchedule() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BellScheduleInput): Promise<BellSchedule> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("bell_schedules")
        .upsert({ family_id: familyId, ...input }, { onConflict: "family_id" })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as BellSchedule;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bell_schedule", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri snimanju satnice");
    },
  });
}
