import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Event } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

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
};

export type UpdateEventInput = Partial<
  Pick<Event, "name" | "description" | "date" | "start_time" | "end_time" | "notes">
>;

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

  const query = useQuery({
    queryKey: ["events", familyId, { from, to }],
    queryFn: () => fetchEvents(familyId as string, { from, to }),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`events-${familyId}`)
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
  }, [familyId, queryClient]);

  return query;
}

export function useCreateEvent() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateEventInput): Promise<Event> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("events")
        .insert({ family_id: familyId, ...payload })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Event;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", familyId] });
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
      const { data, error } = await supabase
        .from("events")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Event;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", familyId] });
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
