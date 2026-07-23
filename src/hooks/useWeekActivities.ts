import { useMemo } from "react";

import {
  deriveShiftForWeek,
  resolveWeekBlocks,
  type ResolvedActivityBlock,
} from "@/utils/activity";
import type { SchoolShift } from "@/types/database";
import { useActivities } from "@/hooks/useActivities";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";

/**
 * Derived hook - composes the three raw activity queries (`useActivities`,
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
  const overridesQuery = useActivityOverrides();
  const participantsQuery = useActivityParticipants();
  const {
    byPersonId: shiftAnchorsByPerson,
    isLoading: shiftsLoading,
    data: shiftAnchorsData,
  } = useSchoolShiftAnchors();

  const blocks = useMemo(() => {
    const activities = activitiesQuery.data ?? [];
    const schedule = scheduleQuery.data ?? [];
    const overrides = overridesQuery.data ?? [];
    const participants = participantsQuery.data ?? [];

    const allBlocks = resolveWeekBlocks({
      weekStart,
      activities,
      schedule,
      participants,
      shiftAnchorsByPersonId: shiftAnchorsByPerson,
      overrides,
    });

    // Person filter moved from activity-level to block-level: multi-person
    // activities should partially show - if the chip filter keeps only
    // Lucija, a shared "Engleski" still appears for Lucija (just without
    // her sibling's block beside it).
    if (!personFilter || personFilter.size === 0) return allBlocks;
    return allBlocks.filter((b) => personFilter.has(b.personId));
  }, [
    activitiesQuery.data,
    scheduleQuery.data,
    overridesQuery.data,
    participantsQuery.data,
    shiftAnchorsByPerson,
    weekStart,
    personFilter,
  ]);

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
    isLoading:
      activitiesQuery.isLoading ||
      scheduleQuery.isLoading ||
      participantsQuery.isLoading ||
      shiftsLoading ||
      overridesQuery.isLoading,
  };
}
