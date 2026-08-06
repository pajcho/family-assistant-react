import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Expense, Receipt, ReceiptItem } from "@/types/database";
import type { ParsedReceiptItem } from "@/hooks/useReceiptImport";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";

/**
 * Expenses ledger hooks (Faza 3/4) - backed by TanStack Query. The list query
 * is scoped to a date range so the Budget page fetches one month (or a wider
 * window for the trend chart) at a time.
 *
 * Surface:
 *   - `useExpenses({ from, to })`   - range query
 *   - `useCreateExpense()`          - insert a manual expense
 *   - `useUpdateExpense()`          - edit a manual expense
 *   - `useDeleteExpense()`          - delete a manual expense
 *
 * Auto rows (`source='payment'`) are written/removed by a DB trigger, never by
 * these mutations - the UI keeps them read-only for as long as their payment
 * exists. Once it is deleted the link is nulled (`ON DELETE SET NULL`, so the
 * spend outlives the payment) and nothing writes the row any more, which is
 * when the UI hands it back to these mutations - see `isDetachedPaymentExpense`.
 * Neither `source` nor `payment_id` is part of the update payload, so an edit
 * never launders a live auto row into a manual one.
 *
 * Realtime is what surfaces a trigger-inserted row on the Budget page the
 * moment a payment is marked paid, and it arrives on the shared family
 * broadcast channel (`useFamilyChannel`) rather than from a subscription in
 * this file.
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
  const query = useQuery({
    queryKey: ["expenses", familyId, range.from, range.to],
    queryFn: () => fetchExpenses(familyId as string, range),
    enabled: !!familyId,
  });

  const expenses = useMemo(() => query.data ?? [], [query.data]);
  return { ...query, expenses };
}

export type LinkedExpenseRef = {
  activityId?: string | null;
  eventId?: string | null;
};

async function fetchLinkedExpenses(familyId: string, ref: LinkedExpenseRef): Promise<Expense[]> {
  let query = supabase
    .from("expenses")
    .select("*")
    .eq("family_id", familyId)
    // Auto rows mirror a payment that the "Plaćanja" box already lists -
    // showing them again would double every paid occurrence.
    .neq("source", "payment")
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  query = ref.activityId
    ? query.eq("activity_id", ref.activityId)
    : query.eq("event_id", ref.eventId as string);
  const { data, error } = await query;
  if (error) return [];
  return (data as Expense[]) ?? [];
}

/**
 * Manual + receipt expenses linked to one activity or event - the "Troškovi"
 * box in the detail dialogs. Cross-month by design (the range query above is
 * month-windowed). Keyed under ["expenses", familyId] so every expense
 * mutation's invalidation refreshes this list too.
 */
