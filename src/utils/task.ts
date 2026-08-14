import { addDays, format, parseISO } from "date-fns";
import type { Task, TaskOccurrence } from "@/types/database";
import { DAY_LABELS_SHORT, getWeekStart, toMondayFirstDow, weeksBetween } from "@/utils/activity";
import {
  addMonthAnchored,
  addWeek,
  dayOfMonth,
  daysBetween,
  formatDate,
  parseDate,
} from "@/utils/date";

/**
 * Pure helpers for tasks: the series walk, the two homes of completion, and the
 * recurrence label. Kept free of React and Supabase - importing anything whose
 * chain reaches `lib/supabase` breaks CI, which has no Supabase env - so
 * `useAgenda`, the kid shell, the digest parity tests and the unit tests can all
 * project a series exactly the same way.
 *
 * Weekday indexes here are the schema's: 0 = Monday .. 6 = Sunday, matching
 * `activity_schedule.day_of_week` and `tasks.recurrence_weekdays`. A raw JS
 * `getDay()` (0 = Sunday) is never stored or compared - `toMondayFirstDow` from
 * utils/activity.ts is the only bridge between the two.
 *
 * The expansion has two halves, because "which instances land in this window" is
 * two questions:
 *
 *   a. the series' OWN dates inside `[from, to]`, reached by fast-forwarding to
 *      `from` in one jump - never by stepping through the years since the anchor;
 *   b. the instances whose SERIES date sits OUTSIDE the window but which an
 *      occurrence row RELOCATED into it. Those cannot be found by walking the
 *      window at all, so the candidates are read off the (sparse) occurrence
 *      rows and each one is phase-tested against the rule in O(1).
 *
 * Together they are exact - no lookback window to guess at - and cost O(window)
 * plus O(occurrence rows), which is why `supabase/functions/_shared/expandTask.ts`
 * can implement the identical rule for the digest. `expandTask.parity.test.ts`
 * feeds one generated corpus to both and fails if they ever disagree.
 *
 * WHERE an instance sits is `moved_to_date`, and WHETHER it is resolved is
 * `status`. They are independent: there is one row per slot, so ticking off an
 * occurrence that was moved flips `status` to 'done' while `moved_to_date` stays
 * put. Reading placement off `status === 'moved'` would snap such an instance
 * back to its series date wearing a checkmark.
 */

/**
 * Runaway guard - a year plus a leap day of instances. It bounds the ENUMERATION
 * of the window only (step a below); the moved-in pass is bounded by the number
 * of occurrence rows instead, which is what makes a daily chore anchored years
 * back still report every day of the window.
 */
const MAX_INSTANCES = 366;

/** `${taskId}|${occurrenceDate}` - the key shape useTaskOccurrences returns. */
export function taskOccurrenceKey(taskId: string, occurrenceDate: string): string {
  return `${taskId}|${occurrenceDate}`;
}

/** True when this task repeats. One-time and null both mean "does not". */
export function isRecurringTask(task: Pick<Task, "recurrence_period">): boolean {
  const period = task.recurrence_period;
  return period != null && period !== "one-time";
}

/* ------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/*                                                                            */
/* Pick-typed the way utils/event.ts is, so a partial select (a global-search  */
/* row, a projected kid card) can use these too. Every real surface passes a   */
/* full `Task`.                                                               */
/* ------------------------------------------------------------------------- */

/** What the series walk reads. */
type TaskSeriesFields = Pick<
  Task,
  | "due_date"
  | "recurrence_period"
  | "recurrence_interval"
  | "recurrence_weekdays"
  | "recurrence_until"
>;

/** What completion resolution reads. */
type TaskCompletionFields = Pick<
  Task,
  "id" | "is_completed" | "recurrence_period" | "completion_mode"
>;

/** What the recurrence label reads. */
type TaskLabelFields = Pick<
  Task,
  "recurrence_period" | "recurrence_interval" | "recurrence_weekdays" | "recurrence_until"
>;

/* ------------------------------------------------------------------------- */
/* The series rule                                                            */
/* ------------------------------------------------------------------------- */

/** `dateStr` + `count` days as YYYY-MM-DD, noon-anchored like utils/date.ts. */
function addDayStr(dateStr: string, count: number): string {
  return format(addDays(parseISO(dateStr + "T12:00:00"), count), "yyyy-MM-dd");
}

