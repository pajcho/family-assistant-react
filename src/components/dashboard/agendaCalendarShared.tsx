import { useEffect, useState } from "react";
import { BanknotesIcon, CakeIcon, CalendarIcon, GlobeAltIcon } from "@heroicons/react/24/outline";

import { Amount } from "@/components/common/Amount";
import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { AgendaItem } from "@/hooks/useAgenda";
import { fallbackColorForProfile, normalizeTime, timeToMinutes } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { isUpcomingPaymentOccurrence } from "@/utils/payment";
import { assignLanes, type Laned } from "@/utils/weekGridLayout";

/**
 * Shared kit for the agenda calendars - the single-day (Danas) column and the
 * weekly (Uskoro) timetable both lay AgendaItems onto a time axis the same way:
 * split off all-day items, lane the timed ones, position by start/end. Keeping
 * the math + the block/chip renderers here means both views stay visually in
 * lockstep. Mirrors the time geometry of the activities `WeekGrid`.
 */
export const SLOT_HEIGHT_PX = 40;
export const SLOT_MINUTES = 30;
export const DEFAULT_START_MIN = 7 * 60;
export const DEFAULT_END_MIN = 21 * 60;
export const GRID_TOP_PADDING_PX = 12;
export const GRID_BOTTOM_PADDING_PX = 12;
const MIN_BLOCK_HEIGHT_PX = 24;
/** Synthetic duration for a timed event with no end time. */
const DEFAULT_EVENT_MINUTES = 60;
/** The semantic "info" token - events and mirrored Google events share it. */
const EVENT_COLOR = "var(--info)";
const EXTERNAL_COLOR = "var(--info)";

export type TimeSpan = { startTime: string; endTime: string };
export type TimedEntry = TimeSpan & { item: AgendaItem };
export type Positioned<T> = Laned<T> & { topPx: number; heightPx: number };
export type PositionedEntry = Positioned<TimedEntry>;

export function isAllDayItem(item: AgendaItem): boolean {
  switch (item.kind) {
    case "activity":
      return false;
    case "event":
    case "external":
      return item.isAllDay;
    case "payment":
    case "birthday":
      return true;
  }
}

export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, min));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Start/end for a timed item, or null if it belongs in the all-day row. */
export function timedRange(item: AgendaItem): { startTime: string; endTime: string } | null {
  if (item.kind === "activity") {
    return { startTime: item.block.startTime, endTime: item.block.endTime };
  }
  if (item.kind === "event" && !item.isAllDay && item.startTime) {
    // Per-day slice times (a multi-day span keeps its end time on the LAST
    // day, so day 1 is open-ended here and gets the synthetic hour).
    return {
      startTime: item.startTime,
      endTime: item.endTime ?? minutesToTime(timeToMinutes(item.startTime) + DEFAULT_EVENT_MINUTES),
    };
  }
  if (item.kind === "external" && !item.isAllDay && item.event.start_time) {
    const startTime = normalizeTime(item.event.start_time);
    const endTime = item.event.end_time
      ? normalizeTime(item.event.end_time)
      : minutesToTime(timeToMinutes(startTime) + DEFAULT_EVENT_MINUTES);
    return { startTime, endTime };
  }
  return null;
}

/** Partition a day's items into the all-day row vs the timed grid. */
export function splitAgendaItems(items: ReadonlyArray<AgendaItem>): {
  allDayItems: AgendaItem[];
  timedEntries: TimedEntry[];
} {
  const allDayItems: AgendaItem[] = [];
  const timedEntries: TimedEntry[] = [];
  for (const item of items) {
    if (isAllDayItem(item)) {
      allDayItems.push(item);
      continue;
    }
    const range = timedRange(item);
    if (range) timedEntries.push({ ...range, item });
    else allDayItems.push(item);
  }
  return { allDayItems, timedEntries };
}

/** Fit-to-content hour window (±1h, default 7-21 when empty), half-hour aligned. */
export function computeRange(entries: ReadonlyArray<TimeSpan>): {
  startMin: number;
  endMin: number;
} {
  if (entries.length === 0) return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };
  let earliest = Infinity;
  let latest = -Infinity;
  for (const e of entries) {
    earliest = Math.min(earliest, timeToMinutes(e.startTime));
    latest = Math.max(latest, timeToMinutes(e.endTime));
  }
  return {
    startMin: Math.floor(Math.max(0, earliest - 60) / SLOT_MINUTES) * SLOT_MINUTES,
    endMin: Math.ceil(Math.min(24 * 60, latest + 60) / SLOT_MINUTES) * SLOT_MINUTES,
  };
}

/**
 * Widen a fit-to-content range so the current time is always inside it (with a
 * half-hour of breathing room each side, half-hour aligned, clamped to the day).
 * Used by the calendars showing "today" so the red "now" line is never clipped
 * out just because the day's items all sit in the afternoon - the line (and the
 * auto-scroll-to-now) needs `now` to be in the visible axis to render.
 */
