import { format, isAfter, isBefore, parseISO } from "date-fns";
import type { Event } from "../types/database";

import { addDays, daysBetween, formatDate, formatTime, parseDate, startOfToday } from "./date";
import { serbianPlural } from "./plural";

/**
 * Span helpers for (possibly multi-day) events. `end_date` is the inclusive
 * last day, NULL for single-day events; times sit on the span edges
 * (start_time = first day, end_time = last day). See the column comment in
 * types/database.ts. Pick-typed so partial selects (e.g. global search rows)
 * can use them too.
 */
type EventSpan = Pick<Event, "date" | "end_date">;
type EventSchedule = EventSpan & Pick<Event, "start_time" | "end_time">;

/** Inclusive last day of the event - `date` itself for single-day events. */
export function eventLastDay(event: EventSpan): string {
  // Defensive `>` guard: the DB CHECK forbids end_date <= date, but a bad row
  // must degrade to single-day, not to an empty/negative span.
  return event.end_date && event.end_date > event.date ? event.end_date : event.date;
}

export function isMultiDayEvent(event: EventSpan): boolean {
  return eventLastDay(event) !== event.date;
}

/** Total span length in days - 1 for single-day events. */
export function eventSpanDays(event: EventSpan): number {
  return daysBetween(parseDate(event.date), parseDate(eventLastDay(event))) + 1;
}

/** Paucal-correct span length for labels (Serbian day agreement). */
export function eventDurationLabel(event: EventSpan): string {
  const days = eventSpanDays(event);
  return `${days} ${serbianPlural(days, { one: "dan", few: "dana", many: "dana" })}`;
}

/** Multi-day event whose span covers `today` - the "U toku" state. */
export function isEventOngoing(event: EventSpan, today: string): boolean {
  return isMultiDayEvent(event) && event.date <= today && today <= eventLastDay(event);
}

/**
 * One calendar day's slice of an event - what the agenda shows on that day.
 * Only the first day carries `startTime` and only the last day `endTime`, so
 * middle days come out as whole-day continuations - the same shape the gcal
 * sync produces for multi-day Google events (one all-day row per day, see
 * supabase/functions/_shared/expandEvent.ts), except the native slice keeps
 * the end time on the last day instead of dropping it.
 */
export type EventDaySlice = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** 1-based position within the span (1/1 for single-day events). */
  dayIndex: number;
  totalDays: number;
};

/** Expand an event into per-day slices, clamped to the `[from, to]` window. */
export function eventDaySlices(event: EventSchedule, from: string, to: string): EventDaySlice[] {
  const first = event.date;
  const last = eventLastDay(event);
  if (last < from || first > to) return [];
  const firstDate = parseDate(first);
  const totalDays = daysBetween(firstDate, parseDate(last)) + 1;
  const startIndex = first < from ? daysBetween(firstDate, parseDate(from)) : 0;
  const endIndex = last > to ? daysBetween(firstDate, parseDate(to)) : totalDays - 1;
  const out: EventDaySlice[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    out.push({
      date: i === 0 ? first : format(addDays(firstDate, i), "yyyy-MM-dd"),
      startTime: i === 0 ? event.start_time : null,
      endTime: i === totalDays - 1 ? event.end_time : null,
      dayIndex: i + 1,
      totalDays,
    });
  }
  return out;
}

/**
 * New `end_date` for a reschedule that moves the whole span so it starts on
 * `newDate`, keeping its length. NULL for single-day events.
 */
export function shiftedEventEndDate(event: EventSpan, newDate: string): string | null {
  if (!isMultiDayEvent(event)) return null;
  const span = daysBetween(parseDate(event.date), parseDate(eventLastDay(event)));
  return format(addDays(parseDate(newDate), span), "yyyy-MM-dd");
}

/** True if event has already ended (past its last day, or its last day today after end time / end of day for all-day). */
export function isEventEnded(event: EventSpan & Pick<Event, "end_time">): boolean {
  const now = new Date();
  const todayStart = startOfToday();
  const lastDay = eventLastDay(event);
  const lastDayStart = parseDate(lastDay);
  if (isBefore(lastDayStart, todayStart)) return true;
  if (isAfter(lastDayStart, todayStart)) return false;
  // Last day is today: compare with end time, or end of day for all-day / start-only
  const end = event.end_time ?? "23:59";
  const endDateTime = parseISO(lastDay + "T" + (end.length === 5 ? end + ":00" : end));
  return now >= endDateTime;
}

/** "05.08." - short day label used inside multi-day range strings. */
function formatShortDay(dateStr: string): string {
  return format(parseDate(dateStr), "dd.MM.");
}

/**
 * Date (range) label: "05.08.2026" for single-day, "05.08. - 07.08.2026" for
 * multi-day (both years spelled out when the span crosses a year boundary).
 */
export function formatEventDateRange(event: EventSpan): string {
  if (!isMultiDayEvent(event)) return formatDate(event.date);
  const lastDay = eventLastDay(event);
  const sameYear = event.date.slice(0, 4) === lastDay.slice(0, 4);
  const startLabel = sameYear ? formatShortDay(event.date) : formatDate(event.date);
  return `${startLabel} - ${formatDate(lastDay)}`;
}

/**
 * Format event time for display.
 *
 * Single-day: "Ceo dan" | "HH:mm" | "do HH:mm" | "HH:mm - HH:mm".
 * Multi-day: times sit on the span edges, so they carry their short dates -
 * "od 05.08. 09:00" | "do 07.08. 15:00" | "05.08. 09:00 - 07.08. 15:00" |
 * "Ceo dan" when the span has no times at all.
 */
export function formatEventTimeRange(event: EventSchedule): string {
  const hasStart = event.start_time?.trim();
  const hasEnd = event.end_time?.trim();
  if (!hasStart && !hasEnd) return "Ceo dan";
  if (isMultiDayEvent(event)) {
    const startDay = formatShortDay(event.date);
    const endDay = formatShortDay(eventLastDay(event));
    if (hasStart && !hasEnd) return `od ${startDay} ${formatTime(event.start_time!)}`;
    if (!hasStart && hasEnd) return `do ${endDay} ${formatTime(event.end_time!)}`;
    return `${startDay} ${formatTime(event.start_time!)} - ${endDay} ${formatTime(event.end_time!)}`;
  }
  if (hasStart && !hasEnd) return formatTime(event.start_time!);
  if (!hasStart && hasEnd) return `do ${formatTime(event.end_time!)}`;
  return `${formatTime(event.start_time!)} - ${formatTime(event.end_time!)}`;
}
