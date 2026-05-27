import { addDays, format, parseISO, startOfDay } from "date-fns";
import type {
  Activity,
  ActivitySchedule,
  SchoolShift,
  SchoolShiftAnchor,
  WeekPattern,
} from "@/types/database";

/**
 * Anchor used by the "every N weeks" modulo. Prefer `active_from` because
 * that's the user-controlled phasing knob; fall back to `created_at` so
 * activities created without an explicit season still have a stable
 * reference. Both are normalized to the containing Monday.
 */
function activityAnchorWeek(activity: Pick<Activity, "active_from" | "created_at">): string {
  return getWeekStart(activity.active_from ?? activity.created_at);
}

/**
 * Pure helpers for the Activities feature — week math, school-shift
 * derivation, and A/B-pattern resolution. Kept free of React / Supabase so
 * they can be unit-tested in isolation and reused on the server later
 * (digests, push notifications) without dragging hooks along.
 */

// ---------------------------------------------------------------------------
// Day-of-week conversion
// ---------------------------------------------------------------------------

/**
 * The schema stores `day_of_week` as 0=Monday … 6=Sunday (UI is
 * Monday-first). JS `Date.getDay()` returns 0=Sunday … 6=Saturday, so the
 * client remaps on read/write.
 */
export function toMondayFirstDow(jsDay: number): number {
  return (jsDay + 6) % 7;
}

export function fromMondayFirstDow(mondayFirstDow: number): number {
  return (mondayFirstDow + 1) % 7;
}

export const DAY_LABELS_FULL: ReadonlyArray<string> = [
  "Ponedeljak",
  "Utorak",
  "Sreda",
  "Četvrtak",
  "Petak",
  "Subota",
  "Nedelja",
];

export const DAY_LABELS_SHORT: ReadonlyArray<string> = [
  "Pon",
  "Uto",
  "Sre",
  "Čet",
  "Pet",
  "Sub",
  "Ned",
];

// ---------------------------------------------------------------------------
// Week boundaries
// ---------------------------------------------------------------------------

/**
 * Monday of the week containing `date`. Always Monday-first regardless of
 * locale, because the rest of the app's date math assumes that.
 *
 * Accepts either a `Date`, a YYYY-MM-DD string (DATE column), or an ISO
 * timestamp string (TIMESTAMPTZ column like `activities.created_at`).
 */
export function getWeekStart(date: Date | string): string {
  let d: Date;
  if (typeof date === "string") {
    // YYYY-MM-DD gets noon attached so the parsed Date stays inside the
    // calendar day regardless of timezone. Full ISO timestamps already
    // carry their own time portion (and tz), so parse them directly.
    d = date.includes("T") ? parseISO(date) : parseISO(date + "T12:00:00");
  } else {
    d = startOfDay(date);
  }
  const dow = toMondayFirstDow(d.getDay());
  const monday = addDays(d, -dow);
  return format(monday, "yyyy-MM-dd");
}

/** Today's Monday — convenience for "this week" defaults. */
export function getThisWeekStart(): string {
  return getWeekStart(new Date());
}

/**
 * Whole weeks elapsed from `fromWeekStart` to `toWeekStart`. Both inputs are
 * expected to already be Mondays (YYYY-MM-DD) — caller normalizes with
 * `getWeekStart` first.
 */
