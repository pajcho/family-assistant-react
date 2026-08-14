import { useMemo } from "react";

import { taskAgendaItem, type TaskAgendaItem } from "@/components/tasks/taskItemModel";
import { completedEntries } from "@/components/tasks/completedTasks";
import {
  COMPLETED_WINDOW_DAYS,
  SCHEDULED_WINDOW_DAYS,
  type SmartListKey,
} from "@/components/tasks/smartLists";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";
import { useProfile } from "@/hooks/useProfile";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import type { Task } from "@/types/database";
import {
  expandTaskOccurrences,
  isFutureOccurrence,
  isHiddenBySkip,
  isInstanceResolved,
} from "@/utils/task";
import { shiftIsoByDays } from "@/utils/pickerGrid";

/**
 * The query side of the /tasks row model: the same cached rows the agenda reads
 * (`useTasksList`, `useTaskAssignees`, `useTaskOccurrenceRows`), projected for
 * screens that are only about tasks.
 *
 * It deliberately does NOT go through `useAgenda`: only one of those may be
 * mounted at a time, the dashboard already owns that instance, and everything
 * here needs exactly one of its six arms. Mounting this costs no extra fetch.
 *
 * The pure half - shapes, predicates, the instance pick - is `taskItemModel.ts`,
 * which is what the tests import (this file's chain reaches `lib/supabase`).
 */

/** Stable "everybody" - the sidebar has no person rail and passes nothing. */
const NO_PERSON_FILTER: ReadonlySet<string> = new Set();

/**
 * How much each cross-list view holds - the sidebar's rows and the index's tiles.
 *
 * Every number here is derived from the SAME rows its own screen renders, which
 * is the whole point of the hook. Three rules make that true, and each of them
 * used to be broken in a way somebody could see:
 *
 *   1. **What is late is `useOverdueTasks`**, not a predicate of its own.
 *      `isTaskOverdue` answers for a task ROW and is false for every repeat by
 *      design, so counting with it said "Kasni 3" over a list of 7: the four
 *      repeating chores with missed days were invisible to the tile and present
 *      in the list.
 *   2. **The three forward-looking ones count TASKS with something OUTSTANDING**,
 *      not tasks that merely exist. A chore that repeats daily is one thing you
 *      own, not ninety (which is why the unit is tasks), but one whose next three
 *      months are all ticked, or whose series has ended, owes nothing and must
 *      not sit in the count. That is also why they need the expansion: "has this
 *      anything left to do in the window the screen shows" cannot be read off
 *      the task row.
 *   3. **`personIds` decides whose answer it is**, not just which rows survive.
 *      For `per_assignee` work "done" has one answer per person, so a chore Milan
 *      finished is finished FOR MILAN - `isInstanceResolved` is asked with the
 *      rail's people, exactly as `useOverdueTasks` and every section heading ask
 *      it.
 *
 * Završeno is the odd one out in unit: it counts EVENTS, because that is what its
 * screen shows - five ticks of the same daily chore are five things that
 * happened - and its rail filters on WHO TICKED IT rather than who owes it.
 *
 * The window is `SCHEDULED_WINDOW_DAYS`, the one Zakazano and the Inbox render;
 * a task dated past it is not in the count because it is not in the list either.
 */
