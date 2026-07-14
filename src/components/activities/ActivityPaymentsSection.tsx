import { useMemo } from "react";

import type { Activity } from "@/types/database";
import { LinkedPaymentsList } from "@/components/payments/LinkedPaymentsList";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { usePaymentHistory, usePaymentsList } from "@/hooks/usePayments";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useToday } from "@/hooks/useToday";
import { computeActivityMonthlySummaries } from "@/utils/activityAttendance";
import { formatAmount } from "@/utils/format";

/**
 * Read-only "Plaćanja" section inside the activity edit dialog — the reverse
 * side of the payment → activity link. Renders nothing until the activity has
 * at least one linked payment; then lists them and appends the per-month
 * attendance breakdown for the current + last 6 months
 * ("Jun 2026 · 8 termina · 4.000 RSD") computed by the pure
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

  return (
    <LinkedPaymentsList payments={linkedPayments}>
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
    </LinkedPaymentsList>
  );
}
