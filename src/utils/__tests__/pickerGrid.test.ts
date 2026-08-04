import { describe, expect, it } from "vitest";

import {
  addMinutesToTime,
  buildMonthGrid,
  clampIso,
  daysInMonth,
  durationBetween,
  formatDuration,
  isLeapYear,
  isoFromParts,
  minutesToTime,
  mondayFirstWeekday,
  parseTypedDate,
  partsFromIso,
  shiftIsoByDays,
  shiftIsoByMonths,
  shiftMonth,
  timeToMinutes,
} from "@/utils/pickerGrid";

describe("isLeapYear / daysInMonth", () => {
  it("follows the Gregorian rule", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("gives February the right length", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2025, 1)).toBe(28);
    expect(daysInMonth(1900, 1)).toBe(28);
    expect(daysInMonth(2000, 1)).toBe(29);
  });

  it("gives the other months their fixed lengths", () => {
    expect(daysInMonth(2026, 0)).toBe(31);
    expect(daysInMonth(2026, 3)).toBe(30);
    expect(daysInMonth(2026, 11)).toBe(31);
  });
});

describe("mondayFirstWeekday", () => {
  it("puts Monday at index 0", () => {
    // 4. avgust 2026. je utorak.
    expect(mondayFirstWeekday(2026, 7, 4)).toBe(1);
    // 1. januar 2026. je četvrtak.
    expect(mondayFirstWeekday(2026, 0, 1)).toBe(3);
    // 1. mart 2026. je nedelja.
    expect(mondayFirstWeekday(2026, 2, 1)).toBe(6);
  });

  it("handles the leap-day boundary", () => {
    // 29. februar 2024. je četvrtak.
    expect(mondayFirstWeekday(2024, 1, 29)).toBe(3);
    // 1. mart 2024. je petak.
    expect(mondayFirstWeekday(2024, 2, 1)).toBe(4);
  });
});

describe("buildMonthGrid", () => {
  it("always returns six weeks", () => {
    for (let month = 0; month < 12; month += 1) {
      expect(buildMonthGrid(2026, month)).toHaveLength(42);
    }
  });

  it("pads the first week with the previous month", () => {
    // Avgust 2026. počinje u subotu -> 5 vodećih dana iz jula.
    const grid = buildMonthGrid(2026, 7);
    expect(grid[0]).toEqual({ iso: "2026-07-27", day: 27, inMonth: false });
    expect(grid[4]).toEqual({ iso: "2026-07-31", day: 31, inMonth: false });
    expect(grid[5]).toEqual({ iso: "2026-08-01", day: 1, inMonth: true });
  });

  it("rolls the year over at both ends", () => {
    const jan = buildMonthGrid(2026, 0);
    expect(jan[0].iso.startsWith("2025-12")).toBe(true);
    const dec = buildMonthGrid(2026, 11);
    expect(dec[41].iso.startsWith("2027-01")).toBe(true);
  });

  it("includes the leap day", () => {
    const feb = buildMonthGrid(2024, 1);
    const inMonth = feb.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[28].iso).toBe("2024-02-29");
  });

  it("stops February 2025 at the 28th", () => {
    const inMonth = buildMonthGrid(2025, 1).filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[27].iso).toBe("2025-02-28");
  });

  it("keeps the cells in ascending date order", () => {
    const grid = buildMonthGrid(2026, 1);
    for (let i = 1; i < grid.length; i += 1) {
      expect(grid[i - 1].iso < grid[i].iso).toBe(true);
    }
  });
});

describe("isoFromParts / partsFromIso", () => {
  it("round-trips", () => {
    expect(isoFromParts(2026, 7, 4)).toBe("2026-08-04");
    expect(partsFromIso("2026-08-04")).toEqual({ year: 2026, month: 7, day: 4 });
  });

  it("rejects impossible dates", () => {
    expect(partsFromIso("2025-02-29")).toBeNull();
    expect(partsFromIso("2026-13-01")).toBeNull();
    expect(partsFromIso("2026-00-10")).toBeNull();
    expect(partsFromIso("04.08.2026")).toBeNull();
    expect(partsFromIso(null)).toBeNull();
    expect(partsFromIso("")).toBeNull();
  });

  it("accepts the leap day", () => {
    expect(partsFromIso("2024-02-29")).toEqual({ year: 2024, month: 1, day: 29 });
  });
});

describe("shiftMonth", () => {
  it("rolls forward and back across years", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 5, 12)).toEqual({ year: 2027, month: 5 });
    expect(shiftMonth(2026, 5, -18)).toEqual({ year: 2024, month: 11 });
  });
});

