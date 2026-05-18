import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { PaymentForm, type PaymentFormPayload } from "@/components/payments/PaymentForm";
import type { Payment } from "@/types/database";

export type PaymentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
  /** When the payment already has history, recurrence type radios get disabled. */
  hasHistory?: boolean;
  /** Inline error banner shown above the form (e.g. mutation failure). */
  error?: string | null;
  saving?: boolean;
  onSubmit: (payload: PaymentFormPayload) => void;
};

/**
 * Direct port of `components/payments/PaymentFormDialog.vue`.
 *
 * Owns the ResponsiveDialog shell + inline error banner. The form fields
 * and footer buttons live inside <PaymentForm> so the dialog stays purely
 * about presentation; the parent page wires submit → mutation.
 *
 * On mobile (<sm) this becomes a bottom-sheet via vaul; on desktop it's a
 * centered modal — see `src/components/ui/responsive-dialog.tsx`.
 */
export function PaymentFormDialog({
  open,
  onOpenChange,
  payment,
  hasHistory,
  error,
  saving,
  onSubmit,
}: PaymentFormDialogProps) {
  const title = payment ? "Izmeni plaćanje" : "Dodaj plaćanje";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : null}
        <PaymentForm
          payment={payment}
          hasHistory={hasHistory}
          saving={saving}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
