import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ExpenseCategory } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Expense-category hooks (Faza 3/4) - the family's spend buckets, backed by
 * TanStack Query + Supabase Realtime. Same shape as the other entity hooks.
 *
 * Surface:
 *   - `useExpenseCategories()`      - list query (sorted) + realtime + `byId`
 *   - `useCreateExpenseCategory()`  - insert (appends after the last sort_order)
 *   - `useUpdateExpenseCategory()`  - rename / color / icon / limit / sort
 *   - `useDeleteExpenseCategory()`  - delete (expenses.category_id SET NULL in DB)
 *
 * `familyId` always comes from `useProfile()` so the RLS guard matches.
 */

export type CreateExpenseCategoryInput = {
  name: string;
  color: string;
  icon: string;
  monthly_limit?: number | null;
};

export type UpdateExpenseCategoryInput = Partial<
  Pick<ExpenseCategory, "name" | "color" | "icon" | "sort_order" | "monthly_limit">
>;

async function fetchExpenseCategories(familyId: string): Promise<ExpenseCategory[]> {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("family_id", familyId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data as ExpenseCategory[]) ?? [];
}

export interface UseExpenseCategoriesResult {
  categories: ExpenseCategory[];
  byId: Map<string, ExpenseCategory>;
  isLoading: boolean;
}

export function useExpenseCategories(): UseExpenseCategoriesResult {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["expense_categories", familyId],
    queryFn: () => fetchExpenseCategories(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`expense_categories-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expense_categories",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["expense_categories", familyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const categories = useMemo(() => query.data ?? [], [query.data]);
  const byId = useMemo(() => {
    const m = new Map<string, ExpenseCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  return { categories, byId, isLoading: query.isLoading };
}

export function useCreateExpenseCategory() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateExpenseCategoryInput): Promise<ExpenseCategory> => {
      if (!familyId) throw new Error("Nema porodice");
      // Append after the current max sort_order so a new bucket lands last.
      const { data: last } = await supabase
        .from("expense_categories")
        .select("sort_order")
        .eq("family_id", familyId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSort = ((last?.sort_order as number | undefined) ?? -1) + 1;

      const { data, error } = await supabase
        .from("expense_categories")
        .insert({
          family_id: familyId,
          name: payload.name,
          color: payload.color,
          icon: payload.icon,
          monthly_limit: payload.monthly_limit ?? null,
          sort_order: nextSort,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as ExpenseCategory;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expense_categories", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju kategorije");
    },
  });
}

export function useUpdateExpenseCategory() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      id: string;
      payload: UpdateExpenseCategoryInput;
    }): Promise<ExpenseCategory> => {
      const { data, error } = await supabase
        .from("expense_categories")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as ExpenseCategory;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expense_categories", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni kategorije");
    },
  });
}

export function useDeleteExpenseCategory() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("expense_categories").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expense_categories", familyId] });
      // Detached expenses (category_id → NULL) need to re-render uncategorized.
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju kategorije");
    },
  });
}
