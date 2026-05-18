import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Expense } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Expenses data hooks — direct port of `composables/useExpenses.ts` from the
 * sibling Nuxt app, backed by TanStack Query + Supabase Realtime.
 *
 * Surface:
 *   - `useExpensesList({ hidePaid? })`  — list query + realtime subscription
 *   - `useCreateExpense()`              — insert mutation (assigns next sort_order)
 *   - `useUpdateExpense()`              — update mutation
 *   - `useDeleteExpense()`              — delete mutation
 *   - `useMarkExpensePaid()`            — flips is_paid + stamps paid_date
 *   - `useReorderExpenses()`            — parallel bulk update of sort_order
 *
 * `familyId` comes from `useProfile()`; never accept it from callers so the
 * Supabase RLS guard always matches the authenticated user.
 */

export interface ExpenseListFilters {
  hidePaid?: boolean;
}

export type CreateExpenseInput = {
  name: string;
  description?: string | null;
  amount: number;
};

export type UpdateExpenseInput = Partial<Pick<Expense, "name" | "description" | "amount">>;

export interface ExpenseReorderItem {
  id: string;
  sort_order: number;
}

async function fetchExpenses(familyId: string, filters: ExpenseListFilters): Promise<Expense[]> {
  let q = supabase
    .from("expenses")
    .select("*")
    .eq("family_id", familyId)
    .order("sort_order", { ascending: true });
  if (filters.hidePaid) q = q.eq("is_paid", false);
  const { data, error } = await q;
  if (error) return [];
  return (data as Expense[]) ?? [];
}

export function useExpensesList(filters: ExpenseListFilters = {}) {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const { hidePaid } = filters;

  const query = useQuery({
    queryKey: ["expenses", familyId, { hidePaid }],
    queryFn: () => fetchExpenses(familyId as string, { hidePaid }),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`expenses-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `family_id=eq.${familyId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["expenses", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient]);

  return query;
}

export function useCreateExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateExpenseInput): Promise<Expense> => {
      if (!familyId) throw new Error("Nema porodice");

      // Get max sort_order to append the new expense at the end.
      // Mirrors the Vue source: SELECT sort_order ORDER DESC LIMIT 1 → max + 1
      // (falls back to 0 + 1 = 1 when there are no rows yet).
      const { data: maxData } = await supabase
        .from("expenses")
        .select("sort_order")
        .eq("family_id", familyId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .single();
      const nextOrder = ((maxData as { sort_order: number } | null)?.sort_order ?? 0) + 1;

      const { data, error } = await supabase
        .from("expenses")
        .insert({
          family_id: familyId,
          ...payload,
          is_paid: false,
          paid_date: null,
          sort_order: nextOrder,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Expense;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju troška");
    },
  });
}

export function useUpdateExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateExpenseInput }): Promise<Expense> => {
      const { data, error } = await supabase
        .from("expenses")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Expense;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni troška");
    },
  });
}

export function useDeleteExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju troška");
    },
  });
}

export function useMarkExpensePaid() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("expenses")
        .update({ is_paid: true, paid_date: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri označavanju troška");
    },
  });
}

export function useReorderExpenses() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: ExpenseReorderItem[]): Promise<void> => {
      // Fire all updates in parallel — mirrors the Vue Promise.all behavior.
      const results = await Promise.all(
        updates.map((item) =>
          supabase.from("expenses").update({ sort_order: item.sort_order }).eq("id", item.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri promeni redosleda");
    },
  });
}
