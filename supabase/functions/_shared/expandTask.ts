// supabase/functions/_shared/expandTask.ts
//
// The recurrence walk for `tasks`, duplicated for Deno.
//
// `src/utils/task.ts` is the canonical copy and the client's single source of
// truth for which dates a task series has. Edge functions cannot import from
// `src/` (different runtime, different module graph, and that file reaches
// date-fns), so this is the same rule set written against plain string dates -
// exactly the arrangement `_shared/expandEvent.ts` has with the gcal sync.
//
// Keep the two in step. The exported names and the behaviour below mirror the
// client function for function, so a differential test can feed one fixture to
// both and compare; anything that drifts here shows up as a digest that
// disagrees with the Danas screen the user is holding.
//
// The rules, from plan 015 section 6:
//
//   daily    every `recurrence_interval` days from due_date
//   weekly   with `recurrence_weekdays`: every listed weekday in every
//            `recurrence_interval`-th week, counted from due_date's week.
//            Without it: every `recurrence_interval` weeks on due_date's own
//            weekday. Weekday indexes are 0 = Monday .. 6 = Sunday, matching
//            activity_schedule.day_of_week - NEVER a raw JS getDay().
//   monthly  anchored on due_date's day of the month, so a series due on the
//            31st reports 28 February and then 31 March again instead of
//            drifting down to the 28th forever.
//
// `recurrence_until` is inclusive. A relocated occurrence is reported at its new
// date; a 'skipped' one is still returned, flagged, and dropped by the caller
// (the agenda hides it, the digest does not count it, no reminder fires).
//
// The expansion runs in two passes, because "which instances land in this
// window" is two questions:
//
//   a. the series' OWN dates inside [from, to], reached by fast-forwarding to
//      `from` in one jump - never by stepping through the years since the anchor,
//      which would burn the whole instance cap before reaching this month and
//      leave the digest silent on a day the agenda shows as busy;
//   b. the instances whose SERIES date sits OUTSIDE the window but which an
//      occurrence row RELOCATED into it. No enumeration of the window can reach
//      those, so the candidates are read off the (sparse) occurrence rows and
//      each is phase-tested against the rule in O(1) instead of walked to.
//
// The 366-instance cap guards pass (a) only; pass (b) is bounded by the number of
// occurrence rows. Both passes terminate structurally: every step is strictly
// forward and stops at min(to, recurrence_until).
//
// WHERE an instance sits is `moved_to_date`, and WHETHER it is resolved is
// `status`. They are independent: there is one row per slot, so ticking off an
// occurrence that was moved flips `status` to 'done' while `moved_to_date` stays
// put. Reading placement off `status === 'moved'` would snap such an instance
// back to its series date wearing a checkmark.

export type TaskRecurrencePeriod = "one-time" | "daily" | "weekly" | "monthly";
export type TaskCompletionMode = "shared" | "per_assignee";
export type TaskOccurrenceStatus = "done" | "skipped" | "moved";

/**
 * The `tasks` columns the walk reads - a structural subset of `Task` in
 * src/types/database.ts, so one row object satisfies this and the client
 * expander both.
 */
export interface TaskSeries {
  id: string;
  /** Null = an undated task, which has no instances at all. For a recurring task this is the series anchor. */
  due_date: string | null;
  recurrence_period: TaskRecurrencePeriod | null;
  recurrence_interval: number;
  /** 0 = Monday .. 6 = Sunday. Weekly recurrence only. */
  recurrence_weekdays: number[] | null;
  /** Inclusive last day of the series. */
  recurrence_until: string | null;
  completion_mode: TaskCompletionMode;
  /** The completion truth for a NON-recurring task only. */
  is_completed: boolean;
}

/** The `task_occurrences` columns the resolution reads. */
export interface TaskOccurrenceRecord {
  task_id: string;
  /** The ORIGINAL projected date from the series, even when this row moves it. */
  occurrence_date: string;
  /** NULL = the occurrence as a whole; set = one assignee's own copy. */
  person_id: string | null;
  status: TaskOccurrenceStatus;
  /** WHERE the occurrence sits. Independent of `status` - a ticked move keeps it. */
  moved_to_date: string | null;
}

