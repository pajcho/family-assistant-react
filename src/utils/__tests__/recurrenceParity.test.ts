import { describe, expect, it } from "vitest";
import type { Payment, PaymentOverride } from "@/types/database";
import { monthRange } from "../budget";
import { expandPaymentOccurrences, overrideKey, paymentOccurrencesInMonth } from "../payment";

/**
 * The app used to compute payment occurrence dates TWICE, with two independent
 * implementations that did not always agree:
 *
 *   Engine A - `expandPaymentOccurrences` (utils/payment.ts). Used by useAgenda,
 *              useBusyDays and the budget projection. Walked forward from
 *              `due_date`, chaining `addMonth` on its own already-clamped
 *              output, so a 31st became a 28th forever.
 *   Engine B - the four `date.ts` helpers as wired up by PaymentsPage, which
 *              re-derived each month's date from the ORIGINAL `due_date` - and
 *              could rewind past the start of the series.
 *
 * Plan 010 made both call paths one anchored walk: engine B is now
 * `paymentOccurrencesInMonth`, the month-shaped face of the very same
 * `walkOccurrenceDates` engine A uses. This file keeps running both call paths
 * over the same fixtures, but every fixture now asserts AGREEMENT - it is the
 * regression guard against the two surfaces drifting apart again.
 *
 * The assertions that flipped (and why) are recorded per fixture below.
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
 * Engine B: the month view the Payments page draws. Plan 009 had to keep a COPY
 * of the page's date branch here (importing the component drags Supabase into a
 * pure unit test); plan 010 replaced that branch with `paymentOccurrencesInMonth`,
 * so the mirror is gone and this calls the real thing.
 *
 * The page additionally suppresses rows it has already drawn elsewhere
 * (`hasRealRow`, `occurrenceDate === payment.due_date`, dates already in payment
 * history) - those guards hide rows, they do not change which dates the engine
 * produces, which is what this file compares.
 */
function engineB(p: Payment, month: string): string[] {
  return paymentOccurrencesInMonth(p, month, NO_OVERRIDES).map((o) => o.occurrenceDate);
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
/* Fixture 2 - month-end, the case the anchor exists for                      */
/* ------------------------------------------------------------------------- */

describe("parity: monthly payment due on the 31st", () => {
  const p = payment({ due_date: "2026-01-31" });

  it("engine A clamps only where it must, and gets the day back after", () => {
    // WAS (plan 009): 01-31, 02-28, 03-28, 04-28, 05-28, 06-28 - the day was
    // inherited from the clamped February result and never recovered. Now every
    // step re-derives from the anchor, so only the short months are clamped.
    const walk = expandPaymentOccurrences(p, "2026-01-01", "2026-06-30", NO_OVERRIDES);
    expect(walk.map((o) => o.occurrenceDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("engine B reports the same 31st it always did", () => {
    expect(engineB(p, "2026-03")).toEqual(["2026-03-31"]);
  });

  it("the two engines now name the same day for the same instalment", () => {
    // WAS a DIVERGENCE assertion: engine A said 2026-03-28, engine B 2026-03-31.
    // The agenda / budget / busy-days and the Payments page agree on 03-31.
    expect(engineA(p, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineB(p, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineA(p, "2026-03")).toEqual(engineB(p, "2026-03"));
  });

  it("they still agree in February, where both clamp to the 28th", () => {
    // Unchanged by plan 010: February has no 31st, so the anchored walk clamps
    // exactly like the old one.
    expect(engineA(p, "2026-02")).toEqual(["2026-02-28"]);
    expect(engineB(p, "2026-02")).toEqual(["2026-02-28"]);
  });

  it("uses the stored anchor when due_date has ALREADY advanced onto a clamped day", () => {
    // The DB half of the fix: mark-paid has moved the live row to 2026-02-28,
    // but the series is anchored on the 31st, so March is the 31st - not the
    // 28th the bare due_date would suggest.
    const advanced = payment({ due_date: "2026-02-28", due_anchor_day: 31 });
    expect(engineA(advanced, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineB(advanced, "2026-03")).toEqual(["2026-03-31"]);
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
/* Fixture 4 - weekly before the series starts: no such occurrence            */
/* ------------------------------------------------------------------------- */

describe("parity: weekly payment, month before the series starts", () => {
  const p = payment({ due_date: "2026-08-05", recurrence_period: "weekly" });

  it("neither engine invents an occurrence before the first instalment", () => {
    // WAS a DIVERGENCE assertion: engine B rewound a week past the series start
    // and reported 2026-07-29 for a payment whose first instalment is
    // 2026-08-05. The shared walk only ever moves FORWARD from due_date, so
    // July is empty - the correct answer, and what engine A already said.
    expect(engineA(p, "2026-07")).toEqual([]);
    expect(engineB(p, "2026-07")).toEqual([]);
    expect(engineA(p, "2026-07")).toEqual(engineB(p, "2026-07"));
    // Months further back are empty too - the old rewind produced one there as well.
    expect(engineB(p, "2026-06")).toEqual([]);
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

  it("the third instalment lands on the same day in both engines", () => {
    // WAS a DIVERGENCE assertion: engine A said 2026-03-28 (drift), engine B
    // 2026-03-31. Limited series step through the same anchored walk now.
    expect(engineA(p, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineB(p, "2026-03")).toEqual(["2026-03-31"]);
    expect(engineA(p, "2026-03")).toEqual(engineB(p, "2026-03"));
  });

  it("they agree on the second instalment, and both stop after the third", () => {
    // Unchanged by plan 010: anchoring moves days, never the instalment count.
    expect(engineA(p, "2026-02")).toEqual(["2026-02-28"]);
    expect(engineB(p, "2026-02")).toEqual(["2026-02-28"]);
    expect(engineA(p, "2026-04")).toEqual([]);
    expect(engineB(p, "2026-04")).toEqual([]);
  });

  it("still emits exactly `remaining_occurrences` instalments across the series", () => {
    const walk = expandPaymentOccurrences(p, "2026-01-01", "2027-12-31", NO_OVERRIDES);
    expect(walk.map((o) => o.occurrenceDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
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

  it("a cancel saved from the Payments page is now honored by engine A", () => {
    // WAS the money-visible bug: canceling the March instalment on the Payments
    // page writes occurrence_date = 2026-03-31, engine A looked it up under
    // 2026-03-28, found nothing, and the agenda / busy-days markers / budget
    // projection kept the instalment live and unpaid. Both engines key on
    // 2026-03-31 now, so the cancel lands.
    const occ = expandPaymentOccurrences(p, "2026-03-01", "2026-03-31", cancelAt("2026-03-31"));
    expect(occ).toEqual([]);
    // ... and the page's own month view drops it too, once its filter runs.
    expect(paymentOccurrencesInMonth(p, "2026-03", cancelAt("2026-03-31"))).toEqual([
      { occurrenceDate: "2026-03-31", effectiveDate: "2026-03-31" },
    ]);
  });

  it("an override left on the OLD drifted date no longer matches anything", () => {
    // The other side of the same coin, and the honest cost of the fix: a cancel
    // that an older build saved under engine A's drifted 2026-03-28 keys on a
    // date that is not an occurrence any more, so it is inert. Plan 010 does
    // NOT migrate existing payment_overrides rows - that is a separate decision
    // with production data in front of whoever makes it.
    const occ = expandPaymentOccurrences(p, "2026-03-01", "2026-03-31", cancelAt("2026-03-28"));
    expect(occ).toEqual([{ occurrenceDate: "2026-03-31", effectiveDate: "2026-03-31" }]);
  });
});
