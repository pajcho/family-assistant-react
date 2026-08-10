import { describe, expect, it } from "vitest";
import type {
  BellSchedule,
  SchoolBreak,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
} from "@/types/database";
import {
  addMinutesToTime,
  computeBellGrid,
  isDateInBreak,
  resolveSchoolBreakDays,
  resolveSchoolWeekBlocks,
  timeBandForWeek,
  variantForWeek,
} from "../schoolTimetable";

// Mirrors the migration defaults: 45' classes, 5' small / 20' big breaks,
// morning 08:00 (big break after 2), afternoon 14:00 (after 2), early band
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

function schoolBreak(over: Partial<SchoolBreak>): SchoolBreak {
  return {
    id: Math.random().toString(36).slice(2),
    family_id: "fam",
    name: "Raspust",
    start_month: 6,
    start_day: 21,
    end_month: 8,
    end_day: 31,
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
      entry({
        person_id: "p",
        variant: "A",
        day_of_week: 0,
        period_index: 2,
        subject: "Matematika",
      }),
      entry({ person_id: "p", variant: "B", day_of_week: 0, period_index: 1, subject: "Engleski" }),
    ];

    const a = resolveSchoolWeekBlocks({
      weekStart: W0,
      bell: BELL,
      entries,
      shiftAnchorsByPersonId: anchors,
    });
    expect(a.map((b) => [b.subject, b.startTime, b.endTime])).toEqual([
      ["Srpski", "08:00", "08:45"],
      ["Matematika", "08:50", "09:35"],
    ]);

    // Week B → the 'B' timetable, and (afternoon_uses_predcas) the 13:00 grid.
    const b = resolveSchoolWeekBlocks({
      weekStart: W1,
      bell: BELL,
      entries,
      shiftAnchorsByPersonId: anchors,
    });
    expect(b.map((x) => [x.subject, x.startTime])).toEqual([["Engleski", "13:00"]]);
  });

  it("1st/2nd grader: week-B subjects show at MORNING times", () => {
    const a1 = new Map<string, SchoolShiftAnchor>();
    a1.set(
      "kid",
      anchor({ person_id: "kid", anchor_shift: "morning", fixed_time_band: "morning" }),
    );
    const entries = [
      entry({ person_id: "kid", variant: "A", day_of_week: 0, period_index: 1, subject: "Srpski" }),
      entry({
        person_id: "kid",
        variant: "B",
        day_of_week: 0,
        period_index: 1,
        subject: "Likovno",
      }),
    ];
    const b = resolveSchoolWeekBlocks({
      weekStart: W1,
      bell: BELL,
      entries,
      shiftAnchorsByPersonId: a1,
    });
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
    const r = resolveSchoolWeekBlocks({
      weekStart: W0,
      bell: BELL,
      entries,
      shiftAnchorsByPersonId: empty,
    });
    expect(r.map((b) => b.subject)).toEqual(["Srpski"]);
    expect(r[0].startTime).toBe("08:00");
  });

  it("skips entries whose period_index exceeds max_periods, and returns [] without a bell", () => {
    anchors.set("p", anchor({ person_id: "p" }));
    const entries = [
      entry({ person_id: "p", variant: "A", period_index: 8, subject: "Van mreže" }),
    ];
    expect(
      resolveSchoolWeekBlocks({
        weekStart: W0,
        bell: BELL,
        entries,
        shiftAnchorsByPersonId: anchors,
      }),
    ).toEqual([]);
    expect(
      resolveSchoolWeekBlocks({
        weekStart: W0,
        bell: null,
        entries,
        shiftAnchorsByPersonId: anchors,
      }),
    ).toEqual([]);
  });
});

