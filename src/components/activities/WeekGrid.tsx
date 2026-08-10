import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { BookOpenIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";
import {
  WEEK_GRID_GUTTER_PX,
  WeekTimeGridShell,
  type WeekGridDay,
} from "@/components/calendar/WeekTimeGridShell";
import type { Activity, Profile } from "@/types/database";
import {
  DAY_LABELS_SHORT,
  fallbackColorForProfile,
  timeToMinutes,
  type ResolvedActivityBlock,
} from "@/utils/activity";
import type { ResolvedSchoolBlock } from "@/utils/schoolTimetable";
import {
  buildHourLabels,
  computeRange,
  gridHeightPx,
  positionSpans,
  type TimeGridConfig,
} from "@/utils/timeGridGeometry";
import { assignLanes, type Laned } from "@/utils/weekGridLayout";

/**
 * Weekly schedule grid - 7 day columns × 30-minute time slots, drawn on the
 * shared {@link WeekTimeGridShell} frame (the calendar's Nedelja view uses the
 * same one, so column widths and sticky mechanics stay in lockstep).
 *
 * Renders two kinds of blocks in the same time-positioned layout:
 *   • activities - trainings / music / etc. with explicit times (solid, in
 *     the person's color).
 *   • school     - class periods whose times are DERIVED from the bell
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
 * This grid's scale, handed to the shared geometry in `@/utils/timeGridGeometry`
 * (the agenda calendars pass a taller one). `minBlockHeightPx: 0` is the one
 * real difference: a short class here stays exactly as tall as its duration
 * rather than being floored to a legible minimum.
 */
const WEEK_GRID: TimeGridConfig = {
  slotMinutes: SLOT_MINUTES,
  slotHeightPx: SLOT_HEIGHT_PX,
  gridTopPaddingPx: GRID_TOP_PADDING_PX,
  gridBottomPaddingPx: GRID_BOTTOM_PADDING_PX,
  minBlockHeightPx: 0,
  defaultStartMin: DEFAULT_START_MIN,
  defaultEndMin: DEFAULT_END_MIN,
};

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
  /** date → raspust label, shown under the day number. */
  breakDays?: ReadonlyMap<string, string>;
  activitiesById: ReadonlyMap<string, Activity>;
  peopleById: ReadonlyMap<string, Profile>;
  onBlockClick?: (block: ResolvedActivityBlock) => void;
  onSchoolBlockClick?: (block: ResolvedSchoolBlock) => void;
};

type PositionedBlock = Laned<GridBlock> & {
  topPx: number;
  heightPx: number;
};

function isToday(dateStr: string): boolean {
  const today = format(new Date(), "yyyy-MM-dd");
  return dateStr === today;
}

/**
 * A block is "past" once it has fully elapsed: any day before today, or today
 * after its end time. Drives the faded styling that lets the eye separate
 * already-happened blocks from upcoming ones, the way Google Calendar dims the
 * past. Dates are yyyy-MM-dd so lexical comparison is chronological; `nowMin`
 * is minutes-since-midnight, matching `timeToMinutes(endTime)`.
 */
function isBlockPast(date: string, endTime: string, todayStr: string, nowMin: number): boolean {
  if (date < todayStr) return true;
  if (date > todayStr) return false;
  return timeToMinutes(endTime) <= nowMin;
}

