import { addDays, format, parseISO } from "date-fns";
import type {
  BellSchedule,
  SchoolBreak,
  SchoolShift,
  SchoolShiftAnchor,
  SchoolTimetableEntry,
  TimetableVariant,
} from "@/types/database";
import { deriveShiftForWeek, normalizeTime } from "./activity";

/**
 * Pure helpers for the School-timetable feature. Like `utils/activity.ts`,
 * these are free of React / Supabase so they can be unit-tested in isolation
 * and reused server-side (push reminders, digests) later.
 *
 * The whole point of this feature: the user types SUBJECTS per slot, never
 * times. Concrete class times are derived here from the family's
 * `BellSchedule` plus the child's resolved time band - change the bell
 * schedule and every class moves automatically.
 *
 * Two independent axes (the crux of the model - see the migration header):
 *   • VARIANT (A/B)  - which timetable is active this week. Driven by the
 *                      child's rota shift (`deriveShiftForWeek`): morning weeks
 *                      use 'A', afternoon weeks use 'B'.
 *   • TIME BAND      - which bell-schedule start times apply. Equals the rota
 *                      shift UNLESS `fixed_time_band` pins it. 1st/2nd graders
 *                      pin it to 'morning' so subjects still flip A↔B while the
 *                      clock stays put.
 */

// ---------------------------------------------------------------------------
// Resolving the week's variant + time band for a child
// ---------------------------------------------------------------------------

/**
 * The rota shift this child is in for `weekStart` - drives WHICH timetable
 * (A/B) is active. `deriveShiftForWeek` already collapses to `anchor_shift`
 * for non-alternating children, so this is constant for them.
 */
export function rotaShiftForWeek(
  anchor: Pick<
    SchoolShiftAnchor,
    "anchor_week_start" | "anchor_shift" | "flip_interval_weeks" | "is_alternating"
  >,
  weekStart: string,
): SchoolShift {
  return deriveShiftForWeek(anchor, weekStart);
}

/** Map a rota shift to the timetable variant it selects. */
export function variantForShift(shift: SchoolShift): TimetableVariant {
  return shift === "morning" ? "A" : "B";
}

/** The active timetable variant for the week. */
export function variantForWeek(
  anchor: Pick<
    SchoolShiftAnchor,
    "anchor_week_start" | "anchor_shift" | "flip_interval_weeks" | "is_alternating"
  >,
  weekStart: string,
): TimetableVariant {
  return variantForShift(rotaShiftForWeek(anchor, weekStart));
}

/**
 * The TIME band for the week - which bell-schedule start times apply. Equals
 * the rota shift, unless `fixed_time_band` overrides it (1st/2nd graders).
 */
export function timeBandForWeek(
  anchor: Pick<
    SchoolShiftAnchor,
    | "anchor_week_start"
    | "anchor_shift"
    | "flip_interval_weeks"
    | "is_alternating"
    | "fixed_time_band"
  >,
  weekStart: string,
): SchoolShift {
  return anchor.fixed_time_band ?? rotaShiftForWeek(anchor, weekStart);
}

// ---------------------------------------------------------------------------
// Bell grid - turning a band into concrete per-slot times
// ---------------------------------------------------------------------------

export interface BellSlot {
  /** 1-based class slot within the band. */
  periodIndex: number;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  /** True when the big break (veliki odmor) falls immediately AFTER this slot. */
  bigBreakAfter: boolean;
}

/** Add `minutes` to an "HH:MM[:SS]" clock time, returning "HH:MM". */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = normalizeTime(time).split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Which start time + big-break position apply for a given band. The afternoon
 * band has two flavours; `usesPredcas` picks the earlier-start one.
 */
export function bandParams(
  bell: Pick<
    BellSchedule,
    | "morning_start"
    | "morning_big_break_after"
    | "afternoon_start"
    | "afternoon_big_break_after"
    | "afternoon_predcas_start"
    | "afternoon_predcas_big_break_after"
  >,
  band: SchoolShift,
  usesPredcas: boolean,
): { start: string; bigBreakAfter: number } {
  if (band === "morning") {
    return {
      start: normalizeTime(bell.morning_start),
      bigBreakAfter: bell.morning_big_break_after,
    };
  }
  if (usesPredcas) {
    return {
      start: normalizeTime(bell.afternoon_predcas_start),
      bigBreakAfter: bell.afternoon_predcas_big_break_after,
    };
  }
  return {
    start: normalizeTime(bell.afternoon_start),
    bigBreakAfter: bell.afternoon_big_break_after,
  };
}

/**
 * Compute the ordered class slots for a band: walk forward from the band's
 * start, each class `period_minutes` long, with `small_break_minutes` between
 * classes - except after `bigBreakAfter`, where the gap is `big_break_minutes`.
 * Produces `max_periods` slots.
 */
