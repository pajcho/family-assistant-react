import * as React from "react";
import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { PaymentUndoDialog } from "@/components/payments/PaymentUndoDialog";
import { usePaymentHistoryByPaymentId, useUndoLastPayment } from "@/hooks/usePayments";
import type { Payment } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";

export type PaymentHistoryPopupProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The payment whose history we're inspecting; null while closed. */
  payment: Payment | null;
};

/**
 * Direct port of `components/payments/PaymentHistoryPopup.vue` from the
 * sibling Nuxt app.
 *
 * Shows every paid instance of a recurring payment (latest first), with an
 * inline "Poništi" link on the most recent entry. Tapping that opens an
 * embedded <PaymentUndoDialog> for confirmation; on confirm we call
 * `useUndoLastPayment` and let realtime + invalidation refresh the list.
 *
 * Uses ResponsiveDialog so it's a bottom sheet on mobile and a centered
 * modal on desktop.
 */
export function PaymentHistoryPopup({ open, onOpenChange, payment }: PaymentHistoryPopupProps) {
  const [undoConfirmOpen, setUndoConfirmOpen] = React.useState(false);
  const undoMutation = useUndoLastPayment();

  const historyQuery = usePaymentHistoryByPaymentId(open ? payment?.id : null);
  const history = historyQuery.data ?? [];
  const loading = historyQuery.isLoading || historyQuery.isFetching;

  // Close the nested undo dialog whenever the parent popup closes.
  React.useEffect(() => {
    if (!open) setUndoConfirmOpen(false);
  }, [open]);

  const handleUndo = async () => {
    if (!payment?.id) return;
    try {
      await undoMutation.mutateAsync(payment.id);
      setUndoConfirmOpen(false);
      // Realtime + invalidation refresh the per-payment history query, so
      // the list redraws without an explicit refetch.
    } catch {
      // Toast surfaced by the hook's onError; keep the confirm dialog open
      // so the user can retry or cancel.
    }
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{`Istorija: ${payment?.name ?? ""}`}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {loading ? (
            <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              Učitavanje…
            </div>
          ) : history.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              Nema zabeleženih uplata za ovo plaćanje.
            </div>
          ) : (
            <ul className="space-y-2">
              {history.map((entry, index) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-700/50"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {`${index + 1}. Dospeće ${formatDate(entry.due_date)}`}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {`Plaćeno ${formatDate(entry.paid_date)}`}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatAmount(entry.amount)}
                    </span>
                    {index === 0 ? (
                      <button
                        type="button"
                        disabled={undoMutation.isPending}
                        onClick={() => setUndoConfirmOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-red-400"
                      >
                        <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                        Poništi
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Zatvori
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentUndoDialog
        open={undoConfirmOpen}
        onOpenChange={setUndoConfirmOpen}
        paymentName={payment?.name ?? ""}
        loading={undoMutation.isPending}
        onConfirm={() => {
          void handleUndo();
        }}
      />
    </>
  );
}
