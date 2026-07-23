import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { GoogleCalendar, GoogleCalendarSharing } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { readFunctionsError } from "@/utils/functionsError";

/**
 * Lists the calendars under the member's connected Google accounts and lets them
 * set each calendar's `sharing` (none / private / family).
 *
 * The list query goes through `gcal-calendars { action: "list" }`, which
 * refreshes CalendarList from Google into `google_calendars` (preserving prior
 * sharing choices) and returns the rows. Sharing changes go through
 * `{ action: "set_sharing" }` and are applied optimistically so the picker feels
 * instant - and so toggling doesn't re-hit Google for every change.
 *
 * Pass `enabled = false` when there are no connections yet, to avoid a needless
 * round-trip.
 */

async function fetchCalendars(): Promise<GoogleCalendar[]> {
  const { data, error } = await supabase.functions.invoke<{
    calendars?: GoogleCalendar[];
    error?: string;
  }>("gcal-calendars", { body: { action: "list" } });
  const message = error
    ? ((await readFunctionsError(error)) ?? error.message)
    : (data?.error ?? null);
  if (message) throw new Error(message);
  return data?.calendars ?? [];
}

export function useGoogleCalendars(enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = ["google_calendars", userId];

  const query = useQuery({
    queryKey,
    queryFn: fetchCalendars,
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
  });

  const setSharingMutation = useMutation({
    mutationFn: async ({
      calendarId,
      sharing,
    }: {
      calendarId: string;
      sharing: GoogleCalendarSharing;
    }): Promise<void> => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
        "gcal-calendars",
        { body: { action: "set_sharing", calendarId, sharing } },
      );
      const message = error
        ? ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (message) throw new Error(message);
    },
    // Optimistic: patch the one calendar's sharing in cache; roll back on error.
    onMutate: async ({ calendarId, sharing }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<GoogleCalendar[]>(queryKey);
      queryClient.setQueryData<GoogleCalendar[]>(queryKey, (old) =>
        (old ?? []).map((c) => (c.id === calendarId ? { ...c, sharing } : c)),
      );
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error(e.message || "Greška pri čuvanju");
    },
  });

  return {
    calendars: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    setSharing: setSharingMutation.mutate,
  };
}
