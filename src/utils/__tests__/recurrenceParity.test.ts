import { describe, expect, it } from "vitest";
import type { Payment, PaymentOverride } from "@/types/database";
import { monthRange } from "../budget";
import {
  getDueDateInMonth,
  getLimitedMonths,
  getWeeklyOccurrencesInMonth,
  isMonthlyOccurrenceMonth,
} from "../date";
import { expandPaymentOccurrences, overrideKey } from "../payment";

/**
 * The app computes payment occurrence dates TWICE, with two independent
 * implementations, and they do not always agree:
 *
 *   Engine A - `expandPaymentOccurrences` (utils/payment.ts). Used by useAgenda,
 *              useBusyDays and the budget projection. Walks forward from
 *              `due_date`, chaining `addMonth` on its own already-clamped
 *              output.
 *   Engine B - the four `date.ts` helpers as wired up by PaymentsPage. Re-derives
 *              each month's date from the ORIGINAL `due_date`.
 *
 * This file runs both engines over the same fixtures and records the result -
 * agreements as a regression guard, disagreements as explicit
 * `not.toEqual` assertions. These are characterization tests: they assert what
 * the code does TODAY, defects and all. Plan 010 unifies the two engines and
 * will have to rewrite the disagreement assertions - that diff is the record of
 * which on-screen numbers changed.
 */

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    family_id: "fam",
    name: "Kirija",
    description: null,
    amount: 1000,
    currency: "RSD",
    original_amount: null,
    exchange_rate: null,
    due_date: "2026-01-15",
    is_recurring: true,
    recurrence_period: "monthly",
    recurrence_interval: 1,
    remaining_occurrences: null,
    is_paid: false,
    is_paused: false,
    is_variable_amount: false,
    paid_date: null,
    remind_days_before: null,
    activity_id: null,
    event_id: null,
    birthday_id: null,
    category_id: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const NO_OVERRIDES = new Map<string, PaymentOverride>();

/* ------------------------------------------------------------------------- */
/* The two engines, both reduced to "which dates in month M"                  */
/* ------------------------------------------------------------------------- */

/** Engine A: the shared occurrence walker, restricted to one month. */
function engineA(p: Payment, month: string): string[] {
  const { from, to } = monthRange(month);
  return expandPaymentOccurrences(p, from, to, NO_OVERRIDES).map((o) => o.occurrenceDate);
}

/**
 * Engine B: a COPY of the occurrence-date branch in
 * `components/payments/PaymentsPage.tsx` (the `weekly` / `monthly` / `limited`
 * arms of its synthetic-upcoming-row loop). Copied rather than imported because
 * importing the component would drag Supabase into a pure unit test.
 *
 * Deliberately mirrors only the DATE computation. The page additionally
 * suppresses rows it has already drawn elsewhere (`hasRealRow`,
 * `occurrenceDate === payment.due_date`, and dates already present in payment
 * history); those guards hide rows, they do not change which dates the helpers
 * produce, which is what this file compares.
 *
 * Delete this mirror when plan 010 unifies the engines.
 */
function engineB(p: Payment, month: string): string[] {
  const interval = Math.max(1, p.recurrence_interval ?? 1);

  if (p.recurrence_period === "weekly") {
    return getWeeklyOccurrencesInMonth(p.due_date, month, interval);
  }

  if (p.recurrence_period === "monthly") {
    return isMonthlyOccurrenceMonth(p.due_date, month, interval)
      ? [getDueDateInMonth(month, p.due_date)]
      : [];
  }

  if (p.recurrence_period === "limited") {
    const months = getLimitedMonths(p.due_date, Math.max(0, p.remaining_occurrences ?? 0));
    return months.includes(month) ? [getDueDateInMonth(month, p.due_date)] : [];
  }

  return [];
}

/* ------------------------------------------------------------------------- */
/* Fixture 1 - the common case, both engines agree                            */
/* ------------------------------------------------------------------------- */

describe("parity: monthly payment on a mid-month day", () => {
  const p = payment({ due_date: "2026-01-15" });

  it("both engines report the 15th in March", () => {
    expect(engineA(p, "2026-03")).toEqual(["2026-03-15"]);
    expect(engineB(p, "2026-03")).toEqual(["2026-03-15"]);
    // Regression guard: whatever plan 010 does, this case must keep agreeing.
    expect(engineA(p, "2026-03")).toEqual(engineB(p, "2026-03"));
  });
});

/* ------------------------------------------------------------------------- */
/* Fixture 2 - month-end drift, the engines DISAGREE                          */
/* ------------------------------------------------------------------------- */

