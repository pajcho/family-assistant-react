import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The receipt save moved from two client inserts (expenses + expense_items)
 * to the transactional `save_receipt_expense` RPC. These tests pin the RPC
 * contract: the exact payload split (p_receipt / p_expense / p_items with the
 * line's `idx`), and that BOTH duplicate signals - the RPC's own 'duplicate'
 * status and a raced raw 23505 - surface as DuplicateReceiptError, which the
 * scan dialog's "Račun je već dodat" arm keys on.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<() => Promise<{ data: unknown; error: { code?: string; message: string } | null }>>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ familyId: "fam-1" }),
}));

import { DuplicateReceiptError, useSaveReceiptExpense } from "@/hooks/useExpenses";
import type { SaveReceiptExpenseInput } from "@/hooks/useExpenses";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const input: SaveReceiptExpenseInput = {
  amount: 1234.5,
  spent_on: "2026-08-01",
  merchant: "Maxi",
  receipt_url: "https://suf.purs.gov.rs/v/?vl=test",
  total_amount: 1234.5,
  pib: "12345678",
  company_name: "DELHAIZE SERBIA",
  store_name: "Maxi 123",
  category_id: "cat-1",
  person_id: null,
  note: null,
  items: [
    { name: "Mleko 1l", quantity: 2, unitPrice: 199.99, total: 399.98 },
    { name: "Hleb", quantity: null, unitPrice: null, total: 89.99 },
  ],
};

describe("useSaveReceiptExpense", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps the input onto the RPC payload and resolves with the expense id", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "saved", expense_id: "exp-1" }, error: null });

    const { result } = renderHook(() => useSaveReceiptExpense(), { wrapper });
    const res = await result.current.mutateAsync(input);

    expect(res).toEqual({ expenseId: "exp-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("save_receipt_expense", {
      p_receipt: {
        receipt_url: "https://suf.purs.gov.rs/v/?vl=test",
        merchant: "Maxi",
        pib: "12345678",
        company_name: "DELHAIZE SERBIA",
        store_name: "Maxi 123",
        total_amount: 1234.5,
        issued_on: "2026-08-01",
      },
      p_expense: {
        amount: 1234.5,
        spent_on: "2026-08-01",
        category_id: "cat-1",
        person_id: null,
        note: null,
        activity_id: null,
        event_id: null,
      },
      p_items: [
        { idx: 0, name: "Mleko 1l", quantity: 2, unit_price: 199.99, total: 399.98 },
        { idx: 1, name: "Hleb", quantity: null, unit_price: null, total: 89.99 },
      ],
    });
  });

  it("throws DuplicateReceiptError on the RPC's 'duplicate' status", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "duplicate" }, error: null });

    const { result } = renderHook(() => useSaveReceiptExpense(), { wrapper });
    await expect(result.current.mutateAsync(input)).rejects.toBeInstanceOf(DuplicateReceiptError);
  });

  it("throws DuplicateReceiptError on a raced raw unique violation (23505)", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const { result } = renderHook(() => useSaveReceiptExpense(), { wrapper });
    await expect(result.current.mutateAsync(input)).rejects.toBeInstanceOf(DuplicateReceiptError);
  });

  it("rejects with a readable error when the RPC reports neither saved nor duplicate", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { result } = renderHook(() => useSaveReceiptExpense(), { wrapper });
    await expect(result.current.mutateAsync(input)).rejects.toThrow("boom");
  });
});
