import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import { useCreateExpense } from "@/hooks/useExpenses";
import { useCreatePayment } from "@/hooks/usePayments";
import type { Activity } from "@/types/database";

// Same lazy chunk as the budget page - camera + zxing stay out of the main bundle.
const ReceiptScanDialog = lazy(() => import("@/components/budget/receipt/ReceiptScanDialog"));

export type ActivityMoneyKind = "payment" | "expense" | "scan";

export type ActivityMoneyRequest = {
  kind: ActivityMoneyKind;
  activity: Activity;
};

export type ActivityMoneyFlowProps = {
  /** What to add (and for which activity); null renders nothing. */
  request: ActivityMoneyRequest | null;
  /** Called when the flow is done (saved or dismissed). */
  onClose: () => void;
};

/**
 * The "dodaj uz aktivnost" money flows - a new payment, a manual expense or a
 * scanned receipt, each opening pre-linked to the given activity. Mounted by
 * `BlockActionDialog` OUTSIDE its own sheet, so the form survives the sheet
 * closing underneath it. Owns the mutations + inline errors, never navigates -
 * the member stays on Danas / Aktivnosti after saving.
 *
 * `stage` mirrors `request.kind` but can diverge: the expense form's
 * "Skeniraj račun" shortcut hops to the scanner within the same request
 * (the link carries over).
 */
export function ActivityMoneyFlow({ request, onClose }: ActivityMoneyFlowProps) {
  const createPayment = useCreatePayment();
  const createExpense = useCreateExpense();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [stage, setStage] = useState<ActivityMoneyKind | null>(request?.kind ?? null);

  // Each new request restarts the flow at its kind (and clears stale errors).
  useEffect(() => {
    setStage(request?.kind ?? null);
    setPaymentError(null);
    setExpenseError(null);
  }, [request]);

  if (!request || !stage) return null;

  const link = { kind: "activity" as const, id: request.activity.id };

  const handleDismiss = (open: boolean) => {
    if (!open) onClose();
  };

  const handlePaymentSubmit = async (payload: PaymentFormPayload) => {
    setPaymentError(null);
    try {
      await createPayment.mutateAsync(payload);
      onClose();
      toast.success("Plaćanje je dodato.");
    } catch (err) {
      setPaymentError(
        err instanceof Error && err.message ? err.message : "Greška pri dodavanju plaćanja",
      );
    }
  };

  const handleExpenseSubmit = async (payload: ExpenseFormPayload) => {
    setExpenseError(null);
    try {
      await createExpense.mutateAsync(payload);
      onClose();
      toast.success("Trošak je dodat.");
    } catch (err) {
      setExpenseError(
        err instanceof Error && err.message ? err.message : "Greška pri dodavanju troška",
      );
    }
  };

  return (
    <>
      {stage === "payment" ? (
        <PaymentFormDialog
          open
          onOpenChange={handleDismiss}
          payment={null}
          initialLink={link}
          error={paymentError}
          saving={createPayment.isPending}
          onSubmit={(payload) => {
            void handlePaymentSubmit(payload);
          }}
        />
      ) : null}

      {stage === "expense" ? (
        <ExpenseFormDialog
          open
          onOpenChange={handleDismiss}
          initialLink={link}
          error={expenseError}
          saving={createExpense.isPending}
          onSubmit={(payload) => {
            void handleExpenseSubmit(payload);
          }}
          onScanReceipt={() => setStage("scan")}
        />
      ) : null}

      {stage === "scan" ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open onOpenChange={handleDismiss} link={link} />
        </Suspense>
      ) : null}
    </>
  );
}
