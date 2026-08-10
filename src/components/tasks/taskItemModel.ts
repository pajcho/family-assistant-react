import type { AgendaItem } from "@/hooks/useAgenda";
import type { Task, TaskOccurrence } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import { expandTaskOccurrences, isMissedOccurrence, isRecurringTask } from "@/utils/task";
import type { TaskOccurrenceInstance } from "@/utils/task";

/**
 * The /tasks screens' row model: how a task row is shaped, which instance it
 * stands for, whose tick it carries and whether a person filter lets it through.
 *
 * Pure and total, and - like `utils/task.ts` - it MUST NOT import anything whose
 * chain reaches `lib/supabase`: CI has no Supabase env, so an import chain that
 * touches the client is what breaks the tests there. The hooks that feed these
 * helpers from the query cache live next door in `taskItems.ts`.
 *
 * The output is `AgendaItem` of `kind: "task"`, which is what `TaskRow` and
 * `TaskDetailSheet` take, so a task row looks and behaves the same on Danas and
 * on /tasks without a second row component.
 */

export type TaskAgendaItem = Extract<AgendaItem, { kind: "task" }>;

/** Narrow the task-only overdue list (`useOverdueTasks`) back to its arm. */
export function isTaskAgendaItem(item: AgendaItem): item is TaskAgendaItem {
  return item.kind === "task";
}

/**
 * The person-rail predicate. An EMPTY selection means "everybody", the same
 * convention the dashboard filters and the activities chips use - and a task with
 * no assignees is family-wide, so it belongs to nobody in particular and is
 * filtered OUT the moment a person is picked.
 */
export function matchesPersonFilter(item: TaskAgendaItem, personIds: ReadonlySet<string>): boolean {
  if (personIds.size === 0) return true;
  return item.assigneeIds.some((id) => personIds.has(id));
}

/**
 * Sort key mirroring `useAgenda`'s: a timed task at its minute, an all-day one
 * after every timed minute of the day. Duplicated rather than exported from the
 * agenda because it is three lines and importing `useAgenda` here would pull the
 * whole six-source hook into a screen that wants one of them.
 */
const ALL_DAY_SORT_KEY = 24 * 60 + 1;

function sortKeyFor(dueTime: string | null): number {
  if (!dueTime) return ALL_DAY_SORT_KEY;
  const [hours, minutes] = dueTime.split(":").map(Number);
  return hours * 60 + minutes;
}

/** One agenda-shaped row for one projected instance of `task`. */
export function taskAgendaItem(
  task: Task,
  instance: TaskOccurrenceInstance,
  assigneeIds: string[],
  today: string,
): TaskAgendaItem {
  const dueTime = task.due_time ? normalizeTime(task.due_time) : null;
  return {
    kind: "task",
    date: instance.effectiveDate,
    sortKey: sortKeyFor(dueTime),
    task,
    occurrenceDate: instance.occurrenceDate,
    dueTime,
    assigneeIds,
    isDone: instance.isDone,
    // Recurring only, exactly as `useAgenda` decides it: a one-off that slipped
    // is carried over by the overdue block instead of being struck in place.
    missed: isRecurringTask(task) && isMissedOccurrence(instance, today),
  };
}

/**
 * Which occurrence slot ONE circle owns for a task, mirroring `TaskRow`'s rule
 * so a chore reads the same on Danas and inside its list.
 *
 * `completion_mode: 'shared'` has one answer for the whole occurrence, so the
 * slot is the whole-occurrence row (`null`). `'per_assignee'` has as many answers
 * as the task has assignees, so a single circle picks: the viewer's own copy when
 * the viewer is an assignee, otherwise the ONE assignee's when there is only one
 * (a child's chore ticked off by a parent), otherwise the viewer's - which is
 * also `useToggleTask`'s default, so the read and the write always agree.
 */
export function completionSlotFor(
  task: Task,
  assigneeIds: readonly string[],
  viewerId: string | null,
): string | null {
  if (task.completion_mode !== "per_assignee") return null;
  if (viewerId && assigneeIds.includes(viewerId)) return viewerId;
  if (assigneeIds.length === 1) return assigneeIds[0];
  return viewerId;
}

/**
 * A stand-in instance for a task that has no series to project - an undated one
 * in the Inbox or the "Meni dodeljeno" pile. `date` is only ever read back by
 * `useToggleTask`, which ignores it for a non-recurring task (whose truth is a
 * single boolean), so `today` is a safe and honest anchor: an undated task
 * cannot recur, because recurrence needs a `due_date` to count from.
 *
 * The one place that anchor must NOT leak is `TaskDetailSheet`, which would print
 * it as the task's "Kada" and offer to move an occurrence that does not exist -
 * see {@link detailSheetDates}.
 */
export function undatedTaskInstance(task: Task, today: string): TaskOccurrenceInstance {
  return {
    occurrenceDate: today,
    effectiveDate: today,
    occurrence: undefined,
    isDone: task.is_completed,
    isSkipped: false,
  };
}

/**
 * What `TaskDetailSheet` should be told about a row's dates.
 *
 * `AgendaItem` types both dates as required strings, so an undated task travels
 * with a synthetic anchor (see {@link undatedTaskInstance}) to keep the tick
 * working. The sheet takes `null` for exactly that case - "a task with no date at
 * all, which has a single implicit occurrence and no per-occurrence actions" -
 * and passing the anchor instead would have it print today as the task's deadline
 * and offer to move an occurrence nothing is keyed to.
 */
export function detailSheetDates(item: TaskAgendaItem | null): {
  occurrenceDate: string | null;
  effectiveDate: string | null;
} {
  if (!item || item.task.due_date === null) return { occurrenceDate: null, effectiveDate: null };
  return { occurrenceDate: item.occurrenceDate, effectiveDate: item.date };
}

/**
 * The three probes that find a recurring task's next instance without expanding
 * a year of a daily chore to use one entry of it: a week covers daily and
 * weekly, six weeks covers monthly, and the last one catches a long interval or
 * a series that has already ended.
 */
const NEXT_INSTANCE_PROBES: readonly number[] = [8, 45, 400];

/**
 * The instance a task stands for INSIDE its list - a list shows one row per
 * task, not one per occurrence, so a repeating chore has to pick a day.
 *
 * The pick is the next unresolved-or-not occurrence from today on, which is what
 * a person means by "when is this due". `null` for an undated task (a someday
 * item belongs to no day) and for a series whose last instance is already past.
 */
export function nextTaskInstance(
  task: Task,
  today: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): TaskOccurrenceInstance | null {
  if (!task.due_date) return null;
  if (!isRecurringTask(task)) {
    const instances = expandTaskOccurrences(task, task.due_date, task.due_date, occurrencesByKey);
    return instances[0] ?? null;
  }
  for (const days of NEXT_INSTANCE_PROBES) {
    const to = shiftIsoByDays(today, days) ?? today;
    const found = expandTaskOccurrences(task, today, to, occurrencesByKey).find(
      (instance) => !instance.isSkipped,
    );
    if (found) return found;
  }
  return null;
}
