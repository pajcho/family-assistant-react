import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  List,
  ListScope,
  ListWithTasks,
  Task,
  TaskCompletionMode,
  TaskOccurrence,
  TaskRecurrencePeriod,
  TaskScope,
} from "@/types/database";
import { applyCategorySort } from "@/lib/groceryCategorize";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { replaceTaskAssignees } from "@/hooks/useTaskAssignees";
import { useTaskOccurrenceRows } from "@/hooks/useTaskOccurrences";
import { isRecurringTask, isTaskDoneOn } from "@/utils/task";

/**
 * Lists and tasks data hooks - the successor of `useLists.ts`, which owned both
 * halves back when a task was still a `list_item`.
 *
 * Two queries hold task rows and both have to stay in step:
 *
 *   ["lists", familyId] - lists + their nested tasks, one round-trip, because
 *     one screen renders many lists. This is the query the shipped lists UI has
 *     always read, and every optimistic update below still patches it first.
 *   ["tasks", familyId] - the flat family task list, for the agenda and the
 *     smart lists, where a task's parent list is beside the point (or absent).
 *
 * The realtime `tasks` entry in `useFamilyChannel` invalidates BOTH, and so does
 * every mutation here. Patching only one of them is how a row appears ticked on
 * Danas and unticked in its list.
 *
 * Scope semantics are the list's, unchanged: `family` is visible to everyone in
 * the family, `personal` only to the owner. A task inside a list is FORCED to
 * carry its list's scope by a trigger; only a listless task answers for itself.
 * Visibility is enforced server-side by RLS - the client queries by `family_id`
 * and lets the two-arm policy do the rest.
 */

export type CreateListInput = {
  name: string;
  scope: ListScope;
  /** Hours of retention for completed items; null = never auto-delete. */
  auto_delete_completed_after_hours?: number | null;
  description?: string | null;
};

export type UpdateListInput = {
  name?: string;
  scope?: ListScope;
  auto_delete_completed_after_hours?: number | null;
  description?: string | null;
};

/** Every new dimension is optional: `list_id` + `name` alone is a list item. */
export type CreateTaskInput = {
  name: string;
  /** Omitted or null = a standalone task; it lands in the Inbox smart list. */
  list_id?: string | null;
  description?: string | null;
  due_date?: string | null;
  /** "HH:MM" or "HH:MM:SS". Requires `due_date` - a CHECK constraint says so. */
  due_time?: string | null;
  recurrence_period?: TaskRecurrencePeriod | null;
  recurrence_interval?: number;
  /** 0 = Monday .. 6 = Sunday. Never a raw JS `getDay()`. */
  recurrence_weekdays?: number[] | null;
  recurrence_until?: string | null;
  completion_mode?: TaskCompletionMode;
  remind_minutes_before?: number | null;
  remind_days_before?: number | null;
  /** Empty or omitted = family-wide, nobody's in particular. */
  assigneeIds?: string[];
  /** Only consulted for a LISTLESS task; one inside a list inherits its list's. */
  scope?: TaskScope;
};

export type UpdateTaskInput = {
  name?: string;
  description?: string | null;
  is_completed?: boolean;
  /** Moving a task between lists (or to the Inbox) re-derives its scope. */
  list_id?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  recurrence_period?: TaskRecurrencePeriod | null;
  recurrence_interval?: number;
  recurrence_weekdays?: number[] | null;
  recurrence_until?: string | null;
  completion_mode?: TaskCompletionMode;
  remind_minutes_before?: number | null;
  remind_days_before?: number | null;
  /** Replaces the WHOLE assignee set. Omit to leave assignees untouched. */
  assigneeIds?: string[];
};

/* ------------------------------------------------------------------------- */
/* Cache plumbing                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Re-apply the list's display order to its tasks.
 *
 * `sort_order` is the single source of truth - assigned at insert time (append
 * at the end) and rewritten by `useReorderTasks` when the user drags rows
 * around. Smart sort is a *view-time projection* on top: when
 * `smart_sort_enabled = true` we re-arrange the tasks into aisle order
 * client-side, without ever touching the persisted sort_order. Toggling smart
 * sort off non-destructively restores the manual order.
 *
 * Extracted so the optimistic mutations (`useCreateTask` etc.) can drop a
 * placeholder into the cache and have it land in the same slot the next
 * server-side fetch would put it in - no visible re-shuffle when the realtime
 * invalidation catches up.
 */
