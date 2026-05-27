import * as React from "react";
import { addDays, format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import type { Activity, Profile } from "@/types/database";
import {
  DAY_LABELS_SHORT,
  fallbackColorForProfile,
  timeToMinutes,
  type ResolvedActivityBlock,
} from "@/utils/activity";

/**
 * Weekly schedule grid — 7 day columns × 30-minute time slots. Time gutter
 * on the left, blocks absolutely positioned inside their day column.
 *
 * The visible time range adapts to the data: if all blocks fit between 7:00
 * and 21:00 we render the default window; otherwise we widen to cover the
 * earliest start - 1h and the latest end + 1h, clamped to [0:00, 24:00].
 *
 * Overlapping blocks in the same day are laid out side-by-side with equal
 * widths within their overlap group, using a simple interval-graph sweep.
 */

const SLOT_HEIGHT_PX = 28;
const SLOT_MINUTES = 30;
const DEFAULT_START_MIN = 7 * 60;
const DEFAULT_END_MIN = 21 * 60;
// Vertical breathing room above the first hour label and below the last
// block. Without the top inset, labels positioned at `topPx = 0` get
// halved by their `translate-y-1/2` and the first hour reads as clipped.
const GRID_TOP_PADDING_PX = 12;
const GRID_BOTTOM_PADDING_PX = 12;

export type WeekGridProps = {
  weekStart: string;
  blocks: ReadonlyArray<ResolvedActivityBlock>;
  activitiesById: ReadonlyMap<string, Activity>;
  peopleById: ReadonlyMap<string, Profile>;
  onBlockClick?: (block: ResolvedActivityBlock) => void;
};

interface PositionedBlock extends ResolvedActivityBlock {
  topPx: number;
  heightPx: number;
  /** 1-based — out of `totalLanes` overlapping in this group. */
  lane: number;
  totalLanes: number;
}

/**
 * Sweep overlapping blocks in a single day and assign each one a lane
 * index. Each group of mutually-overlapping blocks gets `totalLanes` =
 * the group size; non-overlapping blocks get lane=1, totalLanes=1.
 */
function assignLanes(daysBlocks: ResolvedActivityBlock[]): PositionedBlock[] {
  const sorted = [...daysBlocks].sort((a, b) => {
    const aStart = timeToMinutes(a.startTime);
    const bStart = timeToMinutes(b.startTime);
    if (aStart !== bStart) return aStart - bStart;
    return timeToMinutes(a.endTime) - timeToMinutes(b.endTime);
  });

  type Active = { block: ResolvedActivityBlock; endMin: number; lane: number };
  const result: PositionedBlock[] = [];
  let group: Active[] = [];
  let groupMaxEnd = -Infinity;

  const flushGroup = () => {
    if (group.length === 0) return;
    const totalLanes = group.length;
    for (const { block, lane } of group) {
      const startMin = timeToMinutes(block.startTime);
      const endMin = timeToMinutes(block.endTime);
      result.push({
        ...block,
        lane,
        totalLanes,
        topPx: 0, // filled in by caller relative to viewport start
        heightPx: ((endMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      });
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

    // Find smallest free lane (1-based).
    const usedLanes = new Set(
      group.filter((a) => a.endMin > startMin).map((a) => a.lane),
    );
    let lane = 1;
    while (usedLanes.has(lane)) lane++;

    group.push({ block, endMin, lane });
    groupMaxEnd = Math.max(groupMaxEnd, endMin);
  }
  flushGroup();

  return result;
}

function computeViewportRange(
  blocks: ReadonlyArray<ResolvedActivityBlock>,
): { startMin: number; endMin: number } {
  // No blocks → fall back to a reasonable default window so the grid still
  // renders (and the user has something to scan visually).
  if (blocks.length === 0) return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };

  let earliest = Infinity;
  let latest = -Infinity;
  for (const b of blocks) {
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    if (s < earliest) earliest = s;
    if (e > latest) latest = e;
  }

  // Fit-to-content with ~1h breathing room on each side. Previously we
  // always anchored to 7:00–21:00 which wasted vertical space when every
  // activity sat in a 3-hour band in the afternoon.
  const startMin = Math.max(0, earliest - 60);
  const endMin = Math.min(24 * 60, latest + 60);
  // Round to half-hour grid lines so the slot count is whole.
  return {
    startMin: Math.floor(startMin / SLOT_MINUTES) * SLOT_MINUTES,
    endMin: Math.ceil(endMin / SLOT_MINUTES) * SLOT_MINUTES,
  };
}

function isToday(dateStr: string): boolean {
  const today = format(new Date(), "yyyy-MM-dd");
  return dateStr === today;
}

export function WeekGrid({
  weekStart,
  blocks,
  activitiesById,
  peopleById,
  onBlockClick,
}: WeekGridProps) {
  const { startMin, endMin } = React.useMemo(() => computeViewportRange(blocks), [blocks]);
  const slotCount = (endMin - startMin) / SLOT_MINUTES;
  const totalHeightPx =
    slotCount * SLOT_HEIGHT_PX + GRID_TOP_PADDING_PX + GRID_BOTTOM_PADDING_PX;

  // Group blocks per day-of-week then run the lane sweep.
  const positionedByDay = React.useMemo(() => {
    const byDay: Record<number, ResolvedActivityBlock[]> = {};
    for (const block of blocks) {
      (byDay[block.dayOfWeek] ??= []).push(block);
    }
    const result: Record<number, PositionedBlock[]> = {};
    for (const [dowStr, list] of Object.entries(byDay)) {
      const dow = Number(dowStr);
      result[dow] = assignLanes(list).map((p) => ({
        ...p,
        topPx:
          GRID_TOP_PADDING_PX +
          ((timeToMinutes(p.startTime) - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      }));
    }
    return result;
  }, [blocks, startMin]);

  // Hour labels — one per full hour inside the viewport range. Top inset
  // matches the block positioning so labels and gridlines stay aligned.
  const hourLabels: { topPx: number; label: string }[] = [];
  const firstHour = Math.ceil(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  for (let h = firstHour; h <= lastHour; h++) {
    hourLabels.push({
      topPx:
        GRID_TOP_PADDING_PX + ((h * 60 - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      label: `${String(h).padStart(2, "0")}:00`,
    });
  }

  const weekStartDate = parseISO(weekStart + "T12:00:00");
  const dayHeaders = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStartDate, i);
    return {
      label: DAY_LABELS_SHORT[i],
      dayNum: format(date, "d.M."),
      dateStr: format(date, "yyyy-MM-dd"),
    };
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="min-w-[640px]">
        {/* Day headers — sticky so they stay visible while scrolling vertically. */}
        <div className="sticky top-0 z-10 grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground" />
          {dayHeaders.map((dh) => (
            <div
              key={dh.dateStr}
              className={cn(
                "border-l border-gray-200 px-2 py-2 text-center dark:border-gray-700",
                isToday(dh.dateStr) && "bg-blue-50 dark:bg-blue-950/30",
              )}
            >
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                {dh.label}
              </div>
              <div className="text-[10px] text-muted-foreground">{dh.dayNum}</div>
            </div>
          ))}
        </div>

        {/* Body — grid with the same column template; each cell is a relatively-
            positioned column the blocks layer on top of. */}
        <div
          className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]"
          style={{ height: `${totalHeightPx}px` }}
        >
          {/* Time gutter */}
          <div className="relative">
            {hourLabels.map((hl) => (
              <div
                key={hl.label}
                style={{ top: `${hl.topPx}px` }}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              >
                {hl.label}
              </div>
            ))}
          </div>

          {/* 7 day columns */}
          {dayHeaders.map((dh, dow) => (
            <div
              key={dh.dateStr}
              className={cn(
                "relative border-l border-gray-200 dark:border-gray-700",
                isToday(dh.dateStr) && "bg-blue-50/40 dark:bg-blue-950/10",
              )}
            >
              {/* Hour gridlines */}
              {hourLabels.map((hl) => (
                <div
                  key={hl.label}
                  style={{ top: `${hl.topPx}px` }}
                  className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-700/60"
                />
              ))}
              {/* Blocks */}
              {(positionedByDay[dow] ?? []).map((block) => {
                const activity = activitiesById.get(block.activityId);
                const person = peopleById.get(block.personId);
                const color = person?.color ?? fallbackColorForProfile(block.personId);
                const widthPct = 100 / block.totalLanes;
                const leftPct = (block.lane - 1) * widthPct;

                return (
                  <button
                    type="button"
                    key={block.scheduleId}
                    onClick={() => onBlockClick?.(block)}
                    style={{
                      top: `${block.topPx}px`,
                      height: `${block.heightPx}px`,
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      backgroundColor: `${color}1F`, // ~12% opacity
                      borderLeftColor: color,
                    }}
                    className={cn(
                      "absolute overflow-hidden rounded-md border border-transparent border-l-4",
                      "px-1.5 py-0.5 text-left text-[10px] leading-tight",
                      "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      "transition-[filter]",
                    )}
                    aria-label={
                      activity ? `${activity.name} — ${block.startTime}` : "Aktivnost"
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span className="tabular-nums opacity-70">{block.startTime}</span>
                      {block.weekPattern !== "every" ? (
                        <span
                          className="rounded-sm px-1 text-[8px] font-semibold uppercase"
                          style={{ backgroundColor: color, color: "white" }}
                        >
                          {block.weekPattern}
                        </span>
                      ) : null}
                      {block.recurrenceIntervalWeeks > 1 ? (
                        <span
                          className="rounded-sm px-1 text-[8px] font-semibold tabular-nums"
                          style={{ backgroundColor: color, color: "white" }}
                          title={`Svake ${block.recurrenceIntervalWeeks} nedelje`}
                        >
                          ×{block.recurrenceIntervalWeeks}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11px] font-medium text-gray-900 dark:text-gray-100">
                      {activity?.name ?? "Aktivnost"}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
