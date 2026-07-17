import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";

import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { useCreateExpense } from "@/hooks/useExpenses";

const ReceiptScanDialog = lazy(() => import("@/components/budget/receipt/ReceiptScanDialog"));

export type ExpenseQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Reuses the budget's exact manual-expense form (and its receipt shortcut) on
 * non-budget surfaces. The flow owns the mutation and feedback, but never
 * navigates, so callers stay in their current context after a successful save.
 */
export function ExpenseQuickAddFlow({ open, onOpenChange }: ExpenseQuickAddFlowProps) {
  const createExpense = useCreateExpense();
  const [formError, setFormError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMounted, setScanMounted] = useState(false);

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

  const openScanner = () => {
    onOpenChange(false);
    setScanMounted(true);
    setScanOpen(true);
  };

  return (
    <>
      <ExpenseFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        error={formError}
        saving={createExpense.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
        onScanReceipt={openScanner}
      />

      {scanMounted ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open={scanOpen} onOpenChange={setScanOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