function applyTaskOrdering(list: ListWithTasks): ListWithTasks {
  const byManualOrder = [...(list.tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const tasks = list.smart_sort_enabled ? applyCategorySort(byManualOrder) : byManualOrder;
  return { ...list, tasks };
}

/** Both caches that hold task rows, snapshotted together for one rollback. */
interface TaskCacheSnapshot {
  lists: ListWithTasks[] | undefined;
  tasks: Task[] | undefined;
}

function snapshotTaskCaches(queryClient: QueryClient, familyId: string | null): TaskCacheSnapshot {
  return {
    lists: queryClient.getQueryData<ListWithTasks[]>(["lists", familyId]),
    tasks: queryClient.getQueryData<Task[]>(["tasks", familyId]),
  };
}

function rollbackTaskCaches(
  queryClient: QueryClient,
  familyId: string | null,
  snapshot: TaskCacheSnapshot | undefined,
): void {
  if (!snapshot) return;
  if (snapshot.lists) queryClient.setQueryData(["lists", familyId], snapshot.lists);
  if (snapshot.tasks) queryClient.setQueryData(["tasks", familyId], snapshot.tasks);
}

/** Both keys, invalidated together - see the module note on the two caches. */
function invalidateTaskCaches(queryClient: QueryClient, familyId: string | null): void {
  void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
  void queryClient.invalidateQueries({ queryKey: ["tasks", familyId] });
}

/**
 * Apply `patch` to every cached copy of the tasks `match` selects, in both
 * caches. Deliberately does NOT re-run `applyTaskOrdering`: a rename that
 * changes a task's aisle simply lands in the right group on the next fetch, and
 * re-sorting a row the user is looking at makes it jump under their thumb.
 */
function patchCachedTasks(
  queryClient: QueryClient,
  familyId: string | null,
  match: (task: Task) => boolean,
  patch: (task: Task) => Task,
): void {
  const lists = queryClient.getQueryData<ListWithTasks[]>(["lists", familyId]);
  if (lists) {
    queryClient.setQueryData(
      ["lists", familyId],
      lists.map((list) => ({
        ...list,
        tasks: list.tasks.map((task) => (match(task) ? patch(task) : task)),
      })),
    );
  }
  const tasks = queryClient.getQueryData<Task[]>(["tasks", familyId]);
  if (tasks) {
    queryClient.setQueryData(
      ["tasks", familyId],
      tasks.map((task) => (match(task) ? patch(task) : task)),
    );
  }
}

/** Yank every task `match` selects out of both caches. */
function removeCachedTasks(
  queryClient: QueryClient,
  familyId: string | null,
  match: (task: Task) => boolean,
): void {
  const lists = queryClient.getQueryData<ListWithTasks[]>(["lists", familyId]);
  if (lists) {
    queryClient.setQueryData(
      ["lists", familyId],
      lists.map((list) => ({ ...list, tasks: list.tasks.filter((task) => !match(task)) })),
    );
  }
  const tasks = queryClient.getQueryData<Task[]>(["tasks", familyId]);
  if (tasks) {
    queryClient.setQueryData(
      ["tasks", familyId],
      tasks.filter((task) => !match(task)),
    );
  }
}

/* ------------------------------------------------------------------------- */
/* Queries                                                                    */
/* ------------------------------------------------------------------------- */

async function fetchListsWithTasks(familyId: string): Promise<ListWithTasks[]> {
  // Most-recently-active list first. The AFTER trigger on tasks bumps the
  // parent list's `updated_at`, so adding/checking/renaming any task promotes
  // the list to the top - matches the "I just used this list, put it where I can
  // find it" mental model on the dashboard and overview.
  const { data, error } = await supabase
    .from("lists")
    .select("*, tasks(*)")
    .eq("family_id", familyId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data as ListWithTasks[]) ?? []).map(applyTaskOrdering);
}

export function useListsWithTasks() {
  const { familyId } = useProfile();

  const query = useQuery({
    queryKey: ["lists", familyId],
    queryFn: () => fetchListsWithTasks(familyId as string),
    enabled: !!familyId,
  });

  return query;
}

/**
 * Every task of the family, flat - listed and listless alike.
 *
 * Loaded wholesale like payments, activities and birthdays are, because the
 * agenda projects recurrence client-side and the smart lists are pure selections
 * over the same rows. Retention (see `purge_expired_completed_tasks`) is what
 * keeps a long-lived shopping list from making this unbounded.
 */
async function fetchTasks(familyId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("family_id", familyId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Task[]) ?? [];
}

export function useTasksList() {
  const { familyId } = useProfile();

  return useQuery({
    queryKey: ["tasks", familyId],
    queryFn: () => fetchTasks(familyId as string),
    enabled: !!familyId,
  });
}

/* ------------------------------------------------------------------------- */
/* List mutations                                                             */
/* ------------------------------------------------------------------------- */

export function useCreateList() {
  const { familyId } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateListInput): Promise<List> => {
      if (!familyId) throw new Error("Nema porodice");
      if (!user?.id) throw new Error("Niste prijavljeni");

      // Append to the end - same pattern as the old expenses table.
      const { data: maxData } = await supabase
        .from("lists")
        .select("sort_order")
        .eq("family_id", familyId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextOrder = ((maxData as { sort_order: number } | null)?.sort_order ?? 0) + 1;

      const { data, error } = await supabase
        .from("lists")
        .insert({
          family_id: familyId,
          owner_id: user.id,
          name: payload.name,
          scope: payload.scope,
          sort_order: nextOrder,
          auto_delete_completed_after_hours: payload.auto_delete_completed_after_hours ?? null,
          description: payload.description ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as List;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri kreiranju liste");
    },
  });
}

export function useUpdateList() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateListInput }): Promise<List> => {
      const { data, error } = await supabase
        .from("lists")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as List;
    },
    onSuccess: () => {
      // Changing a list's scope re-stamps the scope of every task inside it (an
      // AFTER trigger on `lists`), so the flat task cache is stale too.
      invalidateTaskCaches(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni liste");
    },
  });
}

