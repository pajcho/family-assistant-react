import { Suspense, useEffect, useState } from "react";

import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { ReceiptExpenseDialog } from "@/components/budget/ReceiptExpenseDialog";
// Same lazy chunk as Novac - camera + zxing stay out of the main bundle.
import { ReceiptScanDialog } from "@/components/budget/receipt/lazyReceiptScanDialog";
import { PaymentDetailDialog } from "@/components/payments/PaymentDetailDialog";
import { useDeleteExpense, useUpdateExpense } from "@/hooks/useExpenses";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import type { Expense, Payment } from "@/types/database";

export type LinkedMoneyTarget =
  | { kind: "payment"; payment: Payment }
  | { kind: "expense"; expense: Expense };

export type LinkedMoneyViewerProps = {
  /** The tapped linked-money row; null renders nothing. */
  target: LinkedMoneyTarget | null;
  /** Called when the popup is dismissed (the host sheet comes back). */
  onClose: () => void;
};

/**
 * Detail popup for a money row tapped inside another entity's detail sheet
 * (event / birthday / activity occurrence). The HOST hides its own sheet
 * while `target` is set (`open={… && !target}`) and returns when this closes -
 * the same hide-don't-close trick as the payment sheet's link editor, so two
 * overlays never fight over the body scroll lock.
 *
 * Routing mirrors the Budget page rows: payments open the full
 * `PaymentDetailDialog` (its "Izmeni" self-hosts the edit form), receipt
 * expenses open the receipt detail, manual expenses open the edit form.
 */
export function LinkedMoneyViewer({ target, onClose }: LinkedMoneyViewerProps) {
  const { byPayment } = usePaymentParticipants();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const [expenseError, setExpenseError] = useState<string | null>(null);
  // "Skeniraj račun" on a manual row swaps this popup for the scanner in
  // attach mode - same request, one level of the same flow.
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    setExpenseError(null);
    setAttaching(false);
  }, [target]);

  const handleDismiss = (open: boolean) => {
    if (!open) onClose();
  };

  if (!target) return null;

  if (target.kind === "payment") {
    return (
      <PaymentDetailDialog
        open
        onOpenChange={handleDismiss}
        payment={target.payment}
        personIds={byPayment.get(target.payment.id) ?? []}
      />
    );
  }

  const expense = target.expense;
  if (expense.source === "receipt") {
    return <ReceiptExpenseDialog open onOpenChange={handleDismiss} expense={expense} />;
  }

  const handleExpenseSubmit = async (payload: ExpenseFormPayload) => {
    setExpenseError(null);
    try {
      await updateExpense.mutateAsync({ id: expense.id, payload });
      onClose();
    } catch (err) {
      setExpenseError(
        err instanceof Error && err.message ? err.message : "Greška pri izmeni troška",
      );
    }
  };

  const handleExpenseDelete = async () => {
    try {
      await deleteExpense.mutateAsync(expense.id);
      onClose();
    } catch {
      // Toast surfaced by the hook; the form stays open for retry.
    }
  };

  if (attaching) {
    return (
      <Suspense fallback={null}>
        <ReceiptScanDialog open onOpenChange={handleDismiss} attachTo={expense} />
      </Suspense>
    );
  }

  return (
    <ExpenseFormDialog
      open
      onOpenChange={handleDismiss}
      expense={expense}
      error={expenseError}
      saving={updateExpense.isPending}
      onSubmit={(payload) => {
        void handleExpenseSubmit(payload);
      }}
      // Payment-sourced rows also land on this form; only a hand-typed one
      // with no receipt yet can take one on.
      onAttachReceipt={
        expense.source === "manual" && !expense.receipt_id && !expense.receipt_url
          ? () => setAttaching(true)
          : undefined
      }
      onDelete={() => {
        void handleExpenseDelete();
      }}
      deleting={deleteExpense.isPending}
    />
  );
}
