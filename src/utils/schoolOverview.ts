import { addDays, format, parseISO } from "date-fns";

import type {
  BellSchedule,
  SchoolBreak,
  SchoolShift,
  SchoolShiftAnchor,
  TimetableVariant,
} from "@/types/database";
import { normalizeTime } from "./activity";
import {
  bandParams,
  breakCoversPerson,
  isDateInBreak,
  timeBandForWeek,
  variantForWeek,
} from "./schoolTimetable";

/**
 * Presentation-level derivations for the Škola screen.
 *
 * `schoolTimetable.ts` answers "which class happens when"; this answers the
 * questions the screen actually asks on top of that - is a class running right
 * now, when does this week start and end, what changes next week, and how far
 * off the next raspust is. Kept pure (no React, no Supabase) so the wording and
 * the edge cases around midnight, empty days and New Year wrapping can be
 * tested directly.
 */

/** "HH:MM[:SS]" → minutes since midnight. */
export function minutesOfTime(time: string): number {
  const [h, m] = normalizeTime(time).split(":").map(Number);
  return h * 60 + m;
}

/** Anything with a clock span - a resolved school block, or a bell slot. */
export interface TimeSpan {
  startTime: string;
  endTime: string;
}

export type SchoolPeriodState = "past" | "now" | "future";

/**
 * Where a class sits relative to the clock. `nowMinutes` is null for any day
 * that is not today, and then every class reads as "future" - another day's
 * column is a plan you are looking up, not a thing with a past.
 */
export function periodState(span: TimeSpan, nowMinutes: number | null): SchoolPeriodState {
  if (nowMinutes == null) return "future";
  if (nowMinutes >= minutesOfTime(span.endTime)) return "past";
  if (nowMinutes >= minutesOfTime(span.startTime)) return "now";
  return "future";
}

export interface SchoolDaySummary {
  /** 1-based slot of the class in progress, or null when none is. */
  currentPeriod: number | null;
  /** One glanceable phrase for the card subtitle. */
  label: string;
}

/**
 * The day's state in one phrase: "3. čas u toku", "počinje u 08:00", "odmor do
 * 09:55", "gotovo za danas". For a day that is not today (`nowMinutes` null)
 * it is the span instead, because "in progress" is meaningless there.
 */
export function schoolDaySummary(
  blocks: ReadonlyArray<TimeSpan & { periodIndex: number }>,
  nowMinutes: number | null,
): SchoolDaySummary {
  if (blocks.length === 0) return { currentPeriod: null, label: "nema časova" };

  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (nowMinutes == null) {
    return { currentPeriod: null, label: `${first.startTime} - ${last.endTime}` };
  }

  if (nowMinutes < minutesOfTime(first.startTime)) {
    return { currentPeriod: null, label: `počinje u ${first.startTime}` };
  }
  if (nowMinutes >= minutesOfTime(last.endTime)) {
    return { currentPeriod: null, label: "gotovo za danas" };
  }

  const current = blocks.find(
    (b) => nowMinutes >= minutesOfTime(b.startTime) && nowMinutes < minutesOfTime(b.endTime),
  );
  if (current)
    return { currentPeriod: current.periodIndex, label: `${current.periodIndex}. čas u toku` };

  // Between two classes - name the one being waited for, since that is what
  // the parent is actually asking ("when do I pick them up / when is it over").
  const next = blocks.find((b) => minutesOfTime(b.startTime) > nowMinutes);
  return { currentPeriod: null, label: next ? `odmor do ${next.startTime}` : "odmor" };
}

export interface SchoolWeekOutlook {
  /** Monday of the described week (YYYY-MM-DD). */
  weekStart: string;
  /** Which timetable (A/B) is active - flips even for fixed-morning children. */
  variant: TimetableVariant;
  /** Which bell-schedule band applies - what time they actually go. */
  band: SchoolShift;
  /** "HH:MM" the first class of that week starts. */
  startTime: string;
  /** Whether the earlier "pred-čas" afternoon start is in effect this week. */
  usesPredcas: boolean;
}

/** Resolve a child's whole week in one shot: variant, band and start time. */
export function weekOutlook(
  anchor: SchoolShiftAnchor,
  bell: BellSchedule,
  weekStart: string,
): SchoolWeekOutlook {
  const variant = variantForWeek(anchor, weekStart);
  const band = timeBandForWeek(anchor, weekStart);
  // Gated on the band: `afternoon_uses_predcas` stays true on a morning week,
  // and a "pred-čas od 13:00" badge on a child sitting in class at 08:00 lies.
  const usesPredcas = band === "afternoon" && anchor.afternoon_uses_predcas;
  const { start } = bandParams(bell, band, usesPredcas);
  return { weekStart, variant, band, startTime: normalizeTime(start), usesPredcas };
}

/** Monday of the week after `weekStart`. */
export function nextWeekStart(weekStart: string): string {
  return format(addDays(parseISO(weekStart + "T12:00:00"), 7), "yyyy-MM-dd");
}

export interface NextBreakHit {
  brk: SchoolBreak;
  /** The day the break is first hit - today itself when one is already running. */
  date: string;
  daysUntil: number;
  /** True when the break covers today. */
  ongoing: boolean;
}

/**
 * The next raspust that touches any of `personIds`, scanning forward day by
 * day. Breaks carry no year, so a plain date comparison cannot answer this -
 * walking the calendar is what makes both the New Year wrap and 29.02 fall out
 * for free, and 365 iterations over a handful of rows costs nothing.
 */
export function nextBreak(args: {
  /** YYYY-MM-DD to scan from, inclusive. */
  today: string;
  breaks: ReadonlyArray<SchoolBreak>;
  memberIdsByBreak: ReadonlyMap<string, ReadonlySet<string>>;
  personIds: ReadonlyArray<string>;
  withinDays?: number;
}): NextBreakHit | null {
  const { today, breaks, memberIdsByBreak, personIds, withinDays = 365 } = args;
  if (breaks.length === 0 || personIds.length === 0) return null;

  const relevant = breaks.filter((brk) =>
    personIds.some((id) => breakCoversPerson(brk, id, memberIdsByBreak)),
  );
  if (relevant.length === 0) return null;

  const from = parseISO(today + "T12:00:00");
  for (let offset = 0; offset <= withinDays; offset += 1) {
    const dateISO = format(addDays(from, offset), "yyyy-MM-dd");
    const hit = relevant.find((brk) => isDateInBreak(dateISO, brk));
    if (hit) return { brk: hit, date: dateISO, daysUntil: offset, ongoing: offset === 0 };
  }
  return null;
}

/**
 * Days until a break next covers a date, 0 while it is running. `Infinity`
 * when it never comes round inside `withinDays` (only reachable if a row is
 * malformed - every real break repeats yearly). Sorting a list by this is what
 * puts the raspust the family is actually waiting for at the top.
 */
export function daysUntilBreak(brk: SchoolBreak, today: string, withinDays = 366): number {
  const from = parseISO(today + "T12:00:00");
  for (let offset = 0; offset <= withinDays; offset += 1) {
    if (isDateInBreak(format(addDays(from, offset), "yyyy-MM-dd"), brk)) return offset;
  }
  return Number.POSITIVE_INFINITY;
}
