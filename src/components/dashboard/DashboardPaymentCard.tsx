import * as React from "react";
import { BanknotesIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import { PaymentHistoryPopup } from "@/components/payments/PaymentHistoryPopup";
import { useMarkPaymentPaid } from "@/hooks/usePayments";
import type { Payment } from "@/types/database";
import { addDays, formatDate, isDateInRange, isOverdue, startOfToday } from "@/utils/date";
import { formatAmount } from "@/utils/format";

/**
 * "Predstojeća plaćanja" dashboard card. Direct port of
 * `components/dashboard/DashboardPaymentCard.vue`.
 *
 * Visible items = unpaid && !paused payments that are overdue OR due within
 * the next 7 days. Overdue rows are sorted first (by due_date), then upcoming.
 *
 * Each row uses the `red` accent (light-pink/red tint + red amount + warning
 * icon) when overdue, otherwise the `amber` accent. The card header icon
 * stays amber regardless — only the rows tint red, matching the screenshots.
 *
 * Clicking a row opens the per-payment detail popup. The popup includes a
 * "Označi kao plaćeno" link that calls `useMarkPaymentPaid` directly (so the
 * mark-paid flow works without leaving the dashboard) and an "Istorija" link
 * that opens the shared `PaymentHistoryPopup`.
 */
export type DashboardPaymentCardProps = {
  payments: Payment[];
  onAdd: () => void;
  onEdit: (payment: Payment) => void;
};

function recurrenceLabel(payment: Payment): string {
  if (payment.recurrence_period === "monthly") return "Mesečno plaćanje";
  if (payment.recurrence_period === "limited") return "Plaćanje na rate";
  return "Jednokratno plaćanje";
}

export function DashboardPaymentCard({ payments, onAdd, onEdit }: DashboardPaymentCardProps) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedPayment, setSelectedPayment] = React.useState<Payment | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const markPaid = useMarkPaymentPaid();

  const duePayments = React.useMemo<Payment[]>(() => {
    const today = startOfToday();
    const in7 = addDays(today, 7);
    const unpaid = payments.filter((p) => !p.is_paid && !p.is_paused);
    const overdue = unpaid
      .filter((p) => isOverdue(p.due_date))
      .toSorted((a, b) => a.due_date.localeCompare(b.due_date));
    const upcoming = unpaid
      .filter((p) => isDateInRange(p.due_date, today, in7))
      .toSorted((a, b) => a.due_date.localeCompare(b.due_date));
    return [...overdue, ...upcoming];
  }, [payments]);

  const visiblePayments = duePayments.slice(0, 5);

  const openDetail = (payment: Payment) => {
    setSelectedPayment(payment);
    setDetailOpen(true);
  };

  const handleEdit = () => {
    if (!selectedPayment) return;
    setDetailOpen(false);
    onEdit(selectedPayment);
  };

  const openHistory = () => {
    setDetailOpen(false);
    setHistoryOpen(true);
  };

  // Mirror the Vue `watch(historyOpen, ...)` — re-open the detail popup when
  // the history sheet closes so the user lands back where they were.
  const prevHistoryOpen = React.useRef(false);
  React.useEffect(() => {
    if (prevHistoryOpen.current && !historyOpen && selectedPayment) {
      setDetailOpen(true);
    }
    prevHistoryOpen.current = historyOpen;
  }, [historyOpen, selectedPayment]);

  const handleMarkAsPaid = async () => {
    if (!selectedPayment) return;
    try {
      await markPaid.mutateAsync(selectedPayment.id);
      setDetailOpen(false);
    } catch {
      // Toast surfaced by hook's onError; keep popup open so user can retry.
    }
  };

  return (
    <>
      <DashboardCard
        icon={BanknotesIcon}
        title="Predstojeća plaćanja"
        emptyMessage="Nema plaćanja za prikaz"
        addLabel="Dodaj plaćanje"
        viewAllLink="/payments"
        hasItems={duePayments.length > 0}
        accent="amber"
        onAdd={onAdd}
      >
        {visiblePayments.map((payment) => {
          const overdue = isOverdue(payment.due_date);
          return (
            <DashboardCardItem
              key={payment.id}
              label={payment.name}
              value={formatAmount(payment.amount)}
              accent={overdue ? "red" : "amber"}
              badgeIcon={overdue ? ExclamationTriangleIcon : undefined}
              badgeIconTitle={overdue ? "Prekoračeno" : undefined}
              onClick={() => openDetail(payment)}
            />
          );
        })}
        {duePayments.length > 5 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">+ još {duePayments.length - 5}</p>
        ) : null}
      </DashboardCard>

      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji plaćanja</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {selectedPayment ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                  <BanknotesIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedPayment.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {recurrenceLabel(selectedPayment)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Iznos:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {formatAmount(selectedPayment.amount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Datum dospeća:</dt>
                    <dd className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                      {formatDate(selectedPayment.due_date)}
                      {!selectedPayment.is_paid && isOverdue(selectedPayment.due_date) ? (
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
                        selectedPayment.is_paid
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {selectedPayment.is_paid ? "Plaćeno" : "Nije plaćeno"}
                    </dd>
                  </div>
                  {selectedPayment.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {selectedPayment.description}
                      </dd>
                    </div>
                  ) : null}
                  {selectedPayment.recurrence_period === "limited" &&
                  selectedPayment.remaining_occurrences ? (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Preostalo:</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">
                        {selectedPayment.remaining_occurrences} rata
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
                    {!selectedPayment.is_paid ? (
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
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Zatvori
            </Button>
            <Button onClick={handleEdit}>Izmeni</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentHistoryPopup
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        payment={selectedPayment}
      />
    </>
  );
}
