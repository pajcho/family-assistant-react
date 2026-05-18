import {
  parseISO,
  startOfDay,
  differenceInYears,
  differenceInDays,
  getMonth,
  getDate,
  isBefore,
} from "date-fns";
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
