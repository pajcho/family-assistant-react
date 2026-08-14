import { useRef } from "react";

import { agendaItemKey } from "@/hooks/useAgenda";
import type { TaskAgendaItem } from "@/components/tasks/taskItemModel";
import type { Task } from "@/types/database";

/**
 * Rows ticked during THIS visit, so they keep their place instead of vanishing
 * under the thumb.
 *
 * A tick removes a task from every source it was in - overdue stops being
 * overdue, the someday pile drops it - and the row disappeared mid-gesture,
 * which is both disorienting and unrecoverable if the tap was a mistake: there
 * was nothing left on screen to tap again. So the screen remembers what it has
 * rendered, and a row that leaves the selection while its task is now completed
 * keeps being drawn, struck through, until the screen unmounts. Navigating away
 * IS the cleanup, which is also what makes it feel like an undo window rather
 * than a list that never empties.
 *
 * Repeating tasks never come through here: their instances are kept by
 * `useTaskAgendaItems` when done, and `is_completed` on a repeating row is
 * always false by CHECK constraint.
 *
 * Shared by the /tasks overview and the cross-list screens, because "it vanished
 * and I do not know where it went" was reported on both.
 */
export function useTickedHereLinger(
  current: readonly TaskAgendaItem[],
  tasksById: ReadonlyMap<string, Task>,
  isLoading: boolean,
): TaskAgendaItem[] {
  const seen = useRef(new Map<string, TaskAgendaItem>());

  // Nothing is "gone" while the first fetch is still in flight - it has simply
  // not arrived, and treating that as a tick would resurrect stale rows.
  if (isLoading) return [];

  const present = new Set(current.map((item) => agendaItemKey(item)));
  for (const item of current) seen.current.set(agendaItemKey(item), item);

  const out: TaskAgendaItem[] = [];
  for (const [key, item] of seen.current) {
    if (present.has(key)) continue;
    const fresh = tasksById.get(item.task.id);
    if (!fresh?.is_completed) {
      // Left for some other reason (deleted, un-ticked, edited out of range) -
      // forget it, or it would haunt the screen for the rest of the visit.
      seen.current.delete(key);
      continue;
    }
    out.push({ ...item, task: fresh, isDone: true });
  }
  return out;
}
