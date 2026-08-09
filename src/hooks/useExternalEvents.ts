import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ExternalCalendarEvent } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Read-only list of mirrored Google events for a `[from, to]` window, keyed on
 * `local_date`. RLS decides visibility (family-shared events to the whole
 * family, private ones only to the connecting member), so we don't filter by
 * family here. The shared family broadcast channel (`useFamilyChannel`)
 * invalidates this query when the gcal-sync worker upserts changes, so an open
 * agenda refreshes itself.
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
  if (error) throw new Error(error.message);
  return (data as ExternalCalendarEvent[]) ?? [];
}

export function useExternalEventsList(filters: ExternalEventFilters = {}) {
  const { familyId } = useProfile();
  const { from, to } = filters;
  const query = useQuery({
    queryKey: ["external_calendar_events", familyId, { from, to }],
    queryFn: () => fetchExternalEvents({ from, to }),
    enabled: !!familyId,
    // Keep the prior window's rows while a wider [from, to] refetches - same
    // reason as useEventsList: this query is range-scoped too, so a horizon
    // grow on "Uskoro" would otherwise blank it mid-scroll and (under a filter)
    // collapse the list, jumping the scroll to the top.
    placeholderData: keepPreviousData,
  });

  return query;
}

/**
 * Whether ANY mirrored Google event is visible to this member, family-wide and
 * date-independent. Drives the calendar filter's "Google" chip: a family that
 * never connected Google Calendar shouldn't be offered a filter for a source
 * that cannot produce items. Same query-key family as the list above, so the
 * `useFamilyChannel` broadcast invalidation refreshes it when a sync lands.
 */
export function useHasExternalEvents(): boolean {
  const { familyId } = useProfile();
  const query = useQuery({
    queryKey: ["external_calendar_events", familyId, "any"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("external_calendar_events")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!familyId,
    staleTime: 5 * 60_000,
  });
  return query.data ?? false;
}
