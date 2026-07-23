import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { readFunctionsError } from "@/utils/functionsError";
import { useProfile } from "@/hooks/useProfile";
import type { Expense } from "@/types/database";

/**
 * Calls the `receipt-import` Edge Function, which fetches + parses a Serbian
 * fiscal-receipt page (suf.purs.gov.rs/v/…) and returns the parsed data already
 * transliterated to Latin. No DB work happens here - the caller previews the
 * result and saves it through the normal expenses insert path
 * (`useSaveReceiptExpense`) so RLS stays uniform.
 */

/** One parsed receipt line (client mirror of the function's ReceiptItem). */
export interface ParsedReceiptItem {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  total: number;
}

/** The `receipt-import` function's success payload. */
export interface ParsedReceipt {
  merchant: string | null;
  companyName: string | null;
  storeName: string | null;
  pib: string | null;
  /** ISO 8601 with the Belgrade offset - the first 10 chars are the local date. */
  issuedAt: string;
  totalAmount: number;
  items: ParsedReceiptItem[];
  /** Non-fatal notes (Serbian), e.g. "Stavke nisu prepoznate …". */
  warnings: string[];
  /** True when the issuer hasn't synced the receipt journal to PURS yet, so
   *  items are unavailable (optional: older function versions omit it). */
  journalPending?: boolean;
  /** Canonical suf.purs.gov.rs URL, echoed back for the dedup key. */
  receiptUrl: string;
}

interface ImportResponse {
  receipt?: ParsedReceipt;
  error?: string;
  code?: string;
}

/** True for any suf.purs.gov.rs verification link (used to validate pasted input). */
export function isSufReceiptUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return (
      u.protocol === "https:" && u.hostname === "suf.purs.gov.rs" && u.pathname.startsWith("/v/")
    );
  } catch {
    return false;
  }
}

export function useReceiptImport() {
  return useMutation({
    mutationFn: async (url: string): Promise<ParsedReceipt> => {
      const { data, error } = await supabase.functions.invoke<ImportResponse>("receipt-import", {
        body: { url },
      });
      const message = error
        ? ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (message) throw new Error(message);
      if (!data?.receipt) throw new Error("Nismo mogli da pročitamo račun.");
      return data.receipt;
    },
  });
}

/**
 * Per-receipt "Osveži stavke" cooldown, mirroring the SERVER-side value in the
 * Edge Function (REFRESH_COOLDOWN_SECONDS). The client copy only drives the
 * disabled-button countdown; the function enforces the real limit (429).
 */
export const RECEIPT_REFRESH_COOLDOWN_SECONDS = 180;

export type ReceiptRefreshResult = { status: "added"; count: number } | { status: "pending" };

/**
 * Re-fetches an already-imported receipt (journal was pending at import time)
 * and backfills its `expense_items` once the issuer syncs with PURS. The Edge
 * Function claims the per-receipt cooldown + global rate window server-side;
 * the items insert stays client-side under RLS, like the original import.
 */
export function useReceiptRefresh() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (expense: Expense): Promise<ReceiptRefreshResult> => {
      if (!familyId) throw new Error("Nema porodice");
      if (!expense.receipt_url) throw new Error("Trošak nema link računa.");

      const { data, error } = await supabase.functions.invoke<ImportResponse>("receipt-import", {
        body: { url: expense.receipt_url, refresh: true },
      });
      const message = error
        ? ((await readFunctionsError(error)) ?? error.message)
        : (data?.error ?? null);
      if (message) throw new Error(message);
      const receipt = data?.receipt;
      if (!receipt) throw new Error("Nismo mogli da pročitamo račun.");
      if (receipt.journalPending || receipt.items.length === 0) return { status: "pending" };

      // Another device may have backfilled while we fetched - never double-insert.
      const { data: existing } = await supabase
        .from("expense_items")
        .select("id")
        .eq("expense_id", expense.id)
        .limit(1);
      if (!existing || existing.length === 0) {
        const rows = receipt.items.map((it, idx) => ({
          expense_id: expense.id,
          family_id: familyId,
          name: it.name,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          total: it.total,
          sort_order: idx,
        }));
        const { error: itemsError } = await supabase.from("expense_items").insert(rows);
        if (itemsError) throw new Error("Stavke su pročitane, ali nismo uspeli da ih sačuvamo.");
      }
      return { status: "added", count: receipt.items.length };
    },
    onSettled: (_res, _err, expense) => {
      void queryClient.invalidateQueries({ queryKey: ["expense_items", expense.id] });
      // The claimed receipt_checked_at lives on the expense row - refetch it so
      // a reopened detail renders the correct countdown.
      void queryClient.invalidateQueries({ queryKey: ["expenses", familyId] });
    },
  });
}
