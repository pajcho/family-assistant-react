import { useMemo } from "react";

import { taskAgendaItem, type TaskAgendaItem } from "@/components/tasks/taskItemModel";
import type { SmartListKey } from "@/components/tasks/smartLists";
import { useProfile } from "@/hooks/useProfile";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import type { Task } from "@/types/database";
import { expandTaskOccurrences, isRecurringTask, isTaskOverdue } from "@/utils/task";

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

/**
 * How many TASKS each smart list holds - the sidebar's and the index's counts.
 *
 * Deliberately tasks and not occurrences: a chore that repeats daily is one thing
 * you own, not ninety, and the list rows beside these count tasks too. Cheap by
 * construction - no recurrence expansion at all, just three predicates over rows
 * already in the cache.
 */
export function useSmartListCounts(): Record<SmartListKey, number> {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();
  const { profile } = useProfile();
  const today = useToday().str;
  const viewerId = profile?.id ?? null;

  const tasks = tasksQuery.data;

  return useMemo(() => {
    let late = 0;
    let scheduled = 0;
    let mine = 0;
    let inbox = 0;
    for (const task of tasks ?? []) {
      const recurring = isRecurringTask(task);
      const open = recurring || !task.is_completed;
      if (isTaskOverdue(task, today)) late += 1;
      if (open && task.due_date) scheduled += 1;
      if (open && viewerId && (byTask.get(task.id) ?? []).includes(viewerId)) mine += 1;
      if (open && task.list_id === null) inbox += 1;
    }
    return { late, scheduled, mine, inbox };
  }, [tasks, byTask, viewerId, today]);
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
 * is ticked.
 */
export function useTaskAgendaItems({
  from,
  to,
  today,
}: UseTaskAgendaItemsOptions): UseTaskAgendaItemsResult {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();
  const { byKey } = useTaskOccurrenceRows();

  const tasks = tasksQuery.data;

  const { items, undated } = useMemo(() => {
    const out: TaskAgendaItem[] = [];
    const someday: Task[] = [];
    for (const task of tasks ?? []) {
      if (!task.due_date) {
        if (!task.is_completed) someday.push(task);
        continue;
      }
      const assigneeIds = byTask.get(task.id) ?? [];
      for (const instance of expandTaskOccurrences(task, from, to, byKey)) {
        if (instance.isSkipped) continue;
        out.push(taskAgendaItem(task, instance, assigneeIds, today));
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.sortKey - b.sortKey);
    return { items: out, undated: someday };
  }, [tasks, byTask, byKey, from, to, today]);

  return { items, undated, isLoading: tasksQuery.isLoading };
}