export function expandRangeToNow(
  range: { startMin: number; endMin: number },
  nowMin: number,
): { startMin: number; endMin: number } {
  return {
    startMin: Math.max(
      0,
      Math.min(range.startMin, Math.floor(nowMin / SLOT_MINUTES) * SLOT_MINUTES - SLOT_MINUTES),
    ),
    endMin: Math.min(
      24 * 60,
      Math.max(range.endMin, Math.ceil(nowMin / SLOT_MINUTES) * SLOT_MINUTES + SLOT_MINUTES),
    ),
  };
}

/**
 * Lane + position timed entries against a (possibly shared) start-of-axis.
 * Generic over the payload so the weekly grid can lane school classes into the
 * SAME sweep as agenda items - a class that overlaps a training then sits
 * beside it instead of under it.
 */
export function positionEntries<T extends TimeSpan>(
  entries: ReadonlyArray<T>,
  startMin: number,
): Positioned<T>[] {
  return assignLanes([...entries]).map((p) => ({
    ...p,
    topPx:
      GRID_TOP_PADDING_PX +
      ((timeToMinutes(p.startTime) - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
    heightPx: Math.max(
      ((timeToMinutes(p.endTime) - timeToMinutes(p.startTime)) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      MIN_BLOCK_HEIGHT_PX,
    ),
  }));
}

export function buildHourLabels(
  startMin: number,
  endMin: number,
): { topPx: number; label: string }[] {
  const out: { topPx: number; label: string }[] = [];
  for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) {
    out.push({
      topPx: GRID_TOP_PADDING_PX + ((h * 60 - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      label: `${String(h).padStart(2, "0")}:00`,
    });
  }
  return out;
}

export function gridHeightPx(startMin: number, endMin: number): number {
  return (
    ((endMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX +
    GRID_TOP_PADDING_PX +
    GRID_BOTTOM_PADDING_PX
  );
}

/** Re-render every minute so the "now" line tracks the clock, aligned to the
 *  minute boundary so it steps on the minute. */
export function useMinuteTick(): Date {
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
    // iOS freezes timers while the PWA is backgrounded, so on resume `now` -
    // and the date + red now-line derived from it - is stuck at the suspend
    // moment. Snap back to the real clock whenever the app returns to focus.
    const sync = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return now;
}

export function TimedBlock({
  block,
  todayStr,
  nowMin,
  onClick,
}: {
  block: PositionedEntry;
  /** Today as yyyy-MM-dd, for dimming elapsed blocks (à la Google Calendar). */
  todayStr: string;
  /** Minutes-since-midnight "now". */
  nowMin: number;
  onClick: () => void;
}) {
  const { item } = block;
  const widthPct = (block.laneSpan / block.totalLanes) * 100;
  const leftPct = ((block.lane - 1) / block.totalLanes) * 100;
  const isPast =
    item.date < todayStr || (item.date === todayStr && timeToMinutes(block.endTime) <= nowMin);

  let color: string;
  let label: string;
  if (item.kind === "activity") {
    color = item.person?.color ?? fallbackColorForProfile(item.block.personId);
    const personName = item.person
      ? getDisplayName({
          firstName: item.person.first_name,
          lastName: item.person.last_name,
          email: null,
        }) || "Bez imena"
      : "-";
    label = `${personName} · ${item.activity?.name ?? "Aktivnost"}`;
  } else if (item.kind === "external") {
    color = item.event.color ?? EXTERNAL_COLOR;
    label = item.event.title ?? "(bez naslova)";
  } else {
    color = EVENT_COLOR;
    label = item.kind === "event" ? item.event.name : "";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        top: `${block.topPx}px`,
        height: `${block.heightPx}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        // color-mix (not a hex alpha suffix) because `color` may be a CSS
        // variable from the token layer as well as a member's hex.
        backgroundColor: `color-mix(in srgb, ${color} 16%, var(--card))`,
        borderLeftColor: color,
      }}
      className={cn(
        "absolute overflow-hidden rounded-sm border border-l-[3px] border-transparent px-1 py-0.5 text-left sm:px-1.5",
        "hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "transition-[filter]",
        isPast && "opacity-60",
      )}
    >
      {/* The start/end line needs ~70px; a phone column has ~46. The block's
          position on the clock already says when it is, so below `sm` the
          label gets the whole block. */}
      <div className="hidden text-[9.5px] font-semibold tabular-nums text-muted-foreground sm:block">
        {block.startTime}-{block.endTime}
      </div>
      <div className="truncate text-[10px] font-bold text-foreground sm:text-[11px]">{label}</div>
    </button>
  );
}

/**
 * All-day chips fill the width of their (often narrow, in the weekly grid) cell
 * as small tinted cards. Tints mirror the Uskoro filter pills - payment amber,
 * event blue, birthday emerald - so the row reads by kind at a glance, and the
 * colored 3px left border echoes the timed blocks below.
 */
const ALL_DAY_CARD =
  "block w-full rounded-sm border border-l-[3px] px-2 py-1 text-left transition-colors " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const PAYMENT_TINT = "border-warn/30 border-l-warn bg-warn-soft hover:brightness-95";
const EVENT_TINT = "border-info/30 border-l-info bg-info-soft hover:brightness-95";
const BIRTHDAY_TINT = "border-pos/30 border-l-pos bg-pos-soft hover:brightness-95";

export function AllDayChip({ item, onClick }: { item: AgendaItem; onClick: () => void }) {
  if (item.kind === "payment") {
    // A future repetition (not the live due_date occurrence) → read-only + dimmed
    // + "Nadolazeće" tag (matches the list). The live occurrence stays tappable
    // even when due in the future.
    const upcoming = isUpcomingPaymentOccurrence(item);
    // Two rows so the narrow weekly columns stay readable: name on its own line
    // (up to two), then amount + tag + members underneath, aligned past the icon.
    const inner = (
      <>
        <div className="flex min-w-0 items-start gap-1.5">
          <BanknotesIcon className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <span className="hidden min-w-0 text-[11px] leading-snug font-bold text-foreground sm:line-clamp-2">
            {item.payment.name}
          </span>
        </div>
        {/* A phone's week column is ~46px wide - the tinted icon is all that
            fits, and tapping it opens the full detail anyway. */}
        <div className="mt-0.5 hidden flex-wrap items-center gap-x-1.5 gap-y-1 pl-5 sm:flex">
          <span className="text-[11px] font-extrabold tabular-nums text-warn">
            <Amount value={item.payment.amount} round />
          </span>
          {upcoming ? (
            <span className="rounded-full bg-warn/15 px-1.5 py-px text-[9px] font-extrabold tracking-wide text-warn uppercase">
              Nadolazeće
            </span>
          ) : null}
          {item.personIds.length > 0 ? <MemberBadges personIds={item.personIds} size="xs" /> : null}
        </div>
      </>
    );
    if (upcoming) {
      // Read-only future occurrence: keep the tint but cancel the hover-bg so it
      // doesn't read as tappable.
      return (
        <div
          className={cn(
            ALL_DAY_CARD,
            PAYMENT_TINT,
            "cursor-default opacity-60 hover:brightness-100",
          )}
        >
          {inner}
        </div>
      );
    }
    return (
      <button type="button" onClick={onClick} className={cn(ALL_DAY_CARD, PAYMENT_TINT)}>
        {inner}
      </button>
    );
  }

  if (item.kind === "birthday") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(ALL_DAY_CARD, BIRTHDAY_TINT, "flex items-center gap-1.5")}
      >
        <CakeIcon className="size-3.5 shrink-0 text-pos" />
        <span className="hidden min-w-0 truncate text-[11px] font-bold text-foreground sm:block">
          {item.birthday.name}
        </span>
      </button>
    );
  }

  if (item.kind === "external") {
    // Tint by the source calendar's color (inline, since it's dynamic) - same
    // bg/left-border treatment as the timed blocks.
    const color = item.event.color ?? EXTERNAL_COLOR;
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 14%, var(--card))`,
          borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
          borderLeftColor: color,
        }}
        className={cn(ALL_DAY_CARD, "flex items-center gap-1.5 hover:brightness-95")}
      >
        <GlobeAltIcon className="size-3.5 shrink-0" style={{ color }} />
        <span className="hidden min-w-0 truncate text-[11px] font-bold text-foreground sm:block">
          {item.event.title ?? "(bez naslova)"}
        </span>
        {item.personIds.length > 0 ? (
          <span className="hidden sm:block">
            <MemberBadges personIds={item.personIds} size="xs" />
          </span>
        ) : null}
      </button>
    );
  }

  // All-day event.
  if (item.kind === "event") {
    // Multi-day continuations annotate their place in the span: the last day
    // shows when it wraps up ("do 15:00"), the rest their position ("2/5").
    const suffix = item.endTime
      ? `do ${item.endTime}`
      : item.totalDays > 1
        ? `${item.dayIndex}/${item.totalDays}`
        : null;
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(ALL_DAY_CARD, EVENT_TINT, "flex items-center gap-1.5")}
      >
        <CalendarIcon className="size-3.5 shrink-0 text-info" />
        <span className="hidden min-w-0 truncate text-[11px] font-bold text-foreground sm:block">
          {item.event.name}
        </span>
        {suffix ? (
          <span className="hidden shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground sm:block">
            {suffix}
          </span>
        ) : null}
        {item.personIds.length > 0 ? (
          <span className="hidden sm:block">
            <MemberBadges personIds={item.personIds} size="xs" />
          </span>
        ) : null}
      </button>
    );
  }

  // Unreachable in practice (activities are never all-day) - minimal fallback.
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ALL_DAY_CARD, EVENT_TINT, "flex items-center gap-1.5")}
    >
      <CalendarIcon className="size-3.5 shrink-0 text-info" />
    </button>
  );
}
