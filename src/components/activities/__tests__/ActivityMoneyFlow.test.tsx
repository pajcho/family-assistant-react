import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityMoneyFlow } from "@/components/activities/ActivityMoneyFlow";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import type { PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import type { Activity } from "@/types/database";

const { createPayment, createExpense, successToast } = vi.hoisted(() => ({
  createPayment: vi.fn<(payload: PaymentFormPayload) => Promise<{ id: string }>>(),
  createExpense: vi.fn<(payload: unknown) => Promise<{ id: string }>>(),
  successToast: vi.fn<(message: string) => void>(),
}));

vi.mock("sonner", () => ({
  toast: { success: successToast },
}));

vi.mock("@/hooks/usePayments", () => ({
  useCreatePayment: () => ({ mutateAsync: createPayment, isPending: false }),
}));

vi.mock("@/hooks/useExpenses", () => ({
  useCreateExpense: () => ({ mutateAsync: createExpense, isPending: false }),
}));

const paymentPayload = { name: "Članarina" } as PaymentFormPayload;

vi.mock("@/components/payments/PaymentFormDialog", () => ({
  PaymentFormDialog: ({
    open,
    initialLink,
    error,
    onSubmit,
  }: {
    open: boolean;
    initialLink?: PaymentLinkValue | null;
    error?: string | null;
    onSubmit: (payload: PaymentFormPayload) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Dodaj plaćanje">
        <p data-testid="payment-link">
          {initialLink ? `${initialLink.kind}:${initialLink.id}` : "-"}
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" onClick={() => onSubmit(paymentPayload)}>
          Sačuvaj plaćanje
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/budget/ExpenseFormDialog", () => ({
  ExpenseFormDialog: ({
    open,
    initialLink,
    onScanReceipt,
  }: {
    open: boolean;
    initialLink?: PaymentLinkValue | null;
    onScanReceipt?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Dodaj trošak">
        <p data-testid="expense-link">
          {initialLink ? `${initialLink.kind}:${initialLink.id}` : "-"}
        </p>
        <button type="button" onClick={onScanReceipt}>
          Skeniraj račun
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/budget/receipt/ReceiptScanDialog", () => ({
  default: ({ open, link }: { open: boolean; link?: PaymentLinkValue | null }) =>
    open ? (
      <div role="dialog" aria-label="Skeniraj račun">
        <p data-testid="scan-link">{link ? `${link.kind}:${link.id}` : "-"}</p>
      </div>
    ) : null,
}));

const activity = { id: "act-1", name: "Engleski" } as Activity;

describe("ActivityMoneyFlow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the payment form pre-linked to the activity, saves and closes", async () => {
    createPayment.mockResolvedValue({ id: "pay-1" });
    const onClose = vi.fn<() => void>();
    render(<ActivityMoneyFlow request={{ kind: "payment", activity }} onClose={onClose} />);

    expect(screen.getByTestId("payment-link")).toHaveTextContent("activity:act-1");

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj plaćanje" }));

    await waitFor(() => expect(createPayment).toHaveBeenCalledWith(paymentPayload));
    expect(onClose).toHaveBeenCalled();
    expect(successToast).toHaveBeenCalledWith("Plaćanje je dodato.");
  });

  it("keeps the payment form open with an inline error when saving fails", async () => {
    createPayment.mockRejectedValue(new Error("Upis nije uspeo"));
    const onClose = vi.fn<() => void>();
    render(<ActivityMoneyFlow request={{ kind: "payment", activity }} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj plaćanje" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Upis nije uspeo");
    expect(onClose).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });

  it("hops from the expense form to the receipt scanner, keeping the link", async () => {
    render(
      <ActivityMoneyFlow request={{ kind: "expense", activity }} onClose={vi.fn<() => void>()} />,
    );

    expect(screen.getByTestId("expense-link")).toHaveTextContent("activity:act-1");

    fireEvent.click(screen.getByRole("button", { name: "Skeniraj račun" }));

    expect(screen.queryByRole("dialog", { name: "Dodaj trošak" })).not.toBeInTheDocument();
    // findBy: the scanner chunk is lazy() even with the module mocked.
    expect(await screen.findByTestId("scan-link")).toHaveTextContent("activity:act-1");
  });

  it("opens the scanner directly for a scan request", async () => {
    render(
      <ActivityMoneyFlow request={{ kind: "scan", activity }} onClose={vi.fn<() => void>()} />,
    );

    expect(await screen.findByTestId("scan-link")).toHaveTextContent("activity:act-1");
  });

  it("renders nothing without a request", () => {
    const { container } = render(
      <ActivityMoneyFlow request={null} onClose={vi.fn<() => void>()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
