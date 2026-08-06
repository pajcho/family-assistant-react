/**
 * Pure helpers behind the redesigned date / time pickers (DateField,
 * TimeField, DurationChips). Deliberately dependency-free arithmetic on
 * `yyyy-MM-dd` and `HH:mm` strings: no Date objects cross the boundary, so a
 * sheet left open across a DST shift or a PWA suspend can't drift, and every
 * edge case (leap years, month ends, midnight wrap) is unit-testable.
 */

/** Serbian month names, nominative - used for the picker caption. */
export const MONTH_NAMES_SR = [
  "januar",
  "februar",
  "mart",
  "april",
  "maj",
  "jun",
  "jul",
  "avgust",
  "septembar",
  "oktobar",
  "novembar",
  "decembar",
] as const;

/** Short month labels for the month grid (year -> month drill step). */
export const MONTH_SHORT_SR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "avg",
  "sep",
  "okt",
  "nov",
  "dec",
] as const;

/** Weekday headers, Monday first (the app's week starts on Monday). */
export const WEEKDAY_SHORT_SR = ["pon", "uto", "sre", "čet", "pet", "sub", "ned"] as const;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Pad to two digits without pulling in a formatter. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in `month` (0-11) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 1) return isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 30;
}

/** Build a `yyyy-MM-dd` string from calendar parts (month is 0-11). */
export function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month + 1)}-${pad2(day)}`;
}

export type IsoParts = { year: number; month: number; day: number };

/** Parse `yyyy-MM-dd`; null when malformed or not a real calendar date. */
export function partsFromIso(iso: string | null | undefined): IsoParts | null {
  if (!iso) return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * Weekday index of the 1st of the month, Monday-first (0 = Monday).
 * Sakamoto's algorithm - avoids constructing a Date just to read a weekday.
 */
export function mondayFirstWeekday(year: number, month: number, day: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 2 ? year - 1 : year;
  // 0 = Sunday in Sakamoto's result; shift so Monday is 0.
  const sunFirst =
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month] + day) % 7;
  return (sunFirst + 6) % 7;
}

export type MonthGridCell = {
  iso: string;
  /** Day of month as displayed. */
  day: number;
  /** False for the leading/trailing days borrowed from the neighbouring month. */
  inMonth: boolean;
};

/**
 * Six-week (42 cell) Monday-first grid for `month` (0-11) of `year`,
 * including the neighbouring days that fill the first and last week. A fixed
 * cell count keeps the sheet from resizing as the member pages months.
 */
export function buildMonthGrid(year: number, month: number): MonthGridCell[] {
  const lead = mondayFirstWeekday(year, month, 1);
  const total = daysInMonth(year, month);
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevTotal = daysInMonth(prevYear, prevMonth);
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;

  const cells: MonthGridCell[] = [];
  for (let i = lead; i > 0; i -= 1) {
    const day = prevTotal - i + 1;
    cells.push({ iso: isoFromParts(prevYear, prevMonth, day), day, inMonth: false });
  }
  for (let day = 1; day <= total; day += 1) {
    cells.push({ iso: isoFromParts(year, month, day), day, inMonth: true });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ iso: isoFromParts(nextYear, nextMonth, nextDay), day: nextDay, inMonth: false });
    nextDay += 1;
  }
  return cells;
}

/** Step a (year, month) pair by whole months, rolling the year over. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * Same calendar day one month away, clamped to the target month's length
 * (31.01. + 1 month = 28./29.02., never 03.03.).
 */
export function shiftIsoByMonths(iso: string, delta: number): string | null {
  const parts = partsFromIso(iso);
  if (!parts) return null;
  const { year, month } = shiftMonth(parts.year, parts.month, delta);
  return isoFromParts(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

/** Add whole days to a `yyyy-MM-dd` string. */
export function shiftIsoByDays(iso: string, delta: number): string | null {
  const parts = partsFromIso(iso);
  if (!parts) return null;
  let { year, month, day } = parts;
  day += delta;
  while (day < 1) {
    const prev = shiftMonth(year, month, -1);
    year = prev.year;
    month = prev.month;
    day += daysInMonth(year, month);
  }
  for (;;) {
    const len = daysInMonth(year, month);
    if (day <= len) break;
    day -= len;
    const next = shiftMonth(year, month, 1);
    year = next.year;
    month = next.month;
  }
  return isoFromParts(year, month, day);
}

/**
 * Free-text date entry for the birth-date flow: "15.05.1985", "15.5.1985",
 * "15/05/1985", "15 05 1985" and the same shapes with a two-digit year.
 * Returns an ISO string or null - callers keep the raw text until it parses.
 * Two-digit years resolve inside the century window ending at `pivotYear`
 * (so "85" is 1985, not 2085).
 */
export function parseTypedDate(input: string, pivotYear = new Date().getFullYear()): string | null {
  const cleaned = input.trim();
  if (!cleaned) return null;
  const m = /^(\d{1,2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{2}|\d{4})\.?$/.exec(cleaned);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = Number(m[3]);
  if (m[3].length === 2) {
    const century = Math.floor(pivotYear / 100) * 100;
    year += century;
    if (year > pivotYear) year -= 100;
  }
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return isoFromParts(year, month, day);
}

/** ISO string comparison works lexicographically - spelled out for intent. */
export function isoBefore(a: string, b: string): boolean {
  return a < b;
}

/** Clamp an ISO date into an optional [min, max] window. */
export function clampIso(iso: string, min?: string | null, max?: string | null): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** Parse `HH:mm` into minutes since midnight; null when malformed. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = TIME_RE.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Format minutes since midnight back to `HH:mm`, wrapping past midnight. */
export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/**
 * Shift a `HH:mm` value by minutes (the duration chips' end-time math).
 * Wraps at midnight rather than clamping - a 23:30 start plus 90 minutes is
 * 01:00, which is what the member means.
 */
export function addMinutesToTime(time: string, minutes: number): string | null {
  const base = timeToMinutes(time);
  if (base == null) return null;
  return minutesToTime(base + minutes);
}

/** Minutes from `start` to `end`, treating an earlier end as crossing midnight. */
export function durationBetween(start: string, end: string): number | null {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 1440 - a;
}

/** "1h 30" / "45 min" - the duration chip label and the end-time hint. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}`;
}

/** Duration presets offered under the start/end time pair. */
export const DURATION_PRESETS: readonly number[] = [30, 45, 60, 90, 120];

/**
 * Hours offered as the primary grid. Everything outside 7-22 lives behind
 * "Ostali sati", so the common case stays a single tap.
 */
export const PRIMARY_HOURS: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
];

export const SECONDARY_HOURS: readonly number[] = [23, 0, 1, 2, 3, 4, 5, 6];

/** The four minute chips - :00 :15 :30 :45. */
export const MINUTE_STEPS = ["00", "15", "30", "45"] as const;
