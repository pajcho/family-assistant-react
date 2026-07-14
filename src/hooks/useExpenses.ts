import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Expense } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Expenses ledger hooks (Faza 3/4) — backed by TanStack Query + Supabase
 * Realtime. The list query is scoped to a date range so the Budget page fetches
 * one month (or a wider window for the trend chart) at a time.
 *
 * Surface:
 *   - `useExpenses({ from, to })`   — range query + realtime invalidation
 *   - `useCreateExpense()`          — insert a manual expense
 *   - `useUpdateExpense()`          — edit a manual expense
 *   - `useDeleteExpense()`          — delete a manual expense
 *
 * Auto rows (`source='payment'`) are written/removed by a DB trigger, never by
 * these mutations — the UI keeps them read-only. Realtime is what surfaces a
 * trigger-inserted row on the Budget page the moment a payment is marked paid.
 *
 * The realtime channel topic carries a per-hook `useId()` so several instances
 * (e.g. the month view + the 6-month trend) can subscribe without colliding.
 */

export interface ExpenseRange {
  /** Inclusive start, YYYY-MM-DD. */
  from: string;
  /** Inclusive end, YYYY-MM-DD. */
  to: string;
}

export type CreateExpenseInput = {
  amount: number;
  spent_on: string;
  category_id?: string | null;
  person_id?: string | null;
  note?: string | null;
  currency?: string;
  activity_id?: string | null;
  event_id?: string | null;
};

export type UpdateExpenseInput = Partial<
  Pick<
    Expense,
    | "amount"
    | "spent_on"
    | "category_id"
    | "person_id"
    | "note"
    | "currency"
    | "activity_id"
    | "event_id"
  >
>;

async function fetchExpenses(familyId: string, range: ExpenseRange): Promise<Expense[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("family_id", familyId)
    .gte("spent_on", range.from)
    .lte("spent_on", range.to)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data as Expense[]) ?? [];
}

export function useExpenses(range: ExpenseRange) {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["expenses", familyId, range.from, range.to],
    queryFn: () => fetchExpenses(familyId as string, range),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`expenses-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          // Partial key: refresh every mounted range (month view + trend).
          void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const expenses = useMemo(() => query.data ?? [], [query.data]);
  return { ...query, expenses };
}

export function useCreateExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateExpenseInput): Promise<Expense> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("expenses")
        .insert({
          family_id: familyId,
          amount: payload.amount,
          spent_on: payload.spent_on,
          category_id: payload.category_id ?? null,
          person_id: payload.person_id ?? null,
          note: payload.note ?? null,
          currency: payload.currency ?? "RSD",
          source: "manual",
          activity_id: payload.activity_id ?? null,
          event_id: payload.event_id ?? null,
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
