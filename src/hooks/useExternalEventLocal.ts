import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ExternalEventLocal } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

/**
 * App-local enrichment for mirrored Google events — assignment to a family
 * member + a push reminder — keyed by the stable `ical_uid` so it survives
 * re-syncs. Read as a `byUid` map (the whole family's set is small) and written
 * with `setLocal` (a partial upsert: pass only the field you're changing). The
 * client writes directly via RLS; realtime keeps other members in sync.
 */

async function fetchLocal(familyId: string): Promise<ExternalEventLocal[]> {
  const { data, error } = await supabase
    .from("external_event_local")
    .select("ical_uid, assigned_person_id, remind_minutes_before")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as ExternalEventLocal[]) ?? [];
}

export interface SetLocalInput {
  icalUid: string;
  /** Omit to leave assignment unchanged; null clears it. */
  assignedPersonId?: string | null;
  /** Omit to leave the reminder unchanged; null clears it. */
  remindMinutesBefore?: number | null;
}

export function useExternalEventLocal() {
  const { familyId } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const channelKey = useId();
  const queryKey = ["external_event_local", familyId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchLocal(familyId as string),
    enabled: !!familyId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`external-local-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "external_event_local",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["external_event_local", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const byUid = useMemo(() => {
    const map = new Map<string, ExternalEventLocal>();
    for (const row of query.data ?? []) map.set(row.ical_uid, row);
    return map;
  }, [query.data]);

  const setLocalMutation = useMutation({
    mutationFn: async (input: SetLocalInput): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const current = byUid.get(input.icalUid);
      const { error } = await supabase.from("external_event_local").upsert(
        {
          family_id: familyId,
          ical_uid: input.icalUid,
          assigned_person_id:
            input.assignedPersonId !== undefined
              ? input.assignedPersonId
              : (current?.assigned_person_id ?? null),
          remind_minutes_before:
            input.remindMinutesBefore !== undefined
              ? input.remindMinutesBefore
              : (current?.remind_minutes_before ?? null),
          created_by: user?.id ?? null,
        },
        { onConflict: "family_id,ical_uid" },
      );
      if (error) throw new Error(error.message);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<ExternalEventLocal[]>(queryKey);
      queryClient.setQueryData<ExternalEventLocal[]>(queryKey, (old) => {
        const list = [...(old ?? [])];
        const i = list.findIndex((r) => r.ical_uid === input.icalUid);
        const base: ExternalEventLocal =
          i >= 0
            ? list[i]
            : { ical_uid: input.icalUid, assigned_person_id: null, remind_minutes_before: null };
        const next: ExternalEventLocal = {
          ...base,
          ...(input.assignedPersonId !== undefined
            ? { assigned_person_id: input.assignedPersonId }
            : {}),
          ...(input.remindMinutesBefore !== undefined
            ? { remind_minutes_before: input.remindMinutesBefore }
            : {}),
        };
        if (i >= 0) list[i] = next;
        else list.push(next);
        return list;
      });
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error(e.message || "Greška pri čuvanju");
    },
  });

  return { byUid, isLoading: query.isLoading, setLocal: setLocalMutation.mutate };
}
