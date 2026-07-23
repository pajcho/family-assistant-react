import { useEffect, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { List, ListItem, ListScope, ListWithItems } from "@/types/database";
import { applyCategorySort } from "@/lib/groceryCategorize";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

/**
 * Lists data hooks - replaces the old `useExpenses.ts`.
 *
 * One screen renders many lists, so we fetch lists + their items in a
 * single nested select. Realtime subscriptions watch both tables and
 * invalidate the combined query on any change.
 *
 * Scope semantics:
 *   - `family` - visible to everyone in the user's family
 *   - `personal` - visible only to the owner
 *
 * Visibility is enforced server-side via RLS; the client queries by
 * `family_id` (which both kinds share) and lets the policy do the rest.
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

export type CreateListItemInput = {
  list_id: string;
  name: string;
  description?: string | null;
};

export type UpdateListItemInput = {
  name?: string;
  is_completed?: boolean;
  description?: string | null;
};

/**
 * Re-apply the list's display order to its items.
 *
 * `sort_order` is the single source of truth - assigned at insert time
 * (append at the end) and rewritten by `useReorderListItems` when the
 * user drags rows around. Smart sort is a *view-time projection* on top:
 * when `smart_sort_enabled = true` we re-arrange the items into aisle
 * order client-side, without ever touching the persisted sort_order.
 * Toggling smart sort off non-destructively restores the manual order.
 *
 * Extracted so the optimistic mutations (`useCreateListItem` etc.) can
 * drop a placeholder into the cache and have it land in the same slot
 * the next server-side fetch would put it in - no visible re-shuffle
 * when the realtime invalidation catches up.
 */
function applyItemOrdering(list: ListWithItems): ListWithItems {
  const byManualOrder = [...(list.list_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const list_items = list.smart_sort_enabled ? applyCategorySort(byManualOrder) : byManualOrder;
  return { ...list, list_items };
}

async function fetchListsWithItems(familyId: string): Promise<ListWithItems[]> {
  // Most-recently-active list first. The AFTER trigger on list_items bumps
  // the parent list's `updated_at`, so adding/checking/renaming any item
  // promotes the list to the top - matches the "I just used this list, put
  // it where I can find it" mental model on the dashboard and overview.
  const { data, error } = await supabase
    .from("lists")
    .select("*, list_items(*)")
    .eq("family_id", familyId)
    .order("updated_at", { ascending: false });
  if (error) return [];
  return ((data as ListWithItems[]) ?? []).map(applyItemOrdering);
}

export function useListsWithItems() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  // Unique per hook instance. The master-detail layout mounts this hook in
  // several components at once (the sidebar + the open list's detail, plus the
  // dashboard card), and a *shared* channel topic makes Supabase throw
  // "cannot add `postgres_changes` callbacks after `subscribe()`" when the
  // second instance subscribes to the same topic. A per-instance topic gives
  // each mount its own channel - they all just invalidate the same query, which
  // React Query dedupes - and also avoids the same collision during the brief
  // overlap when navigating between two screens that both read lists.
  const instanceId = useId();

  const query = useQuery({
    queryKey: ["lists", familyId],
    queryFn: () => fetchListsWithItems(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    const channel = supabase
      .channel(`lists-${familyId}-${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lists",
          filter: `family_id=eq.${familyId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "list_items",
          filter: `family_id=eq.${familyId}`,
        },
        invalidate,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, instanceId]);

  return query;
}

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
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
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
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju liste");
    },
  });
}

/**
 * Bulk-clone items into a (freshly created) list - the "Dupliraj sa
 * stavkama" half of the duplicate flow. Copies name, notes and the manual
 * sort_order, but always inserts as NOT completed: the use-case is a fresh
 * shopping list from a template, not an archive copy. No optimistic update -
 * this runs right after the list insert, so the invalidate is what surfaces
 * the new list + items together.
 */
export type CopyListItemsInput = {
  /** Source items to clone (their persisted sort_order carries over). */
  items: ListItem[];
  /** The list that receives the copies. */
  targetListId: string;
};

export function useCopyListItems() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ items, targetListId }: CopyListItemsInput): Promise<void> => {
      if (items.length === 0) return;
      const rows = items.map((item) => ({
        list_id: targetListId,
        name: item.name,
        description: item.description,
        sort_order: item.sort_order,
        is_completed: false,
        // family_id is filled in by the BEFORE INSERT trigger
      }));
      const { error } = await supabase.from("list_items").insert(rows);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri kopiranju stavki");
    },
  });
}