describe("isDateInBreak", () => {
  const summer = schoolBreak({ start_month: 6, start_day: 21, end_month: 8, end_day: 31 });

  it("covers the range inclusively, in every year", () => {
    expect(isDateInBreak("2026-06-21", summer)).toBe(true);
    expect(isDateInBreak("2026-08-31", summer)).toBe(true);
    expect(isDateInBreak("2031-07-15", summer)).toBe(true);
    expect(isDateInBreak("2026-06-20", summer)).toBe(false);
    expect(isDateInBreak("2026-09-01", summer)).toBe(false);
  });

  // The whole reason the columns are month+day: end before start = the range
  // runs over New Year, which is exactly how the winter break falls.
  it("wraps the New Year when the end falls before the start", () => {
    const winter = schoolBreak({ start_month: 12, start_day: 30, end_month: 1, end_day: 20 });
    expect(isDateInBreak("2026-12-30", winter)).toBe(true);
    expect(isDateInBreak("2026-12-31", winter)).toBe(true);
    expect(isDateInBreak("2027-01-01", winter)).toBe(true);
    expect(isDateInBreak("2027-01-20", winter)).toBe(true);
    expect(isDateInBreak("2027-01-21", winter)).toBe(false);
    expect(isDateInBreak("2026-12-29", winter)).toBe(false);
    expect(isDateInBreak("2026-06-15", winter)).toBe(false);
  });

  it("handles a single-day break and 29.02 in a non-leap year", () => {
    const oneDay = schoolBreak({ start_month: 5, start_day: 1, end_month: 5, end_day: 1 });
    expect(isDateInBreak("2026-05-01", oneDay)).toBe(true);
    expect(isDateInBreak("2026-05-02", oneDay)).toBe(false);

    // Stored as the number 229, never turned into a Date - so a 29.02 edge
    // survives a non-leap year instead of collapsing onto 01.03.
    const leapEdge = schoolBreak({ start_month: 2, start_day: 20, end_month: 2, end_day: 29 });
    expect(isDateInBreak("2026-02-28", leapEdge)).toBe(true);
    expect(isDateInBreak("2026-03-01", leapEdge)).toBe(false);
  });
});

describe("resolveSchoolWeekBlocks - raspusti", () => {
  // W0 = Monday 2026-05-25, so the week runs 25-31 May.
  const anchors = new Map<string, SchoolShiftAnchor>([["p", anchor({ person_id: "p" })]]);
  const entries = [
    entry({ person_id: "p", variant: "A", day_of_week: 0, period_index: 1, subject: "Srpski" }),
    entry({ person_id: "p", variant: "A", day_of_week: 2, period_index: 1, subject: "Matematika" }),
  ];

  it("drops classes on days a break covers, and keeps the rest", () => {
    // 25-26 May only: Monday is out, Wednesday is not.
    const brk = schoolBreak({ start_month: 5, start_day: 25, end_month: 5, end_day: 26 });
    const blocks = resolveSchoolWeekBlocks({
      weekStart: W0,
      bell: BELL,
      entries,
      shiftAnchorsByPersonId: anchors,
      breaks: [brk],
    });
    expect(blocks.map((b) => b.subject)).toEqual(["Matematika"]);
  });

  it("empties the whole week when the break spans it", () => {
    const brk = schoolBreak({ start_month: 5, start_day: 1, end_month: 9, end_day: 1 });
    expect(
      resolveSchoolWeekBlocks({
        weekStart: W0,
        bell: BELL,
        entries,
        shiftAnchorsByPersonId: anchors,
        breaks: [brk],
      }),
    ).toEqual([]);
  });

  // Siblings in different grades get different breaks - the point of the
  // member list. Listing only Ana must leave Vuk's classes alone.
  it("applies only to the children the break lists", () => {
    const twoKids = new Map<string, SchoolShiftAnchor>([
      ["ana", anchor({ person_id: "ana" })],
      ["vuk", anchor({ person_id: "vuk" })],
    ]);
    const twoKidEntries = [
      entry({ person_id: "ana", variant: "A", day_of_week: 0, subject: "Ana - Srpski" }),
      entry({ person_id: "vuk", variant: "A", day_of_week: 0, subject: "Vuk - Srpski" }),
    ];
    const brk = schoolBreak({ start_month: 5, start_day: 25, end_month: 5, end_day: 26 });

    const blocks = resolveSchoolWeekBlocks({
      weekStart: W0,
      bell: BELL,
      entries: twoKidEntries,
      shiftAnchorsByPersonId: twoKids,
      breaks: [brk],
      breakMemberIdsByBreak: new Map([[brk.id, new Set(["ana"])]]),
    });
    expect(blocks.map((b) => b.subject)).toEqual(["Vuk - Srpski"]);
  });

  it("treats an empty member list as every child", () => {
    const brk = schoolBreak({ start_month: 5, start_day: 25, end_month: 5, end_day: 26 });
    const blocks = resolveSchoolWeekBlocks({
      weekStart: W0,
      bell: BELL,
      entries,
      shiftAnchorsByPersonId: anchors,
      breaks: [brk],
      breakMemberIdsByBreak: new Map([[brk.id, new Set<string>()]]),
    });
    expect(blocks.map((b) => b.subject)).toEqual(["Matematika"]);
  });
});

