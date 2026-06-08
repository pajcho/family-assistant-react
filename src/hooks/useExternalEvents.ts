import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ExternalCalendarEvent } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Read-only list of mirrored Google events for a `[from, to]` window, keyed on
 * `local_date`. RLS decides visibility (family-shared events to the whole
 * family, private ones only to the connecting member), so we don't filter by
 * family here. A realtime subscription invalidates the query when the gcal-sync
 * worker upserts changes, so an open agenda refreshes itself.
 *
 * Unique channel name per hook instance (useId) so it never collides with
 * another subscriber on the same table — mirrors useEventsList.
 */

interface ExternalEventFilters {
  from?: string;
  to?: string;
}

async function fetchExternalEvents(
  filters: ExternalEventFilters,
): Promise<ExternalCalendarEvent[]> {
  let q = supabase
    .from("external_calendar_events")
    .select(
      "id, calendar_id, family_id, owner_user_id, visibility, google_event_id, ical_uid, recurring_event_id, title, description, location, start_at, end_at, local_date, start_time, end_time, is_all_day, event_type, status, html_link, source_url, color",
    )
    .order("local_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true });
  if (filters.from) q = q.gte("local_date", filters.from);
  if (filters.to) q = q.lte("local_date", filters.to);
  const { data, error } = await q;
  if (error) return [];
  return (data as ExternalCalendarEvent[]) ?? [];
}

export function useExternalEventsList(filters: ExternalEventFilters = {}) {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const { from, to } = filters;
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["external_calendar_events", familyId, { from, to }],
    queryFn: () => fetchExternalEvents({ from, to }),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`external-events-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "external_calendar_events" },
        () => queryClient.invalidateQueries({ queryKey: ["external_calendar_events", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  return query;
}
