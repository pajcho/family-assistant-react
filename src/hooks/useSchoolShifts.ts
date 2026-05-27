import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SchoolShift, SchoolShiftAnchor } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * One school-shift anchor per family member. The anchor encodes "on this
 * Monday this person was in this shift" plus how often the shift flips.
 * Every other week's shift is derived from that single row by
 * `deriveShiftForWeek()` in `utils/activity.ts`.
 *
 * Storage is `upsert` keyed on `person_id` (the PK) so setting a shift for
 * the first time and updating it later use the same call.
 */

export type SchoolShiftUpsertInput = {
  person_id: string;
  anchor_week_start: string;
  anchor_shift: SchoolShift;
  flip_interval_weeks?: number;
  /** False for kids whose shift never rotates (1st/2nd grade). Default true. */
  is_alternating?: boolean;
};

async function fetchShiftAnchors(familyId: string): Promise<SchoolShiftAnchor[]> {
  const { data, error } = await supabase
    .from("school_shift_anchors")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as SchoolShiftAnchor[]) ?? [];
}

export function useSchoolShiftAnchors() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["school_shift_anchors", familyId],
    queryFn: () => fetchShiftAnchors(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`school-shift-anchors-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_shift_anchors",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["school_shift_anchors", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  // Indexed by person_id for O(1) lookup in the week resolver.
  const byPersonId = useMemo(() => {
    const map = new Map<string, SchoolShiftAnchor>();
    for (const anchor of query.data ?? []) {
      map.set(anchor.person_id, anchor);
    }
    return map;
  }, [query.data]);

  return { ...query, byPersonId };
}

export function useUpsertSchoolShiftAnchor() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: SchoolShiftUpsertInput): Promise<SchoolShiftAnchor> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("school_shift_anchors")
        .upsert(
          {
            person_id: payload.person_id,
            family_id: familyId,
            anchor_week_start: payload.anchor_week_start,
            anchor_shift: payload.anchor_shift,
            flip_interval_weeks: payload.flip_interval_weeks ?? 1,
            is_alternating: payload.is_alternating ?? true,
          },
          { onConflict: "person_id" },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as SchoolShiftAnchor;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["school_shift_anchors", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri postavljanju smene");
    },
  });
}

export function useDeleteSchoolShiftAnchor() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (personId: string): Promise<void> => {
      const { error } = await supabase
        .from("school_shift_anchors")
        .delete()
        .eq("person_id", personId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["school_shift_anchors", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri uklanjanju smene");
    },
  });
}