describe("resolveSchoolBreakDays", () => {
  const brk = schoolBreak({
    id: "b1",
    name: "Prolećni raspust",
    start_month: 5,
    start_day: 25,
    end_month: 5,
    end_day: 26,
  });

  it("labels each covered day with the break's name", () => {
    const days = resolveSchoolBreakDays({
      weekStart: W0,
      personIds: ["p"],
      breaks: [brk],
      memberIdsByBreak: new Map(),
    });
    expect([...days.keys()]).toEqual(["2026-05-25", "2026-05-26"]);
    expect(days.get("2026-05-25")).toEqual({
      names: ["Prolećni raspust"],
      personIds: ["p"],
      everyone: true,
    });
  });

  // Siblings in different grades get different breaks, so BOTH names have to
  // reach the label - collapsing to one hid a whole child's raspust.
  it("collects every child's break name when they differ", () => {
    const vuksBreak = schoolBreak({
      id: "b2",
      name: "Letnji",
      start_month: 5,
      start_day: 25,
      end_month: 5,
      end_day: 25,
    });
    const days = resolveSchoolBreakDays({
      weekStart: W0,
      personIds: ["ana", "vuk"],
      breaks: [brk, vuksBreak],
      memberIdsByBreak: new Map([
        ["b1", new Set(["ana"])],
        ["b2", new Set(["vuk"])],
      ]),
    });
    expect(days.get("2026-05-25")).toEqual({
      names: ["Prolećni raspust", "Letnji"],
      personIds: ["ana", "vuk"],
      everyone: true,
    });
  });

  // Half the family off still gets a label, but flagged as partial so the UI
  // can name whose break it is - the other child's classes are right there.
  it("marks a day partial when only some children are off", () => {
    const days = resolveSchoolBreakDays({
      weekStart: W0,
      personIds: ["ana", "vuk"],
      breaks: [brk],
      memberIdsByBreak: new Map([["b1", new Set(["ana"])]]),
    });
    expect(days.get("2026-05-25")).toEqual({
      names: ["Prolećni raspust"],
      personIds: ["ana"],
      everyone: false,
    });
  });

  // A child in scope is a STUDENT, whether or not their timetable is filled in
  // - so narrowing to the one child on a break must still label the day.
  it("labels the day when scope is narrowed to the child on the break", () => {
    const days = resolveSchoolBreakDays({
      weekStart: W0,
      personIds: ["ana"],
      breaks: [brk],
      memberIdsByBreak: new Map([["b1", new Set(["ana"])]]),
    });
    expect(days.get("2026-05-25")?.everyone).toBe(true);
    expect(days.get("2026-05-25")?.names).toEqual(["Prolećni raspust"]);
  });

  it("labels the day once when two breaks overlap on it", () => {
    const other = schoolBreak({
      id: "b2",
      name: "Državni praznik",
      start_month: 5,
      start_day: 26,
      end_month: 5,
      end_day: 26,
    });
    const days = resolveSchoolBreakDays({
      weekStart: W0,
      personIds: ["p"],
      breaks: [brk, other],
      memberIdsByBreak: new Map(),
    });
    expect(days.get("2026-05-26")?.names).toEqual(["Prolećni raspust", "Državni praznik"]);
  });

  it("returns nothing without breaks or without children", () => {
    expect(
      resolveSchoolBreakDays({
        weekStart: W0,
        personIds: ["p"],
        breaks: [],
        memberIdsByBreak: new Map(),
      }).size,
    ).toBe(0);
    expect(
      resolveSchoolBreakDays({
        weekStart: W0,
        personIds: [],
        breaks: [brk],
        memberIdsByBreak: new Map(),
      }).size,
    ).toBe(0);
  });
});
