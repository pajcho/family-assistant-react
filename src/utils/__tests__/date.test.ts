import { describe, expect, it } from "vitest";
import {
  addMonth,
  addMonthAnchored,
  getDueDateInMonth,
  getLimitedMonths,
  getWeeklyOccurrencesInMonth,
  isMonthlyOccurrenceMonth,
  monthBounds,
  subtractMonthAnchored,
} from "../date";

/**
 * Characterization tests for the four recurrence helpers in `date.ts` that
 * drive the Payments page. They pin CURRENT behavior - defects included - so a
 * later fix has to change an assertion here rather than silently change numbers
 * on screen. Cases known to be wrong are marked DIVERGENCE and are scheduled to
 * be resolved by plan 010.
 *
 * Unrelated `date.ts` basics (addMonth, subtractMonth, isOverdue, dueDayLabel)
 * already live in `utils.test.ts`; this file is the home for the recurrence
 * four only.
 */

/* ------------------------------------------------------------------------- */
/* getDueDateInMonth - re-derives from the ORIGINAL due date, so no drift     */
/* ------------------------------------------------------------------------- */

describe("getDueDateInMonth", () => {
  it("keeps the original day when the target month is long enough", () => {
    // The whole point of this helper: March gets the 31st back, even though
    // February had to clamp. Contrast with expandPaymentOccurrences, which
    // chains and loses the day forever (see recurrenceParity.test.ts).
    expect(getDueDateInMonth("2026-03", "2026-01-31")).toBe("2026-03-31");
  });

  it("clamps to the last day of a short month", () => {
    expect(getDueDateInMonth("2026-02", "2026-01-31")).toBe("2026-02-28");
    expect(getDueDateInMonth("2026-04", "2026-01-31")).toBe("2026-04-30");
  });

  it("clamps to Feb 29 in a leap year", () => {
    expect(getDueDateInMonth("2028-02", "2026-01-31")).toBe("2028-02-29");
  });

  it("passes a mid-month day through unchanged", () => {
    expect(getDueDateInMonth("2026-05", "2026-01-15")).toBe("2026-05-15");
    expect(getDueDateInMonth("2026-01", "2026-01-15")).toBe("2026-01-15");
  });

  it("has no series-start floor - a month BEFORE the due date still yields a date", () => {
    // Pure calendar math, no notion of when the series begins. Callers are
    // expected to gate on isMonthlyOccurrenceMonth / getLimitedMonths first.
    expect(getDueDateInMonth("2025-12", "2026-01-15")).toBe("2025-12-15");
  });
});

/* ------------------------------------------------------------------------- */
/* addMonthAnchored / subtractMonthAnchored - the anchored step (plan 010)    */
/* ------------------------------------------------------------------------- */

