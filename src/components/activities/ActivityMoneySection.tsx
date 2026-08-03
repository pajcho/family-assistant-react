import { useMemo } from "react";

import type { Activity } from "@/types/database";
import { LinkedExpensesList, LinkedPaymentsList } from "@/components/payments/LinkedPaymentsList";
import type { LinkedMoneyTarget } from "@/components/payments/LinkedMoneyViewer";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useLinkedExpenses } from "@/hooks/useExpenses";
import { usePaymentHistory, usePaymentsList } from "@/hooks/usePayments";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useToday } from "@/hooks/useToday";
import { computeActivityMonthlySummaries } from "@/utils/activityAttendance";
import { Amount } from "@/components/common/Amount";

/**
 * The money boxes inside the activity dialogs - payments and manual/receipt
 * expenses linked to the activity (the reverse side of each link). The
 * payments box appends the per-month attendance breakdown for the current +
 * last 6 months ("Jun 2026 · 8 termina · 4.000 RSD") computed by the pure
 * `computeActivityMonthlySummaries` helper; all-zero months are skipped so a
 * young activity doesn't render a column of noise. Renders nothing while the
 * activity has no linked money. With `onSelect` the rows open the entry's
 * detail via the host's `LinkedMoneyViewer` (the edit form keeps them static).
 */
export function ActivityMoneySection({
  activity,
  onSelect,
}: {
  activity: Activity;
  onSelect?: (target: LinkedMoneyTarget) => void;
}) {
  const paymentsQuery = usePaymentsList();
  const historyQuery = usePaymentHistory();
  const scheduleQuery = useActivitySchedule();
  const participantsQuery = useActivityParticipants();
  const overridesQuery = useActivityOverrides();
  const { byPersonId: shiftAnchorsByPersonId } = useSchoolShiftAnchors();
  const today = useToday();
  const { expenses } = useLinkedExpenses({ activityId: activity.id });

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
    <>
      <LinkedPaymentsList
        payments={linkedPayments}
        onSelect={onSelect ? (payment) => onSelect({ kind: "payment", payment }) : undefined}
      >
        {months.length > 0 ? (
          <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
            <ul className="space-y-1">
              {months.map((m) => (
                <li key={m.month} className="text-xs text-muted-foreground tabular-nums">
                  {m.label} · {m.heldSessions === 1 ? "1 termin" : `${m.heldSessions} termina`} ·{" "}
                  <Amount value={m.paidTotal} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </LinkedPaymentsList>
      <LinkedExpensesList
        expenses={expenses}
        onSelect={onSelect ? (expense) => onSelect({ kind: "expense", expense }) : undefined}
      />
    </>
  );
}
