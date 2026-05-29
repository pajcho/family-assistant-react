import { addDays, format, parseISO } from "date-fns";
import type {
  BellSchedule,
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
 * `BellSchedule` plus the child's resolved time band — change the bell
 * schedule and every class moves automatically.
 *
 * Two independent axes (the crux of the model — see the migration header):
 *   • VARIANT (A/B)  — which timetable is active this week. Driven by the
 *                      child's rota shift (`deriveShiftForWeek`): morning weeks
 *                      use 'A', afternoon weeks use 'B'.
 *   • TIME BAND      — which bell-schedule start times apply. Equals the rota
 *                      shift UNLESS `fixed_time_band` pins it. 1st/2nd graders
 *                      pin it to 'morning' so subjects still flip A↔B while the
 *                      clock stays put.
 */

// ---------------------------------------------------------------------------
// Resolving the week's variant + time band for a child
// ---------------------------------------------------------------------------

/**
 * The rota shift this child is in for `weekStart` — drives WHICH timetable
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
 * The TIME band for the week — which bell-schedule start times apply. Equals
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
// Bell grid — turning a band into concrete per-slot times
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
 * classes — except after `bigBreakAfter`, where the gap is `big_break_minutes`.
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
// Week resolution — one block per class occurrence
// ---------------------------------------------------------------------------

export interface ResolvedSchoolBlock {
  entryId: string;
  personId: string;
  /** YYYY-MM-DD — the concrete day inside the requested week. */
  date: string;
  /** 0..6 Monday-first — grid column. */
  dayOfWeek: number;
  periodIndex: number;
  /** "HH:MM" derived from the bell grid. */
  startTime: string;
  endTime: string;
  subject: string;
  room: string | null;
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
 * `weekStart` MUST already be a Monday (YYYY-MM-DD) — caller's job, same
 * contract as `resolveWeekBlocks`.
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
}): ResolvedSchoolBlock[] {
  const { weekStart, bell, entries, shiftAnchorsByPersonId } = args;
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
  const blocks: ResolvedSchoolBlock[] = [];

  for (const [personId, personEntries] of entriesByPerson) {
    const anchor = shiftAnchorsByPersonId.get(personId);
    const variant: TimetableVariant = anchor ? variantForWeek(anchor, weekStart) : "A";
    const band: SchoolShift = anchor ? timeBandForWeek(anchor, weekStart) : "morning";
    const usesPredcas = anchor?.afternoon_uses_predcas ?? false;

    const grid = computeBellGrid(bell, band, usesPredcas);
    const slotByIndex = new Map(grid.map((s) => [s.periodIndex, s]));

    for (const entry of personEntries) {
      if (entry.variant !== variant) continue;
      const slot = slotByIndex.get(entry.period_index);
      if (!slot) continue; // period beyond max_periods — skip defensively.
      const date = format(addDays(monday, entry.day_of_week), "yyyy-MM-dd");
      blocks.push({
        entryId: entry.id,
        personId,
        date,
        dayOfWeek: entry.day_of_week,
        periodIndex: entry.period_index,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subject: entry.subject,
        room: entry.room,
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
