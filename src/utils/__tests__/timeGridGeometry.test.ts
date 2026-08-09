import { describe, expect, it } from "vitest";

import {
  buildHourLabels,
  computeRange,
  gridHeightPx,
  positionSpans,
  type TimeGridConfig,
} from "../timeGridGeometry";

/**
 * The two scales in the app. Every number here is the one the corresponding
 * grid shipped with, so a change to either config shows up as a failure rather
 * than as a quietly resized calendar.
 */
const AGENDA: TimeGridConfig = {
  slotMinutes: 30,
  slotHeightPx: 40,
  gridTopPaddingPx: 12,
  gridBottomPaddingPx: 12,
  minBlockHeightPx: 24,
  defaultStartMin: 7 * 60,
  defaultEndMin: 21 * 60,
};

/** The activities WeekGrid: denser rows, and no minimum block height. */
const WEEK: TimeGridConfig = { ...AGENDA, slotHeightPx: 28, minBlockHeightPx: 0 };

const span = (startTime: string, endTime: string) => ({ startTime, endTime });

describe("computeRange", () => {
  it("falls back to the configured default window when there is nothing to fit", () => {
    expect(computeRange([], AGENDA)).toEqual({ startMin: 420, endMin: 1260 });
    expect(computeRange([], WEEK)).toEqual({ startMin: 420, endMin: 1260 });
  });

  it("fits to content with an hour of air, aligned to half-hour gridlines", () => {
    // 10:15 - 1h = 9:15, floored to 9:00. 11:45 + 1h = 12:45, ceiled to 13:00.
    expect(computeRange([span("10:15", "11:45")], AGENDA)).toEqual({ startMin: 540, endMin: 780 });
  });

  it("clamps to the day rather than running off either end", () => {
    expect(computeRange([span("00:15", "23:30")], AGENDA)).toEqual({ startMin: 0, endMin: 1440 });
  });

  it("spans the earliest start and the latest end across all entries", () => {
    const range = computeRange(
      [span("14:00", "15:00"), span("08:00", "09:00"), span("11:00", "18:00")],
      AGENDA,
    );
    expect(range).toEqual({ startMin: 420, endMin: 1140 });
  });

  /**
   * The reason this module exists rather than two copies of the math.
   *
   * `normalizeTime` degrades a missing time to "" on purpose (so a stale client
   * does not white-screen), which makes `timeToMinutes` return NaN. The agenda
   * calendars used to fold that NaN straight into Math.min/Math.max, poisoning
   * the whole axis: no hour labels and every block at NaN. The activities grid
   * skipped it instead. This pins the surviving, robust behaviour for BOTH.
   */
  describe("unparseable times", () => {
    const good = [span("09:00", "10:00"), span("13:00", "14:30")];
    const withBad = [span("09:00", "10:00"), span("", ""), span("13:00", "14:30")];

    it("ignores a malformed entry instead of poisoning the range", () => {
      for (const cfg of [AGENDA, WEEK]) {
        expect(computeRange(withBad, cfg)).toEqual(computeRange(good, cfg));
      }
      expect(computeRange(withBad, AGENDA)).toEqual({ startMin: 480, endMin: 930 });
    });

    it("falls back to the default window when NO entry yields a usable bound", () => {
      for (const cfg of [AGENDA, WEEK]) {
        expect(computeRange([span("", "")], cfg)).toEqual(computeRange([], cfg));
      }
    });

    it("still falls back when only one of the two bounds is readable", () => {
      expect(computeRange([span("09:00", "")], AGENDA)).toEqual({ startMin: 420, endMin: 1260 });
    });
  });
});

describe("positionSpans", () => {
  it("positions a block against the start of the axis, at either scale", () => {
    const startMin = 480; // axis starts at 08:00
    const [agenda] = positionSpans([span("09:00", "10:00")], startMin, AGENDA);
    // One hour past the axis start = 2 slots. 12 + 2*40, height 2*40.
    expect(agenda).toMatchObject({ topPx: 92, heightPx: 80 });

    const [week] = positionSpans([span("09:00", "10:00")], startMin, WEEK);
    expect(week).toMatchObject({ topPx: 68, heightPx: 56 });
  });

  it("carries the entry's own fields through untouched", () => {
    const [out] = positionSpans([{ ...span("09:00", "10:00"), lane: 2, id: "a" }], 540, AGENDA);
    expect(out).toMatchObject({ lane: 2, id: "a", startTime: "09:00", endTime: "10:00" });
  });

  it("floors a short block at minBlockHeightPx, but only when there is a floor", () => {
    // 10 minutes is a third of a slot: 13.33px in the agenda, 9.33px in WeekGrid.
    const short = [span("09:00", "09:10")];
    expect(positionSpans(short, 540, AGENDA)[0].heightPx).toBe(24);
    expect(positionSpans(short, 540, WEEK)[0].heightPx).toBeCloseTo((10 / 30) * 28);
  });

  it("leaves a negative duration negative when the floor is off", () => {
    // Nonsense data should stay visibly wrong rather than be squared up into a
    // normal-looking block - the agenda's floor does hide it, WeekGrid's does not.
    const backwards = [span("10:00", "09:00")];
    expect(positionSpans(backwards, 540, AGENDA)[0].heightPx).toBe(24);
    expect(positionSpans(backwards, 540, WEEK)[0].heightPx).toBe(-56);
  });
});

describe("buildHourLabels", () => {
  it("emits one label per full hour in the range, positioned like the blocks", () => {
    const labels = buildHourLabels(540, 720, AGENDA); // 09:00 - 12:00
    expect(labels.map((l) => l.label)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
    expect(labels.map((l) => l.topPx)).toEqual([12, 92, 172, 252]);
  });

  it("scales the label positions with the row height", () => {
    expect(buildHourLabels(540, 660, WEEK).map((l) => l.topPx)).toEqual([12, 68, 124]);
  });

  it("starts at the first WHOLE hour inside a range that begins mid-hour", () => {
    const labels = buildHourLabels(570, 720, AGENDA); // 09:30 - 12:00
    expect(labels.map((l) => l.label)).toEqual(["10:00", "11:00", "12:00"]);
    expect(labels[0].topPx).toBe(52);
  });
});

describe("gridHeightPx", () => {
  it("covers the whole range plus both paddings", () => {
    // 09:00-12:00 is 6 slots: 6*40 + 12 + 12 in the agenda, 6*28 + 24 in WeekGrid.
    expect(gridHeightPx(540, 720, AGENDA)).toBe(264);
    expect(gridHeightPx(540, 720, WEEK)).toBe(192);
  });
});
