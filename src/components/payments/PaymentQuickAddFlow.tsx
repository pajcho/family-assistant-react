import { useState } from "react";

import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import { useCreatePayment } from "@/hooks/usePayments";

export type PaymentQuickAddFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Dodaj → Plaćanje" from surfaces that don't own the payments mutations (the
 * global "+" in the bottom bar). Add only, owns its mutation and error, never
 * navigates - see `EventQuickAddFlow` for the shared shape.
 *
 * `hasHistory` is false by design: a brand new payment has no occurrences, so
 * the recurrence radios stay enabled.
 */
export function PaymentQuickAddFlow({ open, onOpenChange }: PaymentQuickAddFlowProps) {
  const createPayment = useCreatePayment();
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setFormError(null);
  };

  const handleSubmit = async (payload: PaymentFormPayload) => {
    setFormError(null);
    try {
      await createPayment.mutateAsync({
        ...payload,
        is_recurring: payload.recurrence_period !== "one-time",
      });
      onOpenChange(false);
    } catch (err) {
      setFormError(
        err instanceof Error && err.message ? err.message : "Greška pri kreiranju plaćanja",
      );
    }
  };

  return (
    <PaymentFormDialog
      open={open}
      onOpenChange={handleOpenChange}
      payment={null}
      initialPersonIds={[]}
      hasHistory={false}
      error={formError}
      saving={createPayment.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}
