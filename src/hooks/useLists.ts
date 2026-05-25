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
  // Items inside each list stay in sort_order. Postgres can't order nested
  // rows via this client API, so we do it here.
  return ((data as ListWithItems[]) ?? []).map((list) => ({
    ...list,
    list_items: [...(list.list_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
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

/**
 * Reorder every item in `list` by category order. Used by both the
 * explicit smart-sort action and the auto-resort path on insert/rename.
 * Runs the bulk update in parallel; partial failure throws the first
 * error so callers don't see a half-sorted state silently.
 */
async function applySmartSortToList(list: ListWithItems): Promise<void> {
  const sorted = applyCategorySort(list.list_items);
  const updates = sorted.map((item, idx) => ({ id: item.id, sort_order: idx + 1 }));
  const results = await Promise.all(
    updates.map((u) =>
      supabase.from("list_items").update({ sort_order: u.sort_order }).eq("id", u.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

export function useCreateListItem() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateListItemInput): Promise<ListItem> => {
      // Look up the parent list from the cache so we can:
      //   • compute next sort_order without an extra round-trip
      //   • detect whether the list has smart-sort enabled and resort
      //     after the insert so the new item lands in its aisle
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
      const newItem = data as ListItem;

      // Auto-resort when the list is in smart-sort mode. Doing it inside
      // the same `mutationFn` means the cache only invalidates once at
      // the end, so the user never sees the "stuck at the bottom" flash
      // between the insert and the resort.
      if (parent?.smart_sort_enabled) {
        await applySmartSortToList({
          ...parent,
          list_items: [...parent.list_items, newItem],
        });
      }

      return newItem;
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
      const updated = data as ListItem;

      // If the row was renamed AND its parent list is in smart-sort mode,
      // the item's category may have changed (e.g. "Mleko" → "Hleb" jumps
      // from dairy to bakery). Re-sort so it lands in the new aisle.
      // Toggling completed doesn't trigger this — completed items live in
      // the collapsed section regardless of category.
      if (args.payload.name !== undefined) {
        const cached = queryClient.getQueryData<ListWithItems[]>(["lists", familyId]);
        const parent = cached?.find((l) => l.id === updated.list_id);
        if (parent?.smart_sort_enabled) {
          await applySmartSortToList({
            ...parent,
            list_items: parent.list_items.map((it) => (it.id === updated.id ? updated : it)),
          });
        }
      }

      return updated;
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lists", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri sortiranju");
    },
  });
}

/**
 * Toggle `lists.smart_sort_enabled` for one list. When turning ON, also
 * runs an initial bulk sort so the items are immediately in aisle order;
 * subsequent inserts/renames stay sorted thanks to the auto-resort path
 * inside `useCreateListItem` / `useUpdateListItem`. When turning OFF,
 * items keep their current sort_order — we don't scramble back to insert
 * order because that would be jarring.
 */
export function useToggleSmartSort() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { list: ListWithItems; enabled: boolean }): Promise<void> => {
      const { list, enabled } = args;
      const { error } = await supabase
        .from("lists")
        .update({ smart_sort_enabled: enabled })
        .eq("id", list.id);
      if (error) throw new Error(error.message);

      if (enabled) {
        await applySmartSortToList(list);
      }
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