/**
 * Prefix used for the temporary id assigned to an optimistically-inserted
 * row before the server returns the real UUID. Filtering on this prefix
 * lets `mutationFn` ignore in-flight placeholders when it computes the
 * next sort_order, so the value it sends to Postgres matches what
 * `onMutate` already showed in the cache.
 */
const TEMP_ITEM_ID_PREFIX = "temp-";

export function useCreateListItem() {
  const { familyId } = useProfile();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateListItemInput): Promise<ListItem> => {
      // Look up the parent list from the cache so we can compute next
      // sort_order (append-at-end) without an extra round-trip. We skip
      // any temp placeholder rows that `onMutate` may have just inserted
      // for parallel creates - otherwise back-to-back submissions would
      // race the cache and produce sparse / off-by-one sort_orders.
      const cached = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      const parent = cached?.find((l) => l.id === payload.list_id);
      const maxOrder =
        parent?.list_items
          .filter((item) => !item.id.startsWith(TEMP_ITEM_ID_PREFIX))
          .reduce((max, item) => (item.sort_order > max ? item.sort_order : max), 0) ?? 0;

      const { data, error } = await supabase
        .from("list_items")
        .insert({
          list_id: payload.list_id,
          name: payload.name,
          sort_order: maxOrder + 1,
          description: payload.description ?? null,
          // family_id is filled in by the BEFORE INSERT trigger
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as ListItem;
    },
    onMutate: async (payload) => {
      // Optimistic: typing a name and pressing Enter should drop the row
      // into the list instantly. We synthesise a placeholder with a temp
      // id, the same sort_order `mutationFn` will compute, and re-run
      // the list's ordering so the row appears in its final slot (incl.
      // smart-sort aisle). `onSuccess` swaps the temp id for the real
      // one so React keeps the same row mounted across the round-trip.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      const previous = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      if (!previous) return { previous, tempId: null };

      const parent = previous.find((l) => l.id === payload.list_id);
      if (!parent) return { previous, tempId: null };

      const maxOrder = parent.list_items.reduce(
        (max, item) => (item.sort_order > max ? item.sort_order : max),
        0,
      );
      const tempId = `${TEMP_ITEM_ID_PREFIX}${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const optimistic: ListItem = {
        id: tempId,
        list_id: payload.list_id,
        family_id: (familyId as string) ?? "",
        name: payload.name,
        description: payload.description ?? null,
        is_completed: false,
        completed_at: null,
        sort_order: maxOrder + 1,
        created_by_id: user?.id ?? null,
        updated_by_id: user?.id ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const next = previous.map((list) =>
        list.id === payload.list_id
          ? applyItemOrdering({ ...list, list_items: [...list.list_items, optimistic] })
          : list,
      );
      queryClient.setQueryData(["lists", familyId], next);
      return { previous, tempId };
    },
    onSuccess: (data, _vars, ctx) => {
      // Replace the placeholder with the real row in place so the React
      // key is stable across the round-trip (no remount / flicker) and
      // any racing realtime invalidation sees the final id, not a temp.
      if (!ctx?.tempId) return;
      const current = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      if (!current) return;
      const replaced = current.map((list) =>
        applyItemOrdering({
          ...list,
          list_items: list.list_items.map((it) => (it.id === ctx.tempId ? data : it)),
        }),
      );
      queryClient.setQueryData(["lists", familyId], replaced);
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["lists", familyId], ctx.previous);
      }
      toast.error(error.message || "Greška pri dodavanju stavke");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
  });
}

export function useUpdateListItem() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateListItemInput }): Promise<ListItem> => {
      // Toggling is_completed also stamps/clears completed_at so the UI can
      // surface "completed N minutes ago" later without a separate write.
      const patch: Record<string, unknown> = { ...args.payload };
      if (args.payload.is_completed === true) {
        patch.completed_at = new Date().toISOString();
      } else if (args.payload.is_completed === false) {
        patch.completed_at = null;
      }

      const { data, error } = await supabase
        .from("list_items")
        .update(patch)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      // Smart sort is applied client-side at fetch time, so a rename that
      // changes the item's category (e.g. "Mleko" → "Hleb") simply lands
      // in the right aisle on the next render - no sort_order rewrite
      // needed.
      return data as ListItem;
    },
    onMutate: async (args) => {
      // Optimistic: ticking a checkbox should feel instant. We patch the
      // cached list-with-items in place so the row visually completes
      // before the round-trip + realtime invalidation arrives.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      const previous = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      if (previous) {
        const next = previous.map((list) => ({
          ...list,
          list_items: list.list_items.map((item) =>
            item.id === args.id ? { ...item, ...args.payload } : item,
          ),
        }));
        queryClient.setQueryData(["lists", familyId], next);
      }
      return { previous };
    },
    onError: (error: Error, _args, ctx) => {
      // Roll back optimistic update before surfacing the toast.
      if (ctx?.previous) {
        queryClient.setQueryData(["lists", familyId], ctx.previous);
      }
      toast.error(error.message || "Greška pri izmeni stavke");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
  });
}

export function useDeleteListItem() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("list_items").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async (id) => {
      // Optimistic: confirm-dialog has already gathered intent, so yank
      // the row out of the cache immediately. If the server rejects we
      // restore the previous snapshot in `onError`.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      const previous = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      if (previous) {
        const next = previous.map((list) => ({
          ...list,
          list_items: list.list_items.filter((item) => item.id !== id),
        }));
        queryClient.setQueryData(["lists", familyId], next);
      }
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["lists", familyId], ctx.previous);
      }
      toast.error(error.message || "Greška pri brisanju stavke");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
  });
}

/**
 * Bulk-update the `sort_order` of multiple list_items in parallel. Used by
 * the smart-sort feature on shopping lists, but generic enough to back
 * future drag-to-reorder UI.
 */
export interface ListItemReorderInput {
  id: string;
  sort_order: number;
}

export function useReorderListItems() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: ListItemReorderInput[]): Promise<void> => {
      // Fire all updates in parallel - same pattern as `useReorderExpenses`
      // had before the expenses feature was removed. Each call goes through
      // RLS individually, so a partial failure surfaces the first error.
      const results = await Promise.all(
        updates.map((u) =>
          supabase.from("list_items").update({ sort_order: u.sort_order }).eq("id", u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    },
    onMutate: async (updates) => {
      // Optimistic: drag-to-reorder should feel instant. We patch every
      // item's sort_order in the cached list-with-items array and re-sort
      // so the visual order matches the user's drop position before the
      // N PATCH round-trips even land. The realtime subscription will
      // then race in and reconcile.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      const previous = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      if (previous) {
        const sortMap = new Map(updates.map((u) => [u.id, u.sort_order]));
        const next = previous.map((list) => {
          if (!list.list_items.some((item) => sortMap.has(item.id))) return list;
          const patched = list.list_items
            .map((item) =>
              sortMap.has(item.id) ? { ...item, sort_order: sortMap.get(item.id) as number } : item,
            )
            .sort((a, b) => a.sort_order - b.sort_order);
          // Smart sort is a view-time projection that re-runs on every
          // render via `fetchListsWithItems`. We don't apply it here -
          // drag-to-reorder is only exposed when smart sort is OFF, so
          // the manual order is what the user expects to see.
          return { ...list, list_items: patched };
        });
        queryClient.setQueryData(["lists", familyId], next);
      }
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["lists", familyId], ctx.previous);
      }
      toast.error(error.message || "Greška pri sortiranju");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
  });
}

/**
 * Toggle `lists.smart_sort_enabled` for one list.
 *
 * Smart sort is purely a view-time projection - `fetchListsWithItems`
 * applies the category sort client-side when the flag is on. Toggling
 * the flag is therefore a single boolean write with no follow-up bulk
 * update, and turning the flag back off non-destructively restores the
 * user's underlying manual order (the same order surfaced by the new
 * drag-to-reorder UI when smart sort is off).
 */
export function useToggleSmartSort() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { list: ListWithItems; enabled: boolean }): Promise<void> => {
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

/**
 * Bulk-delete every completed item in a single list. Used by the "Clear
 * completed" action inside each list card.
 */
export function useClearCompletedItems() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listId: string): Promise<void> => {
      const { error } = await supabase
        .from("list_items")
        .delete()
        .eq("list_id", listId)
        .eq("is_completed", true);
      if (error) throw new Error(error.message);
    },
    onMutate: async (listId) => {
      // Optimistic: clear the completed section instantly so the count
      // chip and the collapsible vanish without waiting for the bulk
      // DELETE to round-trip. Same intent-already-confirmed rationale
      // as `useDeleteListItem`.
      await queryClient.cancelQueries({ queryKey: ["lists", familyId] });
      const previous = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      if (previous) {
        const next = previous.map((list) =>
          list.id === listId
            ? { ...list, list_items: list.list_items.filter((item) => !item.is_completed) }
            : list,
        );
        queryClient.setQueryData(["lists", familyId], next);
      }
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["lists", familyId], ctx.previous);
      }
      toast.error(error.message || "Greška pri brisanju završenih stavki");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
  });
}
