import { useMemo } from "react";

import { resolveSchoolWeekBlocks, type ResolvedSchoolBlock } from "@/utils/schoolTimetable";
import { useBellSchedule } from "@/hooks/useBellSchedule";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useSchoolTimetable } from "@/hooks/useSchoolTimetable";

/**
 * Derived hook - composes the timetable entries, the family bell schedule, and
 * the shift anchors into concrete per-week school blocks for the grid. Mirrors
 * `useWeekActivities`: same `weekStart` + optional `personFilter` contract, so
 * the page can feed both into one `WeekGrid`.
 */

export interface UseWeekSchoolResult {
  blocks: ResolvedSchoolBlock[];
  isLoading: boolean;
}

export function useWeekSchool(
  weekStart: string,
  personFilter?: ReadonlySet<string>,
): UseWeekSchoolResult {
  const timetableQuery = useSchoolTimetable();
  const { bell, isLoading: bellLoading } = useBellSchedule();
  const { byPersonId: shiftAnchorsByPerson, isLoading: shiftsLoading } = useSchoolShiftAnchors();

  const blocks = useMemo(() => {
    const entries = timetableQuery.data ?? [];
    const all = resolveSchoolWeekBlocks({
      weekStart,
      bell,
      entries,
      shiftAnchorsByPersonId: shiftAnchorsByPerson,
    });
    if (!personFilter || personFilter.size === 0) return all;
    return all.filter((b) => personFilter.has(b.personId));
  }, [timetableQuery.data, bell, shiftAnchorsByPerson, weekStart, personFilter]);

  return {
    blocks,
    isLoading: timetableQuery.isLoading || bellLoading || shiftsLoading,
  };
}