export interface TaskOccurrenceInstance {
  /** The series date this instance came from. */
  occurrenceDate: string;
  /** Where it actually shows - `moved_to_date` when one was set, else occurrenceDate. */
  effectiveDate: string;
  /** Resolved state for this instance, if any row exists. */
  occurrence: TaskOccurrenceRecord | undefined;
  /**
   * Whole-occurrence completion. Never true for completion_mode 'per_assignee' -
   * completion there is one fact per assignee, not one per occurrence - which is
   * the one place it says less than `isTaskDoneOn`.
   */
  isDone: boolean;
  isSkipped: boolean;
}

/**
 * Runaway guard: the most instances the window ENUMERATION may return for one
 * range. The moved-in pass is bounded by the number of occurrence rows instead.
 */
export const MAX_TASK_INSTANCES = 366;

/** True when this task repeats. One-time and null both mean "does not". */
export function isRecurringTask(task: Pick<TaskSeries, "recurrence_period">): boolean {
  return task.recurrence_period != null && task.recurrence_period !== "one-time";
}

/** `${taskId}|${occurrenceDate}` - the key shape useTaskOccurrences returns. */
export function taskOccurrenceKey(taskId: string, occurrenceDate: string): string {
  return `${taskId}|${occurrenceDate}`;
}

/**
 * Every instance of `task` whose EFFECTIVE date falls in [from, to], inclusive,
 * ordered by SERIES date - so an instance moved into the window can lead, exactly
 * as it does in the client expander.
 *
 * A non-recurring task yields at most one instance (its due_date). A recurring
 * one is projected in the two passes described in the header: the rule's own
 * dates inside the window, then the occurrences a row relocated INTO it from a
 * series date outside it.
 */
export function expandTaskOccurrences(
  task: TaskSeries,
  from: string,
  to: string,
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
): TaskOccurrenceInstance[] {
  const rule = seriesRule(task);
  if (rule === null) return [];

  // `recurrence_until` is inclusive, so it only ever pulls the end in.
  const until = task.recurrence_until;
  const windowEnd = until && until < to ? until : to;

  const seriesDates = seriesDatesInWindow(rule, from, windowEnd);
  const covered = new Set(seriesDates);

  // Pass (b). Bounded by `recurrence_until`, never by `to`: an occurrence dragged
  // BACKWARDS from next month belongs in this window too.
  for (const row of relocatedRowsFor(task.id, occurrencesByKey)) {
    const target = row.moved_to_date;
    if (target == null || target < from || target > to) continue;
    const seriesDate = row.occurrence_date;
    if (covered.has(seriesDate)) continue;
    if (until != null && seriesDate > until) continue;
    if (!isSeriesDate(rule, seriesDate)) continue;
    covered.add(seriesDate);
    seriesDates.push(seriesDate);
  }
  // ISO dates sort lexicographically, so plain ascending order is chronological.
  seriesDates.sort();

  const out: TaskOccurrenceInstance[] = [];
  for (const occurrenceDate of seriesDates) {
    const occurrence = wholeOccurrenceRow(task.id, occurrenceDate, occurrencesByKey);
    const effectiveDate = effectiveDateOf(occurrenceDate, occurrence);
    if (effectiveDate < from || effectiveDate > to) continue;
    out.push({
      occurrenceDate,
      effectiveDate,
      occurrence,
      isDone: isInstanceDone(task, occurrenceDate, occurrencesByKey),
      isSkipped: occurrence?.status === "skipped",
    });
  }
  return out;
}

/**
 * The single place that knows completion has two homes: `is_completed` for a
 * non-recurring task, a `task_occurrences` row for a recurring one. `personId`
 * matters only for completion_mode 'per_assignee'.
 *
 * Asked WITHOUT a person, 'per_assignee' falls back to the whole-occurrence row:
 * a task switched from 'shared' to 'per_assignee' mid-life keeps the shared ticks
 * it collected. Only a 'done' row ever counts - 'skipped' and 'moved' are
 * resolutions, not completions.
 */
