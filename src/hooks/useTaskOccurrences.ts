import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type { TaskOccurrence } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import { taskOccurrenceKey } from "@/utils/task";

/**
 * Per-occurrence rows for recurring tasks: the sparse override table, modelled
 * on `usePaymentOverrides`. No row is the normal state.
 *
 * Unlike payment overrides these are not purely a display layer - for a
 * recurring task a `status: 'done'` row IS the completion record, because
 * `tasks.is_completed` is structurally forbidden from carrying it. Ticking is
 * therefore NOT here but in `useToggleTask` (hooks/useTasks.ts), which is the
 * one place that routes a tick to whichever of the two homes applies. What lives
 * here is the pair of WHOLE-OCCURRENCE structural overrides - skip and move -
 * plus the restore that removes them.
 *
 * Keyed by `taskOccurrenceKey(task_id, occurrence_date)`, mapping to EVERY row
 * for that slot: `completion_mode: 'per_assignee'` puts one row per person under
 * the same key. Resolution is `utils/task.ts`'s job, never a caller's.
 */

/** `${task_id}|${occurrence_date}` -> every row for that slot, insertion order. */
export function occurrencesByKeyFrom(
  rows: readonly TaskOccurrence[],
): Map<string, TaskOccurrence[]> {
  const map = new Map<string, TaskOccurrence[]>();
  for (const row of rows) {
    const key = taskOccurrenceKey(row.task_id, row.occurrence_date);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

async function fetchTaskOccurrences(familyId: string): Promise<TaskOccurrence[]> {
  const { data, error } = await supabase
    .from("task_occurrences")
    .select("*")
    .eq("family_id", familyId);
  if (error) throw new Error(error.message);
  return (data as TaskOccurrence[]) ?? [];
}

/**
 * The temp id an optimistically-inserted occurrence carries until the server
 * hands back the real UUID. Same prefix convention as the task placeholders in
 * `useTasks.ts`, so a row still in flight is recognisable in the cache.
 */
const TEMP_OCCURRENCE_ID_PREFIX = "temp-occ-";

/**
 * Skipping and moving are facts about the OCCURRENCE, not about one assignee -
 * the detail sheet acts on "this Tuesday", so the row it writes is the
 * whole-occurrence one (`person_id IS NULL`), which is also the only row
 * `expandTaskOccurrences` reads structural state from.
 */
const WHOLE_OCCURRENCE_PERSON_ID = null;

/** Replace the whole-occurrence row for a slot, or append one if there is none. */
function withWholeOccurrenceRow(
  rows: readonly TaskOccurrence[],
  next: TaskOccurrence,
): TaskOccurrence[] {
  const isSameSlot = (row: TaskOccurrence): boolean =>
    row.task_id === next.task_id &&
    row.occurrence_date === next.occurrence_date &&
    row.person_id == null;
  return rows.some(isSameSlot)
    ? rows.map((row) => (isSameSlot(row) ? { ...next, id: row.id } : row))
    : [...rows, next];
}

/** Rollback snapshot every occurrence mutation carries through `onMutate`. */
type OccurrenceRollback = { previous: TaskOccurrence[] | undefined };

export interface UseTaskOccurrenceRowsResult {
  occurrences: TaskOccurrence[];
  /** `${task_id}|${occurrence_date}` -> its rows. Stable across renders. */
  byKey: Map<string, TaskOccurrence[]>;
  isLoading: boolean;
}

/**
 * The READ half on its own, for the hooks that only need to resolve completion:
 * `useAgenda` and `useToggleTask`. They are mounted on hot paths - a screen with
 * two hundred rows can hold two hundred copies of `useToggleTask` - so they must
 * not drag three idle mutation observers along per instance.
 */
export function useTaskOccurrenceRows(): UseTaskOccurrenceRowsResult {
  const { familyId } = useProfile();
  const query = useQuery({
    queryKey: ["task_occurrences", familyId],
    queryFn: () => fetchTaskOccurrences(familyId as string),
    enabled: !!familyId,
  });

  const occurrences = useMemo(() => query.data ?? [], [query.data]);
  const byKey = useMemo(() => occurrencesByKeyFrom(occurrences), [occurrences]);

  return { occurrences, byKey, isLoading: query.isLoading };
}

export interface UseTaskOccurrencesResult extends UseTaskOccurrenceRowsResult {
  /** Drop one occurrence of a series from the agenda; restorable. */
  skipOccurrence: UseMutationResult<void, Error, SkipOccurrenceInput, OccurrenceRollback>;
  /** Show one occurrence on another date, keyed by its original one. */
  moveOccurrence: UseMutationResult<void, Error, MoveOccurrenceInput, OccurrenceRollback>;
  /** Undo a skip or a move - back to what the series says. */
  restoreOccurrence: UseMutationResult<void, Error, RestoreOccurrenceInput, OccurrenceRollback>;
}

/**
 * The rows plus the three overrides - what a detail sheet needs, since it both
 * reads the occurrence and acts on it. Screens that only read should reach for
 * `useTaskOccurrenceRows` instead.
 */
export function useTaskOccurrences(): UseTaskOccurrencesResult {
  const rows = useTaskOccurrenceRows();
  const skipOccurrence = useSkipOccurrence();
  const moveOccurrence = useMoveOccurrence();
  const restoreOccurrence = useRestoreOccurrence();

  return { ...rows, skipOccurrence, moveOccurrence, restoreOccurrence };
}

/**
 * Shared body of the two override mutations: an optimistic whole-occurrence row
 * in the cache, a rollback on failure, an invalidate either way. `familyId` is
 * sent explicitly even though a trigger would fill it, because the optimistic
 * row needs the same value and reading it twice from two places is how the two
 * drift apart.
 */
function useUpsertOccurrenceOverride<TInput extends { taskId: string; occurrenceDate: string }>(
  build: (input: TInput) => Pick<TaskOccurrence, "status" | "moved_to_date">,
  errorMessage: string,
) {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation<void, Error, TInput, OccurrenceRollback>({
    mutationFn: async (input: TInput): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const { status, moved_to_date } = build(input);
      const { error } = await supabase.from("task_occurrences").upsert(
        {
          task_id: input.taskId,
          family_id: familyId,
          occurrence_date: input.occurrenceDate,
          person_id: WHOLE_OCCURRENCE_PERSON_ID,
          status,
          moved_to_date,
          // A slot that was ticked and is now skipped or moved is no longer
          // done, so the completion stamp goes with the status it belonged to.
          completed_at: null,
          completed_by_person_id: null,
        },
        { onConflict: "task_id,occurrence_date,person_id" },
      );
      if (error) throw new Error(error.message);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["task_occurrences", familyId] });
      const previous = queryClient.getQueryData<TaskOccurrence[]>(["task_occurrences", familyId]);
      if (previous) {
        const { status, moved_to_date } = build(input);
        const nowIso = new Date().toISOString();
        const optimistic: TaskOccurrence = {
          id: `${TEMP_OCCURRENCE_ID_PREFIX}${crypto.randomUUID()}`,
          task_id: input.taskId,
          family_id: (familyId as string) ?? "",
          occurrence_date: input.occurrenceDate,
          person_id: WHOLE_OCCURRENCE_PERSON_ID,
          status,
          moved_to_date,
          completed_at: null,
          completed_by_person_id: null,
          note: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        queryClient.setQueryData(
          ["task_occurrences", familyId],
          withWholeOccurrenceRow(previous, optimistic),
        );
      }
      return { previous };
    },
    onError: (error: Error, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["task_occurrences", familyId], ctx.previous);
      }
      toast.error(error.message || errorMessage);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["task_occurrences", familyId] });
    },
  });
}