export function weeksBetween(fromWeekStart: string, toWeekStart: string): number {
  const from = parseISO(fromWeekStart + "T12:00:00").getTime();
  const to = parseISO(toWeekStart + "T12:00:00").getTime();
  return Math.round((to - from) / (7 * 24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// School-shift derivation
// ---------------------------------------------------------------------------

export function oppositeShift(shift: SchoolShift): SchoolShift {
  return shift === "morning" ? "afternoon" : "morning";
}

/**
 * Resolve the school shift for `targetWeekStart` given a person's anchor.
 * The anchor pins one specific week to a known shift; every `flip_interval_weeks`
 * weeks the shift flips. Weeks before the anchor walk back the same way.
 *
 * When `is_alternating` is false (1st/2nd graders), skip the flip math
 * entirely — the shift is always whatever was anchored.
 */
export function deriveShiftForWeek(
  anchor: Pick<
    SchoolShiftAnchor,
    "anchor_week_start" | "anchor_shift" | "flip_interval_weeks" | "is_alternating"
  >,
  targetWeekStart: string,
): SchoolShift {
  if (!anchor.is_alternating) return anchor.anchor_shift;
  const interval = Math.max(1, Math.floor(anchor.flip_interval_weeks));
  const diff = weeksBetween(anchor.anchor_week_start, targetWeekStart);
  // floor() makes the math symmetric across negative diffs:
  //   floor(-1 / 1) = -1  ⇒ odd flips, opposite shift
  //   floor(-2 / 1) = -2  ⇒ even flips, same shift as anchor
  const flips = Math.floor(diff / interval);
  const flipsMod = ((flips % 2) + 2) % 2; // safe mod for negatives
  return flipsMod === 0 ? anchor.anchor_shift : oppositeShift(anchor.anchor_shift);
}

// ---------------------------------------------------------------------------
// A/B pattern resolution
// ---------------------------------------------------------------------------

/**
 * True if a schedule rule with `pattern` should fire on a week where the
 * activity's person is in `shift`. `'every'` always fires; `'A'` fires on
 * morning weeks; `'B'` fires on afternoon weeks.
 *
 * When the person has no shift anchor, A/B rules silently skip — the UI
 * prevents creating them in that case, so this is a defensive default
 * rather than a regularly hit path.
 */
export function shouldFireOnShift(pattern: WeekPattern, shift: SchoolShift | null): boolean {
  if (pattern === "every") return true;
  if (shift == null) return false;
  if (pattern === "A") return shift === "morning";
  return shift === "afternoon";
}

// ---------------------------------------------------------------------------
// Active window
// ---------------------------------------------------------------------------

/**
 * True if `activity` is active (not paused and within its season window) on
 * `dateStr`. NULL bounds mean open-ended on that side. Used by the week
 * resolver to skip activities outside their season without forcing the user
 * to delete them.
 */
export function isActivityActiveOn(
  activity: Pick<Activity, "is_paused" | "active_from" | "active_to">,
  dateStr: string,
): boolean {
  if (activity.is_paused) return false;
  if (activity.active_from && dateStr < activity.active_from) return false;
  if (activity.active_to && dateStr > activity.active_to) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Resolved week block (output shape for the grid)
// ---------------------------------------------------------------------------

export interface ResolvedActivityBlock {
  scheduleId: string;
  activityId: string;
  personId: string;
  /** YYYY-MM-DD — the exact day of this occurrence inside the requested week. */
  date: string;
  /** 0..6 Monday-first — convenience for the grid column. */
  dayOfWeek: number;
  /** "HH:MM" (seconds stripped if present). */
  startTime: string;
  endTime: string;
  weekPattern: WeekPattern;
  /** 1 = each matching week. >1 means the block fires every N weeks. */
  recurrenceIntervalWeeks: number;
}

/**
 * Resolve which schedule rules fire during `weekStart` for a given set of
 * activities and shift anchors, and return one block per occurrence with
 * the concrete date filled in.
 *
 * `weekStart` MUST already be normalized to a Monday (caller's job).
 */
export function resolveWeekBlocks(args: {
  weekStart: string;
  activities: ReadonlyArray<Activity>;
  schedule: ReadonlyArray<ActivitySchedule>;
  shiftAnchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
}): ResolvedActivityBlock[] {
  const { weekStart, activities, schedule, shiftAnchorsByPersonId } = args;
  const activitiesById = new Map(activities.map((a) => [a.id, a]));

  const blocks: ResolvedActivityBlock[] = [];

  for (const rule of schedule) {
    const activity = activitiesById.get(rule.activity_id);
    if (!activity) continue;

    const occurrenceDate = format(
      addDays(parseISO(weekStart + "T12:00:00"), rule.day_of_week),
      "yyyy-MM-dd",
    );

    if (!isActivityActiveOn(activity, occurrenceDate)) continue;

    // "Every N weeks" modulo. Interval 1 (default) means every matching
    // week, so the check is a no-op. Weeks before the anchor never fire.
    const interval = Math.max(1, Math.floor(rule.recurrence_interval_weeks));
    if (interval > 1) {
      const anchorWeek = activityAnchorWeek(activity);
      const diff = weeksBetween(anchorWeek, weekStart);
      if (diff < 0 || diff % interval !== 0) continue;
    }

    // A/B resolution — needs the person's anchor. `'every'` skips the lookup.
    if (rule.week_pattern !== "every") {
      const anchor = shiftAnchorsByPersonId.get(activity.person_id);
      const shift = anchor ? deriveShiftForWeek(anchor, weekStart) : null;
      if (!shouldFireOnShift(rule.week_pattern, shift)) continue;
    }

    blocks.push({
      scheduleId: rule.id,
      activityId: activity.id,
      personId: activity.person_id,
      date: occurrenceDate,
      dayOfWeek: rule.day_of_week,
      startTime: normalizeTime(rule.start_time),
      endTime: normalizeTime(rule.end_time),
      weekPattern: rule.week_pattern,
      recurrenceIntervalWeeks: interval,
    });
  }

  // Stable order: by day, then start_time, then activity name fallback (id).
  blocks.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.activityId.localeCompare(b.activityId);
  });

  return blocks;
}

/** Strip seconds — Postgres TIME comes back as "HH:MM:SS" but we only need HH:MM. */
export function normalizeTime(time: string): string {
  return time.length >= 5 ? time.slice(0, 5) : time;
}

/** Convert "HH:MM" to minutes since midnight — for grid row positioning. */
export function timeToMinutes(time: string): number {
  const normalized = normalizeTime(time);
  const [h, m] = normalized.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Per-person color fallback (until the user picks one)
// ---------------------------------------------------------------------------

/**
 * 8-color palette the picker shows. Stored canonically as hex.
 */
export const PROFILE_COLOR_PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#6366f1", // indigo
] as const;

/**
 * Deterministic placeholder for profiles without a `color` set yet — same
 * id always picks the same palette slot so the UI doesn't churn between
 * renders.
 */
export function fallbackColorForProfile(profileId: string): string {
  let hash = 0;
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash * 31 + profileId.charCodeAt(i)) >>> 0;
  }
  return PROFILE_COLOR_PALETTE[hash % PROFILE_COLOR_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Shift labels (Serbian)
// ---------------------------------------------------------------------------

export const SHIFT_LABELS: Record<SchoolShift, string> = {
  morning: "Jutarnja smena",
  afternoon: "Popodnevna smena",
};
