import { describe, expect, it } from "vitest";
import type {
  Activity,
  ActivityOverride,
  ActivityParticipant,
  ActivitySchedule,
  PaymentHistory,
  SchoolShiftAnchor,
} from "@/types/database";
import { computeActivityMonthlySummaries } from "../activityAttendance";

/* ------------------------------------------------------------------------- */
/* Fixtures — June 2026 starts on a Monday (Mondays: 1, 8, 15, 22, 29);      */
/* July 2026 Mondays: 6, 13, 20, 27.                                         */
/* ------------------------------------------------------------------------- */

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
    created_at: "2026-01-05T00:00:00Z", // a Monday — stable interval anchor
    updated_at: "2026-01-05T00:00:00Z",
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

function participant(person_id: string): ActivityParticipant {
  return { activity_id: "a1", person_id, family_id: "fam", created_at: "" };
}

function activityOverride(over: Partial<ActivityOverride> = {}): ActivityOverride {
  return {
    id: "ao1",
    schedule_id: "s1",
    family_id: "fam",
    person_id: "p1",
    date: "2026-06-08",
    action: "cancel",
    override_start_time: null,
    override_end_time: null,
    override_date: null,
    note: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function historyRow(
  over: Partial<Pick<PaymentHistory, "payment_id" | "due_date" | "amount" | "status">> = {},
): Pick<PaymentHistory, "payment_id" | "due_date" | "amount" | "status"> {
  return { payment_id: "pay1", due_date: "2026-06-10", amount: 2000, status: "paid", ...over };
}

const NO_ANCHORS = new Map<string, SchoolShiftAnchor>();
const LINKED = new Set(["pay1"]);

function summarize(
  over: Partial<Parameters<typeof computeActivityMonthlySummaries>[0]> = {},
): ReturnType<typeof computeActivityMonthlySummaries> {
  return computeActivityMonthlySummaries({
    activity: activity(),
    schedule: [schedule()],
    participants: [participant("p1")],
    shiftAnchorsByPersonId: NO_ANCHORS,
    linkedPaymentIds: LINKED,
    history: [],
    currentMonth: "2026-07",
    monthsBack: 1,
    ...over,
  });
}

/* ------------------------------------------------------------------------- */
/* Held-session counting                                                     */
/* ------------------------------------------------------------------------- */

describe("computeActivityMonthlySummaries — held sessions", () => {
  it("counts each schedule occurrence per month, newest month first", () => {
    const months = summarize();
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-06"]);
    expect(months.map((m) => m.heldSessions)).toEqual([4, 5]); // Jul: 4 Mondays, Jun: 5
  });

  it("labels months in capitalized Serbian Latin", () => {
    const months = summarize();
    expect(months.map((m) => m.label)).toEqual(["Jul 2026", "Jun 2026"]);
  });

  it("subtracts canceled occurrences", () => {
    const months = summarize({
      overrides: [activityOverride({ date: "2026-06-08" })],
    });
    expect(months.find((m) => m.month === "2026-06")?.heldSessions).toBe(4);
  });

  it("keeps a termin held when only one of two participants canceled", () => {
    const months = summarize({
      participants: [participant("p1"), participant("p2")],
      overrides: [activityOverride({ date: "2026-06-08", person_id: "p1" })],
    });
    // Two siblings share the same slot — one skipping doesn't cancel the termin.
    expect(months.find((m) => m.month === "2026-06")?.heldSessions).toBe(5);
  });

  it("counts a distinct termin once regardless of participant count", () => {
    const months = summarize({ participants: [participant("p1"), participant("p2")] });
    expect(months.map((m) => m.heldSessions)).toEqual([4, 5]);
  });

  it("moves a rescheduled termin across the month boundary", () => {
    // Monday Jun 29 moved to Wednesday Jul 1: June loses it, July gains it.
    const months = summarize({
      overrides: [
        activityOverride({
          date: "2026-06-29",
          action: "reschedule",
          override_start_time: "17:00:00",
          override_end_time: "18:00:00",
          override_date: "2026-07-01",
        }),
      ],
    });
    expect(months.find((m) => m.month === "2026-06")?.heldSessions).toBe(4);
    expect(months.find((m) => m.month === "2026-07")?.heldSessions).toBe(5);
  });

  it("applies A/B week patterns through the shift anchor", () => {
    const anchors = new Map<string, SchoolShiftAnchor>([
      [
        "p1",
        {
          person_id: "p1",
          family_id: "fam",
          anchor_week_start: "2026-06-01",
          anchor_shift: "morning",
          flip_interval_weeks: 1,
          is_alternating: true,
          fixed_time_band: null,
          afternoon_uses_predcas: true,
          created_at: "",
          updated_at: "",
        },
      ],
    ]);
    const months = summarize({
      schedule: [schedule({ week_pattern: "A" })],
      shiftAnchorsByPersonId: anchors,
    });
    // A = morning weeks: Jun 1, 15, 29 fire; Jun 8, 22 are B weeks.
    expect(months.find((m) => m.month === "2026-06")?.heldSessions).toBe(3);
  });

  it('applies "every N weeks" intervals anchored on active_from', () => {
    const months = summarize({
      activity: activity({ active_from: "2026-06-01" }),
      schedule: [schedule({ recurrence_interval_weeks: 2 })],
    });
    // From Jun 1 every other Monday: Jun 1, 15, 29 — then Jul 13, 27.
    expect(months.find((m) => m.month === "2026-06")?.heldSessions).toBe(3);
    expect(months.find((m) => m.month === "2026-07")?.heldSessions).toBe(2);
  });

  it("returns zero sessions for months outside the season window", () => {
    const months = summarize({ activity: activity({ active_from: "2026-07-01" }) });
    expect(months.find((m) => m.month === "2026-06")?.heldSessions).toBe(0);
    expect(months.find((m) => m.month === "2026-07")?.heldSessions).toBe(4);
  });
});

/* ------------------------------------------------------------------------- */
/* Paid totals                                                               */
/* ------------------------------------------------------------------------- */

describe("computeActivityMonthlySummaries — paid totals", () => {
  it("sums paid history of linked payments by due-date month", () => {
    const months = summarize({
      linkedPaymentIds: new Set(["pay1", "pay2"]),
      history: [
        historyRow({ due_date: "2026-06-10", amount: 2000 }),
        historyRow({ payment_id: "pay2", due_date: "2026-06-20", amount: 2000 }),
        historyRow({ due_date: "2026-07-10", amount: 2500 }),
      ],
    });
    expect(months.find((m) => m.month === "2026-06")?.paidTotal).toBe(4000);
    expect(months.find((m) => m.month === "2026-07")?.paidTotal).toBe(2500);
  });

  it("ignores canceled history rows and payments that aren't linked", () => {
    const months = summarize({
      history: [
        historyRow({ status: "canceled" }),
        historyRow({ payment_id: "other", amount: 9999 }),
        historyRow({ amount: 1500 }),
      ],
    });
    expect(months.find((m) => m.month === "2026-06")?.paidTotal).toBe(1500);
  });
});