export function isTaskDoneOn(
  task: TaskSeries,
  date: string,
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
  personId?: string | null,
): boolean {
  if (!isRecurringTask(task)) return task.is_completed;
  const rows = occurrencesByKey.get(taskOccurrenceKey(task.id, date));
  if (!rows || rows.length === 0) return false;
  if (task.completion_mode === "per_assignee" && personId) {
    return rows.some((r) => r.person_id === personId && r.status === "done");
  }
  return rows.some((r) => r.person_id == null && r.status === "done");
}

/**
 * Unfinished, non-recurring, and its due date already passed.
 *
 * Answers for a task ROW, so a series is never overdue here - it has no single
 * deadline to have missed. Lateness for a repeat is per instance and is
 * {@link lateOccurrences}.
 */
export function isTaskOverdue(task: TaskSeries, today: string): boolean {
  if (task.is_completed || isRecurringTask(task)) return false;
  return task.due_date != null && task.due_date < today;
}

/**
 * A past instance nobody resolved. Asked of recurring instances only; a one-off
 * that slipped is `isTaskOverdue`, which is a different treatment.
 */
export function isMissedOccurrence(instance: TaskOccurrenceInstance, today: string): boolean {
  return instance.effectiveDate < today && !instance.isDone && !instance.isSkipped;
}

/** How far back unfinished instances of a repeat are still carried as debt. */
export const LATE_LOOKBACK_DAYS = 30;

/**
 * This instance has not come due yet, so it cannot be finished from a list.
 * Recurring only: a one-off's due date is a deadline (finishing early is
 * normal), a repeat's occurrence date is an appointment.
 */
export function isFutureOccurrence(
  task: Pick<TaskSeries, "recurrence_period">,
  effectiveDate: string,
  today: string,
): boolean {
  return isRecurringTask(task) && effectiveDate > today;
}

/**
 * Whether an instance has been dealt with, for the purpose of owing it.
 * `isDone` is whole-occurrence completion and is always false for a
 * `per_assignee` chore, so that shape is re-resolved per person: everybody it
 * was given to has ticked their own copy.
 */
function isInstanceResolved(
  task: TaskSeries,
  instance: TaskOccurrenceInstance,
  assigneeIds: readonly string[],
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
): boolean {
  if (instance.isDone || instance.isSkipped) return true;
  if (task.completion_mode !== "per_assignee" || assigneeIds.length === 0) return false;
  return assigneeIds.every((personId) =>
    isTaskDoneOn(task, instance.occurrenceDate, occurrencesByKey, personId),
  );
}

/**
 * The unresolved past instances of one repeating series, oldest first - the debt
 * the overdue block carries. Bounded by {@link LATE_LOOKBACK_DAYS} rather than by
 * the series' own start, and judged on `effectiveDate` throughout, so an instance
 * moved forward into next week is not late and one moved back into last week is.
 *
 * Mirrors `lateOccurrences` in src/utils/task.ts; expandTask.parity.test.ts
 * fails if the two ever disagree.
 */
