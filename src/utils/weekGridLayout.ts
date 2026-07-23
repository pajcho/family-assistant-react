import { timeToMinutes } from "./activity";

/**
 * A time block decorated with its column placement inside a day's overlap
 * layout. Render width is `laneSpan / totalLanes`; left offset is
 * `(lane - 1) / totalLanes`.
 */
export type Laned<T> = T & {
  /** 1-based column index within the overlap group. */
  lane: number;
  /**
   * Number of columns the group is divided into - the PEAK number of blocks
   * active at the same instant, NOT the group's total size.
   */
  totalLanes: number;
  /**
   * How many consecutive columns (starting at `lane`) the block occupies. A
   * block widens rightward across columns that hold nothing overlapping it, so
   * one that briefly shares the row then runs on alone reclaims the freed
   * width instead of staying pinned to a thin slice.
   */
  laneSpan: number;
};

type TimeBlock = { startTime: string; endTime: string };

/**
 * Lay overlapping time blocks of a single day out into side-by-side columns.
 *
 * Two passes over an interval graph:
 *  1. Sweep start-sorted blocks, grouping ones that transitively overlap, and
 *     greedily give each the lowest free column - reusing a column the instant
 *     its previous occupant ends.
 *  2. Per group, set `totalLanes` to the PEAK column count, then expand each
 *     block rightward across columns holding nothing that overlaps it.
 *
 * The peak count matters: a transitive chain (A-B overlap, B-C overlap, but
 * A-C don't) reuses columns, so the group's *size* over-counts the columns
 * ever used at once. Dividing width by the size left the surplus columns
 * empty on the right - the bug this layout fixes.
 */
export function assignLanes<T extends TimeBlock>(daysBlocks: ReadonlyArray<T>): Laned<T>[] {
  const sorted = [...daysBlocks].sort((a, b) => {
    const aStart = timeToMinutes(a.startTime);
    const bStart = timeToMinutes(b.startTime);
    if (aStart !== bStart) return aStart - bStart;
    return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
  });

  type Active = { block: T; startMin: number; endMin: number; lane: number };
  const result: Laned<T>[] = [];
  let group: Active[] = [];
  let groupMaxEnd = -Infinity;

  const flushGroup = () => {
    if (group.length === 0) return;
    // Peak concurrency = highest column index actually used, not group.length.
    const totalLanes = group.reduce((max, a) => Math.max(max, a.lane), 0);
    for (const { block, startMin, endMin, lane } of group) {
      // Widen into consecutive higher columns until one holds a block that
      // overlaps this one in time.
      let laneSpan = 1;
      for (let col = lane + 1; col <= totalLanes; col++) {
        const occupied = group.some(
          (o) => o.lane === col && o.startMin < endMin && o.endMin > startMin,
        );
        if (occupied) break;
        laneSpan++;
      }
      result.push({ ...block, lane, totalLanes, laneSpan });
    }
    group = [];
    groupMaxEnd = -Infinity;
  };

  for (const block of sorted) {
    const startMin = timeToMinutes(block.startTime);
    const endMin = timeToMinutes(block.endTime);

    if (group.length > 0 && startMin >= groupMaxEnd) {
      flushGroup();
    }

    // Smallest free column (1-based) among blocks still active at startMin.
    const usedLanes = new Set(group.filter((a) => a.endMin > startMin).map((a) => a.lane));
    let lane = 1;
    while (usedLanes.has(lane)) lane++;

    group.push({ block, startMin, endMin, lane });
    groupMaxEnd = Math.max(groupMaxEnd, endMin);
  }
  flushGroup();

  return result;
}
