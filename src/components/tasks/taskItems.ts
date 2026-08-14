import { useMemo } from "react";

import { taskAgendaItem, type TaskAgendaItem } from "@/components/tasks/taskItemModel";
import { completedEntries } from "@/components/tasks/completedTasks";
import { COMPLETED_WINDOW_DAYS, type SmartListKey } from "@/components/tasks/smartLists";
import { useProfile } from "@/hooks/useProfile";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import type { Task } from "@/types/database";
import {
  expandTaskOccurrences,
  isHiddenBySkip,
  isRecurringTask,
  isTaskOverdue,
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
 * The three forward-looking ones count TASKS, not occurrences: a chore that
 * repeats daily is one thing you own, not ninety, and the list rows beside these
 * count tasks too. Cheap by construction - no recurrence expansion at all, just
 * three predicates over rows already in the cache.
 *
 * Završeno is the exception and counts EVENTS, because that is what its screen
 * shows: five ticks of the same daily chore are five things that happened.
 *
 * `personIds` narrows all four to the people the caller's rail has picked. On
 * the index the tiles sit directly under that rail and now swap the body below
 * them, so a tile counting the whole family above rows counting one person is
 * the number and the list disagreeing in plain sight. Each view applies it the
 * way its own screen does: the three forward-looking ones on WHO IT IS FOR,
 * Završeno on WHO TICKED IT.
 */
export function useSmartListCounts(
  personIds: ReadonlySet<string> = NO_PERSON_FILTER,
): Record<SmartListKey, number> {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();
  const { occurrences } = useTaskOccurrenceRows();
  const today = useToday().str;
  const since = shiftIsoByDays(today, -COMPLETED_WINDOW_DAYS) ?? today;

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
    let late = 0;
    let scheduled = 0;
    let inbox = 0;
    for (const task of tasks ?? []) {
      // Same rule as `matchesPersonFilter`: an empty selection is everybody, and
      // a task with no assignees belongs to the family, so it drops out the
      // moment a person is picked.
      if (personIds.size > 0 && !(byTask.get(task.id) ?? []).some((id) => personIds.has(id))) {
        continue;
      }
      const recurring = isRecurringTask(task);
      const open = recurring || !task.is_completed;
      if (isTaskOverdue(task, today)) late += 1;
      if (open && task.due_date) scheduled += 1;
      if (open && task.list_id === null) inbox += 1;
    }
    return { late, scheduled, inbox, done };
  }, [tasks, byTask, personIds, today, done]);
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
