import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Task, TaskOccurrence } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useKidSession } from "@/hooks/useKidSession";
import { useProfile } from "@/hooks/useProfile";
import { useTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { useTasksList } from "@/hooks/useTasks";
import { useToday } from "@/hooks/useToday";
import { normalizeTime } from "@/utils/activity";
import { subtractDay } from "@/utils/date";
import {
  expandTaskOccurrences,
  isHiddenBySkip,
  isRecurringTask,
  isTaskDoneOn,
  taskOccurrenceKey,
} from "@/utils/task";

/**
 * A child's own chores, and the single write a kid session may make against
 * them.
 *
 * THE RULE, and it is not negotiable: the kid shell NEVER writes to `tasks`,
 * `task_assignees` or `task_occurrences`. There is no kid INSERT / UPDATE /
 * DELETE policy on any of them, and the grown-up write policies deliberately
 * demand `auth_user_family_id()`, which is NULL for a child (a child has no row
 * in `profiles` at all - see the header of 20260808000000_kid_mode.sql), so a
 * direct write is refused by the DATABASE rather than by this file. Ticking a
 * chore off goes through the `kid_complete_task` RPC, which writes exactly one
 * thing - "this is done" - for exactly one task the child is really assigned to.
 *
 * The READ needs no query of its own. `useTasksList`, `useTaskAssignees` and
 * `useTaskOccurrenceRows` are already mounted by `useAgenda` on the same screen,
 * they share their cache keys, and the three kid SELECT policies narrow all of
 * them to this child's rows. What this hook adds are the three answers the
 * shared agenda layer cannot give a child:
 *
 *   1. per-child completion - `AgendaItem.isDone` answers for the WHOLE
 *      occurrence, which is the wrong answer whenever `completion_mode` is
 *      'per_assignee';
 *   2. whether a tick is allowed at all, so a child never taps into a refusal;
 *   3. the tick itself, optimistic, because on a child's phone it has to land
 *      under the thumb rather than after a round trip.
 */

/**
 * How far back a child may still resolve a chore, in days.
 *
 * `kid_complete_task` refuses anything outside `CURRENT_DATE - 2` ..
 * `CURRENT_DATE + 1`. That window is the DATABASE's date (UTC on Supabase)
 * while everything here is the DEVICE's local one, and the two can disagree by
 * a day in either direction. One day of slack on the device therefore sits
 * strictly inside the two days the function allows, whichever way the clocks
 * fall. Widening this to 2 would let a device whose date is a day BEHIND the
 * database send a date the function rejects.
 */
const COMPLETABLE_DAYS_BACK = 1;

/** One projected instance of one of this child's chores. */
export interface KidChore {
  task: Task;
  /** The SERIES date - what `kid_complete_task` keys the occurrence on. */
  occurrenceDate: string;
  /** Where it actually shows, which differs once a parent moves an occurrence. */
  effectiveDate: string;
  /** Normalized HH:mm, or null for a chore with no clock on it. */
  dueTime: string | null;
  /** THIS child's answer, `per_assignee` included. */
  isDone: boolean;
  /**
   * Whether the tick circle is live. False for a chore that has not happened
   * yet (you cannot do tomorrow's washing up today), for one whose series date
   * has fallen out of the RPC's reach, and in the parent preview - there is no
   * kid session there for the function to resolve, so every call would raise.
   */
  canComplete: boolean;
}

export interface KidCompleteTaskInput {
  task: Task;
  /** The SERIES date of the instance being ticked, never its effective date. */
  date: string;
  /** Target state. The card passes the opposite of what it currently shows. */
  done: boolean;
}

export interface UseKidTasksResult {
  /** This child's chore instances inside the requested window. */
  chores: KidChore[];
  /** `${task_id}|${occurrence_date}` -> its chore, for a card's own lookup. */
  byKey: Map<string, KidChore>;
  /**
   * Per-child completion for one instance, or `undefined` when this window
   * knows nothing about it - which is what lets a caller fall back to the
   * agenda item's own whole-occurrence answer instead of reading a miss as
   * "not done".
   */
  isDone: (taskId: string, occurrenceDate: string) => boolean | undefined;
  /** Tick one chore on or off. Optimistic, and it never touches a table. */
  completeTask: (input: KidCompleteTaskInput) => void;
  isLoading: boolean;
}

/**
 * What the child is told when the RPC says no. Every branch names something a
 * child can act on, and none of them leaks a Postgres message: `RAISE
 * EXCEPTION` text arrives verbatim in `error.message`, and "date outside the
 * allowed window" is not a sentence anybody should read on their own phone.
 */
function kidCompleteErrorText(raw: string): string {
  if (raw.includes("date outside the allowed window")) {
    return "Ovo više ne može da se završi ovde. Reci mami ili tati.";
  }
  if (raw.includes("not assigned to this child")) return "Ovaj zadatak nije tvoj.";
  if (raw.includes("not a kid session")) return "Ovo radi samo u tvojoj aplikaciji.";
  return "Nije uspelo. Probaj još jednom.";
}

/** Prefix on the optimistic occurrence row, matching the grown-up mutations. */
const TEMP_OCCURRENCE_ID_PREFIX = "temp-kid-occ-";

/** Both cached rollbacks one tick can need - it writes to one home or the other. */
interface KidCompleteRollback {
  tasks: Task[] | undefined;
  occurrences: TaskOccurrence[] | undefined;
}

/**
 * The tick. Optimistic in both of completion's homes, exactly as
 * `useToggleTask` is for a grown-up: `tasks.is_completed` for a one-off,
 * a `task_occurrences` row for a repeat.
 *
 * `kid_complete_task` returns void, so there is nothing to merge back - the
 * `onSettled` invalidation is the reconciliation, and a failure rolls the cache
 * back and says so in words a child understands.
 */
function useCompleteKidTask(kidProfileId: string | null) {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const tasksKey = ["tasks", familyId] as const;
  const occurrencesKey = ["task_occurrences", familyId] as const;

  return useMutation<void, Error, KidCompleteTaskInput, KidCompleteRollback>({
    mutationFn: async (input): Promise<void> => {
      const { error } = await supabase.rpc("kid_complete_task", {
        p_task_id: input.task.id,
        p_date: input.date,
        p_done: input.done,
      });
      if (error) throw new Error(error.message);
    },

    onMutate: async (input): Promise<KidCompleteRollback> => {
      // A one-off chore is ticked on the task row itself, which is also the
      // only shape the kid shell can hold in cache: it never mounts
      // `useListsWithTasks`, so there is no ["lists"] copy to keep in step.
      if (!isRecurringTask(input.task)) {
        await queryClient.cancelQueries({ queryKey: tasksKey });
        const tasks = queryClient.getQueryData<Task[]>(tasksKey);
        if (tasks) {
          const nowIso = new Date().toISOString();
          queryClient.setQueryData<Task[]>(
            tasksKey,
            tasks.map((task) =>
              task.id === input.task.id
                ? {
                    ...task,
                    is_completed: input.done,
                    completed_at: input.done ? nowIso : null,
                    completed_by_person_id: input.done ? kidProfileId : null,
                  }
                : task,
            ),
          );
        }
        return { tasks, occurrences: undefined };
      }

      await queryClient.cancelQueries({ queryKey: occurrencesKey });
      const occurrences = queryClient.getQueryData<TaskOccurrence[]>(occurrencesKey);
      if (occurrences) {
        // The same slot the function will write: this child's own row when the
        // chore is ticked per assignee, the shared one otherwise.
        const slotPersonId = input.task.completion_mode === "per_assignee" ? kidProfileId : null;
        const isSameSlot = (row: TaskOccurrence): boolean =>
          row.task_id === input.task.id &&
          row.occurrence_date === input.date &&
          (row.person_id ?? null) === slotPersonId;
        const nowIso = new Date().toISOString();
        queryClient.setQueryData<TaskOccurrence[]>(
          occurrencesKey,
          input.done
            ? [
                ...occurrences.filter((row) => !isSameSlot(row)),
                {
                  id: `${TEMP_OCCURRENCE_ID_PREFIX}${crypto.randomUUID()}`,
                  task_id: input.task.id,
                  family_id: (familyId as string) ?? "",
                  occurrence_date: input.date,
                  person_id: slotPersonId,
                  status: "done",
                  moved_to_date: null,
                  completed_at: nowIso,
                  completed_by_person_id: kidProfileId,
                  // The trigger resolves a kid session through kid_profile_id(),
                  // since a child has no `profiles` row to match auth.uid().
                  acted_by_person_id: kidProfileId,
                  acted_at: nowIso,
                  note: null,
                  created_at: nowIso,
                  updated_at: nowIso,
                },
              ]
            : // Only a 'done' row is completion truth: the status filter is what
              // keeps an untick from wiping a parent's skip or move.
              occurrences.filter((row) => !(isSameSlot(row) && row.status === "done")),
        );
      }
      return { tasks: undefined, occurrences };
    },

    onError: (error, _input, rollback) => {
      if (rollback?.tasks) queryClient.setQueryData(tasksKey, rollback.tasks);
      if (rollback?.occurrences) {
        queryClient.setQueryData(occurrencesKey, rollback.occurrences);
      }
      // The circle springs back on its own with the rollback, so the card stays
      // usable and the child can simply try again.
      toast.error(kidCompleteErrorText(error.message));
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksKey });
      void queryClient.invalidateQueries({ queryKey: occurrencesKey });
    },
  });
}