export function useLinkedExpenses(ref: LinkedExpenseRef) {
  const { familyId } = useProfile();
  const query = useQuery({
    queryKey: [
      "expenses",
      familyId,
      "linked",
      ref.activityId ? "activity" : "event",
      ref.activityId ?? ref.eventId ?? "",
    ],
    queryFn: () => fetchLinkedExpenses(familyId as string, ref),
    enabled: !!familyId && !!(ref.activityId || ref.eventId),
  });
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
// Receipt import (Faza 5, receipts model) - save a scanned receipt through the
// `save_receipt_expense` RPC (receipt row + expense + claimed lines, one
// transaction), lazy line loading for detail, and merchant→category memory.
// ───────────────────────────────────────────────────────────────────────────

/** Thrown when the receipt (globally-unique receipt_url) is already added. */
export class DuplicateReceiptError extends Error {
  receiptUrl: string;
  constructor(receiptUrl: string) {
    super("Ovaj račun je već dodat");
    this.name = "DuplicateReceiptError";
    this.receiptUrl = receiptUrl;
  }
}

/**
 * Thrown when a claim RPC loses a race (SQLSTATE PT409): the lines this save
 * or split targeted were claimed by someone else meanwhile. The transaction
 * rolled back - the UI should re-fetch the claims and let the user retry.
 */
export class ClaimConflictError extends Error {
  constructor(message?: string) {
    super(message || "Neko je u međuvremenu izmenio ovaj račun.");
    this.name = "ClaimConflictError";
  }
}

/** A receipt row + its lines (idx-sorted) + every expense claimed from it. */
export type ReceiptWithClaims = {
  receipt: Receipt;
  lines: ReceiptItem[];
  expenses: Expense[];
};

type ReceiptEmbedRow = Receipt & { receipt_items: ReceiptItem[]; expenses: Expense[] };

function shapeReceiptEmbed(row: ReceiptEmbedRow): ReceiptWithClaims {
  const { receipt_items: lines, expenses, ...receipt } = row;
  return {
    receipt: receipt as Receipt,
    lines: [...(lines ?? [])].sort((a, b) => a.idx - b.idx),
    expenses: [...(expenses ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

/**
 * The scan fast path: a receipt we already stored needs NO Edge call (no PURS
 * fetch, no rate-limit spend) - the preview renders straight from the DB,
 * with already-claimed lines disabled. Null when this family never stored it.
 */
export async function fetchReceiptByUrl(receiptUrl: string): Promise<ReceiptWithClaims | null> {
  const { data, error } = await supabase
    .from("receipts")
    .select("*, receipt_items(*), expenses(*)")
    .eq("receipt_url", receiptUrl)
    .maybeSingle();
  if (error || !data) return null;
  return shapeReceiptEmbed(data as ReceiptEmbedRow);
}

async function fetchReceiptById(receiptId: string): Promise<ReceiptWithClaims | null> {
  const { data, error } = await supabase
    .from("receipts")
    .select("*, receipt_items(*), expenses(*)")
    .eq("id", receiptId)
    .maybeSingle();
  if (error || !data) return null;
  return shapeReceiptEmbed(data as ReceiptEmbedRow);
}

/**
 * Receipt context for an expense detail: the receipt's own facts, ALL its
 * lines and its sibling expenses - powers "Deo računa · 3 od 12 stavki",
 * the sibling jump and the split affordance. Enabled only while a detail
 * for a linked expense is open.
 */
export function useReceiptContext(receiptId: string | null) {
  const query = useQuery({
    queryKey: ["receipt-context", receiptId],
    queryFn: () => fetchReceiptById(receiptId as string),
    enabled: !!receiptId,
    staleTime: 30_000,
  });
  return { ...query, context: query.data ?? null };
}

export type SaveReceiptExpenseInput = {
  /** The expense's amount - equals `total_amount` until splitting lands. */
  amount: number;
  spent_on: string;
  merchant: string | null;
  receipt_url: string;
  /** The receipt's own total (kept on the receipts row). */
  total_amount: number;
  pib?: string | null;
  company_name?: string | null;
  store_name?: string | null;
  category_id: string | null;
  person_id: string | null;
  note: string | null;
  /** Optional activity/event link (scan started from that context) - XOR. */
  activity_id?: string | null;
  event_id?: string | null;
  items: ParsedReceiptItem[];
  /**
   * Line idx values THIS expense claims. Omit/null = claim every free line
   * (whole-receipt save). The RPC rejects a lost claim race with PT409,
   * surfaced as {@link ClaimConflictError}.
   */
  claim_idxs?: number[] | null;
};

export type SaveReceiptExpenseResult = {
  expenseId: string;
};

/**
 * Saves a scanned receipt atomically via the `save_receipt_expense` RPC:
 * receipts row (insert, or re-use of an orphan whose expense was deleted),
 * the source='receipt' expense, and its claimed receipt_items - all or
 * nothing, so a partial "expense without lines" save can no longer happen.
 * Throws DuplicateReceiptError on the RPC's 'duplicate' status (receipt
 * already claimed, concurrent save, or another family's receipt) so the UI
 * can offer to jump to the existing one.
 */
export function useSaveReceiptExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveReceiptExpenseInput): Promise<SaveReceiptExpenseResult> => {
      if (!familyId) throw new Error("Nema porodice");

      const { data, error } = await supabase.rpc("save_receipt_expense", {
        p_receipt: {
          receipt_url: input.receipt_url,
          merchant: input.merchant ?? null,
          pib: input.pib ?? null,
          company_name: input.company_name ?? null,
          store_name: input.store_name ?? null,
          total_amount: input.total_amount,
          issued_on: input.spent_on,
        },
        p_expense: {
          amount: input.amount,
          spent_on: input.spent_on,
          category_id: input.category_id ?? null,
          person_id: input.person_id ?? null,
          note: input.note ?? null,
          activity_id: input.activity_id ?? null,
          event_id: input.event_id ?? null,
        },
        p_items: input.items.map((it, idx) => ({
          idx,
          name: it.name,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          total: it.total,
        })),
        p_claim_idxs: input.claim_idxs ?? null,
      });

      if (error) {
        // A raced concurrent insert can still surface as a raw unique
        // violation instead of the RPC's own 'duplicate' arm.
        if ((error as { code?: string }).code === "23505") {
          throw new DuplicateReceiptError(input.receipt_url);
        }
        if ((error as { code?: string }).code === "PT409") {
          throw new ClaimConflictError(error.message);
        }
        throw new Error(error.message);
      }

      const result = data as { status?: string; expense_id?: string } | null;
      if (result?.status === "duplicate") {
        throw new DuplicateReceiptError(input.receipt_url);
      }
      if (result?.status !== "saved" || !result.expense_id) {
        throw new Error("Greška pri čuvanju računa.");
      }

      return { expenseId: result.expense_id };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
      // The saved category becomes this merchant's remembered default, so the
      // cached lookup (staleTime 60s) must not serve the pre-save answer.
      void queryClient.invalidateQueries({ queryKey: ["merchant-category", familyId] });
      // Claims changed: any open receipt context / partial preview is stale.
      void queryClient.invalidateQueries({ queryKey: ["receipt-context"] });
      void queryClient.invalidateQueries({ queryKey: ["expense-item-counts"] });
    },
    // Errors (incl. DuplicateReceiptError) are handled inline by the scan dialog.
  });
}

export type SplitReceiptExpenseInput = {
  /** The receipt expense to carve lines out of. */
  expenseId: string;
  /** Line idx values that MOVE to the new expense. */
  claimIdxs: number[];
  category_id: string | null;
  person_id: string | null;
  note: string | null;
};

/**
 * Splits an already-saved receipt expense via the `split_receipt_expense`
 * RPC: the selected lines move onto a NEW expense (its amount = their sum),
 * the original's amount shrinks by the same sum - one transaction, ledger
 * total unchanged. PT409 (a parallel edit won) surfaces as
 * {@link ClaimConflictError}.
 */
export function useSplitReceiptExpense() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SplitReceiptExpenseInput): Promise<SaveReceiptExpenseResult> => {
      const { data, error } = await supabase.rpc("split_receipt_expense", {
        p_expense_id: input.expenseId,
        p_claim_idxs: input.claimIdxs,
        p_new_expense: {
          category_id: input.category_id ?? null,
          person_id: input.person_id ?? null,
          note: input.note ?? null,
        },
      });
      if (error) {
        if ((error as { code?: string }).code === "PT409") {
          throw new ClaimConflictError(error.message);
        }
        throw new Error(error.message);
      }
      const result = data as { status?: string; expense_id?: string } | null;
      if (result?.status !== "saved" || !result.expense_id) {
        throw new Error("Greška pri deljenju računa.");
      }
      return { expenseId: result.expense_id };
    },
    onSuccess: (res, input) => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
      // Both sides' line sets changed, and so did the shared receipt context.
      void queryClient.invalidateQueries({ queryKey: ["receipt_items", input.expenseId] });
      void queryClient.invalidateQueries({ queryKey: ["receipt_items", res.expenseId] });
      void queryClient.invalidateQueries({ queryKey: ["receipt-context"] });
      void queryClient.invalidateQueries({ queryKey: ["expense-item-counts"] });
    },
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
      .from("receipt_items")
      .select("expense_id,name")
      .eq("family_id", familyId)
      .not("expense_id", "is", null)
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

async function fetchExpenseItems(expenseId: string): Promise<ReceiptItem[]> {
  const { data, error } = await supabase
    .from("receipt_items")
    .select("*")
    .eq("expense_id", expenseId)
    .order("idx", { ascending: true });
  if (error) return [];
  return (data as ReceiptItem[]) ?? [];
}

/**
 * Lazily loads the receipt lines CLAIMED by one expense - enabled only when a
 * detail view for `expenseId` is open. Lines are snapshots and not
 * realtime-published, so a generous staleTime is fine.
 */
export function useExpenseItems(expenseId: string | null) {
  const query = useQuery({
    queryKey: ["receipt_items", expenseId],
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
    .from("receipt_items")
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
