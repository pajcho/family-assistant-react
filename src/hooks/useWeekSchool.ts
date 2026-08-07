import { useMemo } from "react";

import {
  resolveSchoolBreakDays,
  resolveSchoolWeekBlocks,
  type ResolvedSchoolBlock,
} from "@/utils/schoolTimetable";
import { useBellSchedule } from "@/hooks/useBellSchedule";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useSchoolBreaks } from "@/hooks/useSchoolBreaks";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useSchoolTimetable } from "@/hooks/useSchoolTimetable";
import { getDisplayName } from "@/utils/identity";

/**
 * Derived hook - composes the timetable entries, the family bell schedule, the
 * shift anchors and the raspusti into concrete per-week school blocks for the
 * grid. Mirrors `useWeekActivities`: same `weekStart` + optional `personFilter`
 * contract, so the page can feed both into one `WeekGrid`.
 */

export interface UseWeekSchoolResult {
  blocks: ResolvedSchoolBlock[];
  /**
   * "YYYY-MM-DD" → the label for that day's raspust, ready to render. The grid
   * puts it under the day number so an empty school column reads as a break
   * rather than as a bug.
   */
  breakDays: Map<string, string>;
  isLoading: boolean;
}

export function useWeekSchool(
  weekStart: string,
  personFilter?: ReadonlySet<string>,
): UseWeekSchoolResult {
  const timetableQuery = useSchoolTimetable();
  const { bell, isLoading: bellLoading } = useBellSchedule();
  const { byPersonId: shiftAnchorsByPerson, isLoading: shiftsLoading } = useSchoolShiftAnchors();
  const { breaks, memberIdsByBreak, isLoading: breaksLoading } = useSchoolBreaks();
  const { members } = useFamilyMembers();

  const entries = useMemo(() => timetableQuery.data ?? [], [timetableQuery.data]);

  const blocks = useMemo(() => {
    const all = resolveSchoolWeekBlocks({
      weekStart,
      bell,
      entries,
      shiftAnchorsByPersonId: shiftAnchorsByPerson,
      breaks,
      breakMemberIdsByBreak: memberIdsByBreak,
    });
    if (!personFilter || personFilter.size === 0) return all;
    return all.filter((b) => personFilter.has(b.personId));
  }, [entries, bell, shiftAnchorsByPerson, breaks, memberIdsByBreak, weekStart, personFilter]);

  const breakDays = useMemo(() => {
    // Scope = the STUDENTS in view. A student is a member with a shift anchor,
    // the same rule the options sheet uses - deriving it from timetable rows
    // instead was wrong: a child whose timetable is still empty dropped out of
    // scope, so their raspust never showed at all, and filtering to that child
    // emptied the scope and made the label vanish entirely.
    //
    // Iterating `members` (not the anchor map) keeps roster order, so a label
    // naming two children reads the same way everywhere.
    const inScope = members
      .map((m) => m.id)
      .filter(
        (id) =>
          shiftAnchorsByPerson.has(id) &&
          (!personFilter || personFilter.size === 0 || personFilter.has(id)),
      );

    const resolved = resolveSchoolBreakDays({
      weekStart,
      personIds: inScope,
      breaks,
      memberIdsByBreak,
    });

    const nameById = new Map(members.map((m) => [m.id, m]));
    const labels = new Map<string, string>();
    for (const [date, day] of resolved) {
      const breakNames = day.names.join(" · ");
      if (day.everyone) {
        labels.set(date, breakNames);
        continue;
      }
      // Only some are off, so the day still has classes: say whose break it is
      // rather than hanging an unqualified "Raspust" over a sibling's lessons.
      const who = day.personIds
        .map((id) => {
          const member = nameById.get(id);
          if (!member) return null;
          return (
            member.first_name ||
            getDisplayName({
              firstName: member.first_name,
              lastName: member.last_name,
              email: null,
            }) ||
            null
          );
        })
        .filter((name): name is string => !!name);
      labels.set(date, who.length > 0 ? `${who.join(", ")} - ${breakNames}` : breakNames);
    }
    return labels;
  }, [members, shiftAnchorsByPerson, breaks, memberIdsByBreak, weekStart, personFilter]);

  return {
    blocks,
    breakDays,
    isLoading: timetableQuery.isLoading || bellLoading || shiftsLoading || breaksLoading,
  };
}