describe("parity: monthly payment due on the 31st", () => {
  const p = payment({ due_date: "2026-01-31" });

  it("engine A permanently loses the 31st once February clamps it", () => {
    // addMonth is chained on its own clamped output: 01-31 -> 02-28 -> 03-28 ->
    // 04-28 ... The day never recovers.
    const walk = expandPaymentOccurrences(p, "2026-01-01", "2026-06-30", NO_OVERRIDES);
    expect(walk.map((o) => o.occurrenceDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-28",
      "2026-04-28",
      "2026-05-28",
      "2026-06-28",
    ]);
  });

  it("engine B re-derives from the original due date, so March is the 31st", () => {
    expect(engineB(p, "2026-03")).toEqual(["2026-03-31"]);
  });

  it("DIVERGENCE: the two engines name different days for the same instalment", () => {
    // The agenda / budget say 2026-03-28, the Payments page says 2026-03-31.
    // Same instalment, two dates. Resolved by plan 010.
    expect(engineA(p, "2026-03")).toEqual(["2026-03-28"]);
    expect(engineB(p, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineA(p, "2026-03")).not.toEqual(engineB(p, "2026-03"));
  });

  it("they still agree in February, where both clamp to the 28th", () => {
    // The drift only becomes visible in the month AFTER the first clamp.
    expect(engineA(p, "2026-02")).toEqual(["2026-02-28"]);
    expect(engineB(p, "2026-02")).toEqual(["2026-02-28"]);
  });
});

/* ------------------------------------------------------------------------- */
/* Fixture 3 - quarterly, engines agree                                       */
/* ------------------------------------------------------------------------- */

describe("parity: quarterly payment (monthly, interval 3)", () => {
  const p = payment({ due_date: "2026-04-10", recurrence_interval: 3 });

  it("both engines report July, three months after April", () => {
    expect(engineA(p, "2026-07")).toEqual(["2026-07-10"]);
    expect(engineB(p, "2026-07")).toEqual(["2026-07-10"]);
    expect(engineA(p, "2026-07")).toEqual(engineB(p, "2026-07"));
  });

  it("both engines report nothing in an off month", () => {
    expect(engineA(p, "2026-05")).toEqual([]);
    expect(engineB(p, "2026-05")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Fixture 4 - weekly before the series starts, the engines DISAGREE          */
/* ------------------------------------------------------------------------- */

describe("parity: weekly payment, month before the series starts", () => {
  const p = payment({ due_date: "2026-08-05", recurrence_period: "weekly" });

  it("DIVERGENCE: engine B invents a pre-series occurrence, engine A emits none", () => {
    // The payment's first instalment is 2026-08-05, so July has none. Engine B
    // rewinds a week past the series start and reports 2026-07-29 anyway.
    // Resolved by plan 010.
    expect(engineA(p, "2026-07")).toEqual([]);
    expect(engineB(p, "2026-07")).toEqual(["2026-07-29"]);
    expect(engineA(p, "2026-07")).not.toEqual(engineB(p, "2026-07"));
  });

  it("they agree inside the due month", () => {
    const expected = ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"];
    expect(engineA(p, "2026-08")).toEqual(expected);
    expect(engineB(p, "2026-08")).toEqual(expected);
  });
});

/* ------------------------------------------------------------------------- */
/* Fixture 5 - limited instalments on the 31st, same drift as fixture 2       */
/* ------------------------------------------------------------------------- */

describe("parity: limited payment, 3 instalments from the 31st", () => {
  const p = payment({
    due_date: "2026-01-31",
    recurrence_period: "limited",
    remaining_occurrences: 3,
  });

  it("DIVERGENCE: the third instalment lands on a different day in each engine", () => {
    expect(engineA(p, "2026-03")).toEqual(["2026-03-28"]);
    expect(engineB(p, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineA(p, "2026-03")).not.toEqual(engineB(p, "2026-03"));
  });

  it("they agree on the second instalment, and both stop after the third", () => {
    expect(engineA(p, "2026-02")).toEqual(["2026-02-28"]);
    expect(engineB(p, "2026-02")).toEqual(["2026-02-28"]);
    expect(engineA(p, "2026-04")).toEqual([]);
    expect(engineB(p, "2026-04")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* The user-visible consequence: a cancel saved on one engine's date is       */
/* invisible to the other                                                     */
/* ------------------------------------------------------------------------- */

describe("override lookup across the divergence", () => {
  const p = payment({ due_date: "2026-01-31" });

  function cancelAt(occurrenceDate: string): Map<string, PaymentOverride> {
    const map = new Map<string, PaymentOverride>();
    map.set(overrideKey(p.id, occurrenceDate), {
      id: "ov1",
      payment_id: p.id,
      family_id: "fam",
      occurrence_date: occurrenceDate,
      action: "cancel",
      override_date: null,
      reason: null,
      created_at: "",
      updated_at: "",
    });
    return map;
  }

  it("DIVERGENCE: a cancel saved from the Payments page is missed by engine A", () => {
    // Canceling the March instalment on the Payments page writes
    // occurrence_date = 2026-03-31 (engine B's date). Engine A looks the
    // override up under 2026-03-28 and finds nothing, so the agenda, the
    // "busy days" markers and the budget projection all still show the
    // instalment as live and unpaid. This is the money-visible bug.
    const occ = expandPaymentOccurrences(p, "2026-03-01", "2026-03-31", cancelAt("2026-03-31"));
    expect(occ).toEqual([{ occurrenceDate: "2026-03-28", effectiveDate: "2026-03-28" }]);
  });

  it("the same cancel keyed on engine A's own date does drop the occurrence", () => {
    // Proof that the miss above is purely the date mismatch, not a broken
    // override lookup.
    const occ = expandPaymentOccurrences(p, "2026-03-01", "2026-03-31", cancelAt("2026-03-28"));
    expect(occ).toEqual([]);
  });
});
