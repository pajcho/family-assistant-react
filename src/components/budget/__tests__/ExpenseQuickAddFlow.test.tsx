import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpenseQuickAddFlow } from "@/components/budget/ExpenseQuickAddFlow";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";

const { mutateAsync, successToast } = vi.hoisted(() => ({
  mutateAsync: vi.fn<(payload: ExpenseFormPayload) => Promise<{ id: string }>>(),
  successToast: vi.fn<(message: string) => void>(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: successToast,
  },
}));

vi.mock("@/hooks/useExpenses", () => ({
  useCreateExpense: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

const payload: ExpenseFormPayload = {
  amount: 1250,
  currency: "RSD",
  original_amount: null,
  exchange_rate: null,
  category_id: null,
  spent_on: "2026-07-17",
  person_id: null,
  note: "Pijaca",
  activity_id: null,
  event_id: null,
};

vi.mock("@/components/budget/ExpenseFormDialog", () => ({
  ExpenseFormDialog: ({
    open,
    error,
    onSubmit,
    onScanReceipt,
  }: {
    open: boolean;
    error?: string | null;
    onSubmit: (value: ExpenseFormPayload) => void;
    onScanReceipt?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Dodaj trošak">
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" onClick={() => onSubmit(payload)}>
          Sačuvaj trošak
        </button>
        <button type="button" onClick={onScanReceipt}>
          Skeniraj račun
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/budget/receipt/ReceiptScanDialog", () => ({
  default: () => null,
}));

describe("ExpenseQuickAddFlow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves, confirms success and closes without routing", async () => {
    mutateAsync.mockResolvedValue({ id: "expense-1" });
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<ExpenseQuickAddFlow open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj trošak" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(payload));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(successToast).toHaveBeenCalledWith("Trošak je dodat.");
  });

  it("keeps the form open and shows an inline error when saving fails", async () => {
    mutateAsync.mockRejectedValue(new Error("Upis nije uspeo"));
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<ExpenseQuickAddFlow open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj trošak" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Upis nije uspeo");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(successToast).not.toHaveBeenCalled();
  });
});
