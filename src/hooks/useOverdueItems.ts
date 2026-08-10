import { useMemo } from "react";

import type { AgendaItem } from "@/hooks/useAgenda";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import { useOverdueTasks } from "@/hooks/useOverdueTasks";

/**
 * Everything that is late, in one list: overdue payments and overdue tasks
 * merged and sorted oldest first.
 *
 * Exists so `OverdueSection` takes ONE list and stays a dumb renderer. The two
 * sources have different definitions of late (a payment's live occurrence can be
 * rescheduled, a task's due date cannot; a recurring task is never late at all),
 * and keeping each rule in its own hook is what stops that nuance leaking into
 * the component.
 *
 * Both halves already carry `sortKey: 0`, so the merge is a plain date sort. It
 * is a STABLE sort, which is what decides the tie: same date means payments
 * first, then tasks.
 */
export interface UseOverdueItemsResult {
  items: AgendaItem[];
  isLoading: boolean;
}

export function useOverdueItems(): UseOverdueItemsResult {
  const payments = useOverduePayments();
  const tasks = useOverdueTasks();

  const items = useMemo<AgendaItem[]>(
    () => [...payments.items, ...tasks.items].sort((a, b) => a.date.localeCompare(b.date)),
    [payments.items, tasks.items],
  );

  return { items, isLoading: payments.isLoading || tasks.isLoading };
}
