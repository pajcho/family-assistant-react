import { isAfter, isBefore, parseISO } from "date-fns";
import type { Event } from "../types/database";

import { formatTime, parseDate, startOfToday } from "./date";

/** True if event has already ended (past date, or today after end time / end of day for all-day). */
export function isEventEnded(event: Event): boolean {
  const now = new Date();
  const todayStart = startOfToday();
  const eventDateStart = parseDate(event.date);
  if (isBefore(eventDateStart, todayStart)) return true;
  if (isAfter(eventDateStart, todayStart)) return false;
  // Today: compare with end time, or end of day for all-day / start-only
  const end = event.end_time ?? "23:59";
  const endDateTime = parseISO(event.date + "T" + (end.length === 5 ? end + ":00" : end));
  return now >= endDateTime;
}

/** Format event time for display: "Ceo dan" | "HH:mm" | "do HH:mm" | "HH:mm - HH:mm". */
export function formatEventTimeRange(event: Event): string {
  const hasStart = event.start_time?.trim();
  const hasEnd = event.end_time?.trim();
  if (!hasStart && !hasEnd) return "Ceo dan";
  if (hasStart && !hasEnd) return formatTime(event.start_time!);
  if (!hasStart && hasEnd) return `do ${formatTime(event.end_time!)}`;
  return `${formatTime(event.start_time!)} - ${formatTime(event.end_time!)}`;
}
