import { useMemo } from "react";

import type { AgendaItem } from "@/hooks/useAgenda";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { normalizeTime } from "@/utils/activity";
import { isTaskOverdue } from "@/utils/task";

/**
 * Overdue tasks as agenda rows - unfinished, NON-recurring tasks whose due date
 * already slipped before today. One row per task, oldest first.
 *
 * The recurring exclusion is decision 6 of the plan and lives in
 * `isTaskOverdue`: a chore missed on Tuesday is a missed Tuesday, not a debt
 * that follows you into Wednesday. Those surface as `missed` instances on their
 * own day instead.
 *
 * Sits beside `useAgenda` for the same reason `useOverduePayments` does: overdue
 * lives BEFORE any agenda window (`[today, ...]`), so it is not "in range". The
 * underlying task queries are shared through React Query's cache, so calling
 * both in a tab costs no extra fetch.
 */
export interface UseOverdueTasksResult {
  items: AgendaItem[];
  isLoading: boolean;
}

export function useOverdueTasks(): UseOverdueTasksResult {
  const tasksQuery = useTasksList();
  const { byTask } = useTaskAssignees();

  const today = useToday().str;

  const items = useMemo<AgendaItem[]>(() => {
    const out: AgendaItem[] = [];
    for (const task of tasksQuery.data ?? []) {
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
        dueTime: task.due_time ? normalizeTime(task.due_time) : null,
        assigneeIds: byTask.get(task.id) ?? [],
        isDone: false,
        // `missed` is the recurring-instance treatment ("propušteno" and gone);
        // a one-off that slipped is carried over instead, which is this block.
        missed: false,
      });
    }
    // Oldest overdue first - longest-outstanding at the top.
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [tasksQuery.data, byTask, today]);

  return { items, isLoading: tasksQuery.isLoading };
}
