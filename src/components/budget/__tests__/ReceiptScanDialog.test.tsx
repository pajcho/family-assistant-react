import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParsedReceipt } from "@/hooks/useReceiptImport";

/**
 * Regression test for the scanned-receipt flow: dismissing a preview SUB-VIEW
 * (Stavke / Kategorija / Detalji) must pop back to the preview - NOT close the
 * whole scan dialog and throw away the parsed receipt. The responsive dialog
 * is mocked to a plain passthrough with an overlay-dismiss button, so the
 * sheet-stack wiring (the thing under test) runs for real on the mobile path.
 */

const { fakeReceipt, saveMutate } = vi.hoisted(() => ({
  fakeReceipt: {
    merchant: "Maxi",
    companyName: null,
    storeName: null,
    pib: null,
    issuedAt: "2026-08-01T12:00:00+02:00",
    totalAmount: 1234,
    // Two lines summing EXACTLY to totalAmount - per-line selection is on.
    items: [
      { name: "Mleko 1l", quantity: 1, unitPrice: 234, total: 234 },
      { name: "Hleb", quantity: 1, unitPrice: 1000, total: 1000 },
    ],
    warnings: [],
    receiptUrl: "https://suf.purs.gov.rs/v/?vl=test",
  } as ParsedReceipt,
  saveMutate: vi.fn<
    (input: unknown, callbacks?: { onSuccess?: (res: { expenseId: string }) => void }) => void
  >((_input, callbacks) => {
    callbacks?.onSuccess?.({ expenseId: "exp-1" });
  }),
}));

vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        <button
          type="button"
          aria-label="Prevuci za zatvaranje"
          onClick={() => onOpenChange(false)}
        >
          ×
        </button>
        {children}
      </div>
    ) : null,
  ResponsiveDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  ResponsiveDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  ResponsiveDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // Mobile path: picker rows + the drawer close→reopen hop in useSheetStack.
  useIsDesktop: () => false,
}));

// Fully self-contained (no importOriginal): the real module imports
// @/lib/supabase, which throws at import time without VITE_SUPABASE_* env -
// present locally via .env, absent in CI.
vi.mock("@/hooks/useReceiptImport", () => ({
  isSufReceiptUrl: (raw: string) => raw.trim().startsWith("https://suf.purs.gov.rs/v/"),
  useReceiptImport: () => ({
    mutate: (
      _url: string,
      { onSuccess }: { onSuccess: (data: ParsedReceipt) => void | Promise<void> },
    ) => {
      void onSuccess(fakeReceipt);
    },
    isPending: false,
  }),
}));

vi.mock("@/hooks/useExpenses", () => ({
  DuplicateReceiptError: class extends Error {},
  ClaimConflictError: class extends Error {},
  fetchExpenseByReceiptUrl: vi.fn<() => Promise<null>>(() => Promise.resolve(null)),
  // Fast path finds nothing stored - the flow proceeds to the (mocked) import.
  fetchReceiptByUrl: vi.fn<() => Promise<null>>(() => Promise.resolve(null)),
  useSaveReceiptExpense: () => ({ mutate: saveMutate, isPending: false }),
  useMerchantCategory: () => ({ data: null }),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ familyId: "fam-1" }),
}));

vi.mock("@/hooks/useExpenseCategories", () => ({
  useExpenseCategories: () => ({ categories: [] }),
}));

vi.mock("@/components/budget/ExpenseForm", () => ({
  ExpensePersonSelect: () => <div data-testid="person-select" />,
}));

vi.mock("@/components/budget/CategoryGridPicker", () => ({
  CategoryGridPicker: () => <div data-testid="category-picker" />,
}));

vi.mock("../receipt/ReceiptCamera", () => ({
  ReceiptCamera: () => <div data-testid="camera" />,
}));

vi.mock("../receipt/receiptQr", () => ({
  decodeQrFromFile: vi.fn<() => Promise<string | null>>(),
}));

import ReceiptScanDialog from "@/components/budget/receipt/ReceiptScanDialog";

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <output aria-label="owner-open">{String(open)}</output>
      <ReceiptScanDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

async function scanToPreview() {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Nalepi link sa računa"), {
    target: { value: "https://suf.purs.gov.rs/v/?vl=test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Učitaj" }));
  await waitFor(() => expect(screen.getByText("Pregled računa")).toBeInTheDocument());
}

describe("ReceiptScanDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns to the preview when a sub-view is dismissed (receipt survives)", async () => {
    await scanToPreview();

    // Open the "Stavke" sub-view from the mobile picker row.
    fireEvent.click(screen.getByRole("button", { name: /^Stavke/ }));
    expect(screen.getByText("Mleko 1l")).toBeInTheDocument();

    // Drag-to-close the drawer: the stack pops back to the preview after the
    // mobile close→reopen hop instead of closing the whole scan flow.
    fireEvent.click(screen.getByRole("button", { name: "Prevuci za zatvaranje" }));
    await waitFor(() => expect(screen.getByText("Pregled računa")).toBeInTheDocument());

    expect(screen.getByRole("status", { name: "owner-open" })).toHaveTextContent("true");
    expect(screen.getByText("Maxi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sačuvaj trošak" })).toBeInTheDocument();
  });

  it("closes the whole flow only when dismissed at the preview root", async () => {
    await scanToPreview();

    fireEvent.click(screen.getByRole("button", { name: "Prevuci za zatvaranje" }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "owner-open" })).toHaveTextContent("false"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saving a subset claims only the checked lines and offers the remainder (chain)", async () => {
    await scanToPreview();

    // Uncheck "Hleb" in the Stavke sub-view, then pop back to the preview.
    fireEvent.click(screen.getByRole("button", { name: /^Stavke/ }));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "Prevuci za zatvaranje" }));
    await waitFor(() => expect(screen.getByText("Pregled računa")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj trošak" }));

    // The save carried the subset claim + its sum as the amount.
    const input = saveMutate.mock.calls[0]?.[0] as { amount: number; claim_idxs: number[] };
    expect(input.claim_idxs).toEqual([0]);
    expect(input.amount).toBe(234);

    // The chain step offers the leftover line as a new expense; continuing
    // returns to the preview with the remainder preselected.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Dodaj ostatak kao novi trošak" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dodaj ostatak kao novi trošak" }));
    await waitFor(() => expect(screen.getByText("Preostale stavke")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj trošak" }));
    const second = saveMutate.mock.calls[1]?.[0] as { amount: number; claim_idxs: number[] };
    expect(second.claim_idxs).toEqual([1]);
    expect(second.amount).toBe(1000);
  });
});
