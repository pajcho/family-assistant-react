import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/hooks/useProfile";
import { invalidateTaskCaches, TEMP_TASK_ID_PREFIX } from "@/hooks/useTasks";
import { supabase } from "@/lib/supabase";
import type { ListWithTasks } from "@/types/database";

/** Matches MAX_TASKS_PER_CALL in the categorize-tasks function. */
const BATCH_SIZE = 50;

/**
 * (task id, name) pairs already sent this session. Module-level on purpose: it
 * has to outlive re-renders, remounts and StrictMode's double effects, so an
 * outage costs one request per item per session rather than one per render.
 * The name is part of the key because a rename clears the category in the
 * database, and the renamed item deserves a fresh attempt straight away.
 */
const attempted = new Set<string>();

const attemptKey = (task: { id: string; name: string }) => `${task.id}\u0000${task.name}`;

/**
 * Files a smart-sorted list's unfiled items into shop departments.
 *
 * Whenever the list has smart sort on and some items still carry
 * `category = null` (just added, just renamed, left over from before this
 * feature, or not filed because the model was unreachable) it asks the
 * categorize-tasks function to file them. The answer arrives as a normal task
 * update, so the items move out of "Ostalo" on the next render.
 *
 * Fire-and-forget by design, and silent on failure: the items already render
 * under "Ostalo", nothing waits on this, and the next visit simply asks again.
 * An item can always be added, whatever state the model is in.
 *
 * Mount once per open list (useSmartSort does).
 */
export function useAutoCategorize(list: ListWithTasks): void {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const enabled = list.smart_sort_enabled;
  const tasks = list.tasks;

  useEffect(() => {
    if (!enabled) return;

    const unfiled = tasks.filter(
      (task) =>
        task.category == null &&
        // A placeholder is not in the database yet; its real row follows.
        !task.id.startsWith(TEMP_TASK_ID_PREFIX) &&
        !attempted.has(attemptKey(task)),
    );
    if (unfiled.length === 0) return;
    for (const task of unfiled) attempted.add(attemptKey(task));

    for (let start = 0; start < unfiled.length; start += BATCH_SIZE) {
      const taskIds = unfiled.slice(start, start + BATCH_SIZE).map((task) => task.id);
      void supabase.functions
        .invoke<{ filed?: number }>("categorize-tasks", { body: { task_ids: taskIds } })
        .then(({ data, error }) => {
          // Realtime delivers the same change; this covers a dropped socket.
          if (!error && (data?.filed ?? 0) > 0) invalidateTaskCaches(queryClient, familyId);
        })
        .catch(() => {
          // Silent by design: see the hook note.
        });
    }
  }, [enabled, tasks, familyId, queryClient]);
}
