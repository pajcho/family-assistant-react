import { format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "@/types/database";
import { addDays } from "@/utils/date";
import {
  eventDaySlices,
  eventDurationLabel,
  eventLastDay,
  eventSpanDays,
  formatEventDateRange,
  formatEventTimeRange,
  isEventEnded,
  isEventOngoing,
  isMultiDayEvent,
  shiftedEventEndDate,
} from "@/utils/event";

/** Minimal event - only the schedule columns the helpers read. */
function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: "e1",
    family_id: "f1",
    name: "Test",
    description: null,
    date: "2026-08-05",
    end_date: null,
    start_time: null,
    end_time: null,
    notes: null,
    remind_minutes_before: null,
    canceled_at: null,
    cancel_reason: null,
    birthday_id: null,
    reschedule_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("event span helpers", () => {
  it("single-day: last day is the date itself, span 1", () => {
    const e = makeEvent({});
    expect(eventLastDay(e)).toBe("2026-08-05");
    expect(isMultiDayEvent(e)).toBe(false);
    expect(eventSpanDays(e)).toBe(1);
  });

  it("multi-day: inclusive last day and span length", () => {
    const e = makeEvent({ end_date: "2026-08-07" });
    expect(eventLastDay(e)).toBe("2026-08-07");
    expect(isMultiDayEvent(e)).toBe(true);
    expect(eventSpanDays(e)).toBe(3);
  });

  it("degrades a malformed end_date (<= date) to single-day", () => {
    const e = makeEvent({ end_date: "2026-08-01" });
    expect(eventLastDay(e)).toBe("2026-08-05");
    expect(isMultiDayEvent(e)).toBe(false);
  });

  it("paucal duration labels", () => {
    expect(eventDurationLabel(makeEvent({ end_date: "2026-08-06" }))).toBe("2 dana");
    expect(eventDurationLabel(makeEvent({ end_date: "2026-08-07" }))).toBe("3 dana");
    expect(eventDurationLabel(makeEvent({ end_date: "2026-08-25" }))).toBe("21 dan");
  });

  it("isEventOngoing only inside a multi-day span", () => {
    const e = makeEvent({ end_date: "2026-08-07" });
    expect(isEventOngoing(e, "2026-08-04")).toBe(false);
    expect(isEventOngoing(e, "2026-08-05")).toBe(true);
    expect(isEventOngoing(e, "2026-08-06")).toBe(true);
    expect(isEventOngoing(e, "2026-08-07")).toBe(true);
    expect(isEventOngoing(e, "2026-08-08")).toBe(false);
    // Single-day events are never "u toku".
    expect(isEventOngoing(makeEvent({}), "2026-08-05")).toBe(false);
  });

  it("shiftedEventEndDate keeps the span length from the new start", () => {
    const e = makeEvent({ end_date: "2026-08-07" });
    expect(shiftedEventEndDate(e, "2026-09-01")).toBe("2026-09-03");
    expect(shiftedEventEndDate(makeEvent({}), "2026-09-01")).toBeNull();
  });
});

describe("eventDaySlices", () => {
  const timed = makeEvent({
    end_date: "2026-08-07",
    start_time: "09:00",
    end_time: "15:00",
  });

  it("expands a span into first/middle/last slices with edge times", () => {
    expect(eventDaySlices(timed, "2026-08-01", "2026-08-31")).toEqual([
      { date: "2026-08-05", startTime: "09:00", endTime: null, dayIndex: 1, totalDays: 3 },
      { date: "2026-08-06", startTime: null, endTime: null, dayIndex: 2, totalDays: 3 },
      { date: "2026-08-07", startTime: null, endTime: "15:00", dayIndex: 3, totalDays: 3 },
    ]);
  });

  it("keeps both times on a single-day event", () => {
    const single = makeEvent({ start_time: "09:00", end_time: "15:00" });
    expect(eventDaySlices(single, "2026-08-01", "2026-08-31")).toEqual([
      { date: "2026-08-05", startTime: "09:00", endTime: "15:00", dayIndex: 1, totalDays: 1 },
    ]);
  });

  it("clamps to the window but keeps absolute day positions", () => {
    // Window covers only the middle day - dayIndex still says 2/3.
    expect(eventDaySlices(timed, "2026-08-06", "2026-08-06")).toEqual([
      { date: "2026-08-06", startTime: null, endTime: null, dayIndex: 2, totalDays: 3 },
    ]);
  });

  it("returns nothing outside the window", () => {
    expect(eventDaySlices(timed, "2026-08-08", "2026-08-31")).toEqual([]);
    expect(eventDaySlices(timed, "2026-07-01", "2026-08-04")).toEqual([]);
  });
});

describe("isEventEnded with end_date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an ongoing span (last day in the future) is not ended", () => {
    // Started yesterday, ends tomorrow.
    expect(isEventEnded(makeEvent({ date: "2026-08-05", end_date: "2026-08-07" }))).toBe(false);
  });

  it("ends on its LAST day's end_time, not the start day's", () => {
    const endsToday = makeEvent({
      date: "2026-08-04",
      end_date: "2026-08-06",
      end_time: "11:00",
    });
    expect(isEventEnded(endsToday)).toBe(true);
    const endsTonight = makeEvent({
      date: "2026-08-04",
      end_date: "2026-08-06",
      end_time: "20:00",
    });
    expect(isEventEnded(endsTonight)).toBe(false);
  });

  it("all-day span ends after its last day", () => {
    expect(isEventEnded(makeEvent({ date: "2026-08-03", end_date: "2026-08-05" }))).toBe(true);
    expect(isEventEnded(makeEvent({ date: "2026-08-03", end_date: "2026-08-06" }))).toBe(false);
  });
});

