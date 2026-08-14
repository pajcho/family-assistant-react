import { useMemo } from "react";

import type { AgendaItem } from "@/hooks/useAgenda";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { normalizeTime } from "@/utils/activity";
import { isRecurringTask, isTaskOverdue, lateOccurrences } from "@/utils/task";

/**
 * Everything a task still owes, as agenda rows - oldest first.
 *
 * Two shapes, because a task and a series are late in different ways:
 *
 *   - a NON-recurring task is late as a row: `isTaskOverdue`, one row, and it
 *     keeps being carried until somebody deals with it;
 *   - a RECURRING task is late per instance (`lateOccurrences`), and those are
 *     collapsed into ONE row per task, dated to the OLDEST unresolved instance
 *     and carrying `lateCount`. A daily chore nobody has touched for a week
 *     would otherwise own the entire block; and "this chore is behind" is one
 *     thing a person needs to know, not seven.
 *
 * The row's `occurrenceDate` is that oldest instance's, so ticking straight from
 * the overdue block resolves the oldest debt - the one you would have picked
 * anyway - and the rest surface in the detail sheet's "Zaostalo" view.
 *
 * That recurring arm is plan 017 reversing half of decision 6 of plan 015: a
 * missed Tuesday no longer sits struck through on a Tuesday nobody scrolls back
 * to. `isTaskOverdue` still answers false for a series, because a series has no
 * one deadline to have missed - see its comment in utils/task.ts.
 *
 * Sits beside `useAgenda` for the same reason `useOverduePayments` does: overdue
 * lives BEFORE any agenda window (`[today, ...]`), so it is not "in range". Every
 * query it reads is already in the cache for the screens that mount it, so the
 * extra arm costs no fetch.
 */
export interface UseOverdueTasksResult {
  items: AgendaItem[];
  isLoading: boolean;
}

export function useOverdueTasks(): UseOverdueTasksResult {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();
  const { byKey } = useTaskOccurrenceRows();

  const today = useToday().str;

  const items = useMemo<AgendaItem[]>(() => {
    const out: AgendaItem[] = [];
    for (const task of tasksQuery.data ?? []) {
      const assigneeIds = byTask.get(task.id) ?? [];
      const dueTime = task.due_time ? normalizeTime(task.due_time) : null;

      if (isRecurringTask(task)) {
        const late = lateOccurrences(task, today, byKey, assigneeIds);
        const oldest = late[0];
        if (!oldest) continue;
        out.push({
          kind: "task",
          date: oldest.effectiveDate,
          sortKey: 0,
          task,
          occurrenceDate: oldest.occurrenceDate,
          dueTime,
          assigneeIds,
          isDone: false,
          // `missed` is the in-place treatment - struck through on its own day,
          // which is what a past day in the calendar still shows. Here the same
          // instance is being carried forward instead, and a row that did both
          // would tell you off twice for one thing.
          missed: false,
          lateCount: late.length,
        });
        continue;
      }

      if (!isTaskOverdue(task, today)) continue;
      // `isTaskOverdue` already guarantees a due_date and no recurrence.
      const dueDate = task.due_date as string;
      out.push({
        kind: "task",
        date: dueDate,
        // Zero, like the payment arm: the overdue block sorts by date alone, and
        // a shared bucket keeps payments and tasks interleavable by day.
        sortKey: 0,
        task,
        occurrenceDate: dueDate,
        dueTime,
        assigneeIds,
        isDone: false,
        missed: false,
      });
    }
    // Oldest overdue first - longest-outstanding at the top.
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [tasksQuery.data, byTask, byKey, today]);

  return { items, isLoading: tasksQuery.isLoading };
}
