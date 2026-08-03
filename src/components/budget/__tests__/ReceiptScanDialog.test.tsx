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

const fakeReceipt: ParsedReceipt = {
  merchant: "Maxi",
  companyName: null,
  storeName: null,
  pib: null,
  issuedAt: "2026-08-01T12:00:00+02:00",
  totalAmount: 1234,
  items: [{ name: "Mleko 1l", quantity: 1, unitPrice: 1234, total: 1234 }],
  warnings: [],
  receiptUrl: "https://suf.purs.gov.rs/v/?vl=test",
};

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

vi.mock("@/hooks/useReceiptImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReceiptImport")>()),
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
  fetchExpenseByReceiptUrl: vi.fn<() => Promise<null>>(() => Promise.resolve(null)),
  useSaveReceiptExpense: () => ({ mutate: vi.fn<() => void>(), isPending: false }),
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
});
