import { useEffect, useId, useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Expense, ExpenseItem } from "@/types/database";
import type { ParsedReceiptItem } from "@/hooks/useReceiptImport";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Expenses ledger hooks (Faza 3/4) - backed by TanStack Query + Supabase
 * Realtime. The list query is scoped to a date range so the Budget page fetches
 * one month (or a wider window for the trend chart) at a time.
 *
 * Surface:
 *   - `useExpenses({ from, to })`   - range query + realtime invalidation
 *   - `useCreateExpense()`          - insert a manual expense
 *   - `useUpdateExpense()`          - edit a manual expense
 *   - `useDeleteExpense()`          - delete a manual expense
 *
 * Auto rows (`source='payment'`) are written/removed by a DB trigger, never by
 * these mutations - the UI keeps them read-only. Realtime is what surfaces a
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
  /** Always RSD (already converted for foreign-currency entries). */
  amount: number;
  spent_on: string;
  category_id?: string | null;
  person_id?: string | null;
  note?: string | null;
  currency?: string;
  /** Typed amount + frozen NBS rate for foreign entries; omit/null for RSD. */
  original_amount?: number | null;
  exchange_rate?: number | null;
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
    | "original_amount"
    | "exchange_rate"
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
          original_amount: payload.original_amount ?? null,
          exchange_rate: payload.exchange_rate ?? null,
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

// ───────────────────────────────────────────────────────────────────────────
// Receipt import (Faza 5) - save a scanned receipt as a source='receipt' expense
// (+ its line items), lazy item loading for detail, and merchant→category memory.
// ───────────────────────────────────────────────────────────────────────────

/** Thrown when the receipt_url unique index rejects a re-scan of the same receipt. */
export class DuplicateReceiptError extends Error {
  receiptUrl: string;
  constructor(receiptUrl: string) {
    super("Ovaj račun je već dodat");
    this.name = "DuplicateReceiptError";
    this.receiptUrl = receiptUrl;
  }
}

export type SaveReceiptExpenseInput = {
  amount: number;
  spent_on: string;
  merchant: string | null;
  receipt_url: string;
  category_id: string | null;
  person_id: string | null;
  note: string | null;
  items: ParsedReceiptItem[];
};

export type SaveReceiptExpenseResult = {
  expense: Expense;
  /** false when the expense saved but its line items didn't (kept, not orphaned). */
  itemsSaved: boolean;
};

/**
 * Saves a scanned receipt through the normal expenses insert path (source=
 * 'receipt'), then inserts its line items. A unique violation on `receipt_url`
 * throws DuplicateReceiptError so the UI can offer to jump to the existing one.
 * Item insertion is best-effort: if it fails, the expense is KEPT and we flag
 * `itemsSaved=false` (a warning toast) rather than orphan-failing the import.
 */
export function useSaveReceiptExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveReceiptExpenseInput): Promise<SaveReceiptExpenseResult> => {
      if (!familyId) throw new Error("Nema porodice");

      const { data, error } = await supabase
        .from("expenses")
        .insert({
          family_id: familyId,
          amount: input.amount,
          spent_on: input.spent_on,
          category_id: input.category_id ?? null,
          person_id: input.person_id ?? null,
          note: input.note ?? null,
          currency: "RSD",
          source: "receipt",
          merchant: input.merchant ?? null,
          receipt_url: input.receipt_url,
        })
        .select()
        .single();

      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new DuplicateReceiptError(input.receipt_url);
        }
        throw new Error(error.message);
      }

      const expense = data as Expense;

      let itemsSaved = true;
      if (input.items.length > 0) {
        const rows = input.items.map((it, idx) => ({
          expense_id: expense.id,
          family_id: familyId,
          name: it.name,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          total: it.total,
          sort_order: idx,
        }));
        const { error: itemsError } = await supabase.from("expense_items").insert(rows);
        if (itemsError) itemsSaved = false;
      }

      return { expense, itemsSaved };
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
      // The saved category becomes this merchant's remembered default, so the
      // cached lookup (staleTime 60s) must not serve the pre-save answer.
      void queryClient.invalidateQueries({ queryKey: ["merchant-category", familyId] });
      if (!res.itemsSaved) {
        toast.warning("Trošak je sačuvan, ali stavke nisu.");
      }
    },
    // Errors (incl. DuplicateReceiptError) are handled inline by the scan dialog.
  });
}

/** Escape `ilike` wildcards so a literal % / _ in the term stays literal. */
function escapeIlikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

export interface ExpenseSearchHit {
  expense: Expense;
  /** Receipt line items whose name matched the term (empty for field matches). */
  matchedItems: string[];
}

/**
 * Family-wide expense search across ALL months: `note` + `merchant` on the
 * expense itself, plus receipt line items by name - so "mleko" finds the
 * receipt it was bought on. Item matches pull in their parent expense even
 * when the expense's own fields don't match.
 */
