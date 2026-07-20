import type { ReactNode } from "react";

import type { Payment } from "@/types/database";
import { formatDate, isOverdue } from "@/utils/date";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { recurrenceLabel } from "@/utils/payment";

/** Compact status pill — same colorway as the payments list row states. */
function PaymentStatusPill({ payment }: { payment: Payment }) {
  if (payment.is_paid) {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
        Plaćeno
      </span>
    );
  }
  if (payment.is_paused) {
    return (
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
        Pauzirano
      </span>
    );
  }
  if (isOverdue(payment.due_date)) {
    return (
      <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-800/60 dark:text-red-200">
        Prekoračeno
      </span>
    );
  }
  return null;
}

/**
 * Read-only "Plaćanja" box listing the payments linked to one activity or
 * event — the reverse side of the payment link. Renders nothing when the list
 * is empty, so callers can mount it unconditionally. `children` slots extra
 * read-only content into the same box (the activity side appends its
 * per-month attendance breakdown there).
 */
export function LinkedPaymentsList({
  payments,
  children,
}: {
  payments: ReadonlyArray<Payment>;
  children?: ReactNode;
}) {
  if (payments.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Plaćanja</p>
      <ul className="space-y-2">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {payment.name}
                </span>
                <PaymentStatusPill payment={payment} />
              </div>
              <p className="text-xs text-muted-foreground">
                Dospeva {formatDate(payment.due_date)} ·{" "}
                {recurrenceLabel(payment.recurrence_period, payment.recurrence_interval)}
              </p>
            </div>
            <span className="shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Amount value={payment.amount} />
              <AmountOriginal
                amount={payment.original_amount}
                currency={payment.currency}
                className="block text-[10px] font-normal"
              />
            </span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
