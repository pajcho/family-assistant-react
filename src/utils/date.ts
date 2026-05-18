import {
  addDays,
  addMonths,
  subMonths,
  startOfDay,
  parseISO,
  format,
  isBefore,
  isAfter,
  isValid,
  lastDayOfMonth,
  getDate,
  differenceInDays,
  type Locale,
} from "date-fns";
import { sr } from "date-fns/locale";

/** Serbian locale for date-fns format. */
export const srLocale: Locale = sr;

/** Parse YYYY-MM-DD string to Date at start of day (local time). */
export function parseDate(dateStr: string): Date {
  return startOfDay(parseISO(dateStr));
}

/** Today at start of day. */
export function startOfToday(): Date {
  return startOfDay(new Date());
}

/** Re-export for callers that need to add days to a date. */
export { addDays };

/** True if due date (YYYY-MM-DD) is before today. */
export function isOverdue(dueDateStr: string): boolean {
  const due = parseDate(dueDateStr);
  const today = startOfToday();
  return isBefore(due, today);
}

/** True if due date is today or within the next N days (inclusive). */
export function isUpcoming(dueDateStr: string, withinDays: number): boolean {
  const due = parseDate(dueDateStr);
  const today = startOfToday();
  const end = addDays(today, withinDays);
  return !isBefore(due, today) && !isAfter(due, end);
}

/** True if date (YYYY-MM-DD) falls within [from, to] (inclusive, start-of-day). */
export function isDateInRange(dateStr: string, from: Date, to: Date): boolean {
  const date = parseDate(dateStr);
  const fromStart = startOfDay(from);
  const toEnd = startOfDay(to);
  return !isBefore(date, fromStart) && !isAfter(date, toEnd);
}

/** Add one month. Day is capped to last day of target month (e.g. Jan 31 → Feb 28). */
export function addMonth(dateStr: string): string {
  const date = parseISO(dateStr + "T12:00:00");
  const next = addMonths(date, 1);
  const day = getDate(date);
  const lastDay = getDate(lastDayOfMonth(next));
  const safeDay = Math.min(day, lastDay);
  next.setDate(safeDay);
  return format(next, "yyyy-MM-dd");
}

/** Subtract one month. Day is capped to last day of target month. */
export function subtractMonth(dateStr: string): string {
  const date = parseISO(dateStr + "T12:00:00");
  const prev = subMonths(date, 1);
  const day = getDate(date);
  const lastDay = getDate(lastDayOfMonth(prev));
  const safeDay = Math.min(day, lastDay);
  prev.setDate(safeDay);
  return format(prev, "yyyy-MM-dd");
}

/** Same calendar day in a given month (YYYY-MM). Day capped to last day of month. */
export function getDueDateInMonth(monthYYYYMM: string, dueDateStr: string): string {
  const [year, month] = monthYYYYMM.split("-").map(Number);
  const due = parseISO(dueDateStr + "T12:00:00");
  const day = getDate(due);
  const lastDay = getDate(lastDayOfMonth(new Date(year, month - 1, 1)));
  const safeDay = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

/** Current month as YYYY-MM. */
export function currentMonthYYYYMM(): string {
  return format(new Date(), "yyyy-MM");
}

/** For limited payments: list of YYYY-MM for the next `remaining` months starting from due date. */
export function getLimitedMonths(dueDateStr: string, remaining: number): string[] {
  const months: string[] = [];
  let currentMonthStr = dueDateStr;
  for (let i = 0; i < remaining; i++) {
    months.push(currentMonthStr.slice(0, 7));
    currentMonthStr = addMonth(currentMonthStr);
  }
  return months;
}

/** Same calendar day in current month (for unpausing when due_date is in the past). */
export function dueDateInCurrentMonth(pastDueDateStr: string): string {
  const due = parseISO(pastDueDateStr + "T12:00:00");
  const today = new Date();
  const day = getDate(due);
  const lastDay = getDate(lastDayOfMonth(today));
  const safeDay = Math.min(day, lastDay);
  return format(new Date(today.getFullYear(), today.getMonth(), safeDay), "yyyy-MM-dd");
}

/** Format date as DD.MM.YYYY (Serbian). Returns "—" for invalid input so a single bad row can't blow up a render. */
export function formatDate(date: Date | string): string {
  const dateObj = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(dateObj)) return "—";
  return format(dateObj, "dd.MM.yyyy", { locale: srLocale });
}

/** 24-hour time HH:mm */
export function formatTime(time: string): string {
  if (!time) return "";
  const [hoursPart, minutesPart] = time.split(":");
  return `${hoursPart.padStart(2, "0")}:${(minutesPart ?? "00").padStart(2, "0")}`;
}

/** Days from first date to second (can be negative). */
export function daysBetween(from: Date, to: Date): number {
  return differenceInDays(startOfDay(to), startOfDay(from));
}

/** Check if a date string is before today. */
export function isDateBeforeToday(dateStr: string): boolean {
  return isBefore(parseDate(dateStr), startOfToday());
}

/** Check if a date string is today or in the future. */
export function isDateTodayOrFuture(dateStr: string): boolean {
  return !isBefore(parseDate(dateStr), startOfToday());
}

/** Days from today to date (positive = future). */
export function daysFromToday(dateStr: string): number {
  return differenceInDays(parseDate(dateStr), startOfToday());
}