export function useSmartListCounts(
  personIds: ReadonlySet<string> = NO_PERSON_FILTER,
): Record<SmartListKey, number> {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();
  const { occurrences, byKey } = useTaskOccurrenceRows();
  const today = useToday().str;
  const since = shiftIsoByDays(today, -COMPLETED_WINDOW_DAYS) ?? today;
  const windowEnd = shiftIsoByDays(today, SCHEDULED_WINDOW_DAYS) ?? today;
  // The same rows the Kasni list renders, for the same people - so the tile and
  // the heading below it are literally the same number.
  const overdue = useOverdueTasks(personIds);

  const tasks = tasksQuery.data;

  // Through the same function the Završeno screen renders, so the tile and the
  // screen can never disagree. Counting one-offs here and letting the screen add
  // repeating occurrences is exactly how a badge starts lying.
  const done = useMemo(() => {
    const entries = completedEntries(tasks ?? [], occurrences, since);
    if (personIds.size === 0) return entries.length;
    return entries.filter((e) => e.byPersonId !== null && personIds.has(e.byPersonId)).length;
  }, [tasks, occurrences, since, personIds]);

  return useMemo(() => {
    // Late tasks are outstanding by definition, and both other views lead with
    // that same block - so they start from it rather than re-deciding it.
    const lateTaskIds = new Set<string>();
    for (const item of overdue.items) {
      if (item.kind === "task") lateTaskIds.add(item.task.id);
    }

    let scheduled = 0;
    let inbox = 0;
    for (const task of tasks ?? []) {
      // Same rule as `matchesPersonFilter`: an empty selection is everybody, and
      // a task with no assignees belongs to the family, so it drops out the
      // moment a person is picked.
      const assigneeIds = byTask.get(task.id) ?? [];
      if (personIds.size > 0 && !assigneeIds.some((id) => personIds.has(id))) continue;

      if (!task.due_date) {
        // The someday pile: no date, so it is only ever an Inbox row.
        if (!task.is_completed && task.list_id === null) inbox += 1;
        continue;
      }

      const owedBy =
        personIds.size === 0 ? assigneeIds : assigneeIds.filter((id) => personIds.has(id));
      // Two questions, because the two views ask different ones. Zakazano wants
      // anything unresolved in the window - a repeat's next three months ARE
      // what it shows. The Inbox only lists what can be ticked right now (a
      // future occurrence is locked), so counting a chore whose only unresolved
      // instances are locked would put a 1 on a tile over rows that are all
      // settled. `lateTaskIds` satisfies both: a debt is owed and tickable.
      let scheduledHere = lateTaskIds.has(task.id);
      let inboxHere = lateTaskIds.has(task.id);
      for (const instance of expandTaskOccurrences(task, today, windowEnd, byKey)) {
        if (isInstanceResolved(task, instance, owedBy, byKey)) continue;
        scheduledHere = true;
        if (!isFutureOccurrence(task, instance.effectiveDate, today)) inboxHere = true;
        if (scheduledHere && inboxHere) break;
      }

      if (scheduledHere) scheduled += 1;
      if (inboxHere && task.list_id === null) inbox += 1;
    }
    return { late: overdue.items.length, scheduled, inbox, done };
  }, [tasks, byTask, byKey, personIds, today, windowEnd, overdue.items, done]);
}

export interface UseTaskAgendaItemsOptions {
  /** Inclusive window start, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive window end, `YYYY-MM-DD`. */
  to: string;
  /** Today, for the `missed` flag. Always `useToday().str` from the caller. */
  today: string;
}

export interface UseTaskAgendaItemsResult {
  /** Every instance in the window, sorted by (date, sortKey). */
  items: TaskAgendaItem[];
  /** Unfinished tasks with no `due_date` at all - the someday pile. */
  undated: Task[];
  /**
   * The same pile, already ticked. Kept separate rather than dropped: a task
   * with no list and no date used to leave the screen on a tick and never
   * appear anywhere again, which is what "Završeno" and the Inbox's own done
   * section exist to fix.
   */
  undatedDone: Task[];
  isLoading: boolean;
}

/**
 * Every task instance whose effective date falls inside `[from, to]`, plus the
 * undated tasks.
 *
 * The screens bucket by day themselves rather than taking a day index from here,
 * because each of them buckets a FILTERED subset (the person rail, the smart
 * list's own source) and an index of the unfiltered set would answer the wrong
 * question.
 *
 * Skipped instances are dropped and done ones kept, the same two rules
 * `useAgenda` applies: a row must not vanish from under the thumb the moment it
 * is ticked. The one exception is a skipped day this viewer had already finished
 * their part of, which stays struck through - see `isHiddenBySkip`.
 */
export function useTaskAgendaItems({
  from,
  to,
  today,
}: UseTaskAgendaItemsOptions): UseTaskAgendaItemsResult {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();
  const { byKey } = useTaskOccurrenceRows();
  // Only for the skipped-but-mine exception; see `isHiddenBySkip`.
  const viewerPersonId = useProfile().profile?.id ?? null;

  const tasks = tasksQuery.data;

  const { items, undated, undatedDone } = useMemo(() => {
    const out: TaskAgendaItem[] = [];
    const someday: Task[] = [];
    const somedayDone: Task[] = [];
    for (const task of tasks ?? []) {
      if (!task.due_date) {
        if (task.is_completed) somedayDone.push(task);
        else someday.push(task);
        continue;
      }
      const assigneeIds = byTask.get(task.id) ?? [];
      for (const instance of expandTaskOccurrences(task, from, to, byKey)) {
        if (isHiddenBySkip(task, instance, byKey, viewerPersonId)) continue;
        out.push(taskAgendaItem(task, instance, assigneeIds, today));
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.sortKey - b.sortKey);
    // Most recently ticked first - the done pile is read newest-down.
    somedayDone.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return { items: out, undated: someday, undatedDone: somedayDone };
  }, [tasks, byTask, byKey, viewerPersonId, from, to, today]);

  return { items, undated, undatedDone, isLoading: tasksQuery.isLoading };
}
