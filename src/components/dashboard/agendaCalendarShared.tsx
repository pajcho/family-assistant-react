import { useEffect, useState } from "react";
import { BanknotesIcon, CakeIcon, CalendarIcon } from "@heroicons/react/24/outline";

import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { AgendaItem } from "@/hooks/useAgenda";
import { fallbackColorForProfile, normalizeTime, timeToMinutes } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { assignLanes, type Laned } from "@/utils/weekGridLayout";

/**
 * Shared kit for the agenda calendars — the single-day (Danas) column and the
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
/** blue-500 — matches the event row icon / list accent. */
const EVENT_COLOR = "#3b82f6";

export type TimedEntry = { startTime: string; endTime: string; item: AgendaItem };
export type PositionedEntry = Laned<TimedEntry> & { topPx: number; heightPx: number };

export function isAllDayItem(item: AgendaItem): boolean {
  switch (item.kind) {
    case "activity":
      return false;
    case "event":
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
  if (item.kind === "event" && !item.isAllDay && item.event.start_time) {
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

/** Fit-to-content hour window (±1h, default 7–21 when empty), half-hour aligned. */
export function computeRange(entries: ReadonlyArray<TimedEntry>): {
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
 * out just because the day's items all sit in the afternoon — the line (and the
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

/** Lane + position timed entries against a (possibly shared) start-of-axis. */
export function positionEntries(
  entries: ReadonlyArray<TimedEntry>,
  startMin: number,
): PositionedEntry[] {
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
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
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
      : "—";
    label = `${personName} · ${item.activity?.name ?? "Aktivnost"}`;
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
        backgroundColor: `${color}1F`,
        borderLeftColor: color,
      }}
      className={cn(
        "absolute overflow-hidden rounded-md border border-l-4 border-transparent px-1.5 py-0.5 text-left",
        "hover:brightness-110 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
        "transition-[filter]",
        isPast && "opacity-60",
      )}
    >
      <div className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
        {block.startTime}–{block.endTime}
      </div>
      <div className="truncate text-[11px] font-medium text-gray-900 dark:text-gray-100">
        {label}
      </div>
    </button>
  );
}

export function AllDayChip({
  item,
  todayStr,
  onClick,
}: {
  item: AgendaItem;
  /** Today (yyyy-MM-dd). A payment dated after it is "nadolazeće" — rendered
   *  read-only and dimmed here too, mirroring the agenda list. */
  todayStr: string;
  onClick: () => void;
}) {
  const base =
    "inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60";

  if (item.kind === "payment") {
    const amount = new Intl.NumberFormat("sr-Latn", { maximumFractionDigits: 0 }).format(
      item.payment.amount,
    );
    // Not yet due → read-only + dimmed + "Nadolazeće" tag (matches the list).
    const upcoming = item.date > todayStr;
    const inner = (
      <>
        <BanknotesIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
        <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
          {item.payment.name}
        </span>
        <span className="shrink-0 text-gray-500 dark:text-gray-400">{amount} RSD</span>
        {upcoming ? (
          <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] font-medium tracking-wide text-gray-500 uppercase dark:bg-gray-700 dark:text-gray-400">
            Nadolazeće
          </span>
        ) : null}
        {item.personIds.length > 0 ? <MemberBadges personIds={item.personIds} size="xs" /> : null}
      </>
    );
    if (upcoming) {
      return (
        <span
          className={cn(base, "cursor-default opacity-60 hover:bg-white dark:hover:bg-gray-800")}
        >
          {inner}
        </span>
      );
    }
    return (
      <button type="button" onClick={onClick} className={base}>
        {inner}
      </button>
    );
  }

  if (item.kind === "birthday") {
    return (
      <button type="button" onClick={onClick} className={base}>
        <CakeIcon className="size-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
        <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
          {item.birthday.name}
        </span>
      </button>
    );
  }

  // All-day event.
  return (
    <button type="button" onClick={onClick} className={base}>
      <CalendarIcon className="size-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
      <span className="truncate font-medium text-gray-900 dark:text-gray-100">
        {item.kind === "event" ? item.event.name : ""}
      </span>
      {item.kind === "event" && item.personIds.length > 0 ? (
        <MemberBadges personIds={item.personIds} size="xs" />
      ) : null}
    </button>
  );
}
