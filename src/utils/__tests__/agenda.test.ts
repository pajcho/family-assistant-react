import { describe, expect, it } from "vitest";
import type {
  Activity,
  ActivityOverride,
  ActivityParticipant,
  ActivitySchedule,
  Birthday,
  Payment,
  PaymentOverride,
  SchoolShiftAnchor,
} from "@/types/database";
import { resolveBlocksInRange } from "../activity";
import { expandBirthdayOccurrences } from "../birthday";
import {
  expandPaymentOccurrences,
  isPaymentOverdue,
  isUpcomingPaymentOccurrence,
  overrideKey,
} from "../payment";

/* ------------------------------------------------------------------------- */
/* expandPaymentOccurrences                                                  */
/* ------------------------------------------------------------------------- */

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    family_id: "fam",
    name: "Kirija",
    description: null,
    amount: 1000,
    due_date: "2026-06-10",
    is_recurring: true,
    recurrence_period: "monthly",
    recurrence_interval: 1,
    remaining_occurrences: null,
    is_paid: false,
    is_paused: false,
    paid_date: null,
    remind_days_before: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function paymentOverride(over: Partial<PaymentOverride> = {}): PaymentOverride {
  return {
    id: "ov1",
    payment_id: "pay1",
    family_id: "fam",
    occurrence_date: "2026-06-10",
    action: "cancel",
    override_date: null,
    reason: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function overrideMap(...overrides: PaymentOverride[]): Map<string, PaymentOverride> {
  const map = new Map<string, PaymentOverride>();
  for (const o of overrides) map.set(overrideKey(o.payment_id, o.occurrence_date), o);
  return map;
}

const NO_OVERRIDES = new Map<string, PaymentOverride>();

describe("expandPaymentOccurrences", () => {
  it("walks a monthly series across the window", () => {
    const occ = expandPaymentOccurrences(payment(), "2026-06-01", "2026-08-31", NO_OVERRIDES);
    expect(occ.map((o) => o.effectiveDate)).toEqual(["2026-06-10", "2026-07-10", "2026-08-10"]);
  });

  it("honors the monthly interval (quarterly)", () => {
    const occ = expandPaymentOccurrences(
      payment({ recurrence_interval: 3 }),
      "2026-06-01",
      "2026-12-31",
      NO_OVERRIDES,
    );
    expect(occ.map((o) => o.effectiveDate)).toEqual(["2026-06-10", "2026-09-10", "2026-12-10"]);
  });

  it("walks a weekly series with an interval", () => {
    const occ = expandPaymentOccurrences(
      payment({ recurrence_period: "weekly", recurrence_interval: 2 }),
      "2026-06-10",
      "2026-07-10",
      NO_OVERRIDES,
    );
    expect(occ.map((o) => o.effectiveDate)).toEqual(["2026-06-10", "2026-06-24", "2026-07-08"]);
  });

  it("emits a one-time payment once, only when it falls in range", () => {
    expect(
      expandPaymentOccurrences(
        payment({ recurrence_period: "one-time" }),
        "2026-06-01",
        "2026-06-30",
        NO_OVERRIDES,
      ),
    ).toHaveLength(1);
    expect(
      expandPaymentOccurrences(
        payment({ recurrence_period: "one-time" }),
        "2026-07-01",
        "2026-07-31",
        NO_OVERRIDES,
      ),
    ).toHaveLength(0);
  });

  it("caps a limited series at remaining_occurrences regardless of window", () => {
    const occ = expandPaymentOccurrences(
      payment({ recurrence_period: "limited", remaining_occurrences: 3 }),
      "2026-06-01",
      "2027-12-31",
      NO_OVERRIDES,
    );
    expect(occ.map((o) => o.effectiveDate)).toEqual(["2026-06-10", "2026-07-10", "2026-08-10"]);
  });

  it("drops a canceled occurrence", () => {
    const occ = expandPaymentOccurrences(
      payment(),
      "2026-06-01",
      "2026-08-31",
      overrideMap(paymentOverride({ occurrence_date: "2026-07-10", action: "cancel" })),
    );
    expect(occ.map((o) => o.effectiveDate)).toEqual(["2026-06-10", "2026-08-10"]);
  });

  it("buckets a rescheduled occurrence by its new effective date", () => {
    const occ = expandPaymentOccurrences(
      payment(),
      "2026-06-01",
      "2026-06-30",
      overrideMap(
        paymentOverride({
          occurrence_date: "2026-06-10",
          action: "reschedule",
          override_date: "2026-06-15",
        }),
      ),
    );
    expect(occ).toEqual([{ occurrenceDate: "2026-06-10", effectiveDate: "2026-06-15" }]);
  });

  it("surfaces a past live occurrence that was rescheduled into the window (Danas)", () => {
    // due_date is yesterday, moved onto today — from === to === today.
    const occ = expandPaymentOccurrences(
      payment({ due_date: "2026-06-09" }),
      "2026-06-10",
      "2026-06-10",
      overrideMap(
        paymentOverride({
          occurrence_date: "2026-06-09",
          action: "reschedule",
          override_date: "2026-06-10",
        }),
      ),
    );
    expect(occ).toEqual([{ occurrenceDate: "2026-06-09", effectiveDate: "2026-06-10" }]);
  });

  it("walks an overdue due_date forward, emitting only in-window occurrences", () => {
    const occ = expandPaymentOccurrences(
      payment({ due_date: "2026-01-10" }),
      "2026-06-01",
      "2026-07-31",
      NO_OVERRIDES,
    );
    expect(occ.map((o) => o.effectiveDate)).toEqual(["2026-06-10", "2026-07-10"]);
  });

  it("returns nothing when the series starts after the window", () => {
    expect(
      expandPaymentOccurrences(
        payment({ due_date: "2026-09-10" }),
        "2026-06-01",
        "2026-08-31",
        NO_OVERRIDES,
      ),
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- */
/* isUpcomingPaymentOccurrence                                               */
/* ------------------------------------------------------------------------- */

describe("isUpcomingPaymentOccurrence", () => {
  it("treats the live occurrence (keyed on due_date) as editable, even when due in the future", () => {
    // The next/first instalment — e.g. due tomorrow — IS the live row, so it
    // must stay actionable, not be locked as "Nadolazeće".
    expect(
      isUpcomingPaymentOccurrence({
        occurrenceDate: "2026-06-10",
        payment: payment({ due_date: "2026-06-10" }),
      }),
    ).toBe(false);
  });

  it("treats a later repetition as upcoming (read-only)", () => {
    expect(
      isUpcomingPaymentOccurrence({
        occurrenceDate: "2026-07-10",
        payment: payment({ due_date: "2026-06-10" }),
      }),
    ).toBe(true);
  });

  it("keeps an overdue live occurrence editable (anchor in the past, not a repetition)", () => {
    expect(
      isUpcomingPaymentOccurrence({
        occurrenceDate: "2026-01-10",
        payment: payment({ due_date: "2026-01-10" }),
      }),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* isPaymentOverdue                                                          */
/* ------------------------------------------------------------------------- */

const TODAY = "2026-06-15";

describe("isPaymentOverdue", () => {
  it("is overdue when the live due_date is before today", () => {
    expect(isPaymentOverdue(payment({ due_date: "2026-06-10" }), NO_OVERRIDES, TODAY)).toBe(true);
  });

  it("is not overdue when due today or later", () => {
    expect(isPaymentOverdue(payment({ due_date: "2026-06-15" }), NO_OVERRIDES, TODAY)).toBe(false);
    expect(isPaymentOverdue(payment({ due_date: "2026-06-20" }), NO_OVERRIDES, TODAY)).toBe(false);
  });

  it("ignores paid and paused payments", () => {
    expect(
      isPaymentOverdue(payment({ due_date: "2026-06-10", is_paid: true }), NO_OVERRIDES, TODAY),
    ).toBe(false);
    expect(
      isPaymentOverdue(payment({ due_date: "2026-06-10", is_paused: true }), NO_OVERRIDES, TODAY),
    ).toBe(false);
  });

  it("follows a reschedule: moved into the future is no longer overdue", () => {
    const overrides = overrideMap(
      paymentOverride({
        occurrence_date: "2026-06-10",
        action: "reschedule",
        override_date: "2026-06-20",
      }),
    );
    expect(isPaymentOverdue(payment({ due_date: "2026-06-10" }), overrides, TODAY)).toBe(false);
  });

  it("follows a reschedule: still-past effective date stays overdue", () => {
    const overrides = overrideMap(
      paymentOverride({
        occurrence_date: "2026-06-10",
        action: "reschedule",
        override_date: "2026-06-12",
      }),
    );
    expect(isPaymentOverdue(payment({ due_date: "2026-06-10" }), overrides, TODAY)).toBe(true);
  });

  it("is not overdue when the live occurrence is canceled", () => {
    const overrides = overrideMap(
      paymentOverride({ occurrence_date: "2026-06-10", action: "cancel" }),
    );
    expect(isPaymentOverdue(payment({ due_date: "2026-06-10" }), overrides, TODAY)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* expandBirthdayOccurrences                                                 */
/* ------------------------------------------------------------------------- */

function birthday(birth_date: string): Pick<Birthday, "birth_date"> {
  return { birth_date };
}

describe("expandBirthdayOccurrences", () => {
  it("projects a birthday into the requested year", () => {
    expect(expandBirthdayOccurrences(birthday("1990-03-15"), "2026-01-01", "2026-12-31")).toEqual([
      { date: "2026-03-15" },
    ]);
  });

  it("clamps Feb-29 to Feb-28 in a non-leap year", () => {
    expect(expandBirthdayOccurrences(birthday("2000-02-29"), "2027-01-01", "2027-12-31")).toEqual([
      { date: "2027-02-28" },
    ]);
  });

  it("keeps Feb-29 in a leap year", () => {
    expect(expandBirthdayOccurrences(birthday("2000-02-29"), "2028-01-01", "2028-12-31")).toEqual([
      { date: "2028-02-29" },
    ]);
  });

  it("projects across a multi-year span", () => {
    expect(expandBirthdayOccurrences(birthday("1990-07-04"), "2026-01-01", "2027-12-31")).toEqual([
      { date: "2026-07-04" },
      { date: "2027-07-04" },
    ]);
  });

  it("returns nothing when the birthday falls outside the window", () => {
    expect(
      expandBirthdayOccurrences(birthday("1990-03-15"), "2026-04-01", "2026-12-31"),
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- */
/* resolveBlocksInRange                                                      */
/* ------------------------------------------------------------------------- */

// 2026-06-01 and 2026-06-08 are Mondays; 2026-06-10 is the Wednesday after.
const MON_1 = "2026-06-01";
const MON_2 = "2026-06-08";
const WED_2 = "2026-06-10";

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    family_id: "fam",
    name: "Engleski",
    description: null,
    active_from: null,
    active_to: null,
    is_paused: false,
    remind_minutes_before: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function schedule(over: Partial<ActivitySchedule> = {}): ActivitySchedule {
  return {
    id: "s1",
    activity_id: "a1",
    family_id: "fam",
    day_of_week: 0, // Monday
    start_time: "17:00:00",
    end_time: "18:00:00",
    week_pattern: "every",
    recurrence_interval_weeks: 1,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const PARTICIPANT: ActivityParticipant = {
  activity_id: "a1",
  person_id: "p",
  family_id: "fam",
  created_at: "",
};

function activityOverride(over: Partial<ActivityOverride> = {}): ActivityOverride {
  return {
    id: "ao1",
    schedule_id: "s1",
    family_id: "fam",
    person_id: "p",
    date: MON_1,
    action: "reschedule",
    override_start_time: "18:00:00",
    override_end_time: "19:00:00",
    override_date: WED_2,
    note: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const NO_ANCHORS = new Map<string, SchoolShiftAnchor>();

describe("resolveBlocksInRange", () => {
  it("resolves a weekly activity on each Monday the range touches", () => {
    const blocks = resolveBlocksInRange({
      from: MON_1,
      to: MON_2,
      activities: [activity()],
      schedule: [schedule()],
      participants: [PARTICIPANT],
      shiftAnchorsByPersonId: NO_ANCHORS,
    });
    expect(blocks.map((b) => b.date)).toEqual([MON_1, MON_2]);
  });

  it("filters out occurrences before the range start", () => {
    const blocks = resolveBlocksInRange({
      from: "2026-06-02", // Tuesday — drops Monday 06-01
      to: MON_2,
      activities: [activity()],
      schedule: [schedule()],
      participants: [PARTICIPANT],
      shiftAnchorsByPersonId: NO_ANCHORS,
    });
    expect(blocks.map((b) => b.date)).toEqual([MON_2]);
  });

  it("resolves a cross-week reschedule: ghost at origin, real block at target", () => {
    const blocks = resolveBlocksInRange({
      from: MON_1,
      to: "2026-06-14",
      activities: [activity()],
      schedule: [schedule()],
      participants: [PARTICIPANT],
      shiftAnchorsByPersonId: NO_ANCHORS,
      overrides: [activityOverride()],
    });

    const byDate = new Map(blocks.map((b) => [b.date, b]));
    // Origin Monday keeps a moved-away ghost pointing at the new date.
    expect(byDate.get(MON_1)?.override?.movedTo).toBe(WED_2);
    // The unaffected next Monday is a plain block.
    expect(byDate.get(MON_2)?.override).toBeUndefined();
    // The real block lands in the target week with the new time + back-pointer.
    expect(byDate.get(WED_2)?.override?.movedFrom).toBe(MON_1);
    expect(byDate.get(WED_2)?.startTime).toBe("18:00");
  });
});
