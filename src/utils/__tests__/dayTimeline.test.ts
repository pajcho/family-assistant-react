import { describe, expect, it } from "vitest";

import type { AgendaItem } from "@/hooks/useAgenda";
import { nowLineIndex, splitDayTimeline } from "@/utils/dayTimeline";

/* Minimal fixtures - the split only reads the fields asserted below, so the
   rest of each row is cast rather than hand-built. */

const day = "2026-08-04";

function activity(startTime: string, endTime: string): AgendaItem {
  return {
    kind: "activity",
    date: day,
    sortKey: 0,
    block: { personId: "p1", date: day, startTime, endTime },
    person: undefined,
    activity: undefined,
  } as unknown as AgendaItem;
}

function event(opts: {
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  name?: string;
}): AgendaItem {
  return {
    kind: "event",
    date: day,
    sortKey: 0,
    event: { id: "e1", name: opts.name ?? "Događaj" },
    personIds: [],
    isAllDay: opts.isAllDay ?? false,
    startTime: opts.startTime ?? null,
    endTime: opts.endTime ?? null,
    dayIndex: 1,
    totalDays: 1,
  } as unknown as AgendaItem;
}

function payment(name: string): AgendaItem {
  return {
    kind: "payment",
    date: day,
    sortKey: 0,
    payment: { id: "pay1", name, amount: 1000 },
    personIds: [],
  } as unknown as AgendaItem;
}

function birthday(): AgendaItem {
  return {
    kind: "birthday",
    date: day,
    sortKey: 0,
    birthday: { id: "b1", name: "Baba Mira", birth_date: "1954-08-04" },
  } as unknown as AgendaItem;
}

const NOON = 12 * 60;

describe("splitDayTimeline", () => {
  it("sorts timed rows by start time regardless of input order", () => {
    const { timed } = splitDayTimeline(
      [activity("18:00", "19:30"), activity("08:00", "12:20"), activity("14:00", "15:00")],
      NOON,
    );
    expect(timed.map((entry) => entry.startTime)).toEqual(["08:00", "14:00", "18:00"]);
  });

  it("marks a row past only once its END has elapsed", () => {
    const { timed } = splitDayTimeline(
      [activity("08:00", "12:20"), activity("08:00", "11:00")],
      NOON,
    );
    // 12:20 still running at noon, 11:00 already over.
    expect(timed.map((entry) => entry.past)).toEqual([false, true]);
  });

  it("keeps payments out of the clock even though they are due today", () => {
    const { timed, payments, chips } = splitDayTimeline(
      [payment("Vrtić"), activity("09:00", "10:00")],
      NOON,
    );
    expect(payments).toHaveLength(1);
    expect(timed).toHaveLength(1);
    expect(chips).toHaveLength(0);
  });

  it("sends all-day items, birthdays and time-less events to the chips", () => {
    const { chips, timed } = splitDayTimeline(
      [birthday(), event({ isAllDay: true }), event({ startTime: null })],
      NOON,
    );
    expect(chips).toHaveLength(3);
    expect(timed).toHaveLength(0);
  });

  it("gives an open-ended event a synthetic hour", () => {
    const { timed } = splitDayTimeline([event({ startTime: "14:00" })], NOON);
    expect(timed[0]).toMatchObject({ startTime: "14:00", endTime: "15:00" });
  });

  it("reports no end when start and end are the same minute", () => {
    const { timed } = splitDayTimeline([activity("17:00", "17:00")], NOON);
    expect(timed[0].endTime).toBeNull();
  });
});

describe("nowLineIndex", () => {
  const rows = () =>
    splitDayTimeline([activity("08:00", "09:00"), activity("14:00", "15:00")], NOON).timed;

  it("puts the line above the first row that has not started", () => {
    expect(nowLineIndex(rows(), NOON)).toBe(1);
  });

  it("draws no line before the day has started - nothing to separate", () => {
    expect(nowLineIndex(rows(), 6 * 60)).toBe(-1);
  });

  it("draws no line once every row is behind us", () => {
    expect(nowLineIndex(rows(), 22 * 60)).toBe(-1);
  });

  it("draws no line for an empty day", () => {
    expect(nowLineIndex([], NOON)).toBe(-1);
  });
});
