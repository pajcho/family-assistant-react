import { addDays, format, parseISO, startOfDay } from "date-fns";
import type {
  Activity,
  ActivityOverride,
  ActivityOverrideAction,
  ActivityParticipant,
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
  if (date == null) {
    // Defensive: never throw on a missing date (stale client / partial
    // data) — fall back to the current week.
    d = startOfDay(new Date());
  } else if (typeof date === "string") {
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
  /**
   * Effective times after applying any reschedule override. The grid uses
   * these for layout. The original times (used by the action menu and the
   * "ranije X" tooltip) live on `override.original*` when present.
   */
  startTime: string;
  endTime: string;
  weekPattern: WeekPattern;
  /** 1 = each matching week. >1 means the block fires every N weeks. */
  recurrenceIntervalWeeks: number;
  /**
   * Set when this occurrence has an override for `date`. The block always
   * stays in the output (even when canceled) so the grid can render a
   * "this was supposed to happen" ghost instead of silently dropping it.
   */
  override?: {
    id: string;
    action: ActivityOverrideAction;
    /** For reschedules: the time before the override moved it. */
    originalStartTime: string;
    originalEndTime: string;
    note: string | null;
    /**
     * When the override moves the termin to a different date, set on the
     * ghost block at the *original* date (pointing where it went). The
     * `movedFrom` counterpart is set on the full block at the new date.
     */
    movedTo?: string;
    movedFrom?: string;
    /**
     * On a moved-away ghost the block's `startTime`/`endTime` show the
     * ORIGINAL rule times (so the ghost reads as the slot the termin
     * left). These two fields carry the override's new times so the
     * action dialog can prefill the reschedule form with them. Only set
     * for moved-away ghosts.
     */
    rescheduledStartTime?: string;
    rescheduledEndTime?: string;
  };
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
  participants: ReadonlyArray<ActivityParticipant>;
  shiftAnchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  overrides?: ReadonlyArray<ActivityOverride>;
}): ResolvedActivityBlock[] {
  const {
    weekStart,
    activities,
    schedule,
    participants,
    shiftAnchorsByPersonId,
    overrides = [],
  } = args;
  const activitiesById = new Map(activities.map((a) => [a.id, a]));
  const scheduleById = new Map(schedule.map((s) => [s.id, s]));

  // Person ids per activity. Empty array = no participants → no blocks for
  // that activity (defensive — the UI prevents activities with zero
  // participants).
  const personsByActivity = new Map<string, string[]>();
  for (const p of participants) {
    const arr = personsByActivity.get(p.activity_id);
    if (arr) arr.push(p.person_id);
    else personsByActivity.set(p.activity_id, [p.person_id]);
  }

  // Indexed by `${schedule_id}|${date}|${person_id}` — per-person key
  // matches the new UNIQUE constraint so each participant has their own
  // override slot for the same occurrence.
  const overridesByKey = new Map<string, ActivityOverride>();
  for (const o of overrides) {
    overridesByKey.set(`${o.schedule_id}|${o.date}|${o.person_id}`, o);
  }

  const blocks: ResolvedActivityBlock[] = [];

  // ─── Pass 1: walk rules × participants, emit blocks on the original date ─
  for (const rule of schedule) {
    const activity = activitiesById.get(rule.activity_id);
    if (!activity) continue;
    const persons = personsByActivity.get(activity.id);
    if (!persons || persons.length === 0) continue;

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

    const baseStart = normalizeTime(rule.start_time);
    const baseEnd = normalizeTime(rule.end_time);

    for (const personId of persons) {
      // A/B resolution — uses THIS person's shift anchor. Two siblings on
      // the same rule can resolve to different shifts (different schools,
      // different cycles), so we check per person.
      if (rule.week_pattern !== "every") {
        const anchor = shiftAnchorsByPersonId.get(personId);
        const shift = anchor ? deriveShiftForWeek(anchor, weekStart) : null;
        if (!shouldFireOnShift(rule.week_pattern, shift)) continue;
      }

      const override = overridesByKey.get(`${rule.id}|${occurrenceDate}|${personId}`);
      const movedToDifferentDay =
        override?.action === "reschedule" &&
        !!override.override_date &&
        override.override_date !== occurrenceDate;

      let effectiveStart = baseStart;
      let effectiveEnd = baseEnd;
      let overrideInfo: ResolvedActivityBlock["override"] | undefined;
      if (override) {
        if (
          override.action === "reschedule" &&
          !movedToDifferentDay &&
          override.override_start_time &&
          override.override_end_time
        ) {
          effectiveStart = normalizeTime(override.override_start_time);
          effectiveEnd = normalizeTime(override.override_end_time);
        }
        overrideInfo = {
          id: override.id,
          action: override.action,
          originalStartTime: baseStart,
          originalEndTime: baseEnd,
          note: override.note,
          movedTo: movedToDifferentDay ? (override.override_date as string) : undefined,
          rescheduledStartTime:
            movedToDifferentDay && override.override_start_time
              ? normalizeTime(override.override_start_time)
              : undefined,
          rescheduledEndTime:
            movedToDifferentDay && override.override_end_time
              ? normalizeTime(override.override_end_time)
              : undefined,
        };
      }

      blocks.push({
        scheduleId: rule.id,
        activityId: activity.id,
        personId,
        date: occurrenceDate,
        dayOfWeek: rule.day_of_week,
        startTime: effectiveStart,
        endTime: effectiveEnd,
        weekPattern: rule.week_pattern,
        recurrenceIntervalWeeks: interval,
        override: overrideInfo,
      });
    }
  }

  // ─── Pass 2: emit moved-here blocks for per-person overrides whose ──────
  //            target date lands in this week (even if the original date is
  //            elsewhere). Each override is naturally per-person now.
  const weekEnd = format(addDays(parseISO(weekStart + "T12:00:00"), 6), "yyyy-MM-dd");
  for (const override of overrides) {
    if (override.action !== "reschedule") continue;
    if (!override.override_date) continue;
    if (override.override_date === override.date) continue;
    if (override.override_date < weekStart || override.override_date > weekEnd) continue;
    if (!override.override_start_time || !override.override_end_time) continue;

    const rule = scheduleById.get(override.schedule_id);
    if (!rule) continue;
    const activity = activitiesById.get(rule.activity_id);
    if (!activity) continue;
    // Sanity check: only emit if this person is still a participant on the
    // activity. If they were removed after the override was created, skip
    // — same silent-skip-and-reactivate semantic we use elsewhere.
    const persons = personsByActivity.get(activity.id);
    if (!persons?.includes(override.person_id)) continue;
    if (!isActivityActiveOn(activity, override.override_date)) continue;

    blocks.push({
      scheduleId: rule.id,
      activityId: activity.id,
      personId: override.person_id,
      date: override.override_date,
      dayOfWeek: toMondayFirstDow(parseISO(override.override_date + "T12:00:00").getDay()),
      startTime: normalizeTime(override.override_start_time),
      endTime: normalizeTime(override.override_end_time),
      weekPattern: rule.week_pattern,
      recurrenceIntervalWeeks: Math.max(1, Math.floor(rule.recurrence_interval_weeks)),
      override: {
        id: override.id,
        action: override.action,
        originalStartTime: normalizeTime(rule.start_time),
        originalEndTime: normalizeTime(rule.end_time),
        note: override.note,
        movedFrom: override.date,
      },
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
export function normalizeTime(time: string | null | undefined): string {
  // Defensive: a stale client running against a migrated schema can hand
  // us an undefined field. Degrade to "" instead of throwing and white-
  // screening the whole page.
  if (!time) return "";
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
export function fallbackColorForProfile(profileId: string | null | undefined): string {
  // Defensive against an undefined id (stale client / partial data) so a
  // single bad row can't crash a render.
  if (!profileId) return PROFILE_COLOR_PALETTE[0];
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
