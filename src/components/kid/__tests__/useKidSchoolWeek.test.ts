import { describe, expect, it, vi } from "vitest";

import type { ResolvedSchoolBlock } from "@/utils/schoolTimetable";

/**
 * The module reaches `@/lib/supabase` through the school hooks, which throws at
 * module scope without the Vite env vars (passes locally, fails CI). Mocked
 * away - the rule under test is pure.
 */
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn<() => never>() } }));

const { currentPeriodIndex } = await import("@/components/kid/useKidSchoolWeek");

/** The prototype's morning band: five classes with a long gap after the 2nd. */
const TIMES: ReadonlyArray<[string, string]> = [
  ["08:00", "08:45"],
  ["08:50", "09:35"],
  ["09:55", "10:40"],
  ["10:45", "11:30"],
  ["11:35", "12:20"],
];

const BLOCKS: ResolvedSchoolBlock[] = TIMES.map(([startTime, endTime], index) => ({
  entryId: `e${index}`,
  personId: "kid-1",
  date: "2026-10-05",
  dayOfWeek: 0,
  periodIndex: index + 1,
  startTime,
  endTime,
  subject: `Predmet ${index + 1}`,
  room: null,
  variant: "A",
  band: "morning",
}));

function at(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

describe("currentPeriodIndex", () => {
  it("finds the class happening right now", () => {
    // 10:20 - the third class, exactly like the prototype's frozen moment.
    expect(currentPeriodIndex(BLOCKS, at(10, 20), true)).toBe(3);
  });

  it("badges nothing during a break - SADA over a period you are not in is a lie", () => {
    expect(currentPeriodIndex(BLOCKS, at(9, 40), true)).toBeNull(); // veliki odmor
    expect(currentPeriodIndex(BLOCKS, at(8, 47), true)).toBeNull(); // mali odmor
  });

  it("badges nothing before the first or after the last class", () => {
    expect(currentPeriodIndex(BLOCKS, at(7, 30), true)).toBeNull();
    expect(currentPeriodIndex(BLOCKS, at(13, 0), true)).toBeNull();
  });

  it("counts the start minute in and the end minute out", () => {
    expect(currentPeriodIndex(BLOCKS, at(8, 0), true)).toBe(1);
    expect(currentPeriodIndex(BLOCKS, at(8, 45), true)).toBeNull();
  });

  it("never badges a day that is not today", () => {
    expect(currentPeriodIndex(BLOCKS, at(10, 20), false)).toBeNull();
  });

  it("handles a day with no classes", () => {
    expect(currentPeriodIndex([], at(10, 20), true)).toBeNull();
  });
});
