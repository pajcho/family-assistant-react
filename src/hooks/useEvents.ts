import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Event } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { replaceEventParticipants } from "@/hooks/useEventParticipants";

/**
 * Events data hooks — direct port of `composables/useEvents.ts` from the
 * sibling Nuxt app, backed by TanStack Query + Supabase Realtime.
 *
 * Surface:
 *   - `useEventsList({ from?, to? })`  — list query + realtime subscription
 *   - `useCreateEvent()`               — insert mutation
 *   - `useUpdateEvent()`               — update mutation
 *   - `useDeleteEvent()`               — delete mutation
 *
 * `familyId` comes from `useProfile()`; never accept it from callers so the
 * Supabase RLS guard always matches the authenticated user.
 */

export interface EventListFilters {
  from?: string;
  to?: string;
}

export type CreateEventInput = {
  name: string;
  description?: string | null;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  notes?: string | null;
  remind_minutes_before?: number | null;
  /** Family members this event is for. Omit/empty = unassigned. */
  personIds?: string[];
};

export type UpdateEventInput = Partial<
  Pick<
    Event,
    | "name"
    | "description"
    | "date"
    | "start_time"
    | "end_time"
    | "notes"
    | "remind_minutes_before"
    | "canceled_at"
    | "cancel_reason"
  >
> & {
  /**
   * Replace the event's assignees. `undefined` leaves them untouched (so the
   * quick cancel / reschedule actions don't clear assignment); any array —
   * including empty — replaces the full set.
   */
  personIds?: string[];
};

// All-day events (null start_time) first per day, then by start_time.
// Mirrors the sort logic from composables/useEvents.ts in the Nuxt source.
function sortEvents(list: Event[]): Event[] {
  return list.toSorted((eventA, eventB) => {
    const dateCompare = eventA.date.localeCompare(eventB.date);
    if (dateCompare !== 0) return dateCompare;
    const aNull = eventA.start_time == null;
    const bNull = eventB.start_time == null;
    if (aNull && !bNull) return -1;
    if (!aNull && bNull) return 1;
    if (aNull && bNull) return 0;
    return (eventA.start_time ?? "").localeCompare(eventB.start_time ?? "");
  });
}

async function fetchEvents(familyId: string, filters: EventListFilters): Promise<Event[]> {
  let q = supabase
    .from("events")
    .select("*")
    .eq("family_id", familyId)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (filters.from) q = q.gte("date", filters.from);
  if (filters.to) q = q.lte("date", filters.to);
  const { data, error } = await q;
  if (error) return [];
  return sortEvents((data as Event[]) ?? []);
}

export function useEventsList(filters: EventListFilters = {}) {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const { from, to } = filters;
  // Unique per hook invocation so the page + dashboard widget can each
  // subscribe without colliding on the same Supabase channel name.
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["events", familyId, { from, to }],
    queryFn: () => fetchEvents(familyId as string, { from, to }),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`events-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["events", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}

export function useCreateEvent() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateEventInput): Promise<Event> => {
      if (!familyId) throw new Error("Nema porodice");
      const { personIds, ...columns } = input;
      const { data, error } = await supabase
        .from("events")
        .insert({ family_id: familyId, ...columns })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const event = data as Event;
      if (personIds && personIds.length > 0) {
        await replaceEventParticipants(familyId, event.id, personIds);
      }
      return event;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["event_participants", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju događaja");
    },
  });
}

export function useUpdateEvent() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateEventInput }): Promise<Event> => {
      const { personIds, ...columns } = args.payload;
      const { data, error } = await supabase
        .from("events")
        .update(columns)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      // Only touch assignees when the caller passed an explicit set; the
      // quick cancel / reschedule actions send columns only.
      if (personIds !== undefined) {
        if (!familyId) throw new Error("Nema porodice");
        await replaceEventParticipants(familyId, args.id, personIds);
      }
      return data as Event;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["event_participants", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni događaja");
    },
  });
}

export function useDeleteEvent() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju događaja");
    },
  });
}
