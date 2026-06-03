import { useMemo, useState } from "react";
import { BanknotesIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import { PaymentDetailDialog } from "@/components/dashboard/PaymentDetailDialog";
import type { Payment } from "@/types/database";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import {
  effectivePaymentDueDate,
  isPaymentOccurrenceCanceled,
  usePaymentOverrides,
} from "@/hooks/usePaymentOverrides";
import { addDays, dueDayLabel, isDateInRange, isOverdue, startOfToday } from "@/utils/date";
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

export function DashboardPaymentCard({ payments, onAdd, onEdit }: DashboardPaymentCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const { byPayment } = usePaymentParticipants();
  const { byKey: overridesByKey } = usePaymentOverrides();

  const duePayments = useMemo(() => {
    const today = startOfToday();
    const in7 = addDays(today, 7);
    // Skip canceled current occurrences; resolve each to its effective
    // (possibly rescheduled) date so a moved payment shows on its new date.
    const rows = payments
      .filter(
        (p) =>
          !p.is_paid &&
          !p.is_paused &&
          !isPaymentOccurrenceCanceled(p.id, p.due_date, overridesByKey),
      )
      .map((payment) => ({
        payment,
        effectiveDate: effectivePaymentDueDate(payment.id, payment.due_date, overridesByKey),
      }));
    const overdue = rows
      .filter((r) => isOverdue(r.effectiveDate))
      .toSorted((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const upcoming = rows
      .filter((r) => isDateInRange(r.effectiveDate, today, in7))
      .toSorted((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    return [...overdue, ...upcoming];
  }, [payments, overridesByKey]);

  const visiblePayments = duePayments.slice(0, 5);

  const openDetail = (payment: Payment) => {
    setSelectedPayment(payment);
    setDetailOpen(true);
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
        {visiblePayments.map(({ payment, effectiveDate }) => {
          const overdue = isOverdue(effectiveDate);
          return (
            <DashboardCardItem
              key={payment.id}
              label={payment.name}
              value={formatAmount(payment.amount)}
              description={dueDayLabel(effectiveDate)}
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

      <PaymentDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payment={selectedPayment}
        personIds={selectedPayment ? (byPayment.get(selectedPayment.id) ?? []) : []}
        onEdit={onEdit}
      />
    </>
  );
}
