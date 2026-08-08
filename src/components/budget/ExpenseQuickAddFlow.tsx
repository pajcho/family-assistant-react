import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { useCreateExpense } from "@/hooks/useExpenses";

import { ReceiptScanDialog } from "@/components/budget/receipt/lazyReceiptScanDialog";

export type ExpenseQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Reuses the budget's exact manual-expense form (and its receipt shortcut) on
 * non-budget surfaces. The flow owns the mutation and feedback, but never
 * navigates, so callers stay in their current context after a successful save.
 *
 * `stage` is what makes the receipt shortcut work here: this component's
 * `open` is a PROP, and its host (the global "+") unmounts the whole flow the
 * moment that goes false. So "Skeniraj račun" must not close the flow to swap
 * dialogs - it switches stage within it, exactly like `LinkedMoneyFlow`.
 * Closing is still the host's call, and it tears down both stages.
 */
export function ExpenseQuickAddFlow({ open, onOpenChange }: ExpenseQuickAddFlowProps) {
  const createExpense = useCreateExpense();
  const [formError, setFormError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "scan">("form");

  // A reopened flow always starts at the form (hosts that keep this mounted).
  useEffect(() => {
    if (!open) setStage("form");
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const handleSubmit = async (payload: ExpenseFormPayload) => {
    setFormError(null);
    try {
      await createExpense.mutateAsync(payload);
      onOpenChange(false);
      toast.success("Trošak je dodat.");
    } catch (error) {
      setFormError(
        error instanceof Error && error.message ? error.message : "Greška pri dodavanju troška",
      );
    }
  };

  return (
    <>
      {stage === "form" ? (
        <ExpenseFormDialog
          open={open}
          onOpenChange={handleOpenChange}
          error={formError}
          saving={createExpense.isPending}
          onSubmit={(payload) => {
            void handleSubmit(payload);
          }}
          onScanReceipt={() => setStage("scan")}
        />
      ) : null}

      {stage === "scan" ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open={open} onOpenChange={handleOpenChange} />
        </Suspense>
      ) : null}
    </>
  );
}