describe("shiftIsoByMonths", () => {
  it("clamps to the shorter target month", () => {
    expect(shiftIsoByMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftIsoByMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(shiftIsoByMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("keeps the day when it fits", () => {
    expect(shiftIsoByMonths("2026-08-04", 1)).toBe("2026-09-04");
    expect(shiftIsoByMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("returns null for garbage", () => {
    expect(shiftIsoByMonths("nope", 1)).toBeNull();
  });
});

describe("shiftIsoByDays", () => {
  it("crosses month and year boundaries", () => {
    expect(shiftIsoByDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftIsoByDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoByDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses the leap day", () => {
    expect(shiftIsoByDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftIsoByDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(shiftIsoByDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("handles multi-month jumps", () => {
    expect(shiftIsoByDays("2026-08-04", 90)).toBe("2026-11-02");
    expect(shiftIsoByDays("2026-08-04", -220)).toBe("2025-12-27");
  });
});

describe("parseTypedDate", () => {
  it("accepts the dotted Serbian shapes", () => {
    expect(parseTypedDate("15.05.1985")).toBe("1985-05-15");
    expect(parseTypedDate("15.5.1985")).toBe("1985-05-15");
    expect(parseTypedDate("1.1.2000")).toBe("2000-01-01");
    expect(parseTypedDate(" 15.05.1985. ")).toBe("1985-05-15");
  });

  it("accepts slashes, dashes and spaces", () => {
    expect(parseTypedDate("15/05/1985")).toBe("1985-05-15");
    expect(parseTypedDate("15-05-1985")).toBe("1985-05-15");
    expect(parseTypedDate("15 05 1985")).toBe("1985-05-15");
  });

  it("resolves two-digit years inside the window ending at the pivot", () => {
    expect(parseTypedDate("15.05.85", 2026)).toBe("1985-05-15");
    expect(parseTypedDate("15.05.05", 2026)).toBe("2005-05-15");
    expect(parseTypedDate("15.05.99", 2026)).toBe("1999-05-15");
  });

  it("rejects impossible and incomplete input", () => {
    expect(parseTypedDate("31.02.1985")).toBeNull();
    expect(parseTypedDate("29.02.1985")).toBeNull();
    expect(parseTypedDate("29.02.1984")).toBe("1984-02-29");
    expect(parseTypedDate("15.13.1985")).toBeNull();
    expect(parseTypedDate("15.05")).toBeNull();
    expect(parseTypedDate("")).toBeNull();
    expect(parseTypedDate("abc")).toBeNull();
  });
});

describe("clampIso", () => {
  it("keeps the value inside the window", () => {
    expect(clampIso("2026-08-04", "2026-08-10", null)).toBe("2026-08-10");
    expect(clampIso("2026-08-20", null, "2026-08-10")).toBe("2026-08-10");
    expect(clampIso("2026-08-04", "2026-08-01", "2026-08-10")).toBe("2026-08-04");
    expect(clampIso("2026-08-04")).toBe("2026-08-04");
  });
});

describe("timeToMinutes / minutesToTime", () => {
  it("round-trips", () => {
    expect(timeToMinutes("17:00")).toBe(1020);
    expect(timeToMinutes("7:05")).toBe(425);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(minutesToTime(1020)).toBe("17:00");
    expect(minutesToTime(0)).toBe("00:00");
  });

  it("rejects malformed values", () => {
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("12:60")).toBeNull();
    expect(timeToMinutes("noon")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes("")).toBeNull();
  });

  it("wraps out-of-range minutes", () => {
    expect(minutesToTime(1440)).toBe("00:00");
    expect(minutesToTime(1500)).toBe("01:00");
    expect(minutesToTime(-30)).toBe("23:30");
  });
});

describe("addMinutesToTime", () => {
  it("computes the end time from a duration chip", () => {
    expect(addMinutesToTime("17:00", 30)).toBe("17:30");
    expect(addMinutesToTime("17:00", 45)).toBe("17:45");
    expect(addMinutesToTime("17:00", 60)).toBe("18:00");
    expect(addMinutesToTime("17:00", 90)).toBe("18:30");
    expect(addMinutesToTime("17:00", 120)).toBe("19:00");
  });

  it("wraps past midnight", () => {
    expect(addMinutesToTime("23:30", 90)).toBe("01:00");
    expect(addMinutesToTime("23:59", 1)).toBe("00:00");
  });

  it("returns null for a malformed start", () => {
    expect(addMinutesToTime("", 30)).toBeNull();
    expect(addMinutesToTime("25:00", 30)).toBeNull();
  });
});

describe("durationBetween", () => {
  it("measures a same-day span", () => {
    expect(durationBetween("17:00", "18:30")).toBe(90);
    expect(durationBetween("08:00", "08:00")).toBe(0);
  });

  it("treats an earlier end as crossing midnight", () => {
    expect(durationBetween("23:00", "00:30")).toBe(90);
  });

  it("returns null for malformed input", () => {
    expect(durationBetween("17:00", "oops")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("labels the presets", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30");
    expect(formatDuration(120)).toBe("2h");
  });
});