export function useDeleteList() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("lists").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // ON DELETE CASCADE takes the list's tasks with it.
      invalidateTaskCaches(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju liste");
    },
  });
}

/**
 * Toggle `lists.smart_sort_enabled` for one list.
 *
 * Smart sort is purely a view-time projection - `fetchListsWithTasks` applies
 * the category sort client-side when the flag is on. Toggling the flag is
 * therefore a single boolean write with no follow-up bulk update, and turning
 * the flag back off non-destructively restores the user's underlying manual
 * order (the same order surfaced by the drag-to-reorder UI when smart sort is
 * off).
 */
export function useToggleSmartSort() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { list: ListWithTasks; enabled: boolean }): Promise<void> => {
      const { error } = await supabase
        .from("lists")
        .update({ smart_sort_enabled: args.enabled })
        .eq("id", args.list.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, args) => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
      if (args.enabled) {
        toast.success("Pametno sortiranje uključeno");
      } else {
        toast.success("Pametno sortiranje isključeno");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri promeni sortiranja");
    },
  });
}

/* ------------------------------------------------------------------------- */
/* Task mutations                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Bulk-clone tasks into a (freshly created) list - the "Dupliraj sa stavkama"
 * half of the duplicate flow. Copies name, notes and the manual sort_order, but
 * always inserts as NOT completed and WITHOUT dates, assignees or recurrence:
 * the use-case is a fresh shopping list from a template, not an archive copy of
 * somebody's schedule. No optimistic update - this runs right after the list
 * insert, so the invalidate is what surfaces the new list + tasks together.
 */
export type CopyTasksInput = {
  /** Source tasks to clone (their persisted sort_order carries over). */
  tasks: Task[];
  /** The list that receives the copies. */
  targetListId: string;
};

export function useCopyTasks() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tasks, targetListId }: CopyTasksInput): Promise<void> => {
      if (tasks.length === 0) return;
      const rows = tasks.map((task) => ({
        list_id: targetListId,
        name: task.name,
        description: task.description,
        sort_order: task.sort_order,
        is_completed: false,
        // family_id, owner_id and scope are filled in by the BEFORE INSERT trigger
      }));
      const { error } = await supabase.from("tasks").insert(rows);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateTaskCaches(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri kopiranju stavki");
    },
  });
}