async function searchExpenses(familyId: string, term: string): Promise<ExpenseSearchHit[]> {
  const pattern = `%${escapeIlikeTerm(term)}%`;
  const [byNote, byMerchant, itemRows] = await Promise.all([
    supabase
      .from("expenses")
      .select("*")
      .eq("family_id", familyId)
      .ilike("note", pattern)
      .order("spent_on", { ascending: false })
      .limit(30),
    supabase
      .from("expenses")
      .select("*")
      .eq("family_id", familyId)
      .ilike("merchant", pattern)
      .order("spent_on", { ascending: false })
      .limit(30),
    supabase
      .from("expense_items")
      .select("expense_id,name")
      .eq("family_id", familyId)
      .ilike("name", pattern)
      .limit(200),
  ]);

  const matchedItemsByExpense = new Map<string, string[]>();
  for (const row of (itemRows.data ?? []) as { expense_id: string; name: string }[]) {
    const arr = matchedItemsByExpense.get(row.expense_id) ?? [];
    arr.push(row.name);
    matchedItemsByExpense.set(row.expense_id, arr);
  }

  const byId = new Map<string, Expense>();
  for (const e of [...(byNote.data ?? []), ...(byMerchant.data ?? [])] as Expense[]) {
    byId.set(e.id, e);
  }
  const missingParentIds = [...matchedItemsByExpense.keys()].filter((id) => !byId.has(id));
  if (missingParentIds.length > 0) {
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .in("id", missingParentIds.slice(0, 50));
    for (const e of (data ?? []) as Expense[]) byId.set(e.id, e);
  }

  return [...byId.values()]
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on))
    .map((expense) => ({ expense, matchedItems: matchedItemsByExpense.get(expense.id) ?? [] }));
}

/** Minimum characters before the expense search fires. */
export const MIN_EXPENSE_SEARCH_CHARS = 2;

export function useExpenseSearch(term: string) {
  const { familyId } = useProfile();
  const trimmed = term.trim();
  const enabled = !!familyId && trimmed.length >= MIN_EXPENSE_SEARCH_CHARS;

  const query = useQuery({
    queryKey: ["expense-search", familyId, trimmed.toLowerCase()],
    queryFn: () => searchExpenses(familyId as string, trimmed),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const hits = useMemo(() => (enabled ? (query.data ?? []) : []), [enabled, query.data]);
  return { hits, isSearching: enabled && query.isFetching, enabled };
}

async function fetchExpenseItems(expenseId: string): Promise<ExpenseItem[]> {
  const { data, error } = await supabase
    .from("expense_items")
    .select("*")
    .eq("expense_id", expenseId)
    .order("sort_order", { ascending: true });
  if (error) return [];
  return (data as ExpenseItem[]) ?? [];
}

/**
 * Lazily loads a receipt expense's line items - enabled only when a detail view
 * for `expenseId` is open. Items are immutable and not realtime-published, so a
 * generous staleTime is fine.
 */
export function useExpenseItems(expenseId: string | null) {
  const query = useQuery({
    queryKey: ["expense_items", expenseId],
    queryFn: () => fetchExpenseItems(expenseId as string),
    enabled: !!expenseId,
    staleTime: 5 * 60_000,
  });
  const items = useMemo(() => query.data ?? [], [query.data]);
  return { ...query, items };
}

async function fetchReceiptItemCounts(expenseIds: string[]): Promise<Record<string, number>> {
  if (expenseIds.length === 0) return {};
  const { data, error } = await supabase
    .from("expense_items")
    .select("expense_id")
    .in("expense_id", expenseIds);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as { expense_id: string }[]) {
    counts[row.expense_id] = (counts[row.expense_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Item counts for a set of receipt expenses (for the "N stavki" list subtitle).
 * One bounded query over the month's receipt rows - items themselves load lazily
 * only when a detail opens.
 */
export function useReceiptItemCounts(expenseIds: string[]) {
  const key = [...expenseIds].sort().join(",");
  return useQuery({
    queryKey: ["expense-item-counts", key],
    queryFn: () => fetchReceiptItemCounts(expenseIds),
    enabled: expenseIds.length > 0,
    staleTime: 60_000,
  });
}

async function fetchMerchantCategory(familyId: string, merchant: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("expenses")
    .select("category_id")
    .eq("family_id", familyId)
    .eq("merchant", merchant)
    .not("category_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return (data[0] as { category_id: string | null }).category_id ?? null;
}

/**
 * Merchant→category memory: the category of the most recent earlier expense
 * from the same `merchant` (null when none). Powers the preview's preselection.
 */
export function useMerchantCategory(merchant: string | null) {
  const { familyId } = useProfile();
  return useQuery({
    queryKey: ["merchant-category", familyId, merchant],
    queryFn: () => fetchMerchantCategory(familyId as string, merchant as string),
    enabled: !!familyId && !!merchant,
    staleTime: 60_000,
  });
}

/** Looks up an existing expense by its receipt_url (for the duplicate "jump" UX). */
export async function fetchExpenseByReceiptUrl(
  familyId: string,
  receiptUrl: string,
): Promise<Expense | null> {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("family_id", familyId)
    .eq("receipt_url", receiptUrl)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as Expense) ?? null;
}
