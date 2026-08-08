import { useEffect, useMemo, useState } from "react";

import { useBellSchedule } from "@/hooks/useBellSchedule";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useWeekSchool } from "@/hooks/useWeekSchool";
import type { SchoolShift } from "@/types/database";
import { deriveShiftForWeek, timeToMinutes } from "@/utils/activity";
import { computeBellGrid, type ResolvedSchoolBlock } from "@/utils/schoolTimetable";

/**
 * One week of school, shaped for a child.
 *
 * The grown-up app renders a clock grid; the kid shell renders a numbered
 * ladder - 1st class, 2nd class, the big break, and so on. That needs three
 * things the existing hooks each hold a piece of: the resolved blocks
 * (`useWeekSchool`, already person-filterable), the bell grid (to know where
 * the veliki odmor falls and how long it is), and the child's shift anchor
 * (to say "ove nedelje si pre podne").
 */

export interface KidSchoolWeek {
  /** `YYYY-MM-DD` → that day's classes, already ordered by period. */
  blocksByDate: Map<string, ResolvedSchoolBlock[]>;
  /** `YYYY-MM-DD` → raspust label, for the days school simply is not on. */
  breakDays: Map<string, string>;
  /** Period after which the veliki odmor falls, or null. */
  bigBreakAfterPeriod: number | null;
  /** "9:35 - 9:55" - the big break's window in this week's band. */
  bigBreakRange: string | null;
  /** The child's rota shift this week, or null when they are not a student. */
  shift: SchoolShift | null;
  /** False when this child has no timetable at all (not a pupil, or empty). */
  hasTimetable: boolean;
  isLoading: boolean;
}

export function useKidSchoolWeek(weekStart: string, kidProfileId: string | null): KidSchoolWeek {
  // A stable single-member set - a fresh Set on every render would re-run the
  // memos inside `useWeekSchool` forever.
  const personFilter = useMemo(() => new Set(kidProfileId ? [kidProfileId] : []), [kidProfileId]);

  const { blocks, breakDays, isLoading } = useWeekSchool(weekStart, personFilter);
  const { bell, isLoading: bellLoading } = useBellSchedule();
  const { byPersonId, isLoading: anchorsLoading } = useSchoolShiftAnchors();

  const anchor = kidProfileId ? byPersonId.get(kidProfileId) : undefined;

  const blocksByDate = useMemo(() => {
    const map = new Map<string, ResolvedSchoolBlock[]>();
    for (const block of blocks) {
      const arr = map.get(block.date);
      if (arr) arr.push(block);
      else map.set(block.date, [block]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.periodIndex - b.periodIndex);
    return map;
  }, [blocks]);

  const { bigBreakAfterPeriod, bigBreakRange } = useMemo(() => {
    // The band comes from the blocks themselves (they were resolved with it),
    // so a child whose time band is pinned by `fixed_time_band` gets the right
    // bell grid without this hook re-deriving that rule.
    const band = blocks[0]?.band ?? anchor?.fixed_time_band ?? "morning";
    if (!bell) return { bigBreakAfterPeriod: null, bigBreakRange: null };
    const grid = computeBellGrid(bell, band, anchor?.afternoon_uses_predcas ?? false);
    const index = grid.findIndex((slot) => slot.bigBreakAfter);
    if (index < 0 || index + 1 >= grid.length) {
      return { bigBreakAfterPeriod: null, bigBreakRange: null };
    }
    return {
      bigBreakAfterPeriod: grid[index].periodIndex,
      bigBreakRange: `${grid[index].endTime} - ${grid[index + 1].startTime}`,
    };
  }, [bell, blocks, anchor]);

  return {
    blocksByDate,
    breakDays,
    bigBreakAfterPeriod,
    bigBreakRange,
    shift: anchor ? deriveShiftForWeek(anchor, weekStart) : null,
    hasTimetable: blocks.length > 0,
    isLoading: isLoading || bellLoading || anchorsLoading,
  };
}

// ---------------------------------------------------------------------------
// "SADA"
// ---------------------------------------------------------------------------

/**
 * Minutes since local midnight, refreshed every half minute and on every
 * resume. Same reasoning as `useToday`: an installed PWA keeps its JS context
 * alive for days, so a clock read once in a memo is wrong by morning. Half a
 * minute is fine here - the badge only ever moves at a class boundary.
 */
export function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(() => currentMinutes());

  useEffect(() => {
    const tick = () => setMinutes(currentMinutes());
    const timer = window.setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, []);

  return minutes;
}

function currentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Which class is happening right now, or null. Only ever true for today, and
 * only inside a class - the break between two classes deliberately shows no
 * badge, because "SADA" over a period the child is not in would be a small lie.
 */
export function currentPeriodIndex(
  blocks: ReadonlyArray<ResolvedSchoolBlock>,
  nowMinutes: number,
  isToday: boolean,
): number | null {
  if (!isToday) return null;
  for (const block of blocks) {
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    if (nowMinutes >= start && nowMinutes < end) return block.periodIndex;
  }
  return null;
}