export function computeBellGrid(
  bell: BellSchedule,
  band: SchoolShift,
  usesPredcas: boolean,
): BellSlot[] {
  const { start, bigBreakAfter } = bandParams(bell, band, usesPredcas);
  const count = Math.max(1, Math.min(12, bell.max_periods));
  const slots: BellSlot[] = [];
  let cursor = normalizeTime(start);
  for (let i = 1; i <= count; i++) {
    const startTime = cursor;
    const endTime = addMinutesToTime(cursor, bell.period_minutes);
    const isBigBreak = i === bigBreakAfter;
    slots.push({ periodIndex: i, startTime, endTime, bigBreakAfter: isBigBreak });
    const gap = isBigBreak ? bell.big_break_minutes : bell.small_break_minutes;
    cursor = addMinutesToTime(endTime, gap);
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Raspusti - the days on which the pattern must NOT produce classes
// ---------------------------------------------------------------------------

/**
 * A break stores month + day only, so every comparison happens on the integer
 * `month * 100 + day` and no `Date` is ever constructed from it. That is what
 * makes 29.02 safe in a non-leap year: it stays the number 229 instead of
 * turning into a date that does not exist.
 */
function monthDayKey(month: number, day: number): number {
  return month * 100 + day;
}

/** `month * 100 + day` for a "YYYY-MM-DD" string. */
export function monthDayOf(dateISO: string): number {
  return monthDayKey(Number(dateISO.slice(5, 7)), Number(dateISO.slice(8, 10)));
}

/**
 * Whether a date falls inside a break, in ANY year.
 *
 * A break whose end lands before its start wraps the New Year: the winter
 * break 30.12 - 20.01 covers everything from 30.12 to the end of the year plus
 * everything from 01.01 to 20.01.
 */
export function isDateInBreak(dateISO: string, brk: SchoolBreak): boolean {
  const md = monthDayOf(dateISO);
  const from = monthDayKey(brk.start_month, brk.start_day);
  const to = monthDayKey(brk.end_month, brk.end_day);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/**
 * Whether a break applies to a child. An EMPTY member list is the default and
 * means the whole family's students - so everyone being on a break, the common case,
 * needs no picking at all.
 */
export function breakCoversPerson(
  brk: SchoolBreak,
  personId: string,
  memberIdsByBreak: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const members = memberIdsByBreak.get(brk.id);
  return !members || members.size === 0 || members.has(personId);
}

/** The breaks covering `personId` on `dateISO`, in the order they were given. */
export function breaksOnDate(args: {
  dateISO: string;
  personId: string;
  breaks: ReadonlyArray<SchoolBreak>;
  memberIdsByBreak: ReadonlyMap<string, ReadonlySet<string>>;
}): SchoolBreak[] {
  const { dateISO, personId, breaks, memberIdsByBreak } = args;
  return breaks.filter(
    (b) => breakCoversPerson(b, personId, memberIdsByBreak) && isDateInBreak(dateISO, b),
  );
}

/** One day's raspust situation for the children currently in view. */
export interface SchoolBreakDay {
  /** Distinct names of the breaks covering at least one child in scope. */
  names: string[];
  /** The children on a break that day, in the order they were passed in. */
  personIds: string[];
  /**
   * Every child in scope is off. When false the day still has classes, so the
   * label has to say WHOSE break it is - siblings in different grades get
   * different breaks, and a bare "Raspust" over a sibling's live classes lies.
   */
  everyone: boolean;
}

/**
 * Which days of a week carry a raspust, for the grid's day headers.
 *
 * `personIds` is the set of children whose schedule the view is showing. It
 * must come from who is a STUDENT, not from who has timetable rows: a child
 * with a shift but an empty timetable is still on the break, and leaving them
 * out made their raspust invisible.
 *
 * Returns `dateISO → SchoolBreakDay`, with days nobody is off left out.
 */
export function resolveSchoolBreakDays(args: {
  weekStart: string;
  personIds: ReadonlyArray<string>;
  breaks: ReadonlyArray<SchoolBreak>;
  memberIdsByBreak: ReadonlyMap<string, ReadonlySet<string>>;
}): Map<string, SchoolBreakDay> {
  const { weekStart, personIds, breaks, memberIdsByBreak } = args;
  const byDate = new Map<string, SchoolBreakDay>();
  if (personIds.length === 0 || breaks.length === 0) return byDate;

  const monday = parseISO(weekStart + "T12:00:00");
  for (let i = 0; i < 7; i += 1) {
    const dateISO = format(addDays(monday, i), "yyyy-MM-dd");
    const names = new Set<string>();
    const off: string[] = [];
    for (const personId of personIds) {
      const hits = breaksOnDate({ dateISO, personId, breaks, memberIdsByBreak });
      if (hits.length === 0) continue;
      off.push(personId);
      for (const b of hits) names.add(b.name);
    }
    if (off.length === 0) continue;
    byDate.set(dateISO, {
      names: [...names],
      personIds: off,
      everyone: off.length === personIds.length,
    });
  }
  return byDate;
}

// ---------------------------------------------------------------------------
// Week resolution - one block per class occurrence
// ---------------------------------------------------------------------------

export interface ResolvedSchoolBlock {
  entryId: string;
  personId: string;
  /** YYYY-MM-DD - the concrete day inside the requested week. */
  date: string;
  /** 0..6 Monday-first - grid column. */
  dayOfWeek: number;
  periodIndex: number;
  /** "HH:MM" derived from the bell grid. */
  startTime: string;
  endTime: string;
  subject: string;
  /** The variant that was active this week (the one these blocks came from). */
  variant: TimetableVariant;
  /** The resolved time band whose bell grid produced the times. */
  band: SchoolShift;
}

/**
 * Resolve every school class occurring during `weekStart` for a set of
 * timetable entries. For each child we resolve the active variant + time band,
 * compute that band's bell grid, and emit one block per entry whose variant
 * matches and whose `period_index` lands inside the grid.
 *
 * `weekStart` MUST already be a Monday (YYYY-MM-DD) - caller's job, same
 * contract as `resolveWeekBlocks`.
 *
 * Days covered by a `raspust` for that child produce nothing - the timetable is
 * a pattern, not a record of what happened, so a break applies in every year,
 * past weeks included.
 *
 * Defensive fallbacks (none should happen with a well-formed UI):
 *   • No bell schedule → returns [] (can't derive times).
 *   • Child with entries but no shift anchor → assume variant 'A' / morning
 *     band, so a misconfigured child still shows *something* rather than
 *     vanishing.
 */
export function resolveSchoolWeekBlocks(args: {
  weekStart: string;
  bell: BellSchedule | null | undefined;
  entries: ReadonlyArray<SchoolTimetableEntry>;
  shiftAnchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  breaks?: ReadonlyArray<SchoolBreak>;
  /** break id → the children it applies to; missing/empty = every child. */
  breakMemberIdsByBreak?: ReadonlyMap<string, ReadonlySet<string>>;
}): ResolvedSchoolBlock[] {
  const {
    weekStart,
    bell,
    entries,
    shiftAnchorsByPersonId,
    breaks = [],
    breakMemberIdsByBreak = new Map<string, ReadonlySet<string>>(),
  } = args;
  if (!bell) return [];
  if (entries.length === 0) return [];

  // Group entries by person so we resolve variant/band once per child.
  const entriesByPerson = new Map<string, SchoolTimetableEntry[]>();
  for (const e of entries) {
    const arr = entriesByPerson.get(e.person_id);
    if (arr) arr.push(e);
    else entriesByPerson.set(e.person_id, [e]);
  }

  const monday = parseISO(weekStart + "T12:00:00");
  const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), "yyyy-MM-dd"));
  const blocks: ResolvedSchoolBlock[] = [];

  for (const [personId, personEntries] of entriesByPerson) {
    const anchor = shiftAnchorsByPersonId.get(personId);
    const variant: TimetableVariant = anchor ? variantForWeek(anchor, weekStart) : "A";
    const band: SchoolShift = anchor ? timeBandForWeek(anchor, weekStart) : "morning";
    const usesPredcas = anchor?.afternoon_uses_predcas ?? false;

    // Resolved once per child, not per entry: a break covers whole days, and a
    // child with 7 classes a day would otherwise re-scan the same list 35 times.
    const offDays = new Set<number>();
    if (breaks.length > 0) {
      for (let day = 0; day < 7; day += 1) {
        const onBreak = breaks.some(
          (b) =>
            breakCoversPerson(b, personId, breakMemberIdsByBreak) &&
            isDateInBreak(weekDates[day], b),
        );
        if (onBreak) offDays.add(day);
      }
    }

    const grid = computeBellGrid(bell, band, usesPredcas);
    const slotByIndex = new Map(grid.map((s) => [s.periodIndex, s]));

    for (const entry of personEntries) {
      if (entry.variant !== variant) continue;
      if (offDays.has(entry.day_of_week)) continue; // raspust - no classes.
      const slot = slotByIndex.get(entry.period_index);
      if (!slot) continue; // period beyond max_periods - skip defensively.
      const date = weekDates[entry.day_of_week];
      blocks.push({
        entryId: entry.id,
        personId,
        date,
        dayOfWeek: entry.day_of_week,
        periodIndex: entry.period_index,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subject: entry.subject,
        variant,
        band,
      });
    }
  }

  // Stable order: by day, then start time, then period index.
  blocks.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.periodIndex - b.periodIndex;
  });

  return blocks;
}
