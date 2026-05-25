import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { List, ListItem, ListScope, ListWithItems } from "@/types/database";
import { applyCategorySort } from "@/lib/groceryCategorize";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

/**
 * Lists data hooks — replaces the old `useExpenses.ts`.
 *
 * One screen renders many lists, so we fetch lists + their items in a
 * single nested select. Realtime subscriptions watch both tables and
 * invalidate the combined query on any change.
 *
 * Scope semantics:
 *   - `family` — visible to everyone in the user's family
 *   - `personal` — visible only to the owner
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

async function fetchListsWithItems(familyId: string): Promise<ListWithItems[]> {
  // Most-recently-active list first. The AFTER trigger on list_items bumps
  // the parent list's `updated_at`, so adding/checking/renaming any item
  // promotes the list to the top — matches the "I just used this list, put
  // it where I can find it" mental model on the dashboard and overview.
  const { data, error } = await supabase
    .from("lists")
    .select("*, list_items(*)")
    .eq("family_id", familyId)
    .order("updated_at", { ascending: false });
  if (error) return [];
  // Item ordering
  // -------------
  // `sort_order` is the single source of truth — assigned at insert time
  // (append at the end) and rewritten by `useReorderListItems` when the
  // user drags rows around.
  //
  // Smart sort is a *view-time projection* layered on top: when the list
  // has `smart_sort_enabled = true`, we re-arrange the items into aisle
  // order client-side, without ever touching the persisted sort_order.
  // Toggling smart sort off therefore reveals the user's underlying
  // manual order again — non-destructive.
  return ((data as ListWithItems[]) ?? []).map((list) => {
    const byManualOrder = [...(list.list_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const list_items = list.smart_sort_enabled ? applyCategorySort(byManualOrder) : byManualOrder;
    return { ...list, list_items };
  });
}

export function useListsWithItems() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["lists", familyId],
    queryFn: () => fetchListsWithItems(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    const channel = supabase
      .channel(`lists-${familyId}`)
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
  }, [familyId, queryClient]);

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

      // Append to the end — same pattern as the old expenses table.
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

export function useCreateListItem() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateListItemInput): Promise<ListItem> => {
      // Look up the parent list from the cache so we can compute next
      // sort_order (append-at-end) without an extra round-trip. Smart
      // sort is applied client-side at fetch time, so we don't need to
      // touch sort_order again after the insert — the new item appears
      // in its aisle automatically when the cache refreshes.
      const cached = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
      const parent = cached?.find((l) => l.id === payload.list_id);
      const maxOrder =
        parent?.list_items.reduce(
          (max, item) => (item.sort_order > max ? item.sort_order : max),
          0,
        ) ?? 0;

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju stavke");
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
      // in the right aisle on the next render — no sort_order rewrite
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju stavke");
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
      // Fire all updates in parallel — same pattern as `useReorderExpenses`
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
          // render via `fetchListsWithItems`. We don't apply it here —
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
 * Smart sort is purely a view-time projection — `fetchListsWithItems`
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju završenih stavki");
    },
  });
}
