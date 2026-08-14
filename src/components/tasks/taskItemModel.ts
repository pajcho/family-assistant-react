import type { AgendaItem } from "@/hooks/useAgenda";
import type { Task, TaskOccurrence } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { shiftIsoByDays } from "@/utils/pickerGrid";
import {
  expandTaskOccurrences,
  isInstanceResolved,
  isMissedOccurrence,
  isRecurringTask,
  isTaskDoneOn,
} from "@/utils/task";
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
 * The people whose answer a filtered surface wants for `item` - the rail's
 * selection narrowed to this task's own assignees, or every assignee when the
 * rail is showing everybody.
 *
 * Only `per_assignee` completion has more than one answer to give, but the
 * narrowing is stated once here so nothing has to re-derive it.
 */
function owedBy(item: TaskAgendaItem, personIds: ReadonlySet<string>): readonly string[] {
  if (personIds.size === 0) return item.assigneeIds;
  return item.assigneeIds.filter((id) => personIds.has(id));
}

/**
 * Whether this row still owes work TO THE PEOPLE THE RAIL HAS PICKED - the one
 * rule every count on /tasks uses, so a tile, a section heading and the rows
 * under it can never disagree about what is outstanding.
 *
 * `item.isDone` alone cannot answer it: whole-occurrence completion is always
 * false for a `per_assignee` chore, so a chore Milan finished counted as owed by
 * Milan the moment his rail chip was on. With the rail on "Svi" the question
 * goes back to the family's answer - three people each owe their own tick, and
 * one of them being done does not finish it.
 */
export function isItemOutstanding(
  item: TaskAgendaItem,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  personIds: ReadonlySet<string>,
): boolean {
  return !isInstanceResolved(
    item.task,
    {
      occurrenceDate: item.occurrenceDate,
      effectiveDate: item.date,
      occurrence: undefined,
      isDone: item.isDone,
      isSkipped: item.skipped === true,
    },
    owedBy(item, personIds),
    occurrencesByKey,
  );
}

/** How many of a group's rows are still owed - what every heading counts. */
export function outstandingCount(
  items: readonly TaskAgendaItem[],
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  personIds: ReadonlySet<string>,
): number {
  return items.filter((item) => isItemOutstanding(item, occurrencesByKey, personIds)).length;
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
    // Only ever true for an instance the caller kept despite the skip, i.e. one
    // this viewer had already finished - see `isHiddenBySkip`.
    skipped: instance.isSkipped,
    // Recurring only, exactly as `useAgenda` decides it: a one-off that slipped
    // is carried over by the overdue block instead of being struck in place.
    missed: isRecurringTask(task) && isMissedOccurrence(instance, today),
  };
}

/**
 * Who may tick a task off, and which occurrence slot that tick reads and writes.
 *
 * One rule, three shapes, and the whole of it is "you cannot finish work that is
 * not yours":
 *
 *   - **Nobody assigned** - a family task belongs to the household, so anybody
 *     may tick it and there is one answer for everyone.
 *   - **`shared` with ONE assignee** - one answer, and anybody may write it: this
 *     is a child's chore ticked off by the parent standing next to them, which is
 *     the everyday case and the reason the rule is not simply "assignees only".
 *     `completed_by_person_id` still records who actually tapped.
 *   - **`shared` with several** - one answer, but only the people it was given to
 *     may write it: whoever gets there first closes it for the rest, and a
 *     bystander has no business deciding that for them.
 *   - **`per_assignee`** - one answer per person. An assignee ticks their own
 *     copy; anybody else gets no circle at all, whatever the head count, because
 *     there is no single slot their tap could honestly mean. Those surfaces show
 *     progress instead.
 *
 * The last arm used to fall back to the viewer's own slot, which let a parent's
 * tap on a chore given to two children write a third, meaningless row - and make
 * the row read as finished while neither child had done it.
 */
export interface TaskTickSlot {
  /** The slot to read and to write. Null = the occurrence as a whole. */
  personId: string | null;
  /** Whether this viewer may tick at all. */
  canTick: boolean;
  /**
   * True when one circle cannot stand for the answer - a `per_assignee` chore
   * seen by somebody who is not on it. Surfaces read `assigneeProgress` instead.
   */
  aggregate: boolean;
}

export function taskTickSlot(
  task: Task,
  assigneeIds: readonly string[],
  viewerId: string | null,
): TaskTickSlot {
  if (assigneeIds.length === 0) return { personId: null, canTick: true, aggregate: false };

  const isAssignee = viewerId !== null && assigneeIds.includes(viewerId);
  if (task.completion_mode !== "per_assignee") {
    return { personId: null, canTick: isAssignee || assigneeIds.length === 1, aggregate: false };
  }
  if (isAssignee) return { personId: viewerId, canTick: true, aggregate: false };
  return { personId: null, canTick: false, aggregate: true };
}

/**
 * How many of a `per_assignee` chore's people have ticked their own copy - the
 * "1/2" a circle is replaced by for somebody who is not on it.
 */
export function assigneeProgress(
  task: Task,
  assigneeIds: readonly string[],
  occurrenceDate: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): { done: number; total: number } {
  let done = 0;
  for (const personId of assigneeIds) {
    if (isTaskDoneOn(task, occurrenceDate, occurrencesByKey, personId)) done += 1;
  }
  return { done, total: assigneeIds.length };
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
