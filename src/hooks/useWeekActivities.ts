import { useMemo } from "react";

import {
  deriveShiftForWeek,
  resolveWeekBlocks,
  type ResolvedActivityBlock,
} from "@/utils/activity";
import type { SchoolShift } from "@/types/database";
import { useActivities } from "@/hooks/useActivities";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";

/**
 * Derived hook — composes the three raw activity queries (`useActivities`,
 * `useActivitySchedule`, `useSchoolShiftAnchors`) and resolves them into
 * concrete per-week blocks ready for the weekly grid.
 *
 * Optionally filters by a set of person ids (the chip filter row). An
 * empty/undefined `personFilter` means "show everyone".
 *
 * Returns the per-person resolved school shift for the week as well, so the
 * page header can show "Marko: jutarnja smena" for each child with an
 * anchor.
 */

export interface UseWeekActivitiesResult {
  weekStart: string;
  blocks: ResolvedActivityBlock[];
  /** Per-personId → resolved shift for `weekStart`. Only populated for people with an anchor. */
  shiftsByPerson: Map<string, SchoolShift>;
  isLoading: boolean;
}

export function useWeekActivities(
  weekStart: string,
  personFilter?: ReadonlySet<string>,
): UseWeekActivitiesResult {
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const { byPersonId: shiftAnchorsByPerson, isLoading: shiftsLoading, data: shiftAnchorsData } =
    useSchoolShiftAnchors();

  const blocks = useMemo(() => {
    const activities = activitiesQuery.data ?? [];
    const schedule = scheduleQuery.data ?? [];

    const filteredActivities =
      personFilter && personFilter.size > 0
        ? activities.filter((a) => personFilter.has(a.person_id))
        : activities;
    const allowedActivityIds = new Set(filteredActivities.map((a) => a.id));
    const filteredSchedule = schedule.filter((rule) => allowedActivityIds.has(rule.activity_id));

    return resolveWeekBlocks({
      weekStart,
      activities: filteredActivities,
      schedule: filteredSchedule,
      shiftAnchorsByPersonId: shiftAnchorsByPerson,
    });
  }, [activitiesQuery.data, scheduleQuery.data, shiftAnchorsByPerson, weekStart, personFilter]);

  const shiftsByPerson = useMemo(() => {
    const map = new Map<string, SchoolShift>();
    for (const anchor of shiftAnchorsData ?? []) {
      map.set(anchor.person_id, deriveShiftForWeek(anchor, weekStart));
    }
    return map;
  }, [shiftAnchorsData, weekStart]);

  return {
    weekStart,
    blocks,
    shiftsByPerson,
    isLoading: activitiesQuery.isLoading || scheduleQuery.isLoading || shiftsLoading,
  };
}