/**
 * Prefix used for the temporary id assigned to an optimistically-inserted row
 * before the server returns the real UUID. Filtering on this prefix lets
 * `mutationFn` ignore in-flight placeholders when it computes the next
 * sort_order, so the value it sends to Postgres matches what `onMutate` already
 * showed in the cache.
 */
const TEMP_TASK_ID_PREFIX = "temp-";

/** Highest persisted sort_order among `tasks`, ignoring in-flight placeholders. */
function maxPersistedSortOrder(tasks: readonly Task[] | undefined): number {
  return (
    tasks
      ?.filter((task) => !task.id.startsWith(TEMP_TASK_ID_PREFIX))
      .reduce((max, task) => (task.sort_order > max ? task.sort_order : max), 0) ?? 0
  );
}

export function useCreateTask() {
  const { familyId } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateTaskInput): Promise<Task> => {
      // Look up the parent list from the cache so we can compute next
      // sort_order (append-at-end) without an extra round-trip. We skip any
      // temp placeholder rows that `onMutate` may have just inserted for
      // parallel creates - otherwise back-to-back submissions would race the
      // cache and produce sparse / off-by-one sort_orders.
      const listId = payload.list_id ?? null;
      let maxOrder: number;
      if (listId) {
        const cached = queryClient.getQueryData<ListWithTasks[]>(["lists", familyId]);
        maxOrder = maxPersistedSortOrder(cached?.find((l) => l.id === listId)?.tasks);
      } else {
        // A listless task has no list to append to, so the Inbox is the scope
        // its order is counted in.
        const cached = queryClient.getQueryData<Task[]>(["tasks", familyId]);
        maxOrder = maxPersistedSortOrder(cached?.filter((task) => task.list_id == null));
      }

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          list_id: listId,
          name: payload.name,
          sort_order: maxOrder + 1,
          description: payload.description ?? null,
          due_date: payload.due_date ?? null,
          due_time: payload.due_time ?? null,
          recurrence_period: payload.recurrence_period ?? null,
          recurrence_interval: payload.recurrence_interval ?? 1,
          recurrence_weekdays: payload.recurrence_weekdays ?? null,
          recurrence_until: payload.recurrence_until ?? null,
          completion_mode: payload.completion_mode ?? "shared",
          remind_minutes_before: payload.remind_minutes_before ?? null,
          remind_days_before: payload.remind_days_before ?? null,
          // A task inside a list has its scope FORCED to the list's by the
          // trigger, so sending one only matters for a listless task.
          ...(listId ? {} : { scope: payload.scope ?? "family" }),
          // family_id and owner_id are filled in by the BEFORE INSERT trigger
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const created = data as Task;

      if (payload.assigneeIds && payload.assigneeIds.length > 0) {
        if (!familyId) throw new Error("Nema porodice");
        await replaceTaskAssignees(familyId, created.id, payload.assigneeIds);
      }
      return created;
    },
    onMutate: async (payload) => {
      // Optimistic: typing a name and pressing Enter should drop the row into
      // the list instantly. We synthesise a placeholder with a temp id, the same
      // sort_order `mutationFn` will compute, and re-run the list's ordering so
      // the row appears in its final slot (incl. smart-sort aisle). `onSuccess`
      // swaps the temp id for the real one so React keeps the same row mounted
      // across the round-trip.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      await queryClient.cancelQueries({ queryKey: ["tasks", familyId] });
      const previous = snapshotTaskCaches(queryClient, familyId);
      const listId = payload.list_id ?? null;

      const parent = listId ? previous.lists?.find((l) => l.id === listId) : undefined;
      if (listId && !parent) return { previous, tempId: null };

      const maxOrder = listId
        ? (parent?.tasks.reduce(
            (max, task) => (task.sort_order > max ? task.sort_order : max),
            0,
          ) ?? 0)
        : (previous.tasks
            ?.filter((task) => task.list_id == null)
            .reduce((max, task) => (task.sort_order > max ? task.sort_order : max), 0) ?? 0);

      const tempId = `${TEMP_TASK_ID_PREFIX}${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const optimistic: Task = {
        id: tempId,
        list_id: listId,
        family_id: (familyId as string) ?? "",
        owner_id: user?.id ?? null,
        scope: parent?.scope ?? payload.scope ?? "family",
        name: payload.name,
        description: payload.description ?? null,
        is_completed: false,
        completed_at: null,
        completed_by_person_id: null,
        due_date: payload.due_date ?? null,
        due_time: payload.due_time ?? null,
        recurrence_period: payload.recurrence_period ?? null,
        recurrence_interval: payload.recurrence_interval ?? 1,
        recurrence_weekdays: payload.recurrence_weekdays ?? null,
        recurrence_until: payload.recurrence_until ?? null,
        completion_mode: payload.completion_mode ?? "shared",
        remind_minutes_before: payload.remind_minutes_before ?? null,
        remind_days_before: payload.remind_days_before ?? null,
        sort_order: maxOrder + 1,
        // Audit columns reference `auth.users`, not `profiles`, so this is the
        // auth uid - exactly what `set_task_defaults()` will stamp server-side.
        created_by_id: user?.id ?? null,
        updated_by_id: user?.id ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      if (previous.lists && listId) {
        queryClient.setQueryData(
          ["lists", familyId],
          previous.lists.map((list) =>
            list.id === listId
              ? applyTaskOrdering({ ...list, tasks: [...list.tasks, optimistic] })
              : list,
          ),
        );
      }
      if (previous.tasks) {
        queryClient.setQueryData(["tasks", familyId], [...previous.tasks, optimistic]);
      }
      return { previous, tempId };
    },
    onSuccess: (data, _vars, ctx) => {
      // Replace the placeholder with the real row in place so the React key is
      // stable across the round-trip (no remount / flicker) and any racing
      // realtime invalidation sees the final id, not a temp.
      if (!ctx?.tempId) return;
      const tempId = ctx.tempId;
      const current = queryClient.getQueryData<ListWithTasks[]>(["lists", familyId]);
      if (current) {
        queryClient.setQueryData(
          ["lists", familyId],
          current.map((list) =>
            applyTaskOrdering({
              ...list,
              tasks: list.tasks.map((task) => (task.id === tempId ? data : task)),
            }),
          ),
        );
      }
      const currentTasks = queryClient.getQueryData<Task[]>(["tasks", familyId]);
      if (currentTasks) {
        queryClient.setQueryData(
          ["tasks", familyId],
          currentTasks.map((task) => (task.id === tempId ? data : task)),
        );
      }
    },
    onError: (error: Error, _vars, ctx) => {
      rollbackTaskCaches(queryClient, familyId, ctx?.previous);
      toast.error(error.message || "Greška pri dodavanju stavke");
    },
    onSettled: (_data, _error, vars) => {
      invalidateTaskCaches(queryClient, familyId);
      if (vars.assigneeIds) {
        void queryClient.invalidateQueries({ queryKey: ["task_assignees", familyId] });
      }
    },
  });
}

export function useUpdateTask() {
  const { familyId, profile } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateTaskInput }): Promise<Task | null> => {
      // `assigneeIds` is a junction table, not a column - it travels separately.
      const { assigneeIds, ...columns } = args.payload;

      let updated: Task | null = null;
      if (Object.keys(columns).length > 0) {
        // Toggling is_completed also stamps/clears completed_at and who did it,
        // so the UI can surface "completed N minutes ago, by X" without a second
        // write. `completed_by_person_id` references `profiles`, so it is the
        // caller's own profile id - which for a grown-up equals their auth uid.
        const patch: Record<string, unknown> = { ...columns };
        if (columns.is_completed === true) {
          patch.completed_at = new Date().toISOString();
          patch.completed_by_person_id = profile?.id ?? null;
        } else if (columns.is_completed === false) {
          patch.completed_at = null;
          patch.completed_by_person_id = null;
        }

        const { data, error } = await supabase
          .from("tasks")
          .update(patch)
          .eq("id", args.id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        // Smart sort is applied client-side at fetch time, so a rename that
        // changes the task's category (e.g. "Mleko" -> "Hleb") simply lands in
        // the right aisle on the next render - no sort_order rewrite needed.
        updated = data as Task;
      }

      if (assigneeIds) {
        if (!familyId) throw new Error("Nema porodice");
        await replaceTaskAssignees(familyId, args.id, assigneeIds);
      }
      return updated;
    },
    onMutate: async (args) => {
      // Optimistic: ticking a checkbox should feel instant. We patch the cached
      // row in place, in both caches, so it visually completes before the
      // round-trip + realtime invalidation arrives.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      await queryClient.cancelQueries({ queryKey: ["tasks", familyId] });
      const previous = snapshotTaskCaches(queryClient, familyId);
      const { assigneeIds: _assigneeIds, ...columns } = args.payload;
      patchCachedTasks(
        queryClient,
        familyId,
        (task) => task.id === args.id,
        (task) => ({ ...task, ...columns }),
      );
      return { previous };
    },
    onError: (error: Error, _args, ctx) => {
      // Roll back optimistic update before surfacing the toast.
      rollbackTaskCaches(queryClient, familyId, ctx?.previous);
      toast.error(error.message || "Greška pri izmeni stavke");
    },
    onSettled: (_data, _error, vars) => {
      invalidateTaskCaches(queryClient, familyId);
      if (vars.payload.assigneeIds) {
        void queryClient.invalidateQueries({ queryKey: ["task_assignees", familyId] });
      }
    },
  });
}

export function useDeleteTask() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async (id) => {
      // Optimistic: the confirm dialog has already gathered intent, so yank the
      // row out of the cache immediately. If the server rejects we restore the
      // previous snapshot in `onError`.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      await queryClient.cancelQueries({ queryKey: ["tasks", familyId] });
      const previous = snapshotTaskCaches(queryClient, familyId);
      removeCachedTasks(queryClient, familyId, (task) => task.id === id);
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      rollbackTaskCaches(queryClient, familyId, ctx?.previous);
      toast.error(error.message || "Greška pri brisanju stavke");
    },
    onSettled: () => {
      invalidateTaskCaches(queryClient, familyId);
      // ON DELETE CASCADE takes the task's assignees and occurrences with it.
      void queryClient.invalidateQueries({ queryKey: ["task_assignees", familyId] });
      void queryClient.invalidateQueries({ queryKey: ["task_occurrences", familyId] });
    },
  });
}

/**
 * Bulk-update the `sort_order` of multiple tasks in parallel. Used by
 * drag-to-reorder inside a list.
 */
export interface TaskReorderInput {
  id: string;
  sort_order: number;
}

export function useReorderTasks() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: TaskReorderInput[]): Promise<void> => {
      // Fire all updates in parallel - same pattern as `useReorderExpenses` had
      // before the expenses feature was removed. Each call goes through RLS
      // individually, so a partial failure surfaces the first error.
      const results = await Promise.all(
        updates.map((u) =>
          supabase.from("tasks").update({ sort_order: u.sort_order }).eq("id", u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    },
    onMutate: async (updates) => {
      // Optimistic: drag-to-reorder should feel instant. We patch every task's
      // sort_order in the cached lists-with-tasks array and re-sort so the
      // visual order matches the user's drop position before the N PATCH
      // round-trips even land. The realtime subscription will then race in and
      // reconcile.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      await queryClient.cancelQueries({ queryKey: ["tasks", familyId] });
      const previous = snapshotTaskCaches(queryClient, familyId);
      const sortMap = new Map(updates.map((u) => [u.id, u.sort_order]));
      if (previous.lists) {
        const next = previous.lists.map((list) => {
          if (!list.tasks.some((task) => sortMap.has(task.id))) return list;
          const patched = list.tasks
            .map((task) =>
              sortMap.has(task.id) ? { ...task, sort_order: sortMap.get(task.id) as number } : task,
            )
            .sort((a, b) => a.sort_order - b.sort_order);
          // Smart sort is a view-time projection that re-runs on every render
          // via `fetchListsWithTasks`. We don't apply it here - drag-to-reorder
          // is only exposed when smart sort is OFF, so the manual order is what
          // the user expects to see.
          return { ...list, tasks: patched };
        });
        queryClient.setQueryData(["lists", familyId], next);
      }
      if (previous.tasks) {
        queryClient.setQueryData(
          ["tasks", familyId],
          previous.tasks.map((task) =>
            sortMap.has(task.id) ? { ...task, sort_order: sortMap.get(task.id) as number } : task,
          ),
        );
      }
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      rollbackTaskCaches(queryClient, familyId, ctx?.previous);
      toast.error(error.message || "Greška pri sortiranju");
    },
    onSettled: () => {
      invalidateTaskCaches(queryClient, familyId);
    },
  });
}

/**
 * Bulk-delete every completed task in a single list. Used by the "Clear
 * completed" action inside each list card. Dated tasks are included: the user
 * asked for this list to be emptied of what is finished, and unlike the
 * retention cron (which must never eat a record of when something was due) this
 * is an explicit, confirmed action.
 */
export function useClearCompletedTasks() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listId: string): Promise<void> => {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("list_id", listId)
        .eq("is_completed", true);
      if (error) throw new Error(error.message);
    },
    onMutate: async (listId) => {
      // Optimistic: clear the completed section instantly so the count chip and
      // the collapsible vanish without waiting for the bulk DELETE to
      // round-trip. Same intent-already-confirmed rationale as `useDeleteTask`.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      await queryClient.cancelQueries({ queryKey: ["tasks", familyId] });
      const previous = snapshotTaskCaches(queryClient, familyId);
      removeCachedTasks(
        queryClient,
        familyId,
        (task) => task.list_id === listId && task.is_completed,
      );
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      rollbackTaskCaches(queryClient, familyId, ctx?.previous);
      toast.error(error.message || "Greška pri brisanju završenih stavki");
    },
    onSettled: () => {
      invalidateTaskCaches(queryClient, familyId);
      void queryClient.invalidateQueries({ queryKey: ["task_occurrences", familyId] });
    },
  });
}

/* ------------------------------------------------------------------------- */
/* Completion - the one mutation that knows it has two homes                  */
/* ------------------------------------------------------------------------- */

export type ToggleTaskInput = {
  task: Task;
  /**
   * The SERIES date of the instance being ticked
   * (`TaskOccurrenceInstance.occurrenceDate`), never its effective date.
   * Ignored for a non-recurring task, whose truth is a single boolean.
   */
  date: string;
  /**
   * Whose copy of the occurrence this is. Only consulted for
   * `completion_mode: 'per_assignee'`; defaults to the caller's own profile.
   */
  personId?: string | null;
  /** Target state. Omitted = flip whatever the instance currently reads as. */
  done?: boolean;
};

/**
 * Tick a task off, whichever of the two homes its completion lives in:
 * `tasks.is_completed` for a non-recurring task, a `task_occurrences` row for a
 * recurring one. `utils/task.ts::isTaskDoneOn` decides which one to read, this
 * decides which one to write, and nothing else in the app touches either.
 *
 * The current state is read from the occurrence cache as it stood when the tap
 * happened, and it may only be read ONCE per tap. `onMutate` runs before
 * `mutationFn` and is what writes the optimistic row, so a second read from
 * `mutationFn` would find that row and send the opposite of what was asked for.
 * The answer therefore travels between the two callbacks in a WeakMap keyed by
 * the variables object React Query hands to both, and is dropped again on settle
 * so a caller reusing one input object cannot inherit a stale target.
 */
export function useToggleTask() {
  const { familyId, profile } = useProfile();
  const queryClient = useQueryClient();
  // The same cached query the agenda reads - no extra fetch.
  const { byKey: occurrencesByKey } = useTaskOccurrenceRows();
  const profileId = profile?.id ?? null;
  const resolvedTargets = useRef(new WeakMap<ToggleTaskInput, boolean>());

  /** The occurrence row this tick owns: the whole one, or this person's copy. */
  const slotPersonIdFor = (input: ToggleTaskInput): string | null =>
    input.task.completion_mode === "per_assignee" ? (input.personId ?? profileId) : null;

  /** Resolve on the first call for this input, replay it on every later one. */
  const resolveTarget = (input: ToggleTaskInput): boolean => {
    const already = resolvedTargets.current.get(input);
    if (already !== undefined) return already;
    const target =
      input.done ?? !isTaskDoneOn(input.task, input.date, occurrencesByKey, slotPersonIdFor(input));
    resolvedTargets.current.set(input, target);
    return target;
  };

  return useMutation({
    mutationFn: async (input: ToggleTaskInput): Promise<void> => {
      const nextDone = resolveTarget(input);

      if (!isRecurringTask(input.task)) {
        const { error } = await supabase
          .from("tasks")
          .update({
            is_completed: nextDone,
            completed_at: nextDone ? new Date().toISOString() : null,
            completed_by_person_id: nextDone ? profileId : null,
          })
          .eq("id", input.task.id);
        if (error) throw new Error(error.message);
        return;
      }

      if (!familyId) throw new Error("Nema porodice");
      const slotPersonId = slotPersonIdFor(input);

      if (!nextDone) {
        // Only a 'done' row is completion truth. The status filter is what keeps
        // an untick from silently deleting a skip or a move for the same slot.
        const query = supabase
          .from("task_occurrences")
          .delete()
          .eq("task_id", input.task.id)
          .eq("occurrence_date", input.date)
          .eq("status", "done");
        const { error } = await (slotPersonId
          ? query.eq("person_id", slotPersonId)
          : query.is("person_id", null));
        if (error) throw new Error(error.message);
        return;
      }

      // `moved_to_date` is deliberately absent from the payload, and that
      // omission is load-bearing: PostgREST writes only the columns it is given,
      // so ticking an occurrence a parent had moved keeps the relocation on the
      // row. The two columns answer two different questions - `moved_to_date` is
      // WHERE the occurrence sits, `status` is WHETHER it is resolved - and
      // `expandTaskOccurrences` honours the date whatever the status says. Send
      // it as null here and Wednesday's chore would snap back to Monday the
      // moment somebody ticked it.
      const { error } = await supabase.from("task_occurrences").upsert(
        {
          task_id: input.task.id,
          family_id: familyId,
          occurrence_date: input.date,
          person_id: slotPersonId,
          status: "done",
          completed_at: new Date().toISOString(),
          completed_by_person_id: profileId,
        },
        { onConflict: "task_id,occurrence_date,person_id" },
      );
      if (error) throw new Error(error.message);
    },
    onMutate: async (input) => {
      const nextDone = resolveTarget(input);

      if (!isRecurringTask(input.task)) {
        await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
        await queryClient.cancelQueries({ queryKey: ["tasks", familyId] });
        const previous = snapshotTaskCaches(queryClient, familyId);
        patchCachedTasks(
          queryClient,
          familyId,
          (task) => task.id === input.task.id,
          (task) => ({
            ...task,
            is_completed: nextDone,
            completed_at: nextDone ? new Date().toISOString() : null,
            completed_by_person_id: nextDone ? profileId : null,
          }),
        );
        return { previous, previousOccurrences: undefined };
      }

      await queryClient.cancelQueries({ queryKey: ["task_occurrences", familyId] });
      const previousOccurrences = queryClient.getQueryData<TaskOccurrence[]>([
        "task_occurrences",
        familyId,
      ]);
      if (previousOccurrences) {
        const slotPersonId = slotPersonIdFor(input);
        const isSameSlot = (row: TaskOccurrence): boolean =>
          row.task_id === input.task.id &&
          row.occurrence_date === input.date &&
          (row.person_id ?? null) === slotPersonId;
        const nowIso = new Date().toISOString();
        const next = nextDone
          ? [
              ...previousOccurrences.filter((row) => !isSameSlot(row)),
              {
                id: `${TEMP_TASK_ID_PREFIX}${crypto.randomUUID()}`,
                task_id: input.task.id,
                family_id: (familyId as string) ?? "",
                occurrence_date: input.date,
                person_id: slotPersonId,
                status: "done" as const,
                moved_to_date: null,
                completed_at: nowIso,
                completed_by_person_id: profileId,
                note: null,
                created_at: nowIso,
                updated_at: nowIso,
              },
            ]
          : previousOccurrences.filter((row) => !(isSameSlot(row) && row.status === "done"));
        queryClient.setQueryData(["task_occurrences", familyId], next);
      }
      return { previous: undefined, previousOccurrences };
    },
    onError: (error: Error, _input, ctx) => {
      rollbackTaskCaches(queryClient, familyId, ctx?.previous);
      if (ctx?.previousOccurrences) {
        queryClient.setQueryData(["task_occurrences", familyId], ctx.previousOccurrences);
      }
      toast.error(error.message || "Greška pri izmeni stavke");
    },
    onSettled: (_data, _error, input) => {
      resolvedTargets.current.delete(input);
      if (isRecurringTask(input.task)) {
        void queryClient.invalidateQueries({ queryKey: ["task_occurrences", familyId] });
        return;
      }
      invalidateTaskCaches(queryClient, familyId);
    },
  });
}
