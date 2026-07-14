import { useMemo } from "react";

import type { Activity, Payment } from "@/types/database";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { usePaymentHistory, usePaymentsList } from "@/hooks/usePayments";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useToday } from "@/hooks/useToday";
import { computeActivityMonthlySummaries } from "@/utils/activityAttendance";
import { formatDate, isOverdue } from "@/utils/date";
import { formatAmount } from "@/utils/format";
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
 * Read-only "Plaćanja" section inside the activity edit dialog — the reverse
 * side of the payment → activity link. Renders nothing until the activity has
 * at least one linked payment; then lists them (name, amount, next due,
 * status) and, below, the per-month attendance breakdown for the current +
 * last 6 months ("Jun 2026 · 8 termina · 4.000 RSD") computed by the pure
 * `computeActivityMonthlySummaries` helper. All-zero months are skipped so a
 * young activity doesn't render a column of noise.
 */
export function ActivityPaymentsSection({ activity }: { activity: Activity }) {
  const paymentsQuery = usePaymentsList();
  const historyQuery = usePaymentHistory();
  const scheduleQuery = useActivitySchedule();
  const participantsQuery = useActivityParticipants();
  const overridesQuery = useActivityOverrides();
  const { byPersonId: shiftAnchorsByPersonId } = useSchoolShiftAnchors();
  const today = useToday();

  const linkedPayments = useMemo(
    () => (paymentsQuery.data ?? []).filter((p) => p.activity_id === activity.id),
    [paymentsQuery.data, activity.id],
  );

  const months = useMemo(() => {
    if (linkedPayments.length === 0) return [];
    return computeActivityMonthlySummaries({
      activity,
      schedule: scheduleQuery.data ?? [],
      participants: participantsQuery.data ?? [],
      shiftAnchorsByPersonId,
      overrides: overridesQuery.data ?? [],
      linkedPaymentIds: new Set(linkedPayments.map((p) => p.id)),
      history: historyQuery.data ?? [],
      currentMonth: today.str.slice(0, 7),
    }).filter((m) => m.heldSessions > 0 || m.paidTotal > 0);
  }, [
    linkedPayments,
    activity,
    scheduleQuery.data,
    participantsQuery.data,
    shiftAnchorsByPersonId,
    overridesQuery.data,
    historyQuery.data,
    today.str,
  ]);

  if (linkedPayments.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Plaćanja</p>
      <ul className="space-y-2">
        {linkedPayments.map((payment) => (
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
            <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {formatAmount(payment.amount)}
            </span>
          </li>
        ))}
      </ul>
      {months.length > 0 ? (
        <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
          <ul className="space-y-1">
            {months.map((m) => (
              <li key={m.month} className="text-xs text-muted-foreground tabular-nums">
                {m.label} · {m.heldSessions === 1 ? "1 termin" : `${m.heldSessions} termina`} ·{" "}
                {formatAmount(m.paidTotal)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