describe("addMonthAnchored", () => {
  it("clamps to the short month, then recovers the anchor day", () => {
    // The whole fix in two assertions: February still clamps (there is no 31st),
    // but the step OUT of February derives the day from the anchor, not from
    // the clamped 28th. Plain addMonth is stuck on the 28th forever.
    expect(addMonthAnchored("2026-01-31", 31)).toBe("2026-02-28");
    expect(addMonthAnchored("2026-02-28", 31)).toBe("2026-03-31");
    expect(addMonth("2026-02-28")).toBe("2026-03-28");
  });

  it("keeps a 31st series on the last day of every short month it passes", () => {
    const walk: string[] = [];
    let cur = "2026-01-31";
    for (let i = 0; i < 5; i++) {
      cur = addMonthAnchored(cur, 31);
      walk.push(cur);
    }
    expect(walk).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("clamps to Feb 29 in a leap year", () => {
    expect(addMonthAnchored("2028-01-31", 31)).toBe("2028-02-29");
  });

  it("honors a multi-month step (quarterly)", () => {
    expect(addMonthAnchored("2026-01-31", 31, 3)).toBe("2026-04-30");
    expect(addMonthAnchored("2026-04-30", 31, 3)).toBe("2026-07-31");
  });

  it("passes a mid-month day through unchanged", () => {
    expect(addMonthAnchored("2026-01-15", 15)).toBe("2026-02-15");
  });

  it("falls back to the day of the date when the anchor is missing or out of range", () => {
    // Rows without an anchor behave exactly like today's addMonth.
    for (const bad of [null, undefined, 0, 32, 3.5, Number.NaN]) {
      expect(addMonthAnchored("2026-01-31", bad)).toBe(addMonth("2026-01-31"));
      expect(addMonthAnchored("2026-02-28", bad)).toBe(addMonth("2026-02-28"));
    }
  });
});

describe("subtractMonthAnchored", () => {
  it("undoes an anchored step, restoring the anchor day", () => {
    // subtractMonth cannot: "2026-02-28" - 1m is "2026-01-28", losing the 31st.
    expect(subtractMonthAnchored("2026-03-31", 31)).toBe("2026-02-28");
    expect(subtractMonthAnchored("2026-02-28", 31)).toBe("2026-01-31");
  });

  it("is the inverse of addMonthAnchored across a short month", () => {
    const forward = addMonthAnchored("2026-02-28", 31);
    expect(subtractMonthAnchored(forward, 31)).toBe("2026-02-28");
  });

  it("honors a multi-month step", () => {
    expect(subtractMonthAnchored("2026-07-31", 31, 3)).toBe("2026-04-30");
  });
});

/* ------------------------------------------------------------------------- */
/* monthBounds                                                                */
/* ------------------------------------------------------------------------- */

describe("monthBounds", () => {
  it("returns the first and last day of the month", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2026-03")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

/* ------------------------------------------------------------------------- */
/* getLimitedMonths                                                           */
/* ------------------------------------------------------------------------- */

describe("getLimitedMonths", () => {
  it("lists `remaining` consecutive months starting at the due-date month", () => {
    expect(getLimitedMonths("2026-01-31", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("does not drop or duplicate a month even though it chains addMonth", () => {
    // getLimitedMonths steps with addMonth on its own output, so the DAY drifts
    // (31 -> 28 -> 28 ...). Only the YYYY-MM prefix is kept, and once the day
    // has clamped to 28 it can never overflow a month again, so the month LIST
    // itself stays correct across a long chain and a year boundary.
    expect(getLimitedMonths("2026-01-31", 14)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("returns an empty list for 0 remaining and a single month for 1", () => {
    expect(getLimitedMonths("2026-01-31", 0)).toEqual([]);
    expect(getLimitedMonths("2026-01-31", 1)).toEqual(["2026-01"]);
  });

  it("crosses a year boundary", () => {
    expect(getLimitedMonths("2025-11-15", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

/* ------------------------------------------------------------------------- */
/* isMonthlyOccurrenceMonth                                                   */
/* ------------------------------------------------------------------------- */

describe("isMonthlyOccurrenceMonth", () => {
  it("interval 1 fires in the due month and every month after, never before", () => {
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-04", 1)).toBe(true);
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-05", 1)).toBe(true);
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-03", 1)).toBe(false);
  });

  it("interval 3 (quarterly) fires only every third month", () => {
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-04", 3)).toBe(true);
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-05", 3)).toBe(false);
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-06", 3)).toBe(false);
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-07", 3)).toBe(true);
  });

  it("counts the month gap across a year boundary", () => {
    // Apr 2026 -> Jan 2027 is 9 months, and 9 % 3 === 0.
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2027-01", 3)).toBe(true);
  });

  it("treats interval 0 and negative intervals as 1 (the Math.max guard)", () => {
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-05", 0)).toBe(true);
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-05", -3)).toBe(true);
    // The pre-due-date guard still wins over the coerced interval.
    expect(isMonthlyOccurrenceMonth("2026-04-10", "2026-03", 0)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* getWeeklyOccurrencesInMonth                                                */
/* ------------------------------------------------------------------------- */

describe("getWeeklyOccurrencesInMonth", () => {
  it("lists every weekly occurrence inside the due month", () => {
    expect(getWeeklyOccurrencesInMonth("2026-08-05", "2026-08", 1)).toEqual([
      "2026-08-05",
      "2026-08-12",
      "2026-08-19",
      "2026-08-26",
    ]);
  });

  it("honors an interval of 2 (every other week)", () => {
    expect(getWeeklyOccurrencesInMonth("2026-08-05", "2026-08", 2)).toEqual([
      "2026-08-05",
      "2026-08-19",
    ]);
  });

  it("carries the cadence forward into a later month", () => {
    expect(getWeeklyOccurrencesInMonth("2026-08-05", "2026-09", 1)).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
      "2026-09-23",
      "2026-09-30",
    ]);
  });

  it("DIVERGENCE: rewinds past the series start and invents a pre-series occurrence", () => {
    // Due date is 2026-08-05, so in July 2026 this payment does not exist yet.
    // The rewind loop has no floor at the series start, so it walks backwards
    // one week and reports 2026-07-29 - a date BEFORE the first instalment.
    // expandPaymentOccurrences walks forward only and returns [] for July.
    // Pinned by plan 009; to be resolved in plan 010.
    expect(getWeeklyOccurrencesInMonth("2026-08-05", "2026-07", 1)).toEqual(["2026-07-29"]);
    // It keeps rewinding for months further back, too - one occurrence each.
    expect(getWeeklyOccurrencesInMonth("2026-08-05", "2026-06", 1)).toEqual(["2026-06-24"]);
  });

  it("returns an empty list for a month the cadence skips entirely", () => {
    // A 5-week cadence (35 days) from Jan 31 lands on Mar 7 next, so February
    // has no occurrence at all.
    expect(getWeeklyOccurrencesInMonth("2026-01-31", "2026-02", 5)).toEqual([]);
  });

  it("treats interval 0 as weekly (the Math.max guard keeps the loop bounded)", () => {
    expect(getWeeklyOccurrencesInMonth("2026-08-05", "2026-08", 0)).toEqual([
      "2026-08-05",
      "2026-08-12",
      "2026-08-19",
      "2026-08-26",
    ]);
  });
});