export function WeekGrid({
  weekStart,
  blocks,
  schoolBlocks = [],
  breakDays,
  activitiesById,
  peopleById,
  onBlockClick,
  onSchoolBlockClick,
}: WeekGridProps) {
  // Merge the two sources into one positioned stream so overlaps between a
  // class and a training are laid out side-by-side, not stacked.
  const allBlocks = useMemo<GridBlock[]>(
    () => [
      ...blocks.map((b) => ({ kind: "activity" as const, ...b })),
      ...schoolBlocks.map((b) => ({ kind: "school" as const, ...b })),
    ],
    [blocks, schoolBlocks],
  );

  // Re-render every minute so the "now" line tracks the current time. The
  // first tick is aligned to the next minute boundary so the line steps on
  // the minute rather than drifting by up to a minute from mount time.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
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

  const { startMin, endMin } = useMemo(() => computeRange(allBlocks, WEEK_GRID), [allBlocks]);
  const totalHeightPx = gridHeightPx(startMin, endMin, WEEK_GRID);

  // Current-time line position, in the same coordinate space as the blocks.
  // Hidden when "now" falls outside the (fit-to-content) visible range - a
  // line pinned to the top/bottom edge would misrepresent where now actually
  // is relative to the activities.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowInViewport = nowMin >= startMin && nowMin <= endMin;
  const nowTopPx = GRID_TOP_PADDING_PX + ((nowMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  // Today, in the blocks' yyyy-MM-dd space - the boundary for fading elapsed
  // blocks. Derived from `now` so it advances at midnight along with the tick.
  const todayStr = format(now, "yyyy-MM-dd");

  // Group blocks per day-of-week then run the lane sweep.
  const positionedByDay = useMemo(() => {
    const byDay: Record<number, GridBlock[]> = {};
    for (const block of allBlocks) {
      (byDay[block.dayOfWeek] ??= []).push(block);
    }
    const result: Record<number, PositionedBlock[]> = {};
    for (const [dowStr, list] of Object.entries(byDay)) {
      const dow = Number(dowStr);
      result[dow] = positionSpans(assignLanes(list), startMin, WEEK_GRID);
    }
    return result;
  }, [allBlocks, startMin]);

  // Hour labels - one per full hour inside the viewport range. Top inset
  // matches the block positioning so labels and gridlines stay aligned.
  const hourLabels = buildHourLabels(startMin, endMin, WEEK_GRID);

  const weekStartDate = parseISO(weekStart + "T12:00:00");
  const dayHeaders: WeekGridDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStartDate, i);
    return {
      label: DAY_LABELS_SHORT[i],
      dayNum: format(date, "d.M."),
      date: format(date, "yyyy-MM-dd"),
    };
  });

  // Auto-scroll the grid so today's column is in view when the week changes.
  // Mobile uses wide fixed-width columns that overflow the viewport, so
  // without this the user lands on Monday and has to swipe to "today". When
  // today isn't in the displayed week (user clicked next/prev week) we
  // leave the scroll at the start.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayDayIndex = dayHeaders.findIndex((dh) => isToday(dh.date));
  useEffect(() => {
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
    container.scrollLeft = Math.max(0, todayCell.offsetLeft - WEEK_GRID_GUTTER_PX);
  }, [todayDayIndex, weekStart]);

  return (
    // The shared week-grid shell (one frame for this grid AND the calendar's
    // Nedelja view): scroll box, sticky day headers with the sticky corner,
    // sticky-left hour gutter, hour gridlines and the "now" line all live
    // there - this component only supplies the axis and the blocks.
    <WeekTimeGridShell
      scrollRef={scrollContainerRef}
      days={dayHeaders}
      todayStr={todayStr}
      hourLabels={hourLabels}
      totalHeightPx={totalHeightPx}
      notesByDate={breakDays}
      now={
        todayDayIndex >= 0 && nowInViewport
          ? { topPx: nowTopPx, label: format(now, "HH:mm") }
          : null
      }
      renderColumn={(_day, dow) =>
        (positionedByDay[dow] ?? []).map((block) => {
          const widthPct = (block.laneSpan / block.totalLanes) * 100;
          const leftPct = ((block.lane - 1) / block.totalLanes) * 100;
          const person = peopleById.get(block.personId);
          const color = person?.color ?? fallbackColorForProfile(block.personId);
          const isPast = isBlockPast(block.date, block.endTime, todayStr, nowMin);

          if (block.kind === "school") {
            return (
              <SchoolBlock
                key={`school-${block.entryId}-${block.date}-${block.personId}`}
                block={block}
                color={color}
                leftPct={leftPct}
                widthPct={widthPct}
                isPast={isPast}
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
          // Both canceled and moved-away render as ghost outlines -
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
                backgroundColor: isGhost
                  ? "transparent"
                  : `color-mix(in srgb, ${color} 16%, var(--card))`,
                borderLeftColor: color,
              }}
              className={cn(
                "absolute overflow-hidden rounded-md border border-transparent",
                // Ghost variants: dashed 1px gray frame on top/right/bottom
                // + thinner 2px left accent (color still applied via inline
                // style.borderLeftColor). Reads as "this slot is reserved
                // but not active" without dominating the column.
                isGhost
                  ? "border-l-2 border-dashed border-border text-muted-foreground"
                  : "border-l-[3px]",
                "px-1.5 py-0.5 text-left text-[10px] leading-tight",
                "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "transition-[filter]",
                // Elapsed blocks fade out (à la Google Calendar) so the
                // week reads at a glance; ghosts are already muted, so
                // they keep a lighter touch when still upcoming.
                isPast ? "opacity-60" : isGhost ? "opacity-70" : null,
              )}
              aria-label={activity ? `${activity.name} - ${block.startTime}` : "Aktivnost"}
              title={
                isCanceled
                  ? `Otkazano · ranije ${block.override?.originalStartTime}-${block.override?.originalEndTime}`
                  : isMovedAway
                    ? `Pomereno na ${block.override?.movedTo} ${block.override?.rescheduledStartTime}-${block.override?.rescheduledEndTime}`
                    : isMovedHere
                      ? `Pomereno sa ${block.override?.movedFrom} ${block.override?.originalStartTime}-${block.override?.originalEndTime}`
                      : isSameDayReschedule
                        ? `Pomereno · ranije ${block.override?.originalStartTime}-${block.override?.originalEndTime}`
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
                    className="rounded-sm px-1 text-[8px] font-normal uppercase"
                    style={{ backgroundColor: "var(--warn)", color: "white" }}
                    title="Pomereno"
                  >
                    ↻
                  </span>
                ) : null}
                {isMovedAway ? (
                  <span
                    className="rounded-sm px-1 text-[8px] font-normal uppercase"
                    style={{ backgroundColor: "var(--warn)", color: "white" }}
                    title="Pomereno u drugi dan"
                  >
                    ↗
                  </span>
                ) : null}
                {isMovedHere ? (
                  <span
                    className="rounded-sm px-1 text-[8px] font-normal uppercase"
                    style={{ backgroundColor: "var(--warn)", color: "white" }}
                    title="Premešten sa drugog dana"
                  >
                    ↘
                  </span>
                ) : null}
                {isCanceled ? (
                  <span
                    className="rounded-sm px-1 text-[8px] font-normal uppercase"
                    style={{ backgroundColor: "var(--neg)", color: "white" }}
                  >
                    ✕
                  </span>
                ) : null}
                {block.weekPattern !== "every" ? (
                  <span
                    className="rounded-sm px-1 text-[8px] font-normal uppercase"
                    style={{ backgroundColor: color, color: "white" }}
                  >
                    {block.weekPattern}
                  </span>
                ) : null}
                {block.recurrenceIntervalWeeks > 1 ? (
                  <span
                    className="rounded-sm px-1 text-[8px] font-normal tabular-nums"
                    style={{ backgroundColor: color, color: "white" }}
                    title={`Svake ${block.recurrenceIntervalWeeks} nedelje`}
                  >
                    ×{block.recurrenceIntervalWeeks}
                  </span>
                ) : null}
              </div>
              <div
                className={cn(
                  "truncate text-[11px] font-semibold",
                  isCanceled
                    ? "text-muted-foreground line-through"
                    : isMovedAway
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                {activity?.name ?? "Aktivnost"}
              </div>
            </button>
          );
        })
      }
    />
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
  isPast,
  onClick,
}: {
  block: { kind: "school" } & ResolvedSchoolBlock & { topPx: number; heightPx: number };
  color: string;
  leftPct: number;
  widthPct: number;
  isPast: boolean;
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
        backgroundColor: `color-mix(in srgb, ${color} 10%, var(--card))`,
        borderLeftColor: color,
      }}
      className={cn(
        // Solid (not dashed - dashed is reserved for canceled/ghost activity
        // blocks) but lighter and thinner than an activity: faint fill + 2px
        // colored left accent so a full school day reads as quiet background.
        "absolute overflow-hidden rounded-md border border-l-2 border-border",
        "px-1.5 py-0.5 text-left text-[10px] leading-tight text-foreground",
        "hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-[filter]",
        // Faded once the class has ended, matching past activity blocks.
        isPast && "opacity-60",
      )}
      aria-label={`${block.subject} - ${block.startTime}`}
      title={`${block.subject} · ${block.startTime}-${block.endTime}`}
    >
      <div className="flex items-center gap-1 text-muted-foreground">
        <BookOpenIcon className="h-2.5 w-2.5 shrink-0" />
        <span className="tabular-nums">{block.startTime}</span>
      </div>
      <div className="truncate text-[11px] font-semibold text-foreground">{block.subject}</div>
    </button>
  );
}
