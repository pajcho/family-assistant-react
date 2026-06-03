import {
  addDays,
  addMonths,
  subMonths,
  startOfDay,
  parseISO,
  format,
  formatDistanceToNow,
  isBefore,
  isAfter,
  isValid,
  lastDayOfMonth,
  getDate,
  differenceInDays,
  type Locale,
} from "date-fns";
import { srLatn } from "date-fns/locale";

/**
 * Serbian (Latin) locale for date-fns. The app is fully Latin-script —
 * the default `sr` import renders relative phrases like "pre 1 dan" in
 * Cyrillic, which doesn't match the rest of the UI.
 */
export const srLocale: Locale = srLatn;

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

/**
 * Add `count` months. Day is capped to the last day of the target month
 * (e.g. Jan 31 + 1m → Feb 28). `count` defaults to 1 so existing
 * `addMonth(date)` callers keep working without passing a step.
 */
export function addMonth(dateStr: string, count = 1): string {
  const date = parseISO(dateStr + "T12:00:00");
  const next = addMonths(date, count);
  const day = getDate(date);
  const lastDay = getDate(lastDayOfMonth(next));
  const safeDay = Math.min(day, lastDay);
  next.setDate(safeDay);
  return format(next, "yyyy-MM-dd");
}

/** Subtract `count` months. Day is capped to the last day of the target month. */
export function subtractMonth(dateStr: string, count = 1): string {
  const date = parseISO(dateStr + "T12:00:00");
  const prev = subMonths(date, count);
  const day = getDate(date);
  const lastDay = getDate(lastDayOfMonth(prev));
  const safeDay = Math.min(day, lastDay);
  prev.setDate(safeDay);
  return format(prev, "yyyy-MM-dd");
}

/** Add `count` weeks (count * 7 days). No day-capping needed — week arithmetic never overflows a month. */
export function addWeek(dateStr: string, count = 1): string {
  const date = parseISO(dateStr + "T12:00:00");
  const next = addDays(date, 7 * count);
  return format(next, "yyyy-MM-dd");
}

/** Subtract `count` weeks. */
export function subtractWeek(dateStr: string, count = 1): string {
  const date = parseISO(dateStr + "T12:00:00");
  const prev = addDays(date, -7 * count);
  return format(prev, "yyyy-MM-dd");
}

/** Subtract `count` days. */
export function subtractDay(dateStr: string, count = 1): string {
  const date = parseISO(dateStr + "T12:00:00");
  const prev = addDays(date, -count);
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

/**
 * True if a monthly payment with `recurrence_interval = interval` fires inside
 * `monthYYYYMM`. The first occurrence is the due-date month itself; subsequent
 * ones land every `interval` months after. Used to suppress upcoming rows in
 * "off" months when interval > 1 (e.g. quarterly payment in Apr → no upcoming
 * row in May/Jun, only in Jul).
 */
export function isMonthlyOccurrenceMonth(
  dueDateStr: string,
  monthYYYYMM: string,
  interval: number,
): boolean {
  const safeInterval = Math.max(1, Math.floor(interval));
  const [dueYear, dueMonthNum] = dueDateStr.slice(0, 7).split("-").map(Number);
  const [selYear, selMonthNum] = monthYYYYMM.split("-").map(Number);
  const diff = (selYear - dueYear) * 12 + (selMonthNum - dueMonthNum);
  if (diff < 0) return false;
  return diff % safeInterval === 0;
}

/**
 * Enumerate the weekly occurrences of a payment that fall inside `monthYYYYMM`.
 * A weekly payment with interval `N` has occurrences at `dueDate`, `dueDate + 7N`,
 * `dueDate + 14N`, … — we walk forward (or backward when the requested month
 * is in the past relative to the due date) and collect the ones that match.
 *
 * Used by the payments page to generate upcoming rows for each occurrence in
 * the selected month, and by the per-month summary to total unpaid amounts.
 */
export function getWeeklyOccurrencesInMonth(
  dueDateStr: string,
  monthYYYYMM: string,
  interval: number,
): string[] {
  const safeInterval = Math.max(1, Math.floor(interval));
  const [year, month] = monthYYYYMM.split("-").map(Number);
  const monthStart = `${monthYYYYMM}-01`;
  const lastDay = getDate(lastDayOfMonth(new Date(year, month - 1, 1)));
  const monthEnd = `${monthYYYYMM}-${String(lastDay).padStart(2, "0")}`;

  let current = dueDateStr;
  // If due date is past the requested month, rewind until we're at or before
  // the month start. Bounded — `safeInterval >= 1` guarantees progress.
  while (current > monthEnd) {
    current = subtractWeek(current, safeInterval);
  }
  // Then fast-forward into the month.
  while (current < monthStart) {
    current = addWeek(current, safeInterval);
  }

  const results: string[] = [];
  while (current <= monthEnd) {
    results.push(current);
    current = addWeek(current, safeInterval);
  }
  return results;
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

/**
 * Serbian-Latin relative phrasing for a due date (YYYY-MM-DD), relative to
 * today: overdue → "kasni N dana", today → "danas", tomorrow → "sutra",
 * future → "za N dana". Used as the payment-row subtitle so a freshly-paid
 * recurring payment (whose next occurrence lands inside the window) reads as
 * a future item, not an unpaid one.
 */
export function dueDayLabel(dueDateStr: string): string {
  const diff = daysFromToday(dueDateStr);
  if (diff === 0) return "danas";
  if (diff === 1) return "sutra";
  if (diff > 1) return `za ${diff} dana`;
  return diff === -1 ? "kasni 1 dan" : `kasni ${-diff} dana`;
}

/**
 * "pre 2 minuta" / "pre 1 sat" — Serbian-Latin relative phrasing for an
 * ISO timestamp. Used in audit / activity displays where the exact date
 * is less interesting than how recent it is.
 */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? parseISO(iso) : iso;
  if (!isValid(date)) return "—";
  return formatDistanceToNow(date, { locale: srLocale, addSuffix: true });
}

/**
 * DD.MM.YYYY HH:mm — full timestamp for audit panels and tooltips. Falls
 * back to "—" on parse failure so a single bad row can't blow up a render.
 */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? parseISO(iso) : iso;
  if (!isValid(date)) return "—";
  return format(date, "dd.MM.yyyy HH:mm", { locale: srLocale });
}
