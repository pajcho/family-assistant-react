import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParsedReceipt } from "@/hooks/useReceiptImport";
import type { Expense } from "@/types/database";

/**
 * Regression test for the scanned-receipt flow: dismissing a preview SUB-VIEW
 * (Stavke / Kategorija / Detalji) must pop back to the preview - NOT close the
 * whole scan dialog and throw away the parsed receipt. The responsive dialog
 * is mocked to a plain passthrough with an overlay-dismiss button, so the
 * sheet-stack wiring (the thing under test) runs for real on the mobile path.
 * Each level is its own overlay, so several dismiss controls coexist - see
 * `dismissTopSheet`.
 */

const { fakeReceipt, saveMutate, attachMutate } = vi.hoisted(() => ({
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
  attachMutate: vi.fn<
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
  // Mobile path: picker rows + the stacked sub-view drawers of useSheetStack.
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
  useAttachReceiptToExpense: () => ({ mutate: attachMutate, isPending: false }),
  useMerchantCategory: () => ({ data: null }),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ familyId: "fam-1" }),
}));

vi.mock("@/hooks/useExpenseCategories", () => ({
  useExpenseCategories: () => ({ categories: [] }),
}));

vi.mock("@/components/budget/ExpenseForm", () => ({
  EXPENSE_LINK_KINDS: ["activity", "event"],
  ExpensePersonSelect: () => <div data-testid="person-select" />,
}));

// The real link field/picker reach @/lib/supabase through MemberBadges. The
// stub keeps the wiring under test (a pick lands in the save payload) without
// dragging the roster query in.
vi.mock("@/components/payments/PaymentLinkField", () => ({
  PaymentLinkField: ({
    onChange,
  }: {
    onChange: (value: { kind: string; id: string } | null) => void;
  }) => (
    <button type="button" onClick={() => onChange({ kind: "activity", id: "act-1" })}>
      Poveži sa aktivnošću
    </button>
  ),
}));

vi.mock("@/components/payments/PaymentLinkPickerSheet", () => ({
  PaymentLinkPickerSheet: () => <div data-testid="link-picker" />,
}));

vi.mock("@/components/budget/CategoryGridPicker", () => ({
  CategoryGridPicker: () => <div data-testid="category-picker" />,
}));

vi.mock("../receipt/ReceiptCamera", () => ({
  ReceiptCamera: () => <div data-testid="camera" />,
}));

vi.mock("@/lib/qrScan", () => ({
  decodeQrFromFile: vi.fn<() => Promise<string | null>>(),
}));

import ReceiptScanDialog from "@/components/budget/receipt/ReceiptScanDialog";

function Harness({ attachTo }: { attachTo?: Expense | null } = {}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <output aria-label="owner-open">{String(open)}</output>
      <ReceiptScanDialog open={open} onOpenChange={setOpen} attachTo={attachTo} />
    </>
  );
}

/** Just enough of a manual expense for the attach path. */
const manualExpense = {
  id: "exp-9",
  source: "manual",
  amount: 999,
  spent_on: "2026-07-30",
  category_id: "cat-1",
} as Expense;

/**
 * Dismiss the TOPMOST overlay. Sub-views open as their own overlay on top of
 * the preview now, so more than one dismiss control is on screen at a time -
 * the last one rendered is the one a swipe-down would hit.
 */
function dismissTopSheet() {
  const handles = screen.getAllByRole("button", { name: "Prevuci za zatvaranje" });
  fireEvent.click(handles[handles.length - 1]);
}

async function scanToPreview(props?: { attachTo?: Expense | null }) {
  render(<Harness attachTo={props?.attachTo} />);
  fireEvent.change(screen.getByLabelText("Nalepi link sa računa"), {
    target: { value: "https://suf.purs.gov.rs/v/?vl=test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Učitaj" }));
  // By heading, not by text: in attach mode the title and the save button
  // share the same words.
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: props?.attachTo ? "Poveži račun" : "Pregled računa" }),
    ).toBeInTheDocument(),
  );
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

    // Drag-to-close the sub-view's own drawer: the stack pops back to the
    // preview underneath instead of closing the whole scan flow.
    dismissTopSheet();
    await waitFor(() => expect(screen.getByText("Pregled računa")).toBeInTheDocument());

    expect(screen.getByRole("status", { name: "owner-open" })).toHaveTextContent("true");
    expect(screen.getByText("Maxi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sačuvaj trošak" })).toBeInTheDocument();
  });

  it("closes the whole flow only when dismissed at the preview root", async () => {
    await scanToPreview();

    dismissTopSheet();

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
    dismissTopSheet();
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

  it("carries a link picked in Detalji into the saved expense", async () => {
    await scanToPreview();

    fireEvent.click(screen.getByRole("button", { name: /^Više detalja/ }));
    fireEvent.click(screen.getByRole("button", { name: "Poveži sa aktivnošću" }));
    dismissTopSheet();
    await waitFor(() => expect(screen.getByText("Pregled računa")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj trošak" }));

    const input = saveMutate.mock.calls[0]?.[0] as {
      activity_id: string | null;
      event_id: string | null;
    };
    expect(input.activity_id).toBe("act-1");
    expect(input.event_id).toBeNull();
  });

  describe("attach mode", () => {
    it("attaches the selected lines to the expense and leaves its other fields alone", async () => {
      await scanToPreview({ attachTo: manualExpense });

      // Nothing that already lives on the expense is offered here.
      expect(screen.queryByRole("button", { name: /^Kategorija/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Više detalja/ })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^Stavke/ }));
      fireEvent.click(screen.getAllByRole("checkbox")[1]);
      dismissTopSheet();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Poveži račun" })).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Poveži račun" }));

      expect(saveMutate).not.toHaveBeenCalled();
      const input = attachMutate.mock.calls[0]?.[0] as {
        expenseId: string;
        claim_idxs: number[];
        receipt_url: string;
      };
      expect(input.expenseId).toBe("exp-9");
      expect(input.claim_idxs).toEqual([0]);
      expect(input.receipt_url).toBe("https://suf.purs.gov.rs/v/?vl=test");
      // No chain step: attaching fixes one row and is done.
      await waitFor(() =>
        expect(screen.getByRole("status", { name: "owner-open" })).toHaveTextContent("false"),
      );
    });
  });
});
