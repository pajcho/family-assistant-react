import { timeToMinutes } from "@/utils/activity";

/**
 * The geometry behind every time grid in the app: the agenda calendars (Danas'
 * day column, Uskoro's week) and the activities WeekGrid. All of them lay time
 * blocks on a vertical axis in exactly the same way and only differ in pixel
 * scale and in whether short blocks get a minimum height - so those differences
 * arrive as config rather than as a second copy of the math.
 *
 * Pure, and dependency-free apart from `timeToMinutes`, so the pixel math is
 * unit-testable without mounting a grid.
 */

export type TimeSpan = { startTime: string; endTime: string };

export interface TimeGridConfig {
  /** Minutes covered by one grid row (30 on every surface today). */
  slotMinutes: number;
  /** Rendered height of one row - the whole scale of the grid. */
  slotHeightPx: number;
  /**
   * Breathing room above the first hour label. Without it a label sitting at
   * `topPx = 0` is halved by its own `translate-y-1/2` and reads as clipped.
   */
  gridTopPaddingPx: number;
  /** Breathing room below the last block. */
  gridBottomPaddingPx: number;
  /**
   * Shortest a block may render. 0 disables the floor, so a block is exactly
   * as tall as its duration - what the activities grid wants, and what leaves
   * a nonsensical negative duration visibly wrong instead of quietly squared
   * up to a normal-looking block.
   */
  minBlockHeightPx: number;
  /** The window to show when there is nothing to fit to. */
  defaultStartMin: number;
  defaultEndMin: number;
}

/**
 * Fit-to-content hour window - an hour of air on each side of the content,
 * aligned to half-hour gridlines, clamped to the day - falling back to the
 * configured default window when there is nothing to fit.
 *
 * Times that do not parse are SKIPPED rather than folded into the min/max.
 * That is load-bearing: `normalizeTime` deliberately degrades a missing value
 * to "" so a stale client does not white-screen, `timeToMinutes("")` is NaN,
 * and folding one NaN into the range would poison the entire axis - no hour
 * labels at all (`NaN <= NaN` is false) and every block positioned at NaN. One
 * bad row drops out of the range instead of taking the grid down with it.
 */
export function computeRange(
  entries: ReadonlyArray<TimeSpan>,
  cfg: TimeGridConfig,
): { startMin: number; endMin: number } {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const entry of entries) {
    const start = timeToMinutes(entry.startTime);
    const end = timeToMinutes(entry.endTime);
    if (Number.isFinite(start)) earliest = Math.min(earliest, start);
    if (Number.isFinite(end)) latest = Math.max(latest, end);
  }
  // No entries, or nothing in them we could read a bound from.
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
    return { startMin: cfg.defaultStartMin, endMin: cfg.defaultEndMin };
  }
  return {
    startMin: Math.floor(Math.max(0, earliest - 60) / cfg.slotMinutes) * cfg.slotMinutes,
    endMin: Math.ceil(Math.min(24 * 60, latest + 60) / cfg.slotMinutes) * cfg.slotMinutes,
  };
}

/**
 * Top + height in pixels for entries that ALREADY carry their lane assignment
 * (callers run `assignLanes` first, since only they know how a day's blocks
 * should be grouped). Generic over the payload, so lane metadata and whatever
 * else the caller hung on the entry survives untouched.
 */
export function positionSpans<E extends TimeSpan>(
  entries: ReadonlyArray<E>,
  startMin: number,
  cfg: TimeGridConfig,
): (E & { topPx: number; heightPx: number })[] {
  return entries.map((entry) => {
    const start = timeToMinutes(entry.startTime);
    const durationPx =
      ((timeToMinutes(entry.endTime) - start) / cfg.slotMinutes) * cfg.slotHeightPx;
    return {
      ...entry,
      topPx: cfg.gridTopPaddingPx + ((start - startMin) / cfg.slotMinutes) * cfg.slotHeightPx,
      heightPx: cfg.minBlockHeightPx > 0 ? Math.max(durationPx, cfg.minBlockHeightPx) : durationPx,
    };
  });
}

/** One label per full hour inside the range, positioned like the blocks are. */
export function buildHourLabels(
  startMin: number,
  endMin: number,
  cfg: TimeGridConfig,
): { topPx: number; label: string }[] {
  const out: { topPx: number; label: string }[] = [];
  for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) {
    out.push({
      topPx: cfg.gridTopPaddingPx + ((h * 60 - startMin) / cfg.slotMinutes) * cfg.slotHeightPx,
      label: `${String(h).padStart(2, "0")}:00`,
    });
  }
  return out;
}

/** Total scrollable height of a grid spanning `startMin`..`endMin`. */
export function gridHeightPx(startMin: number, endMin: number, cfg: TimeGridConfig): number {
  return (
    ((endMin - startMin) / cfg.slotMinutes) * cfg.slotHeightPx +
    cfg.gridTopPaddingPx +
    cfg.gridBottomPaddingPx
  );
}
