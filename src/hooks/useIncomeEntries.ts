import { useEffect, useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { IncomeEntry } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Per-month income RECEIPTS — the frozen counterpart to the recurring `incomes`
 * sources, mirroring how `payment_history` freezes paid payment occurrences.
 * The monthly budget cycle sums these (never the live sources), so editing a
 * source today never rewrites a past month's income.
 *
 * Surface:
 *   - `useIncomeEntries(month)`   — receipts for one "YYYY-MM" + realtime
 *   - `useConfirmIncome()`        — confirm a recurring source for a month
 *                                   (upsert, one row per source per month)
 *   - `useAddOneTimeIncome()`     — record a one-off (bonus etc.)
 *   - `useUpdateIncomeEntry()`    — fix an existing receipt (by id)
 *   - `useDeleteIncomeEntry()`    — remove a receipt (by id)
 */

async function fetchIncomeEntries(familyId: string, month: string): Promise<IncomeEntry[]> {
  const { data, error } = await supabase
    .from("income_entries")
    .select("*")
    .eq("family_id", familyId)
    .eq("month", month)
    .order("received_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data as IncomeEntry[]) ?? [];
}

export interface UseIncomeEntriesResult {
  entries: IncomeEntry[];
  /** Sum of every receipt for the month (recurring confirmations + one-offs). */
  total: number;
  isLoading: boolean;
}

export function useIncomeEntries(month: string): UseIncomeEntriesResult {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();
  const channelKey = useId();

  const query = useQuery({
    queryKey: ["income_entries", familyId, month],
    queryFn: () => fetchIncomeEntries(familyId as string, month),
    enabled: !!familyId,
  });

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`income-entries-${familyId}-${channelKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "income_entries",
          filter: `family_id=eq.${familyId}`,
        },
        // Partial key → refreshes every month's cache at once.
        () => void queryClient.invalidateQueries({ queryKey: ["income_entries", familyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient, channelKey]);

  const entries = useMemo(() => query.data ?? [], [query.data]);
  const total = useMemo(() => entries.reduce((sum, e) => sum + e.amount, 0), [entries]);

  return { entries, total, isLoading: query.isLoading };
}

function invalidateEntries(
  queryClient: ReturnType<typeof useQueryClient>,
  familyId: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: ["income_entries", familyId] });
}

export type ConfirmIncomeInput = {
  income_id: string;
  person_id: string | null;
  /** Snapshot of the source name at confirm time. */
  name: string;
  amount: number;
  month: string;
  received_on: string | null;
};

/**
 * Confirm a recurring source's income for a month. Upsert on `(income_id,
 * month)`, so re-confirming just corrects the amount/date instead of stacking
 * duplicate rows.
 */
export function useConfirmIncome() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ConfirmIncomeInput): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const { error } = await supabase.from("income_entries").upsert(
        {
          family_id: familyId,
          income_id: input.income_id,
          person_id: input.person_id,
          name: input.name,
          amount: input.amount,
          month: input.month,
          received_on: input.received_on,
          is_one_time: false,
        },
        { onConflict: "income_id,month" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateEntries(queryClient, familyId),
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri potvrdi prihoda");
    },
  });
}

export type OneTimeIncomeInput = {
  person_id: string | null;
  name: string;
  amount: number;
  month: string;
  received_on: string | null;
  note?: string | null;
};

/** Record a one-off income (bonus, gift, refund) into a month. */
export function useAddOneTimeIncome() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: OneTimeIncomeInput): Promise<void> => {
      if (!familyId) throw new Error("Nema porodice");
      const { error } = await supabase.from("income_entries").insert({
        family_id: familyId,
        income_id: null,
        person_id: input.person_id,
        name: input.name,
        amount: input.amount,
        month: input.month,
        received_on: input.received_on,
        note: input.note ?? null,
        is_one_time: true,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateEntries(queryClient, familyId),
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju prihoda");
    },
  });
}

export type UpdateIncomeEntryInput = Partial<
  Pick<IncomeEntry, "name" | "amount" | "received_on" | "person_id" | "note">
>;

export function useUpdateIncomeEntry() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdateIncomeEntryInput }): Promise<void> => {
      const { error } = await supabase
        .from("income_entries")
        .update(args.payload)
        .eq("id", args.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateEntries(queryClient, familyId),
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni prihoda");
    },
  });
}

export function useDeleteIncomeEntry() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("income_entries").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateEntries(queryClient, familyId),
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju prihoda");
    },
  });
}