export function lateOccurrences(
  task: TaskSeries,
  today: string,
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
  assigneeIds: readonly string[] = [],
  lookbackDays: number = LATE_LOOKBACK_DAYS,
): TaskOccurrenceInstance[] {
  if (!isRecurringTask(task)) return [];
  const from = addIsoDays(today, -Math.max(1, lookbackDays));
  const to = addIsoDays(today, -1);
  return expandTaskOccurrences(task, from, to, occurrencesByKey)
    .filter(
      (instance) =>
        isMissedOccurrence(instance, today) &&
        !isInstanceResolved(task, instance, assigneeIds, occurrencesByKey),
    )
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

// ---------------------------------------------------------------------------
// Occurrence resolution
// ---------------------------------------------------------------------------

/**
 * The row that carries an instance's WHOLE-OCCURRENCE state: the one with
 * `person_id IS NULL`. Placement (`moved_to_date`) and skipping are facts about
 * the occurrence, not about one assignee, so per-person rows only ever answer for
 * completion, via `isTaskDoneOn`.
 *
 * There is at most one such row per slot: `task_occurrences_unique_slot` is
 * UNIQUE NULLS NOT DISTINCT, so a second "the whole occurrence" row is rejected.
 */
function pickWholeOccurrenceRow(
  rows: TaskOccurrenceRecord[] | undefined,
): TaskOccurrenceRecord | undefined {
  return rows?.find((r) => r.person_id == null);
}

function wholeOccurrenceRow(
  taskId: string,
  occurrenceDate: string,
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
): TaskOccurrenceRecord | undefined {
  return pickWholeOccurrenceRow(occurrencesByKey.get(taskOccurrenceKey(taskId, occurrenceDate)));
}

/**
 * Where an instance sits: the relocation if one was ever recorded, else the
 * series date. Deliberately NOT gated on `status === 'moved'` - there is one row
 * per slot, so ticking off a moved occurrence flips its status to 'done' while
 * `moved_to_date` stays put.
 */
function effectiveDateOf(occurrenceDate: string, row: TaskOccurrenceRecord | undefined): string {
  return row?.moved_to_date ?? occurrenceDate;
}

/**
 * The task's relocated occurrences - every whole-occurrence row carrying a
 * `moved_to_date`, whatever its status. These are the only candidates for pass
 * (b): an instance whose series date sits outside the window can only be inside
 * it because a row moved it.
 *
 * O(rows in the map). The table is sparse by design (no row is the normal
 * state), and each candidate is then phase-tested in O(1) rather than walked to.
 */
function relocatedRowsFor(
  taskId: string,
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
): TaskOccurrenceRecord[] {
  const found: TaskOccurrenceRecord[] = [];
  if (occurrencesByKey.size === 0) return found;
  const prefix = `${taskId}|`;
  for (const [key, rows] of occurrencesByKey) {
    if (!key.startsWith(prefix)) continue;
    const row = pickWholeOccurrenceRow(rows);
    if (row?.moved_to_date != null) found.push(row);
  }
  return found;
}

/**
 * Whole-occurrence completion for one projected instance. 'per_assignee' has no
 * such fact - each assignee ticks their own row, and one tick does not finish the
 * occurrence, so the agenda keeps showing it and the digest keeps counting it.
 */
function isInstanceDone(
  task: TaskSeries,
  occurrenceDate: string,
  occurrencesByKey: Map<string, TaskOccurrenceRecord[]>,
): boolean {
  if (isRecurringTask(task) && task.completion_mode === "per_assignee") return false;
  return isTaskDoneOn(task, occurrenceDate, occurrencesByKey);
}

// ---------------------------------------------------------------------------
// The series rule
// ---------------------------------------------------------------------------

/**
 * One series' recurrence rule, resolved once. Both halves of the expansion read
 * it: the enumeration of the window, and the O(1) test of whether a single date
 * belongs to the series at all. Mirrors `SeriesRule` in src/utils/task.ts.
 */
type SeriesRule =
  | { kind: "single"; anchor: string }
  | { kind: "stepped"; anchor: string; period: "daily" | "monthly"; interval: number }
  | { kind: "weekly"; anchor: string; weekdays: number[]; interval: number };

/** Null for an undated task - a someday item belongs to no day at all. */
function seriesRule(task: TaskSeries): SeriesRule | null {
  const anchor = task.due_date;
  if (!anchor) return null;

  const period = task.recurrence_period;
  if (period == null || period === "one-time") return { kind: "single", anchor };

  const interval = normalizeInterval(task.recurrence_interval);
  if (period === "weekly") {
    return { kind: "weekly", anchor, weekdays: weeklyWeekdays(task), interval };
  }
  return { kind: "stepped", anchor, period, interval };
}

/**
 * The weekday set a weekly series actually fires on. An empty or absent
 * `recurrence_weekdays` means "the weekday due_date falls on" - the one place a
 * weekday is derived from a date, hence the Monday-first rotation, so Sunday is 6
 * and not JS's 0. Collapsing the two weekly shapes into one set means both go
 * through the same block enumeration.
 */
function weeklyWeekdays(task: TaskSeries): number[] {
  const explicit = normalizeWeekdays(task.recurrence_weekdays);
  if (explicit.length > 0) return explicit;
  return task.due_date ? [mondayFirstDow(task.due_date)] : [];
}

// ---------------------------------------------------------------------------
// Pass (a): the series' own dates inside the window
// ---------------------------------------------------------------------------

/**
 * `weekly`: every listed weekday of every `interval`-th week, counted from the
 * week containing the anchor. Blocks are whole Monday-first weeks, so a set of
 * {Mon, Fri} with interval 2 fires on both days of every other week rather than
 * drifting by the anchor's own weekday.
 */
function weeklyDatesInWindow(
  rule: Extract<SeriesRule, { kind: "weekly" }>,
  from: string,
  to: string,
): string[] {
  const { anchor, weekdays, interval } = rule;
  const dates: string[] = [];
  if (weekdays.length === 0) return dates;

  // Whole `interval`-week blocks skipped in one jump before the window opens.
  // Weeks before the anchor come out negative, hence the clamp.
  const skippable = Math.max(0, weeksBetweenIso(mondayOf(anchor), mondayOf(from)));
  let week = addIsoDays(mondayOf(anchor), 7 * (Math.floor(skippable / interval) * interval));

  while (week <= to && dates.length < MAX_TASK_INSTANCES) {
    for (const dayOfWeek of weekdays) {
      if (dates.length >= MAX_TASK_INSTANCES) break;
      const date = addIsoDays(week, dayOfWeek);
      // A series never reports an occurrence before it starts, and the block the
      // jump lands on straddles the window's near edge.
      if (date >= anchor && date >= from && date <= to) dates.push(date);
    }
    week = addIsoDays(week, 7 * interval);
  }
  return dates;
}

/**
 * `daily` and `monthly`: one date per step from the anchor. Monthly steps are
 * ANCHORED on the anchor's day of the month, so the day is re-derived at every
 * step instead of inherited from an already-clamped one: 31 -> 28 (Feb) -> 31
 * (Mar), not 31 -> 28 -> 28 forever.
 */
function steppedDatesInWindow(
  rule: Extract<SeriesRule, { kind: "stepped" }>,
  from: string,
  to: string,
): string[] {
  const { anchor, period, interval } = rule;
  const anchorDay = dayOfMonth(anchor);
  const step = (date: string): string =>
    period === "daily" ? addIsoDays(date, interval) : addMonthsAnchored(date, anchorDay, interval);

  // Jump whole steps to the window instead of stepping through years of history.
  // floor() lands at or before `from`, so nothing inside the window is jumped
  // over; the cap is then spent on the window itself rather than on getting there.
  let current = anchor;
  if (period === "daily") {
    const gap = daysBetweenIso(anchor, from);
    if (gap > 0) current = addIsoDays(anchor, Math.floor(gap / interval) * interval);
  } else {
    const gap = monthsBetweenIso(anchor, from);
    if (gap > 0)
      current = addMonthsAnchored(anchor, anchorDay, Math.floor(gap / interval) * interval);
  }

  const dates: string[] = [];
  while (current <= to && dates.length < MAX_TASK_INSTANCES) {
    // The jump lands at or before `from`, so the first step or two can still be
    // outside the window; they cost an iteration, never a slot of the cap.
    if (current >= from) dates.push(current);
    const next = step(current);
    // Structural termination guard: every step must move the date forward, so the
    // loop is bounded by `to` even if a row carries a nonsense interval.
    if (next <= current) break;
    current = next;
  }
  return dates;
}

/**
 * Pass (a): the series' own dates inside `[from, to]`, oldest first, with no
 * rows applied. `to` is expected to be clipped by `recurrence_until` already.
 */
function seriesDatesInWindow(rule: SeriesRule, from: string, to: string): string[] {
  if (rule.kind === "single") {
    return rule.anchor >= from && rule.anchor <= to ? [rule.anchor] : [];
  }
  if (rule.kind === "weekly") return weeklyDatesInWindow(rule, from, to);
  return steppedDatesInWindow(rule, from, to);
}

// ---------------------------------------------------------------------------
// Pass (b): the O(1) phase test
// ---------------------------------------------------------------------------

/**
 * Whether `date` is one of the rule's own dates, ignoring any window. O(1) - a
 * phase/alignment test, never a walk - which is what makes pass (b) exact and
 * cheap: an occurrence relocated INTO the window from an arbitrary distance away
 * is checked, not searched for.
 *
 * It answers the same question the enumeration does, from the other end: right
 * phase (whole `interval` steps from the anchor), right shape (a listed weekday,
 * or the anchored day of the month), and never before the anchor. A row left
 * behind by a rule that has since changed fails the test and is ignored.
 */
function isSeriesDate(rule: SeriesRule, date: string): boolean {
  if (date < rule.anchor) return false;
  if (rule.kind === "single") return date === rule.anchor;

  if (rule.kind === "weekly") {
    if (!rule.weekdays.includes(mondayFirstDow(date))) return false;
    const weeks = weeksBetweenIso(mondayOf(rule.anchor), mondayOf(date));
    return weeks >= 0 && weeks % rule.interval === 0;
  }

  if (rule.period === "daily") {
    const gap = daysBetweenIso(rule.anchor, date);
    return gap >= 0 && gap % rule.interval === 0;
  }

  const months = monthsBetweenIso(rule.anchor, date);
  if (months < 0 || months % rule.interval !== 0) return false;
  // The day has to be the ANCHORED one for that month: a series due on the 31st
  // lands on 28 February, not on the 27th and not on the 1st of March.
  return addMonthsAnchored(rule.anchor, dayOfMonth(rule.anchor), months) === date;
}

/** 1..52 per the CHECK constraint; anything unusable degrades to 1. */
function normalizeInterval(interval: number | null | undefined): number {
  if (interval == null || !Number.isFinite(interval)) return 1;
  return Math.max(1, Math.floor(interval));
}

/** Sorted, de-duplicated, 0 = Monday .. 6 = Sunday. Junk values are dropped. */
function normalizeWeekdays(weekdays: number[] | null | undefined): number[] {
  if (!weekdays || weekdays.length === 0) return [];
  const seen = new Set<number>();
  for (const raw of weekdays) {
    const d = Math.floor(raw);
    if (Number.isFinite(d) && d >= 0 && d <= 6) seen.add(d);
  }
  return [...seen].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Date helpers - plain YYYY-MM-DD string math, computed in UTC so no timezone
// or DST can shift a calendar day. Mirrors utils/date.ts, which does the same
// with date-fns at local noon.
// ---------------------------------------------------------------------------

function addIsoDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`; negative when `b` is the earlier one. */
function daysBetweenIso(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Whole calendar months from `a` to `b`; negative when `b` is the earlier one. */
function monthsBetweenIso(a: string, b: string): number {
  const years = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  const months = Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  return years * 12 + months;
}

/** Whole weeks between two Mondays; negative when `b` is the earlier one. */
function weeksBetweenIso(aMonday: string, bMonday: string): number {
  return Math.round(daysBetweenIso(aMonday, bMonday) / 7);
}

/** 0 = Monday .. 6 = Sunday, the schema's convention. */
function mondayFirstDow(dateStr: string): number {
  // getUTCDay is 0 = Sunday .. 6 = Saturday, hence the rotation.
  return (new Date(`${dateStr}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Monday of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  return addIsoDays(dateStr, -mondayFirstDow(dateStr));
}

function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/**
 * `count` months on, with the day taken from `anchorDay` and clamped to the
 * target month's length: the same result as
 * `addMonthAnchored(dateStr, anchorDay, count)` in utils/date.ts.
 */
function addMonthsAnchored(dateStr: string, anchorDay: number, count: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const monthIndex = year * 12 + (month - 1) + count;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = (monthIndex % 12) + 1;
  const day = Math.min(
    anchorDay >= 1 && anchorDay <= 31 ? anchorDay : dayOfMonth(dateStr),
    daysInMonth(targetYear, targetMonth),
  );
  return `${pad4(targetYear)}-${pad2(targetMonth)}-${pad2(day)}`;
}

/** Day 0 of the following month is the last day of this one. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}
