import { useEffect, useRef, useState } from "react";
import { BanknotesIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { PaymentHistoryPopup } from "@/components/payments/PaymentHistoryPopup";
import { useMarkPaymentPaid } from "@/hooks/usePayments";
import type { Payment } from "@/types/database";
import { formatDate, isOverdue } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { recurrenceLabel } from "@/utils/payment";

/**
 * Shared payment detail popup used by both `DashboardPaymentCard` and
 * `DashboardTodayCard`. Self-contained: owns the history popup state, the
 * mark-paid mutation, and the re-open dance when the history sheet closes.
 * The "Izmeni" button delegates to the caller via `onEdit`.
 */
export type PaymentDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
  onEdit: (payment: Payment) => void;
};

function paymentSubtitle(payment: Payment): string {
  if (payment.recurrence_period === "limited") return "Plaćanje na rate";
  const base = recurrenceLabel(payment.recurrence_period, payment.recurrence_interval);
  if (payment.recurrence_period === "one-time" || payment.recurrence_period == null) {
    return "Jednokratno plaćanje";
  }
  return `${base} plaćanje`;
}

export function PaymentDetailDialog({
  open,
  onOpenChange,
  payment,
  onEdit,
}: PaymentDetailDialogProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const markPaid = useMarkPaymentPaid();

  // Re-open the detail popup when the history sheet closes so the user
  // lands back where they were. Mirrors the Vue `watch(historyOpen, ...)`.
  const prevHistoryOpen = useRef(false);
  useEffect(() => {
    if (prevHistoryOpen.current && !historyOpen && payment) {
      onOpenChange(true);
    }
    prevHistoryOpen.current = historyOpen;
  }, [historyOpen, payment, onOpenChange]);

  const handleEdit = () => {
    if (!payment) return;
    onOpenChange(false);
    onEdit(payment);
  };

  const openHistory = () => {
    onOpenChange(false);
    setHistoryOpen(true);
  };

  const handleMarkAsPaid = async () => {
    if (!payment) return;
    try {
      await markPaid.mutateAsync(payment.id);
      onOpenChange(false);
    } catch {
      // Toast surfaced by hook's onError; keep popup open so user can retry.
    }
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji plaćanja</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {payment ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                  <BanknotesIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {payment.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {paymentSubtitle(payment)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Iznos:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {formatAmount(payment.amount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Datum dospeća:</dt>
                    <dd className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                      {formatDate(payment.due_date)}
                      {!payment.is_paid && isOverdue(payment.due_date) ? (
                        <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-800/60 dark:text-red-200">
                          Prekoračeno
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Status:</dt>
                    <dd
                      className={
                        payment.is_paid
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {payment.is_paid ? "Plaćeno" : "Nije plaćeno"}
                    </dd>
                  </div>
                  {payment.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {payment.description}
                      </dd>
                    </div>
                  ) : null}
                  {payment.recurrence_period === "limited" && payment.remaining_occurrences ? (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Preostalo:</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">
                        {payment.remaining_occurrences} rata
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-gray-200 pt-2 dark:border-gray-600">
                    <button
                      type="button"
                      className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                      onClick={openHistory}
                    >
                      Istorija
                    </button>
                    {!payment.is_paid ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-blue-400"
                        disabled={markPaid.isPending}
                        onClick={() => {
                          void handleMarkAsPaid();
                        }}
                      >
                        Označi kao plaćeno
                      </button>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500" />
                    )}
                  </div>
                </dl>
              </div>
            </div>
          ) : null}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Zatvori
            </Button>
            <Button onClick={handleEdit}>Izmeni</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentHistoryPopup open={historyOpen} onOpenChange={setHistoryOpen} payment={payment} />
    </>
  );
}
