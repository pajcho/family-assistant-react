import { differenceInCalendarDays, parseISO } from "date-fns";

import { DAY_LABELS_FULL } from "@/utils/activity";

/**
 * Serbian copy helpers for the kid shell - pure, so they can be unit tested
 * without a DOM.
 *
 * Two ideas run through all of it:
 *   • a child reads a COUNTDOWN better than a date ("za 9 dana", not
 *     "14.10.2026"), so dates are always paired with, or replaced by, one;
 *   • Serbian pluralisation is not English pluralisation - "1 dan", "2 dana",
 *     "5 dana", "21 dan" - and getting it wrong is exactly the sort of thing
 *     that makes an app feel machine-written.
 */

const MONTHS_LONG: readonly string[] = [
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
];

const MONTHS_SHORT: readonly string[] = [
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
];

/** Parse a `YYYY-MM-DD` at local noon, so no timezone can shift the day. */
function atNoon(dateISO: string): Date {
  return parseISO(dateISO + "T12:00:00");
}

/**
 * Serbian plural picker: 1 / 2-4 / 5+ , with the 11-14 exception.
 * `pluralSr(21, "dan", "dana", "dana")` → "dan".
 */
export function pluralSr(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = abs % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function daysWord(n: number): string {
  return pluralSr(n, "dan", "dana", "dana");
}

export function classesWord(n: number): string {
  return pluralSr(n, "čas", "časa", "časova");
}

function attemptsWord(n: number): string {
  return pluralSr(n, "pokušaj", "pokušaja", "pokušaja");
}

/** Whole calendar days from `fromISO` to `toISO` (negative = in the past). */
export function daysBetween(fromISO: string, toISO: string): number {
  return differenceInCalendarDays(atNoon(toISO), atNoon(fromISO));
}

/** Monday-first weekday name, lowercase: "ponedeljak". */
export function weekdayName(dateISO: string): string {
  const jsDay = atNoon(dateISO).getDay();
  return DAY_LABELS_FULL[(jsDay + 6) % 7].toLowerCase();
}

/**
 * Genitive weekday, the case "sa" wants: "pomereno sa srede".
 * A table, not a rule - the forms are irregular enough that deriving them would
 * only produce plausible-looking mistakes (same reasoning as `repeatLine`).
 */
const DAY_GENITIVE: readonly string[] = [
  "ponedeljka",
  "utorka",
  "srede",
  "četvrtka",
  "petka",
  "subote",
  "nedelje",
];

export function weekdayGenitive(dateISO: string): string {
  const jsDay = atNoon(dateISO).getDay();
  return DAY_GENITIVE[(jsDay + 6) % 7];
}

/** "ponedeljak, 5. oktobar" - the date line under the greeting. */
export function formatKidLongDate(dateISO: string): string {
  const date = atNoon(dateISO);
  return `${weekdayName(dateISO)}, ${date.getDate()}. ${MONTHS_LONG[date.getMonth()]}`;
}

/** "5. okt" - compact, for day headings and card meta lines. */
export function formatKidShortDate(dateISO: string): string {
  const date = atNoon(dateISO);
  return `${date.getDate()}. ${MONTHS_SHORT[date.getMonth()]}`;
}

/**
 * How far away something is, in a child's words. Anything from three days out
 * becomes a plain countdown - that is the whole point of the format.
 */
export function countdownLabel(days: number): string {
  if (days < 0) return "prošlo";
  if (days === 0) return "danas";
  if (days === 1) return "sutra";
  if (days === 2) return "prekosutra";
  return `za ${days} ${daysWord(days)}`;
}

/**
 * A day heading in "Uskoro": "Sutra · utorak 6. okt", then plain weekday +
 * date, with a countdown chip once the day is far enough away for the date
 * alone to stop meaning anything.
 */
export interface KidDayHeading {
  title: string;
  /** Countdown chip, or null when the title already says it (danas / sutra). */
  chip: string | null;
}

export function kidDayHeading(dateISO: string, todayISO: string): KidDayHeading {
  const days = daysBetween(todayISO, dateISO);
  const weekday = weekdayName(dateISO);
  const short = formatKidShortDate(dateISO);
  if (days === 0) return { title: `Danas · ${weekday} ${short}`, chip: null };
  if (days === 1) return { title: `Sutra · ${weekday} ${short}`, chip: null };
  const title = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${short}`;
  return { title, chip: days >= 3 ? countdownLabel(days) : null };
}

/** Lockout wording: "za 14 minuta", "za 40 sekundi". */
export function formatLockCountdown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  if (safe >= 60) {
    const minutes = Math.ceil(safe / 60);
    return `za ${minutes} ${pluralSr(minutes, "minut", "minuta", "minuta")}`;
  }
  return `za ${safe} ${pluralSr(safe, "sekundu", "sekunde", "sekundi")}`;
}

/** "Imaš još 3 pokušaja." - only shown when the server tells us how many. */
export function attemptsLeftLine(attemptsLeft: number): string {
  if (attemptsLeft <= 0) return "Nema više pokušaja.";
  return `Imaš još ${attemptsLeft} ${attemptsWord(attemptsLeft)}.`;
}
