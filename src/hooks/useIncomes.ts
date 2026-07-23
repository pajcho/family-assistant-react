import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Income } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Household income hooks (Faza 4) - the recurring salaries the monthly-cycle
 * view sums against spend. TanStack Query + Supabase Realtime, same shape as the
 * other entity hooks.
 *
 * Surface:
 *   - `useIncomes()`         - list query (active first) + realtime + total
 *   - `useCreateIncome()`    - insert
 *   - `useUpdateIncome()`    - edit (name / amount / day / person / active)
 *   - `useDeleteIncome()`    - delete
 */

export type CreateIncomeInput = {
  name: string;
  amount: number;
  day_of_month: number;
  person_id?: string | null;
  is_recurring?: boolean;
  active?: boolean;
};

export type UpdateIncomeInput = Partial<
  Pick<Income, "name" | "amount" | "day_of_month" | "person_id" | "is_recurring" | "active">
>;

async function fetchIncomes(familyId: string): Promise<Income[]> {
  const { data, error } = await supabase
    .from("incomes")
    .select("*")
    .eq("family_id", familyId)
    .order("day_of_month", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data as Income[]) ?? [];
}

export interface UseIncomesResult {
  incomes: Income[];
  /** Sum of all ACTIVE incomes' amounts (a quick monthly total). */
  totalActive: number;
  isLoading: boolean;
}

export function useIncomes(): UseIncomesResult {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["incomes", familyId],
    queryFn: () => fetchIncomes(familyId as string),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`incomes-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incomes",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["incomes", familyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const incomes = useMemo(() => query.data ?? [], [query.data]);
  const totalActive = useMemo(
    () => incomes.filter((i) => i.active).reduce((sum, i) => sum + i.amount, 0),
    [incomes],
  );

  return { incomes, totalActive, isLoading: query.isLoading };
}

export function useCreateIncome() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateIncomeInput): Promise<Income> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("incomes")
        .insert({
          family_id: familyId,
          name: payload.name,
          amount: payload.amount,
          day_of_month: payload.day_of_month,
          person_id: payload.person_id ?? null,
          is_recurring: payload.is_recurring ?? true,
          active: payload.active ?? true,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Income;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incomes", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju prihoda");
    },
  });
}

export function useUpdateIncome() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateIncomeInput }): Promise<Income> => {
      const { data, error } = await supabase
        .from("incomes")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Income;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incomes", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni prihoda");
    },
  });
}

export function useDeleteIncome() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("incomes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incomes", familyId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju prihoda");
    },
  });
}
