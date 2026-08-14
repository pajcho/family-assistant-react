import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { TaskAssignee } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Junction-table rows linking tasks to the family members they are for. A
 * straight copy of `useEventParticipants`, down to the write helper not being a
 * mutation hook of its own: `useCreateTask` / `useUpdateTask` call
 * `replaceTaskAssignees` so one submit persists the task and its assignees
 * together.
 *
 * NO rows for a task means "family-wide, nobody's in particular" - not
 * "unassigned and therefore invisible". Assignees drive the person filter, the
 * member badges and, above all, what a child can see.
 */
async function fetchTaskAssignees(familyId: string): Promise<TaskAssignee[]> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as TaskAssignee[]) ?? [];
}

export interface UseTaskAssigneesResult {
  assignees: TaskAssignee[];
  /** task_id -> person_ids, in insertion order. Stable across renders. */
  byTask: Map<string, string[]>;
  isLoading: boolean;
}

export function useTaskAssignees(): UseTaskAssigneesResult {
  const { familyId } = useProfile();
  const query = useQuery({
    queryKey: ["task_assignees", familyId],
    queryFn: () => fetchTaskAssignees(familyId as string),
    enabled: !!familyId,
  });

  const assignees = useMemo(() => query.data ?? [], [query.data]);

  const byTask = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of assignees) {
      const list = map.get(row.task_id);
      if (list) list.push(row.person_id);
      else map.set(row.task_id, [row.person_id]);
    }
    return map;
  }, [assignees]);

  return { assignees, byTask, isLoading: query.isLoading };
}

/**
 * Replace the full set of assignees for one task: delete the existing rows,
 * then insert the new ones in a single round-trip. An empty `personIds` simply
 * clears the assignment, which is a meaningful state (family-wide) and not an
 * error. Not a hook - called from the task mutations, which already hold
 * `familyId`.
 */
export async function replaceTaskAssignees(
  familyId: string,
  taskId: string,
  personIds: ReadonlyArray<string>,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("task_assignees")
    .delete()
    .eq("task_id", taskId);
  if (deleteError) throw new Error(deleteError.message);

  if (personIds.length === 0) return;

  const rows = personIds.map((personId) => ({
    task_id: taskId,
    family_id: familyId,
    person_id: personId,
  }));
  const { error: insertError } = await supabase.from("task_assignees").insert(rows);
  if (insertError) throw new Error(insertError.message);
}