describe("formatting", () => {
  it("formatEventDateRange", () => {
    expect(formatEventDateRange(makeEvent({}))).toBe("05.08.2026");
    expect(formatEventDateRange(makeEvent({ end_date: "2026-08-07" }))).toBe("05.08. - 07.08.2026");
    expect(formatEventDateRange(makeEvent({ date: "2026-12-30", end_date: "2027-01-02" }))).toBe(
      "30.12.2026 - 02.01.2027",
    );
  });

  it("formatEventTimeRange single-day stays unchanged", () => {
    expect(formatEventTimeRange(makeEvent({}))).toBe("Ceo dan");
    expect(formatEventTimeRange(makeEvent({ start_time: "09:00" }))).toBe("09:00");
    expect(formatEventTimeRange(makeEvent({ end_time: "15:00" }))).toBe("do 15:00");
    expect(formatEventTimeRange(makeEvent({ start_time: "09:00", end_time: "15:00" }))).toBe(
      "09:00 - 15:00",
    );
  });

  it("formatEventTimeRange multi-day carries the edge dates", () => {
    const span = { end_date: "2026-08-07" };
    expect(formatEventTimeRange(makeEvent(span))).toBe("Ceo dan");
    expect(formatEventTimeRange(makeEvent({ ...span, start_time: "09:00" }))).toBe(
      "od 05.08. 09:00",
    );
    expect(formatEventTimeRange(makeEvent({ ...span, end_time: "15:00" }))).toBe("do 07.08. 15:00");
    expect(
      formatEventTimeRange(makeEvent({ ...span, start_time: "09:00", end_time: "15:00" })),
    ).toBe("05.08. 09:00 - 07.08. 15:00");
  });
});

describe("useAgenda-style expansion window maths", () => {
  it("today-only window catches a span that started earlier", () => {
    const today = "2026-08-06";
    const e = makeEvent({ date: "2026-08-04", end_date: "2026-08-08" });
    const slices = eventDaySlices(e, today, today);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ date: today, dayIndex: 3, totalDays: 5 });
  });

  it("iterating a long span across a 30-day window stays bounded", () => {
    const e = makeEvent({ date: "2026-01-01", end_date: "2026-12-31" });
    const from = "2026-08-01";
    const to = format(addDays(new Date(2026, 7, 1), 29), "yyyy-MM-dd");
    const slices = eventDaySlices(e, from, to);
    expect(slices).toHaveLength(30);
    expect(slices[0].date).toBe("2026-08-01");
    expect(slices[29].date).toBe("2026-08-30");
  });
});
