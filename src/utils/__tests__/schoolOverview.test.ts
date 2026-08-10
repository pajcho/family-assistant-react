import { describe, expect, it } from "vitest";
import type { BellSchedule, SchoolBreak, SchoolShiftAnchor } from "@/types/database";
import {
  daysUntilBreak,
  minutesOfTime,
  nextBreak,
  nextWeekStart,
  periodState,
  schoolDaySummary,
  weekOutlook,
} from "../schoolOverview";

// Same defaults the migration seeds: 45' classes, 5' small / 20' big breaks,
// morning 08:00, afternoon 14:00, early band 13:00.
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

/** Three consecutive Mondays. */
const W0 = "2026-05-25";
const W1 = "2026-06-01";

function anchor(over: Partial<SchoolShiftAnchor> = {}): SchoolShiftAnchor {
  return {
    person_id: "p",
    family_id: "fam",
    anchor_week_start: W0,
    anchor_shift: "morning",
    flip_interval_weeks: 1,
    is_alternating: true,
    fixed_time_band: null,
    afternoon_uses_predcas: false,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function schoolBreak(over: Partial<SchoolBreak> = {}): SchoolBreak {
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

/** A day of classes as the screen sees it: slot number plus its clock span. */
function day(...spans: Array<[number, string, string]>) {
  return spans.map(([periodIndex, startTime, endTime]) => ({
    periodIndex,
    startTime,
    endTime,
  }));
}

describe("minutesOfTime", () => {
  it("reads both HH:MM and the HH:MM:SS Postgres hands back", () => {
    expect(minutesOfTime("08:00")).toBe(480);
    expect(minutesOfTime("08:00:00")).toBe(480);
    expect(minutesOfTime("13:45")).toBe(825);
    expect(minutesOfTime("00:00")).toBe(0);
  });
});

describe("periodState", () => {
  const span = { startTime: "08:00", endTime: "08:45" };

  it("is future before, now inside, past after", () => {
    expect(periodState(span, 7 * 60 + 59)).toBe("future");
    expect(periodState(span, 8 * 60)).toBe("now");
    expect(periodState(span, 8 * 60 + 44)).toBe("now");
    expect(periodState(span, 8 * 60 + 45)).toBe("past");
  });

  it("treats a day that is not today as all future", () => {
    expect(periodState(span, null)).toBe("future");
  });
});

describe("schoolDaySummary", () => {
  const classes = day([1, "08:00", "08:45"], [2, "08:50", "09:35"], [3, "09:55", "10:40"]);

  it("says so when the day has no classes at all", () => {
    expect(schoolDaySummary([], 600).label).toBe("nema časova");
    expect(schoolDaySummary([], null).label).toBe("nema časova");
  });

  it("gives the span for a day that is not today", () => {
    expect(schoolDaySummary(classes, null).label).toBe("08:00 - 10:40");
  });

  it("counts down to the first class before school starts", () => {
    expect(schoolDaySummary(classes, 7 * 60).label).toBe("počinje u 08:00");
  });

  it("names the class in progress", () => {
    const summary = schoolDaySummary(classes, 10 * 60);
    expect(summary.currentPeriod).toBe(3);
    expect(summary.label).toBe("3. čas u toku");
  });

  it("names the class being waited for during a break", () => {
    // 09:40 - after the 2nd class, inside the big break.
    expect(schoolDaySummary(classes, 9 * 60 + 40).label).toBe("odmor do 09:55");
  });

  it("is done once the last class ends", () => {
    expect(schoolDaySummary(classes, 10 * 60 + 40).label).toBe("gotovo za danas");
    expect(schoolDaySummary(classes, 23 * 60).label).toBe("gotovo za danas");
  });
});

describe("weekOutlook", () => {
  it("flips variant and band with the rota", () => {
    const a = anchor();
    expect(weekOutlook(a, BELL, W0)).toMatchObject({
      variant: "A",
      band: "morning",
      startTime: "08:00",
    });
    expect(weekOutlook(a, BELL, W1)).toMatchObject({
      variant: "B",
      band: "afternoon",
      startTime: "14:00",
    });
  });

  it("keeps a fixed-morning child on the clock while the variant still flips", () => {
    const a = anchor({ fixed_time_band: "morning" });
    expect(weekOutlook(a, BELL, W1)).toMatchObject({
      variant: "B",
      band: "morning",
      startTime: "08:00",
      usesPredcas: false,
    });
  });

  it("applies pred-čas only on the weeks that are actually afternoon", () => {
    const a = anchor({ afternoon_uses_predcas: true });
    // Morning week: the flag is set but irrelevant, and must not be announced.
    expect(weekOutlook(a, BELL, W0)).toMatchObject({
      band: "morning",
      startTime: "08:00",
      usesPredcas: false,
    });
    expect(weekOutlook(a, BELL, W1)).toMatchObject({
      band: "afternoon",
      startTime: "13:00",
      usesPredcas: true,
    });
  });

  it("holds a non-alternating child on one variant and band", () => {
    const a = anchor({ is_alternating: false, anchor_shift: "afternoon" });
    expect(weekOutlook(a, BELL, W0)).toMatchObject({ variant: "B", band: "afternoon" });
    expect(weekOutlook(a, BELL, W1)).toMatchObject({ variant: "B", band: "afternoon" });
  });
});

describe("nextWeekStart", () => {
  it("steps one week, across a month boundary", () => {
    expect(nextWeekStart(W0)).toBe(W1);
    expect(nextWeekStart("2026-12-28")).toBe("2027-01-04");
  });
});

describe("nextBreak", () => {
  const summer = schoolBreak({
    name: "Letnji",
    start_month: 6,
    start_day: 21,
    end_month: 8,
    end_day: 31,
  });
  const winter = schoolBreak({
    name: "Zimski",
    start_month: 12,
    start_day: 30,
    end_month: 1,
    end_day: 20,
  });
  const empty = new Map<string, ReadonlySet<string>>();

  it("counts the days to the next one", () => {
    const hit = nextBreak({
      today: "2026-06-01",
      breaks: [summer],
      memberIdsByBreak: empty,
      personIds: ["p"],
    });
    expect(hit?.brk.name).toBe("Letnji");
    expect(hit?.daysUntil).toBe(20);
    expect(hit?.ongoing).toBe(false);
  });

  it("reports a break that is already running as ongoing", () => {
    const hit = nextBreak({
      today: "2026-07-15",
      breaks: [summer],
      memberIdsByBreak: empty,
      personIds: ["p"],
    });
    expect(hit).toMatchObject({ daysUntil: 0, ongoing: true, date: "2026-07-15" });
  });

  it("finds a break that wraps the New Year from the year before", () => {
    const hit = nextBreak({
      today: "2026-12-01",
      breaks: [winter],
      memberIdsByBreak: empty,
      personIds: ["p"],
    });
    expect(hit?.daysUntil).toBe(29); // 01.12 -> 30.12
  });

  it("finds the same wrapping break from inside January", () => {
    const hit = nextBreak({
      today: "2027-01-05",
      breaks: [winter],
      memberIdsByBreak: empty,
      personIds: ["p"],
    });
    expect(hit).toMatchObject({ daysUntil: 0, ongoing: true });
  });

  it("picks whichever break comes first", () => {
    const hit = nextBreak({
      today: "2026-06-01",
      breaks: [winter, summer],
      memberIdsByBreak: empty,
      personIds: ["p"],
    });
    expect(hit?.brk.name).toBe("Letnji");
  });

  it("ignores a break scoped to other children", () => {
    const scoped = new Map<string, ReadonlySet<string>>([[summer.id, new Set(["other"])]]);
    expect(
      nextBreak({
        today: "2026-06-01",
        breaks: [summer],
        memberIdsByBreak: scoped,
        personIds: ["p"],
      }),
    ).toBeNull();
  });

  it("has nothing to report without breaks or without children", () => {
    expect(
      nextBreak({ today: "2026-06-01", breaks: [], memberIdsByBreak: empty, personIds: ["p"] }),
    ).toBeNull();
    expect(
      nextBreak({ today: "2026-06-01", breaks: [summer], memberIdsByBreak: empty, personIds: [] }),
    ).toBeNull();
  });
});

describe("daysUntilBreak", () => {
  it("is 0 while the break runs and counts forward otherwise", () => {
    const summer = schoolBreak({ start_month: 6, start_day: 21, end_month: 8, end_day: 31 });
    expect(daysUntilBreak(summer, "2026-07-01")).toBe(0);
    expect(daysUntilBreak(summer, "2026-06-20")).toBe(1);
  });

  it("rolls into next year once this year's break has passed", () => {
    const spring = schoolBreak({ start_month: 4, start_day: 1, end_month: 4, end_day: 10 });
    // 11.04.2026 to 01.04.2027.
    expect(daysUntilBreak(spring, "2026-04-11")).toBe(355);
  });
});
