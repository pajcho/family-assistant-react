import { addMonths, format, lastDayOfMonth, parseISO } from "date-fns";

/**
 * Pure budget helpers (NO React / Supabase) so the Budget page and its unit
 * tests share one implementation. Month strings are "YYYY-MM"; date strings are
 * "YYYY-MM-DD".
 */

const MONTH_NAMES_SR = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

/** Inclusive first/last calendar day of a "YYYY-MM" month. */
export function monthRange(month: string): { from: string; to: string } {
  const first = parseISO(`${month}-01T12:00:00`);
  const last = lastDayOfMonth(first);
  return { from: format(first, "yyyy-MM-dd"), to: format(last, "yyyy-MM-dd") };
}

/** Shift a "YYYY-MM" month by `delta` months (can be negative). */
export function shiftMonth(month: string, delta: number): string {
  const next = addMonths(parseISO(`${month}-01T12:00:00`), delta);
  return format(next, "yyyy-MM");
}

/** Human label for a "YYYY-MM" month, e.g. "Jul 2026". */
export function monthLabel(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const name = MONTH_NAMES_SR[(monthNum - 1) % 12] ?? month;
  return `${name} ${year}`;
}

/** The "YYYY-MM" a date string falls in. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}