/**
 * This child's chores between `from` and `to` (inclusive), plus the tick.
 *
 * Mount it once per screen, beside the screen's `useAgenda`, and pass the same
 * window: the cards come from the agenda (so a chore sits in the day beside the
 * activity before it), while the circle on each of them reads from here.
 */
export function useKidTasks({ from, to }: { from: string; to: string }): UseKidTasksResult {
  const { isKid, kidProfileId } = useKidSession();
  const today = useToday().str;
  const tasksQuery = useTasksList();
  const { byTask, isLoading: assigneesLoading } = useTaskAssignees();
  const { byKey: occurrencesByKey, isLoading: occurrencesLoading } = useTaskOccurrenceRows();
  const completion = useCompleteKidTask(kidProfileId);

  const byKey = useMemo(() => {
    const map = new Map<string, KidChore>();
    if (!kidProfileId) return map;
    const earliest = subtractDay(today, COMPLETABLE_DAYS_BACK);

    for (const task of tasksQuery.data ?? []) {
      // Only a DATED task is a chore. An undated one lives inside somebody's
      // list, which is not a child's business at all.
      if (!task.due_date) continue;
      // Assignment is the whole gate: a chore is given to somebody on purpose,
      // and a task with no assignees is family-wide, not this child's. RLS says
      // the same thing to a real kid session; saying it here as well is what
      // makes the parent's preview show exactly what the child sees.
      if (!(byTask.get(task.id) ?? []).includes(kidProfileId)) continue;

      const dueTime = task.due_time ? normalizeTime(task.due_time) : null;
      for (const instance of expandTaskOccurrences(task, from, to, occurrencesByKey)) {
        // A skip is a decision a parent already made, so it is not a chore any
        // more - unless this child had already done it, in which case their
        // work stays on their board rather than being quietly deleted from it.
        // A DONE one stays too: a row vanishing under the thumb that just
        // tapped it reads as "I must have imagined it".
        if (isHiddenBySkip(task, instance, occurrencesByKey, kidProfileId)) continue;
        map.set(taskOccurrenceKey(task.id, instance.occurrenceDate), {
          task,
          occurrenceDate: instance.occurrenceDate,
          effectiveDate: instance.effectiveDate,
          dueTime,
          isDone: isTaskDoneOn(task, instance.occurrenceDate, occurrencesByKey, kidProfileId),
          canComplete:
            isKid &&
            // A day that was called off is not theirs to change any more; it is
            // only still here because they had finished it.
            !instance.isSkipped &&
            instance.effectiveDate <= today &&
            instance.occurrenceDate >= earliest &&
            instance.occurrenceDate <= today,
        });
      }
    }
    return map;
  }, [isKid, kidProfileId, today, from, to, tasksQuery.data, byTask, occurrencesByKey]);

  const chores = useMemo(() => [...byKey.values()], [byKey]);

  const isDone = useCallback(
    (taskId: string, occurrenceDate: string): boolean | undefined =>
      byKey.get(taskOccurrenceKey(taskId, occurrenceDate))?.isDone,
    [byKey],
  );

  return {
    chores,
    byKey,
    isDone,
    completeTask: completion.mutate,
    // The occurrence and assignee rows join the gate on purpose: `useAgenda`
    // does not wait for either, so without this a chore ticked off earlier
    // today would render unticked for a beat and then flip.
    isLoading: tasksQuery.isLoading || assigneesLoading || occurrencesLoading,
  };
}
