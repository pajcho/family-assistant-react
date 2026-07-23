import { useEffect, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { EventParticipant } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Junction-table rows linking events to the family members they're for.
 * Mirrors `useActivityParticipants`, with two differences:
 *   - an event may have ZERO participants (family-wide event), so writes
 *     accept an empty set;
 *   - the write isn't its own mutation hook - `useCreateEvent` /
 *     `useUpdateEvent` call `replaceEventParticipants` so a single submit
 *     persists the event and its assignees together.
 */
async function fetchEventParticipants(familyId: string): Promise<EventParticipant[]> {
  const { data, error } = await supabase
    .from("event_participants")
    .select("*")
    .eq("family_id", familyId);
  if (error) return [];
  return (data as EventParticipant[]) ?? [];
}

export interface UseEventParticipantsResult {
  participants: EventParticipant[];
  /** event_id → person_ids, in insertion order. Stable across renders. */
  byEvent: Map<string, string[]>;
  isLoading: boolean;
}

export function useEventParticipants(): UseEventParticipantsResult {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["event_participants", familyId],
    queryFn: () => fetchEventParticipants(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`event-participants-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_participants",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["event_participants", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const participants = useMemo(() => query.data ?? [], [query.data]);

  const byEvent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of participants) {
      const list = map.get(row.event_id);
      if (list) list.push(row.person_id);
      else map.set(row.event_id, [row.person_id]);
    }
    return map;
  }, [participants]);

  return { participants, byEvent, isLoading: query.isLoading };
}

/**
 * Replace the full set of assignees for one event: delete the existing rows,
 * then insert the new ones in a single round-trip. An empty `personIds`
 * simply clears the assignment. Not a hook - called from the event mutations
 * (and reusable by Phase 2's payments) so the caller already holds `familyId`.
 */
export async function replaceEventParticipants(
  familyId: string,
  eventId: string,
  personIds: ReadonlyArray<string>,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("event_participants")
    .delete()
    .eq("event_id", eventId);
  if (deleteError) throw new Error(deleteError.message);

  if (personIds.length === 0) return;

  const rows = personIds.map((personId) => ({
    event_id: eventId,
    family_id: familyId,
    person_id: personId,
  }));
  const { error: insertError } = await supabase.from("event_participants").insert(rows);
  if (insertError) throw new Error(insertError.message);
}
