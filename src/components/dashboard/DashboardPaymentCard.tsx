import { useMemo, useState } from "react";
import { BanknotesIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import { PaymentDetailDialog } from "@/components/dashboard/PaymentDetailDialog";
import type { Payment } from "@/types/database";
import { addDays, isDateInRange, isOverdue, startOfToday } from "@/utils/date";
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

  const duePayments = useMemo<Payment[]>(() => {
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

      <PaymentDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payment={selectedPayment}
        onEdit={onEdit}
      />
    </>
  );
}
