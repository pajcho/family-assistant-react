import { describe, expect, it } from "vitest";
import type {
  BellSchedule,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
} from "@/types/database";
import {
  addMinutesToTime,
  computeBellGrid,
  resolveSchoolWeekBlocks,
  timeBandForWeek,
  variantForWeek,
} from "../schoolTimetable";

// Mirrors the migration defaults: 45' classes, 5' small / 20' big breaks,
// morning 08:00 (big break after 2), afternoon 14:00 (after 2), pred-čas
// afternoon 13:00 (after 3).
const BELL: BellSchedule = {
  family_id: "fam",
  period_minutes: 45,
  small_break_minutes: 5,
  big_break_minutes: 20,
  max_periods: 7,
  morning_start: "08:00:00",
  morning_big_break_after: 2,
  afternoon_start: "14:00:00",
  afternoon_big_break_after: 2,
  afternoon_predcas_start: "13:00:00",
  afternoon_predcas_big_break_after: 3,
  created_at: "",
  updated_at: "",
};

// Three Mondays, exactly one week apart, so weeksBetween() yields 0,1,2.
const W0 = "2026-05-25";
const W1 = "2026-06-01";

function anchor(over: Partial<SchoolShiftAnchor>): SchoolShiftAnchor {
  return {
    person_id: "p",
    family_id: "fam",
    anchor_week_start: W0,
    anchor_shift: "morning",
    flip_interval_weeks: 1,
    is_alternating: true,
    fixed_time_band: null,
    afternoon_uses_predcas: true,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function entry(over: Partial<SchoolTimetableEntry>): SchoolTimetableEntry {
  return {
    id: Math.random().toString(36).slice(2),
    family_id: "fam",
    person_id: "p",
    variant: "A",
    day_of_week: 0,
    period_index: 1,
    subject: "Srpski",
    room: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("addMinutesToTime", () => {
  it("adds across the hour boundary", () => {
    expect(addMinutesToTime("08:45", 5)).toBe("08:50");
    expect(addMinutesToTime("09:35:00", 20)).toBe("09:55");
    expect(addMinutesToTime("13:10", 5)).toBe("13:15");
  });
});

describe("computeBellGrid", () => {
  it("morning: 08:00 start, big break (20') after the 2nd class", () => {
    const g = computeBellGrid(BELL, "morning", false);
    expect(g.slice(0, 4).map((s) => [s.startTime, s.endTime])).toEqual([
      ["08:00", "08:45"],
      ["08:50", "09:35"],
      ["09:55", "10:40"], // pushed by the 20' big break after slot 2
      ["10:45", "11:30"],
    ]);
    expect(g[1].bigBreakAfter).toBe(true);
    expect(g[0].bigBreakAfter).toBe(false);
  });

  it("afternoon with pred-čas: 13:00 start, big break after the 3rd class", () => {
    const g = computeBellGrid(BELL, "afternoon", true);
    expect(g.slice(0, 5).map((s) => [s.startTime, s.endTime])).toEqual([
      ["13:00", "13:45"],
      ["13:50", "14:35"],
      ["14:40", "15:25"],
      ["15:45", "16:30"], // pushed by the big break after slot 3
      ["16:35", "17:20"],
    ]);
    expect(g[2].bigBreakAfter).toBe(true);
  });

  it("regular afternoon (no pred-čas): 14:00 start, big break after the 2nd", () => {
    const g = computeBellGrid(BELL, "afternoon", false);
    expect(g.slice(0, 3).map((s) => s.startTime)).toEqual(["14:00", "14:50", "15:55"]);
    expect(g[1].bigBreakAfter).toBe(true);
  });

  it("respects max_periods", () => {
    expect(computeBellGrid({ ...BELL, max_periods: 4 }, "morning", false)).toHaveLength(4);
  });
});

describe("variant + time band resolution", () => {
  it("normal alternating child: variant and band move together", () => {
    const a = anchor({ anchor_shift: "morning" });
    expect(variantForWeek(a, W0)).toBe("A");
    expect(timeBandForWeek(a, W0)).toBe("morning");
    expect(variantForWeek(a, W1)).toBe("B");
    expect(timeBandForWeek(a, W1)).toBe("afternoon");
  });

  it("1st/2nd grader: variant flips A↔B but the time band stays morning", () => {
    const a = anchor({ anchor_shift: "morning", is_alternating: true, fixed_time_band: "morning" });
    expect(variantForWeek(a, W0)).toBe("A");
    expect(timeBandForWeek(a, W0)).toBe("morning");
    // The decoupling: week B selects the B timetable, but the clock is morning.
    expect(variantForWeek(a, W1)).toBe("B");
    expect(timeBandForWeek(a, W1)).toBe("morning");
  });

  it("non-alternating child: constant variant and band every week", () => {
    const a = anchor({ is_alternating: false, anchor_shift: "afternoon" });
    expect(variantForWeek(a, W0)).toBe("B");
    expect(variantForWeek(a, W1)).toBe("B");
    expect(timeBandForWeek(a, W1)).toBe("afternoon");
  });
});

describe("resolveSchoolWeekBlocks", () => {
  const anchors = new Map<string, SchoolShiftAnchor>();

  it("emits only the active variant, with bell-derived times", () => {
    anchors.set("p", anchor({ person_id: "p", anchor_shift: "morning" }));
    const entries = [
      entry({ person_id: "p", variant: "A", day_of_week: 0, period_index: 1, subject: "Srpski" }),
      entry({ person_id: "p", variant: "A", day_of_week: 0, period_index: 2, subject: "Matematika" }),
      entry({ person_id: "p", variant: "B", day_of_week: 0, period_index: 1, subject: "Engleski" }),
    ];

    const a = resolveSchoolWeekBlocks({ weekStart: W0, bell: BELL, entries, shiftAnchorsByPersonId: anchors });
    expect(a.map((b) => [b.subject, b.startTime, b.endTime])).toEqual([
      ["Srpski", "08:00", "08:45"],
      ["Matematika", "08:50", "09:35"],
    ]);

    // Week B → the 'B' timetable, and (afternoon_uses_predcas) the 13:00 grid.
    const b = resolveSchoolWeekBlocks({ weekStart: W1, bell: BELL, entries, shiftAnchorsByPersonId: anchors });
    expect(b.map((x) => [x.subject, x.startTime])).toEqual([["Engleski", "13:00"]]);
  });

  it("1st/2nd grader: week-B subjects show at MORNING times", () => {
    const a1 = new Map<string, SchoolShiftAnchor>();
    a1.set("kid", anchor({ person_id: "kid", anchor_shift: "morning", fixed_time_band: "morning" }));
    const entries = [
      entry({ person_id: "kid", variant: "A", day_of_week: 0, period_index: 1, subject: "Srpski" }),
      entry({ person_id: "kid", variant: "B", day_of_week: 0, period_index: 1, subject: "Likovno" }),
    ];
    const b = resolveSchoolWeekBlocks({ weekStart: W1, bell: BELL, entries, shiftAnchorsByPersonId: a1 });
    expect(b).toHaveLength(1);
    expect(b[0].subject).toBe("Likovno");
    expect(b[0].variant).toBe("B");
    expect(b[0].band).toBe("morning");
    expect(b[0].startTime).toBe("08:00"); // NOT 13:00/14:00
  });

  it("falls back to variant A / morning when a child has no shift anchor", () => {
    const empty = new Map<string, SchoolShiftAnchor>();
    const entries = [
      entry({ person_id: "x", variant: "A", period_index: 1, subject: "Srpski" }),
      entry({ person_id: "x", variant: "B", period_index: 1, subject: "Engleski" }),
    ];
    const r = resolveSchoolWeekBlocks({ weekStart: W0, bell: BELL, entries, shiftAnchorsByPersonId: empty });
    expect(r.map((b) => b.subject)).toEqual(["Srpski"]);
    expect(r[0].startTime).toBe("08:00");
  });

  it("skips entries whose period_index exceeds max_periods, and returns [] without a bell", () => {
    anchors.set("p", anchor({ person_id: "p" }));
    const entries = [entry({ person_id: "p", variant: "A", period_index: 8, subject: "Van mreže" })];
    expect(resolveSchoolWeekBlocks({ weekStart: W0, bell: BELL, entries, shiftAnchorsByPersonId: anchors })).toEqual([]);
    expect(resolveSchoolWeekBlocks({ weekStart: W0, bell: null, entries, shiftAnchorsByPersonId: anchors })).toEqual([]);
  });
});
