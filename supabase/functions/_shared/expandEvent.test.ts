import { describe, expect, it } from "vitest";

import { addIsoDays, expandWhen, MAX_SPAN_DAYS } from "./expandEvent.ts";

// Europe/Belgrade is CEST (+02:00) throughout June, so the wall-clock math below
// is stable regardless of where the test runs.
const TZ = "Europe/Belgrade";

describe("addIsoDays", () => {
  it("adds/subtracts days across month and year boundaries (UTC, DST-safe)", () => {
    expect(addIsoDays("2026-06-11", 1)).toBe("2026-06-12");
    expect(addIsoDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addIsoDays("2026-06-13", -1)).toBe("2026-06-12");
    expect(addIsoDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("expandWhen — all-day", () => {
  it("splits a multi-day all-day event into one row per day (end.date is exclusive)", () => {
    const out = expandWhen(
      { id: "e", start: { date: "2026-06-11" }, end: { date: "2026-06-15" } },
      TZ,
    );
    expect(out.map((w) => w.localDate)).toEqual([
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(
      out.every(
        (w) => w.isAllDay && w.startTime === null && w.endTime === null && w.startAt === null,
      ),
    ).toBe(true);
  });

  it("keeps a single-day all-day event as one row", () => {
    const out = expandWhen({ start: { date: "2026-06-11" }, end: { date: "2026-06-12" } }, TZ);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ localDate: "2026-06-11", isAllDay: true });
  });

  it("treats a missing or non-advancing end.date as a single day", () => {
    expect(expandWhen({ start: { date: "2026-06-11" } }, TZ)).toHaveLength(1);
    expect(
      expandWhen({ start: { date: "2026-06-11" }, end: { date: "2026-06-11" } }, TZ),
    ).toHaveLength(1);
  });

  it("clamps an absurdly long span to MAX_SPAN_DAYS rows", () => {
    const out = expandWhen({ start: { date: "2026-01-01" }, end: { date: "2026-12-31" } }, TZ);
    expect(out).toHaveLength(MAX_SPAN_DAYS);
    expect(out[0].localDate).toBe("2026-01-01");
  });
});

describe("expandWhen — timed", () => {
  it("keeps a single-day timed event as one row with start + end times", () => {
    const out = expandWhen(
      {
        start: { dateTime: "2026-06-11T09:00:00+02:00" },
        end: { dateTime: "2026-06-11T10:30:00+02:00" },
      },
      TZ,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      localDate: "2026-06-11",
      startTime: "09:00",
      endTime: "10:30",
      isAllDay: false,
      startAt: "2026-06-11T07:00:00.000Z",
      endAt: "2026-06-11T08:30:00.000Z",
    });
  });

  it("handles an open-ended timed event (no end)", () => {
    const out = expandWhen({ start: { dateTime: "2026-06-11T09:00:00+02:00" } }, TZ);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startTime: "09:00", endTime: null, isAllDay: false });
  });

  it("buckets on the wall-clock day in the family timezone", () => {
    // 22:30Z in June is 00:30 the next day in Belgrade (+02:00).
    const out = expandWhen(
      {
        start: { dateTime: "2026-06-11T22:30:00Z" },
        end: { dateTime: "2026-06-11T23:00:00Z" },
      },
      TZ,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ localDate: "2026-06-12", startTime: "00:30" });
  });

  it("splits a multi-day timed event: day 1 timed, the rest all-day", () => {
    const out = expandWhen(
      {
        start: { dateTime: "2026-06-11T14:00:00+02:00" },
        end: { dateTime: "2026-06-13T10:00:00+02:00" },
      },
      TZ,
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      localDate: "2026-06-11",
      startTime: "14:00",
      endTime: null,
      isAllDay: false,
    });
    expect(out[1]).toMatchObject({ localDate: "2026-06-12", isAllDay: true, startTime: null });
    expect(out[2]).toMatchObject({ localDate: "2026-06-13", isAllDay: true, startTime: null });
  });

  it("treats an end at exactly local midnight as exclusive", () => {
    const out = expandWhen(
      {
        start: { dateTime: "2026-06-11T14:00:00+02:00" },
        end: { dateTime: "2026-06-13T00:00:00+02:00" },
      },
      TZ,
    );
    expect(out.map((w) => w.localDate)).toEqual(["2026-06-11", "2026-06-12"]);
  });
});

describe("expandWhen — no usable start", () => {
  it("returns [] when there is no start", () => {
    expect(expandWhen({}, TZ)).toEqual([]);
    expect(expandWhen({ end: { date: "2026-06-12" } }, TZ)).toEqual([]);
  });
});
