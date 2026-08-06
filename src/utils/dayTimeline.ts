import type { AgendaItem } from "@/hooks/useAgenda";
import { normalizeTime, timeToMinutes } from "@/utils/activity";

/**
 * The pure half of Danas' timeline: how a day's agenda items split into the
 * three bands the screen renders (see components/dashboard/DayTimeline).
 *
 * Lives in utils, not next to the component, so it is testable without
 * dragging React and the data hooks (and therefore the Supabase client) into
 * the test run.
 */

/** An event with a start but no end gets this much room on the clock. */
const DEFAULT_EVENT_MINUTES = 60;

export interface TimelineEntry {
  item: AgendaItem;
  startTime: string;
  /** Null when the item has no meaningful end (start === end). */
  endTime: string | null;
  startMin: number;
  /** Already over at the reference minute - the row renders dimmed. */
  past: boolean;
}

export interface TimelineSplit {
  /** All-day and multi-day items - chips above the clock. */
  chips: AgendaItem[];
  /** Items with a real start time, ascending. */
  timed: TimelineEntry[];
  /** Due today but not tied to an hour - their own section at the bottom. */
  payments: AgendaItem[];
}

function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, min));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/**
 * Start/end for an item that belongs on the clock, or null for one that does
 * not. Mirrors the agenda calendars' `timedRange` so a day reads the same
 * whichever surface shows it.
 */
export function timelineRange(item: AgendaItem): { startTime: string; endTime: string } | null {
  if (item.kind === "activity") {
    return { startTime: item.block.startTime, endTime: item.block.endTime };
  }
  if (item.kind === "event" && !item.isAllDay && item.startTime) {
    // Per-day slice times: a multi-day span keeps its end on the LAST day, so
    // day 1 is open-ended here and gets the synthetic hour.
    return {
      startTime: item.startTime,
      endTime: item.endTime ?? minutesToTime(timeToMinutes(item.startTime) + DEFAULT_EVENT_MINUTES),
    };
  }
  if (item.kind === "external" && !item.isAllDay && item.event.start_time) {
    const startTime = normalizeTime(item.event.start_time);
    return {
      startTime,
      endTime: item.event.end_time
        ? normalizeTime(item.event.end_time)
        : minutesToTime(timeToMinutes(startTime) + DEFAULT_EVENT_MINUTES),
    };
  }
  return null;
}

/**
 * Split a day's items into chips / timed rows / payments.
 *
 * Payments come out even when they carry a time: a due date is a deadline, not
 * an appointment, and putting one at "00:00" between two real events reads as
 * a scheduling claim the app can't back up.
 *
 * `nowMinutes` is passed in rather than read from the clock so the split is a
 * pure function of its inputs.
 */
export function splitDayTimeline(
  items: ReadonlyArray<AgendaItem>,
  nowMinutes: number,
): TimelineSplit {
  const chips: AgendaItem[] = [];
  const timed: TimelineEntry[] = [];
  const payments: AgendaItem[] = [];

  for (const item of items) {
    if (item.kind === "payment") {
      payments.push(item);
      continue;
    }
    const range = timelineRange(item);
    if (!range) {
      chips.push(item);
      continue;
    }
    timed.push({
      item,
      startTime: range.startTime,
      endTime: range.endTime === range.startTime ? null : range.endTime,
      startMin: timeToMinutes(range.startTime),
      past: timeToMinutes(range.endTime) <= nowMinutes,
    });
  }

  timed.sort((a, b) => a.startMin - b.startMin);
  return { chips, timed, payments };
}

/**
 * Index of the row the "Sada" line goes above, or -1 for no line.
 *
 * The line only earns its place when it separates something: with the whole
 * day still ahead there is nothing above it, and with the day already over a
 * line under the last row reads as an error rather than as "now".
 */
export function nowLineIndex(timed: ReadonlyArray<TimelineEntry>, nowMinutes: number): number {
  const next = timed.findIndex((entry) => entry.startMin >= nowMinutes);
  return next > 0 ? next : -1;
}
