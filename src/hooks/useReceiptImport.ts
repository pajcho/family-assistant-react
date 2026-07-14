import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { readFunctionsError } from "@/utils/functionsError";

/**
 * Calls the `receipt-import` Edge Function, which fetches + parses a Serbian
 * fiscal-receipt page (suf.purs.gov.rs/v/…) and returns the parsed data already
 * transliterated to Latin. No DB work happens here — the caller previews the
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
  /** ISO 8601 with the Belgrade offset — the first 10 chars are the local date. */
  issuedAt: string;
  totalAmount: number;
  items: ParsedReceiptItem[];
  /** Non-fatal notes (Serbian), e.g. "Stavke nisu prepoznate …". */
  warnings: string[];
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
