import {
  parseISO,
  startOfDay,
  differenceInYears,
  differenceInDays,
  getMonth,
  getDate,
  isBefore,
  lastDayOfMonth,
  format,
} from "date-fns";
import type { Birthday } from "@/types/database";
import { startOfToday } from "./date";

/** Current age from birth_date (YYYY-MM-DD). */
export function currentAge(birthDate: string): number {
  const today = startOfToday();
  const birth = startOfDay(parseISO(birthDate));
  return differenceInYears(today, birth);
}

/** Next birthday date (this year or next). */
export function nextBirthdayDate(birthDate: string): Date {
  const today = startOfToday();
  const birth = parseISO(birthDate);
  const month = getMonth(birth);
  const day = getDate(birth);
  let next = startOfDay(new Date(today.getFullYear(), month, day));
  if (isBefore(next, today)) {
    next = startOfDay(new Date(today.getFullYear() + 1, month, day));
  }
  return next;
}

/** Days until next birthday. */
export function daysUntilBirthday(birthDate: string): number {
  const today = startOfToday();
  const next = nextBirthdayDate(birthDate);
  return differenceInDays(next, today);
}

/**
 * Project a birthday's (month, day) into every year spanned by `[from, to]`
 * (inclusive, YYYY-MM-DD), returning the dates that land inside the range.
 * Feb-29 is clamped to Feb-28 in non-leap years so the birthday still surfaces.
 * Pure - the unified `useAgenda` layer enumerates birthdays across a range with
 * this.
 */
export function expandBirthdayOccurrences(
  birthday: Pick<Birthday, "birth_date">,
  from: string,
  to: string,
): { date: string }[] {
  const birth = parseISO(birthday.birth_date);
  const month = getMonth(birth); // 0..11
  const day = getDate(birth); // 1..31
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  const out: { date: string }[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    // Clamp to the last day of the target month (Feb-29 → Feb-28 off leap years).
    const lastDay = getDate(lastDayOfMonth(new Date(year, month, 1)));
    const safeDay = Math.min(day, lastDay);
    const date = format(new Date(year, month, safeDay), "yyyy-MM-dd");
    if (date >= from && date <= to) out.push({ date });
  }
  return out;
}