/** Whole calendar months from `a` to `b`; negative when `b` is the earlier one. */
function monthsBetween(a: string, b: string): number {
  const [aYear, aMonth] = a.slice(0, 7).split("-").map(Number);
  const [bYear, bMonth] = b.slice(0, 7).split("-").map(Number);
  return (bYear - aYear) * 12 + (bMonth - aMonth);
}

/** 1..52 per the CHECK constraint; anything unusable degrades to 1. */
function normalizeInterval(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

/**
 * Sorted, deduped, 0-6 clamped weekday set. Defensive because the column is a
 * bare `SMALLINT[]`: a hand-written row can carry a 7, a duplicate or a null.
 */
function normalizeWeekdays(raw: number[] | null | undefined): number[] {
  const clean = (raw ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return [...new Set(clean)].toSorted((a, b) => a - b);
}

/**
 * The weekday set a weekly series actually fires on. An empty or absent
 * `recurrence_weekdays` means "the weekday `due_date` falls on", which is the
 * one place a weekday gets derived from a date - hence `toMondayFirstDow`, so
 * Sunday is 6 and not JS's 0. Collapsing the two weekly shapes into one set
 * means both go through the same block enumeration.
 */
function weeklyWeekdays(task: TaskSeriesFields): number[] {
  const explicit = normalizeWeekdays(task.recurrence_weekdays);
  if (explicit.length > 0) return explicit;
  return task.due_date ? [toMondayFirstDow(parseDate(task.due_date).getDay())] : [];
}

/**
 * One series' recurrence rule, resolved once. Both halves of the expansion read
 * it: the enumeration of the window, and the O(1) test of whether a single date
 * belongs to the series at all.
 */
type SeriesRule =
  | { kind: "single"; anchor: string }
  | { kind: "stepped"; anchor: string; period: "daily" | "monthly"; interval: number }
  | { kind: "weekly"; anchor: string; weekdays: number[]; interval: number };

/** Null for an undated task - a someday item belongs to no day at all. */
function seriesRule(task: TaskSeriesFields): SeriesRule | null {
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
  const skippable = Math.max(0, weeksBetween(getWeekStart(anchor), getWeekStart(from)));
  let week = addWeek(getWeekStart(anchor), Math.floor(skippable / interval) * interval);

  while (week <= to && dates.length < MAX_INSTANCES) {
    for (const dayOfWeek of weekdays) {
      if (dates.length >= MAX_INSTANCES) break;
      const date = addDayStr(week, dayOfWeek);
      // A series never reports an occurrence before it starts, and the block the
      // jump lands on straddles the window's near edge.
      if (date >= anchor && date >= from && date <= to) dates.push(date);
    }
    week = addWeek(week, interval);
  }
  return dates;
}

/**
 * `daily` and `monthly`: one date per step from the anchor. Monthly steps are
 * ANCHORED on the anchor's day of month (`addMonthAnchored`), so the day is
 * re-derived at every step instead of inherited from an already-clamped one:
 * 31 -> 28 (Feb) -> 31 (Mar), not 31 -> 28 -> 28 forever.
 */
function steppedDatesInWindow(
  rule: Extract<SeriesRule, { kind: "stepped" }>,
  from: string,
  to: string,
): string[] {
  const { anchor, period, interval } = rule;
  const anchorDay = dayOfMonth(anchor);
  const step = (date: string): string =>
    period === "daily" ? addDayStr(date, interval) : addMonthAnchored(date, anchorDay, interval);

  // Jump whole steps to the window instead of stepping through years of history:
  // a chore that has repeated daily since 2024 would otherwise spend its whole
  // MAX_INSTANCES budget getting to this month and report nothing. floor() lands
  // at or before `from`, so nothing inside the window can be jumped over.
  let current = anchor;
  if (period === "daily") {
    const gap = daysBetween(parseDate(anchor), parseDate(from));
    if (gap > 0) current = addDayStr(anchor, Math.floor(gap / interval) * interval);
  } else {
    const gap = monthsBetween(anchor, from);
    if (gap > 0)
      current = addMonthAnchored(anchor, anchorDay, Math.floor(gap / interval) * interval);
  }

  const dates: string[] = [];
  while (current <= to && dates.length < MAX_INSTANCES) {
    // The jump lands at or before `from`, so the first step or two can still be
    // outside the window; they cost an iteration, never a slot of the cap.
    if (current >= from) dates.push(current);
    const next = step(current);
    // Structural termination guard: every step must move the date forward, so
    // the loop is bounded by `to` even if a row carries a nonsense interval.
    if (next <= current) break;
    current = next;
  }
  return dates;
}

/**
 * Step (a): the series' own dates inside `[from, to]`, oldest first, with no
 * overrides applied. `to` is expected to be clipped by `recurrence_until`
 * already - which is INCLUSIVE, so it only ever pulls the end in.
 *
 * Enumerating the window directly (rather than walking from `due_date`) is what
 * keeps a two-year-old daily chore cheap; the anchor still bounds the near end,
 * so a series can never report a date BEFORE it starts - the rule
 * `walkOccurrenceDates` follows for payments.
 */
function seriesDatesInWindow(rule: SeriesRule, from: string, to: string): string[] {
  if (rule.kind === "single") {
    return rule.anchor >= from && rule.anchor <= to ? [rule.anchor] : [];
  }
  if (rule.kind === "weekly") return weeklyDatesInWindow(rule, from, to);
  return steppedDatesInWindow(rule, from, to);
}

/**
 * Whether `date` is one of the rule's own dates, ignoring any window. O(1) - a
 * phase/alignment test, never a walk - which is what makes step (b) of the
 * expansion exact and cheap: an occurrence relocated INTO the window from an
 * arbitrary distance away is checked, not searched for.
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
    if (!rule.weekdays.includes(toMondayFirstDow(parseDate(date).getDay()))) return false;
    const weeks = weeksBetween(getWeekStart(rule.anchor), getWeekStart(date));
    return weeks >= 0 && weeks % rule.interval === 0;
  }

  if (rule.period === "daily") {
    const gap = daysBetween(parseDate(rule.anchor), parseDate(date));
    return gap >= 0 && gap % rule.interval === 0;
  }

  const months = monthsBetween(rule.anchor, date);
  if (months < 0 || months % rule.interval !== 0) return false;
  // The day has to be the ANCHORED one for that month: a series due on the 31st
  // lands on 28 February, not on the 27th and not on the 1st of March.
  return addMonthAnchored(rule.anchor, dayOfMonth(rule.anchor), months) === date;
}

/* ------------------------------------------------------------------------- */
/* Expansion                                                                  */
/* ------------------------------------------------------------------------- */

export interface TaskOccurrenceInstance {
  /** The series date this instance came from - what occurrence rows key on. */
  occurrenceDate: string;
  /** Where it actually shows - `moved_to_date` when one was set, else occurrenceDate. */
  effectiveDate: string;
  /** Resolved state for this instance, if any row exists. */
  occurrence: TaskOccurrence | undefined;
  /**
   * Whole-occurrence completion. For `completion_mode: 'per_assignee'` this is
   * never true - completion there is one fact per assignee, not one per
   * occurrence - so the row layer calls `isTaskDoneOn` with the viewer's
   * `personId` instead. This is the one place it says less than `isTaskDoneOn`,
   * which asked without a person falls back to a shared tick.
   */
  isDone: boolean;
  isSkipped: boolean;
}

/**
 * The row that carries this instance's WHOLE-OCCURRENCE state: the one with
 * `person_id IS NULL`. Placement (`moved_to_date`) and skipping are facts about
 * the occurrence - the detail sheet acts on "this Tuesday", not on one assignee -
 * so per-person rows only ever answer for completion, via `isTaskDoneOn`.
 *
 * There is at most one such row per slot: `task_occurrences_unique_slot` is
 * UNIQUE NULLS NOT DISTINCT, so a second "the whole occurrence" row is rejected.
 */
function pickWholeOccurrenceRow(rows: TaskOccurrence[] | undefined): TaskOccurrence | undefined {
  return rows?.find((row) => row.person_id == null);
}

function wholeOccurrenceRow(
  taskId: string,
  occurrenceDate: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): TaskOccurrence | undefined {
  return pickWholeOccurrenceRow(occurrencesByKey.get(taskOccurrenceKey(taskId, occurrenceDate)));
}

/**
 * Where an instance sits: the relocation if one was ever recorded, else the
 * series date. Deliberately NOT gated on `status === 'moved'` - there is one row
 * per slot, so ticking off a moved occurrence flips its status to 'done' while
 * `moved_to_date` stays put. Reading placement off the status would snap that
 * instance back to Monday wearing Wednesday's checkmark.
 */
function effectiveDateOf(occurrenceDate: string, row: TaskOccurrence | undefined): string {
  return row?.moved_to_date ?? occurrenceDate;
}

/**
 * The task's relocated occurrences - every whole-occurrence row carrying a
 * `moved_to_date`, whatever its status. These are the only candidates for step
 * (b): an instance whose series date sits outside the window can only be inside
 * it because a row moved it, and no enumeration of the window would ever reach
 * that series date.
 *
 * O(rows in the map). The table is sparse by design (no row is the normal
 * state), and each candidate is then phase-tested in O(1) rather than walked to.
 */
function relocatedRowsFor(
  taskId: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): TaskOccurrence[] {
  const found: TaskOccurrence[] = [];
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
 * Whole-occurrence completion for one projected instance. `per_assignee` has no
 * such fact - each assignee ticks their own row, and one tick does not finish
 * the occurrence - so it stays false there and the row layer re-resolves with
 * the viewer's person id through `isTaskDoneOn`.
 */
function isInstanceDone(
  task: TaskCompletionFields,
  occurrenceDate: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): boolean {
  if (isRecurringTask(task) && task.completion_mode === "per_assignee") return false;
  return isTaskDoneOn(task, occurrenceDate, occurrencesByKey);
}

/**
 * Every instance of `task` whose EFFECTIVE date falls in [from, to], inclusive.
 *
 * Mirrors `expandPaymentOccurrences`' signature on purpose so the `useAgenda`
 * arm reads like its neighbours. A non-recurring task yields at most one
 * instance (its `due_date`); a recurring one is projected in two passes:
 *
 *   a. `seriesDatesInWindow` - the rule's own dates in the window, jumped to;
 *   b. `relocatedRowsFor` - the instances a row moved INTO the window from a
 *      series date outside it, each phase-tested in O(1) and bounded by
 *      `recurrence_until` (inclusive), never by `to`: an occurrence dragged
 *      BACKWARDS from next month belongs in this window too.
 *
 * SKIPPED instances are still returned, flagged - the agenda layer decides to
 * drop them, this function only reports what the series and its rows say. This
 * is the one deliberate difference from payments, which drops its cancels here.
 *
 * Ordered by SERIES date, so an instance moved in can lead; every day-shaped
 * surface buckets by `effectiveDate` anyway.
 */
export function expandTaskOccurrences(
  task: TaskSeriesFields & TaskCompletionFields,
  from: string,
  to: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): TaskOccurrenceInstance[] {
  const rule = seriesRule(task);
  if (rule === null) return [];

  // `recurrence_until` is inclusive, so it only ever pulls the end in.
  const until = task.recurrence_until;
  const windowEnd = until && until < to ? until : to;

  const seriesDates = seriesDatesInWindow(rule, from, windowEnd);
  const covered = new Set(seriesDates);

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

/* ------------------------------------------------------------------------- */
/* Completion - the only place that knows it has two homes                    */
/* ------------------------------------------------------------------------- */

/**
 * THE single place that knows completion has two homes: `tasks.is_completed` for
 * a non-recurring task (the path the shipped lists UI writes, and a CHECK
 * constraint keeps a recurring task out of it), a `task_occurrences` row for a
 * recurring one. No row means unresolved.
 *
 * `date` is the SERIES date (`TaskOccurrenceInstance.occurrenceDate`), not the
 * effective one, because that is what occurrence rows key on - a moved
 * occurrence is still ticked under the date the series says it belongs to. For a
 * non-recurring task `date` is ignored: its truth is a single boolean.
 *
 * `personId` matters only for `completion_mode: 'per_assignee'`, where each
 * assignee ticks their own row; 'shared' resolves on the whole-occurrence row
 * (`person_id IS NULL`) and ignores it.
 *
 * Asked WITHOUT a person, `per_assignee` falls back to the whole-occurrence row:
 * a task switched from 'shared' to 'per_assignee' mid-life keeps the shared ticks
 * it collected, and dropping them would un-finish history. Only a 'done' row ever
 * counts - 'skipped' and 'moved' are resolutions, not completions.
 */
export function isTaskDoneOn(
  task: TaskCompletionFields,
  date: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  personId?: string | null,
): boolean {
  if (!isRecurringTask(task)) return task.is_completed;
  const rows = occurrencesByKey.get(taskOccurrenceKey(task.id, date));
  if (!rows || rows.length === 0) return false;
  if (task.completion_mode === "per_assignee" && personId) {
    return rows.some((row) => row.person_id === personId && row.status === "done");
  }
  return rows.some((row) => row.person_id == null && row.status === "done");
}

/** Who ticked an instance off, and when. */
export type TaskCompletionStamp = {
  /** ISO timestamp of the tick. Null on rows written before it was recorded. */
  at: string | null;
  /** `profiles.id`, never an auth uid - a child ticking their chore is a person. */
  personId: string | null;
};

/**
 * The same lookup {@link isTaskDoneOn} does, returning WHO and WHEN instead of a
 * boolean - null when the instance is not done.
 *
 * Anyone in the family can tick anything, so "završeno" on its own says nothing
 * about who decided that; this is what lets the detail sheet name them. Both
 * homes stamp it (`useUpdateTask` for the row, the occurrence writers for a
 * repeat), but rows ticked before the stamp existed carry nulls - hence a stamp
 * that can be present with nothing in it.
 */
export function taskCompletionOn(
  task: TaskCompletionFields & Pick<Task, "completed_at" | "completed_by_person_id">,
  date: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  personId?: string | null,
): TaskCompletionStamp | null {
  if (!isRecurringTask(task)) {
    if (!task.is_completed) return null;
    return { at: task.completed_at, personId: task.completed_by_person_id };
  }
  const rows = occurrencesByKey.get(taskOccurrenceKey(task.id, date));
  if (!rows || rows.length === 0) return null;
  const done =
    task.completion_mode === "per_assignee" && personId
      ? rows.find((row) => row.person_id === personId && row.status === "done")
      : rows.find((row) => row.person_id == null && row.status === "done");
  if (!done) return null;
  return { at: done.completed_at, personId: done.completed_by_person_id };
}

/* ------------------------------------------------------------------------- */
/* Overdue and missed                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Unfinished, non-recurring, and its due date already passed - the tasks the
 * overdue block carries forward day after day until they are dealt with.
 *
 * This answers for a task ROW, which is why a repeating task is never overdue
 * here: a series has no single deadline to have missed. Lateness for a repeat is
 * per instance and is {@link lateOccurrences}, which the overdue block reads
 * alongside this. (Decision 6 of plan 015 said a missed Tuesday is not a debt at
 * all; plan 017 kept the row-level half of that and reversed the instance-level
 * half, because a debt nobody can see is a debt nobody pays.) Undated tasks
 * cannot be late either - they are somebody's someday list.
 */
export function isTaskOverdue(
  task: Pick<Task, "due_date" | "is_completed" | "recurrence_period">,
  today: string,
): boolean {
  if (isRecurringTask(task)) return false;
  if (task.is_completed) return false;
  if (!task.due_date) return false;
  return task.due_date < today;
}

/**
 * A past instance nobody resolved - rendered struck through on the day it was
 * due and never carried over. Keyed on `effectiveDate`, so a moved occurrence is
 * judged by where it landed. Skipped instances were resolved, so they are not
 * missed; today's is not missed yet.
 *
 * Instance-shaped on purpose: it answers for one projected occurrence. The
 * one-off case belongs to `isTaskOverdue`, which the overdue block reads
 * straight off the task rows.
 */
export function isMissedOccurrence(instance: TaskOccurrenceInstance, today: string): boolean {
  return instance.effectiveDate < today && !instance.isDone && !instance.isSkipped;
}

/**
 * Whether a skipped instance should drop off this viewer's lists.
 *
 * Skipping exists to take a called-off day off the board, so the answer is
 * normally yes - EXCEPT for somebody who had already finished their own part of
 * it. Their work is not undone by the rest of the day being called off, and
 * having the row vanish from under them contradicts what the skip confirmation
 * promises ("ostaje zabeleženo"). They keep it, ticked and struck through.
 *
 * Only `per_assignee` can reach that state: under `shared` the completion IS the
 * whole-occurrence row, so a skip would have to overwrite it - which is why a
 * finished day cannot be skipped at all (see `occurrenceDone` in
 * TaskDetailSheet). `isTaskDoneOn` reads the shared row there and answers false
 * for a skipped one, so the two cases need no branch here.
 *
 * A DISPLAY rule, deliberately not mirrored in
 * `supabase/functions/_shared/expandTask.ts`: the digest and the reminder pushes
 * ask "should we chase somebody about this", and the answer for a day that was
 * called off and that they have already done is no, whoever they are.
 */
export function isHiddenBySkip(
  task: TaskCompletionFields,
  instance: TaskOccurrenceInstance,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  viewerPersonId: string | null | undefined,
): boolean {
  if (!instance.isSkipped) return false;
  if (!viewerPersonId) return true;
  return !isTaskDoneOn(task, instance.occurrenceDate, occurrencesByKey, viewerPersonId);
}

/**
 * How far back a repeating task's unfinished instances are still carried as
 * debt. Past that they are history and live only in the detail sheet's
 * "Istorija" - a daily chore abandoned in spring is not two hundred rows of
 * guilt on the dashboard.
 */
export const LATE_LOOKBACK_DAYS = 30;

/**
 * This instance has not come due yet, so it cannot be finished from a list.
 *
 * Recurring only, and that asymmetry is the point: a one-off's `due_date` is a
 * DEADLINE, and paying a bill or buying the milk early is normal, while a
 * repeat's occurrence date is an APPOINTMENT - tomorrow's dishes cannot be done
 * today, and a circle offering to say they were is how a week of meaningless
 * `done` rows gets written by one thumb on a week strip.
 *
 * The detail sheet deliberately ignores this and lets the tick through with a
 * different label: "I did it in advance" is real, and two taps is the right
 * price for it.
 */
export function isFutureOccurrence(
  task: Pick<Task, "recurrence_period">,
  effectiveDate: string,
  today: string,
): boolean {
  return isRecurringTask(task) && effectiveDate > today;
}

/**
 * Whether an instance has been dealt with, for the purpose of owing it.
 *
 * `TaskOccurrenceInstance.isDone` is whole-occurrence completion and is
 * therefore ALWAYS false for a `per_assignee` chore - completion there is one
 * fact per person, not one per occurrence. Taken at face value that would report
 * a chore all three assignees finished last Tuesday as still owed, so this
 * re-resolves it the way the row layer does: everybody who was given it has
 * ticked their own copy.
 *
 * With no assignees a `per_assignee` chore has nobody to have finished it, so it
 * falls back to the shared answer `isDone` already gave.
 *
 * `assigneeIds` is WHOSE ANSWER IS BEING ASKED FOR, not simply who the task
 * belongs to - which is what makes a person rail work. Pass the whole assignee
 * list for the family's answer ("is this chore done?"); pass the people the rail
 * has picked for theirs ("does Milan still owe this?"). Every count and every
 * late list on /tasks goes through here, so the two questions can never be
 * answered by two different rules.
 */
export function isInstanceResolved(
  task: TaskCompletionFields,
  instance: TaskOccurrenceInstance,
  assigneeIds: readonly string[],
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): boolean {
  if (instance.isDone || instance.isSkipped) return true;
  if (task.completion_mode !== "per_assignee" || assigneeIds.length === 0) return false;
  return assigneeIds.every((personId) =>
    isTaskDoneOn(task, instance.occurrenceDate, occurrencesByKey, personId),
  );
}

/**
 * The unresolved past instances of one repeating series, oldest first - the debt
 * the overdue block carries.
 *
 * Bounded by {@link LATE_LOOKBACK_DAYS} rather than by the series' own start, so
 * the cost is a fixed window whatever the anchor is. Judged on `effectiveDate`
 * throughout (via `isMissedOccurrence`), which is what makes a move do what it
 * says: an instance dragged forward into next week is not late, and one dragged
 * back into last week is.
 *
 * Empty for a non-recurring task - that one is `isTaskOverdue`, and a task
 * counted by both would be told off twice for the same thing.
 */
export function lateOccurrences(
  task: TaskSeriesFields & TaskCompletionFields,
  today: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  assigneeIds: readonly string[] = [],
  lookbackDays: number = LATE_LOOKBACK_DAYS,
): TaskOccurrenceInstance[] {
  if (!isRecurringTask(task)) return [];
  const from = addDayStr(today, -Math.max(1, lookbackDays));
  const to = addDayStr(today, -1);
  return expandTaskOccurrences(task, from, to, occurrencesByKey)
    .filter(
      (instance) =>
        isMissedOccurrence(instance, today) &&
        !isInstanceResolved(task, instance, assigneeIds, occurrencesByKey),
    )
    .toSorted((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

/* ------------------------------------------------------------------------- */
/* Label                                                                      */
/* ------------------------------------------------------------------------- */

/** Weekday sets that have a name of their own, as their normalized join. */
const EVERY_DAY_SET = "0,1,2,3,4,5,6";
const WORKDAY_SET = "0,1,2,3,4";
const WEEKEND_SET = "5,6";

/** "Pon, Sre" - short day labels in Monday-first order. */
function weekdayListLabel(weekdays: number[]): string {
  return weekdays.map((day) => DAY_LABELS_SHORT[day] ?? "?").join(", ");
}

/** The cadence phrase, before any `recurrence_until` suffix. */
function recurrenceBaseLabel(
  period: "daily" | "weekly" | "monthly",
  interval: number,
  rawWeekdays: number[] | null | undefined,
): string {
  if (period === "daily") {
    if (interval === 1) return "Svaki dan";
    return interval <= 4 ? `Svaka ${interval} dana` : `Svakih ${interval} dana`;
  }

  if (period === "monthly") {
    if (interval === 1) return "Mesečno";
    return interval <= 4 ? `Svaka ${interval} meseca` : `Svakih ${interval} meseci`;
  }

  const cadence = interval === 1 ? "Nedeljno" : `Svake ${interval} nedelje`;
  const weekdays = normalizeWeekdays(rawWeekdays);
  // No weekday set means "the day it started on", which needs no naming.
  if (weekdays.length === 0) return cadence;

  const asKey = weekdays.join(",");
  if (interval === 1) {
    if (asKey === EVERY_DAY_SET) return "Svaki dan";
    if (asKey === WORKDAY_SET) return "Radnim danima";
    if (asKey === WEEKEND_SET) return "Vikendom";
    return weekdayListLabel(weekdays);
  }
  return `${cadence} (${weekdayListLabel(weekdays)})`;
}

/**
 * The repeat rule in one phrase, for the row meta line and the detail sheet's
 * "Ponavljanje" row. Null when the task does not repeat.
 *
 * Paucal grammar follows `recurrenceLabel` in utils/payment.ts: the 2-4 vs 5+
 * split is `svaka dva dana` (paucal) against `svakih pet dana` (plural
 * genitive), while weeks (nedelja, feminine) take `nedelje` for every paucal
 * value - which is what speakers actually say.
 *
 *   daily,   interval 1     -> "Svaki dan"
 *   daily,   interval 2-4   -> "Svaka 3 dana"
 *   daily,   interval 5+    -> "Svakih 10 dana"
 *   weekly,  no weekday set -> "Nedeljno" / "Svake 2 nedelje"
 *   weekly,  Mon-Fri        -> "Radnim danima"
 *   weekly,  Sat + Sun      -> "Vikendom"
 *   weekly,  Mon + Wed      -> "Pon, Sre"
 *   weekly,  every 2 weeks  -> "Svake 2 nedelje (Pon, Sre)"
 *   monthly, interval 1/3/6 -> "Mesečno" / "Svaka 3 meseca" / "Svakih 6 meseci"
 *
 * A bounded series appends its inclusive last day: "Nedeljno do 31.12.2026".
 */
export function taskRecurrenceLabel(task: TaskLabelFields): string | null {
  const period = task.recurrence_period;
  if (period == null || period === "one-time") return null;
  const interval = normalizeInterval(task.recurrence_interval);
  const base = recurrenceBaseLabel(period, interval, task.recurrence_weekdays);
  return task.recurrence_until ? `${base} do ${formatDate(task.recurrence_until)}` : base;
}
