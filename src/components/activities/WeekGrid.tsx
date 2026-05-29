import * as React from "react";
import { addDays, format, parseISO } from "date-fns";
import { BookOpenIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import type { Activity, Profile } from "@/types/database";
import {
  DAY_LABELS_SHORT,
  fallbackColorForProfile,
  timeToMinutes,
  type ResolvedActivityBlock,
} from "@/utils/activity";
import type { ResolvedSchoolBlock } from "@/utils/schoolTimetable";
import { assignLanes, type Laned } from "@/utils/weekGridLayout";

/**
 * Weekly schedule grid — 7 day columns × 30-minute time slots. Time gutter
 * on the left, blocks absolutely positioned inside their day column.
 *
 * Renders two kinds of blocks in the same time-positioned layout:
 *   • activities — trainings / music / etc. with explicit times (solid, in
 *     the person's color).
 *   • school     — class periods whose times are DERIVED from the bell
 *     schedule. Drawn discreetly (lighter fill + a book glyph) so a full
 *     school day doesn't visually drown out the extracurriculars.
 * Both flow through the same lane-assignment sweep so an afternoon class that
 * overlaps an evening training sits side-by-side rather than on top.
 *
 * The visible time range adapts to the data: if all blocks fit between 7:00
 * and 21:00 we render the default window; otherwise we widen to cover the
 * earliest start - 1h and the latest end + 1h, clamped to [0:00, 24:00].
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

/**
 * Discriminated union over the two block kinds. Positioning only ever reads
 * `dayOfWeek` / `startTime` / `endTime` / `personId`, which both shapes share;
 * rendering branches on `kind`.
 */
export type GridBlock =
  | ({ kind: "activity" } & ResolvedActivityBlock)
  | ({ kind: "school" } & ResolvedSchoolBlock);

export type WeekGridProps = {
  weekStart: string;
  blocks: ReadonlyArray<ResolvedActivityBlock>;
  /** School class blocks (already filtered + toggled by the page). */
  schoolBlocks?: ReadonlyArray<ResolvedSchoolBlock>;
  activitiesById: ReadonlyMap<string, Activity>;
  peopleById: ReadonlyMap<string, Profile>;
  onBlockClick?: (block: ResolvedActivityBlock) => void;
  onSchoolBlockClick?: (block: ResolvedSchoolBlock) => void;
};

type PositionedBlock = Laned<GridBlock> & {
  topPx: number;
  heightPx: number;
};

function computeViewportRange(blocks: ReadonlyArray<GridBlock>): {
  startMin: number;
  endMin: number;
} {
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
  schoolBlocks = [],
  activitiesById,
  peopleById,
  onBlockClick,
  onSchoolBlockClick,
}: WeekGridProps) {
  // Merge the two sources into one positioned stream so overlaps between a
  // class and a training are laid out side-by-side, not stacked.
  const allBlocks = React.useMemo<GridBlock[]>(
    () => [
      ...blocks.map((b) => ({ kind: "activity" as const, ...b })),
      ...schoolBlocks.map((b) => ({ kind: "school" as const, ...b })),
    ],
    [blocks, schoolBlocks],
  );

  // Re-render every minute so the "now" line tracks the current time. The
  // first tick is aligned to the next minute boundary so the line steps on
  // the minute rather than drifting by up to a minute from mount time.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(
      () => {
        setNow(new Date());
        intervalId = setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const { startMin, endMin } = React.useMemo(() => computeViewportRange(allBlocks), [allBlocks]);
  const slotCount = (endMin - startMin) / SLOT_MINUTES;
  const totalHeightPx = slotCount * SLOT_HEIGHT_PX + GRID_TOP_PADDING_PX + GRID_BOTTOM_PADDING_PX;

  // Current-time line position, in the same coordinate space as the blocks.
  // Hidden when "now" falls outside the (fit-to-content) visible range — a
  // line pinned to the top/bottom edge would misrepresent where now actually
  // is relative to the activities.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowInViewport = nowMin >= startMin && nowMin <= endMin;
  const nowTopPx = GRID_TOP_PADDING_PX + ((nowMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX;

  // Group blocks per day-of-week then run the lane sweep.
  const positionedByDay = React.useMemo(() => {
    const byDay: Record<number, GridBlock[]> = {};
    for (const block of allBlocks) {
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
        heightPx:
          ((timeToMinutes(p.endTime) - timeToMinutes(p.startTime)) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      }));
    }
    return result;
  }, [allBlocks, startMin]);

  // Hour labels — one per full hour inside the viewport range. Top inset
  // matches the block positioning so labels and gridlines stay aligned.
  const hourLabels: { topPx: number; label: string }[] = [];
  const firstHour = Math.ceil(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  for (let h = firstHour; h <= lastHour; h++) {
    hourLabels.push({
      topPx: GRID_TOP_PADDING_PX + ((h * 60 - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
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

  // Auto-scroll the grid so today's column is in view when the week changes.
  // Mobile uses wide fixed-width columns that overflow the viewport, so
  // without this the user lands on Monday and has to swipe to "today". When
  // today isn't in the displayed week (user clicked next/prev week) we
  // leave the scroll at the start.
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const todayDayIndex = dayHeaders.findIndex((dh) => isToday(dh.dateStr));
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (todayDayIndex < 0) {
      container.scrollLeft = 0;
      return;
    }
    const todayCell = container.querySelector<HTMLElement>(`[data-day-index="${todayDayIndex}"]`);
    if (!todayCell) return;
    // Align today's column near the left edge so the user gets it + the
    // next day in view, not the gutter-and-half-of-today thing.
    container.scrollLeft = Math.max(0, todayCell.offsetLeft - 56);
  }, [todayDayIndex, weekStart]);

  return (
    <div
      ref={scrollContainerRef}
      className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
    >
      {/* `min-w-max` makes the inner wrapper size to its content (1876px on
          mobile, 7×fr on sm+). Without it, the wrapper inherits the
          scroller's viewport width and the inner grid overflows it — which
          breaks sticky-left positioning because the sticky element's
          containing block ends short of the scroll edges. */}
      <div className="min-w-max">
        {/* Day headers — sticky on top so they stay visible while scrolling
            vertically. z-20 (above the body's sticky-left gutter z-10) so
            the top-left intersection cleanly shows the header's empty
            placeholder, not the gutter's first hour label.
            Mobile uses fixed 260px columns so multi-person blocks (siblings
            in the same termin) have room; sm+ flexes back to 1fr / 7. */}
        <div className="sticky top-0 z-20 grid grid-cols-[56px_repeat(7,260px)] border-b border-gray-200 bg-white sm:grid-cols-[56px_repeat(7,minmax(0,1fr))] dark:border-gray-700 dark:bg-gray-800">
          <div className="px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground" />
          {dayHeaders.map((dh, dow) => (
            <div
              key={dh.dateStr}
              data-day-index={dow}
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
          className="grid grid-cols-[56px_repeat(7,260px)] sm:grid-cols-[56px_repeat(7,minmax(0,1fr))]"
          style={{ height: `${totalHeightPx}px` }}
        >
          {/* Time gutter — sticky-left so hour labels stay pinned while the
              user scrolls horizontally between days. bg matches the card
              so day columns scrolling under it are fully obscured. z-10 sits
              below the header (z-20) so the top-left intersection stays
              clean. `sticky` also serves as the positioning context for the
              absolute hour labels (no extra `relative` needed). */}
          <div className="sticky left-0 z-10 bg-white dark:bg-gray-800">
            {hourLabels.map((hl) => (
              <div
                key={hl.label}
                style={{ top: `${hl.topPx}px` }}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              >
                {hl.label}
              </div>
            ))}
            {todayDayIndex >= 0 && nowInViewport ? (
              <div
                style={{ top: `${nowTopPx}px` }}
                className="absolute right-1 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white"
              >
                {format(now, "HH:mm")}
              </div>
            ) : null}
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
                const widthPct = (block.laneSpan / block.totalLanes) * 100;
                const leftPct = ((block.lane - 1) / block.totalLanes) * 100;
                const person = peopleById.get(block.personId);
                const color = person?.color ?? fallbackColorForProfile(block.personId);

                if (block.kind === "school") {
                  return (
                    <SchoolBlock
                      key={`school-${block.entryId}-${block.date}-${block.personId}`}
                      block={block}
                      color={color}
                      leftPct={leftPct}
                      widthPct={widthPct}
                      onClick={onSchoolBlockClick}
                    />
                  );
                }

                const activity = activitiesById.get(block.activityId);

                const isCanceled = block.override?.action === "cancel";
                const isRescheduled = block.override?.action === "reschedule";
                const isMovedAway = !!block.override?.movedTo;
                const isMovedHere = !!block.override?.movedFrom;
                const isSameDayReschedule = isRescheduled && !isMovedAway && !isMovedHere;
                // Both canceled and moved-away render as ghost outlines —
                // they're a "this slot is empty for a reason" marker rather
                // than an active block.
                const isGhost = isCanceled || isMovedAway;

                return (
                  <button
                    type="button"
                    key={`${block.scheduleId}-${block.date}-${block.personId}`}
                    onClick={() => onBlockClick?.(block)}
                    style={{
                      top: `${block.topPx}px`,
                      height: `${block.heightPx}px`,
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      backgroundColor: isGhost ? "transparent" : `${color}1F`,
                      borderLeftColor: color,
                    }}
                    className={cn(
                      "absolute overflow-hidden rounded-md border border-transparent",
                      // Ghost variants: muted opacity + dashed 1px gray frame
                      // on top/right/bottom + thinner 2px left accent (color
                      // still applied via inline style.borderLeftColor). Reads
                      // as "this slot is reserved but not active" without
                      // dominating the column.
                      isGhost
                        ? "border-gray-300 border-l-2 border-dashed text-gray-500 opacity-70 dark:border-gray-600 dark:text-gray-400"
                        : "border-l-4",
                      "px-1.5 py-0.5 text-left text-[10px] leading-tight",
                      "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      "transition-[filter]",
                    )}
                    aria-label={activity ? `${activity.name} — ${block.startTime}` : "Aktivnost"}
                    title={
                      isCanceled
                        ? `Otkazano · ranije ${block.override?.originalStartTime}–${block.override?.originalEndTime}`
                        : isMovedAway
                          ? `Pomereno na ${block.override?.movedTo} ${block.override?.rescheduledStartTime}–${block.override?.rescheduledEndTime}`
                          : isMovedHere
                            ? `Pomereno sa ${block.override?.movedFrom} ${block.override?.originalStartTime}–${block.override?.originalEndTime}`
                            : isSameDayReschedule
                              ? `Pomereno · ranije ${block.override?.originalStartTime}–${block.override?.originalEndTime}`
                              : undefined
                    }
                  >
                    <div className="flex items-center gap-1">
                      <span
                        className={cn(
                          "tabular-nums",
                          isCanceled ? "line-through opacity-70" : "opacity-70",
                        )}
                      >
                        {block.startTime}
                      </span>
                      {isSameDayReschedule ? (
                        <span
                          className="rounded-sm px-1 text-[8px] font-semibold uppercase"
                          style={{ backgroundColor: "#d97706", color: "white" }}
                          title="Pomereno"
                        >
                          ↻
                        </span>
                      ) : null}
                      {isMovedAway ? (
                        <span
                          className="rounded-sm px-1 text-[8px] font-semibold uppercase"
                          style={{ backgroundColor: "#d97706", color: "white" }}
                          title="Pomereno u drugi dan"
                        >
                          ↗
                        </span>
                      ) : null}
                      {isMovedHere ? (
                        <span
                          className="rounded-sm px-1 text-[8px] font-semibold uppercase"
                          style={{ backgroundColor: "#d97706", color: "white" }}
                          title="Premešten sa drugog dana"
                        >
                          ↘
                        </span>
                      ) : null}
                      {isCanceled ? (
                        <span
                          className="rounded-sm px-1 text-[8px] font-semibold uppercase"
                          style={{ backgroundColor: "#dc2626", color: "white" }}
                        >
                          ✕
                        </span>
                      ) : null}
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
                    <div
                      className={cn(
                        "truncate text-[11px] font-medium",
                        isCanceled
                          ? "text-gray-500 line-through dark:text-gray-400"
                          : isMovedAway
                            ? "text-gray-500 dark:text-gray-400"
                            : "text-gray-900 dark:text-gray-100",
                      )}
                    >
                      {activity?.name ?? "Aktivnost"}
                    </div>
                  </button>
                );
              })}
              {/* Current-time line — today's column only, when now is in
                  range. After the blocks in DOM so it paints on top; no
                  z-index (stays under the sticky header/gutter) and
                  pointer-events-none so clicks still reach the blocks. */}
              {isToday(dh.dateStr) && nowInViewport ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
                  style={{ top: `${nowTopPx}px` }}
                >
                  <span className="absolute left-0 top-0 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-red-500" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A single school class. Intentionally flatter and lighter than an activity
 * block: faint tinted fill, a thin left accent in the child's color, and a
 * book glyph so a packed 6-period day reads as "background structure" the
 * trainings sit on top of.
 */
function SchoolBlock({
  block,
  color,
  leftPct,
  widthPct,
  onClick,
}: {
  block: { kind: "school" } & ResolvedSchoolBlock & { topPx: number; heightPx: number };
  color: string;
  leftPct: number;
  widthPct: number;
  onClick?: (block: ResolvedSchoolBlock) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(block)}
      style={{
        top: `${block.topPx}px`,
        height: `${block.heightPx}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: `${color}12`,
        borderLeftColor: color,
      }}
      className={cn(
        // Solid (not dashed — dashed is reserved for canceled/ghost activity
        // blocks) but lighter and thinner than an activity: faint fill + 2px
        // colored left accent so a full school day reads as quiet background.
        "absolute overflow-hidden rounded-md border border-gray-200 border-l-2",
        "px-1.5 py-0.5 text-left text-[10px] leading-tight text-gray-700 dark:border-gray-700 dark:text-gray-200",
        "hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        "transition-[filter]",
      )}
      aria-label={`${block.subject} — ${block.startTime}`}
      title={`${block.subject}${block.room ? ` · ${block.room}` : ""} · ${block.startTime}–${block.endTime}`}
    >
      <div className="flex items-center gap-1 text-muted-foreground">
        <BookOpenIcon className="h-2.5 w-2.5 shrink-0" />
        <span className="tabular-nums">{block.startTime}</span>
      </div>
      <div className="truncate text-[11px] font-medium text-gray-800 dark:text-gray-100">
        {block.subject}
      </div>
      {block.room ? (
        <div className="truncate text-[9px] text-muted-foreground">{block.room}</div>
      ) : null}
    </button>
  );
}
