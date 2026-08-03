import { useMemo } from "react";

import { LinkedExpensesList, LinkedPaymentsList } from "@/components/payments/LinkedPaymentsList";
import type { LinkedMoneyTarget } from "@/components/payments/LinkedMoneyViewer";
import { useLinkedExpenses } from "@/hooks/useExpenses";
import { usePaymentsList } from "@/hooks/usePayments";

/**
 * The money boxes of the event detail dialog - payments AND manual/receipt
 * expenses linked to the event (each the reverse side of its link column).
 * Renders nothing while the event has neither. With `onSelect` the rows open
 * the entry's detail via the host's `LinkedMoneyViewer`.
 */
export function EventMoneySection({
  eventId,
  onSelect,
}: {
  eventId: string;
  onSelect?: (target: LinkedMoneyTarget) => void;
}) {
  const paymentsQuery = usePaymentsList();
  const { expenses } = useLinkedExpenses({ eventId });

  const linkedPayments = useMemo(
    () => (paymentsQuery.data ?? []).filter((p) => p.event_id === eventId),
    [paymentsQuery.data, eventId],
  );

  return (
    <>
      <LinkedPaymentsList
        payments={linkedPayments}
        onSelect={onSelect ? (payment) => onSelect({ kind: "payment", payment }) : undefined}
      />
      <LinkedExpensesList
        expenses={expenses}
        onSelect={onSelect ? (expense) => onSelect({ kind: "expense", expense }) : undefined}
      />
    </>
  );
}