export type SkipOccurrenceInput = {
  taskId: string;
  /** The SERIES date of the instance to drop, never its effective date. */
  occurrenceDate: string;
};

/**
 * "Preskoči ovo ponavljanje" - this Tuesday was not needed. The agenda drops
 * skipped instances entirely, and `isMissedOccurrence` treats them as resolved,
 * so a skip is the difference between "we decided not to" and "we forgot".
 */
export function useSkipOccurrence() {
  return useUpsertOccurrenceOverride<SkipOccurrenceInput>(
    () => ({ status: "skipped", moved_to_date: null }),
    "Greška pri preskakanju ponavljanja",
  );
}

export type MoveOccurrenceInput = {
  taskId: string;
  /** The SERIES date being moved - what the row keys on. */
  occurrenceDate: string;
  /** Where it shows instead. */
  movedToDate: string;
};

/**
 * "Pomeri na sutra" for a recurring task: the series is untouched, this one
 * instance surfaces on another day. Keyed by the original date, so it can still
 * be found by the date the series says it belongs to.
 */
export function useMoveOccurrence() {
  return useUpsertOccurrenceOverride<MoveOccurrenceInput>(
    (input) => ({ status: "moved", moved_to_date: input.movedToDate }),
    "Greška pri pomeranju ponavljanja",
  );
}

export type RestoreOccurrenceInput = {
  taskId: string;
  occurrenceDate: string;
};

/**
 * Undo a skip or a move. Deliberately NOT a way to untick: a `status: 'done'`
 * row is completion truth, and removing it belongs to `useToggleTask` alongside
 * the `is_completed` half. The `status` filter is what keeps the two apart.
 */
export function useRestoreOccurrence() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation<void, Error, RestoreOccurrenceInput, OccurrenceRollback>({
    mutationFn: async (input: RestoreOccurrenceInput): Promise<void> => {
      const { error } = await supabase
        .from("task_occurrences")
        .delete()
        .eq("task_id", input.taskId)
        .eq("occurrence_date", input.occurrenceDate)
        .is("person_id", null)
        .in("status", ["skipped", "moved"]);
      if (error) throw new Error(error.message);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["task_occurrences", familyId] });
      const previous = queryClient.getQueryData<TaskOccurrence[]>(["task_occurrences", familyId]);
      if (previous) {
        const next = previous.filter(
          (row) =>
            !(
              row.task_id === input.taskId &&
              row.occurrence_date === input.occurrenceDate &&
              row.person_id == null &&
              (row.status === "skipped" || row.status === "moved")
            ),
        );
        queryClient.setQueryData(["task_occurrences", familyId], next);
      }
      return { previous };
    },
    onError: (error: Error, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["task_occurrences", familyId], ctx.previous);
      }
      toast.error(error.message || "Greška pri vraćanju ponavljanja");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["task_occurrences", familyId] });
    },
  });
}
