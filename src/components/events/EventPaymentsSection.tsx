import { useMemo } from "react";

import { LinkedPaymentsList } from "@/components/payments/LinkedPaymentsList";
import { usePaymentsList } from "@/hooks/usePayments";

/**
 * Read-only "Plaćanja" section for the event detail dialog - the reverse side
 * of the payment → event link. Just the linked payments with status; events
 * have no schedule, so there's no monthly breakdown (that's the activity
 * side's `ActivityPaymentsSection`). Renders nothing without linked payments.
 */
export function EventPaymentsSection({ eventId }: { eventId: string }) {
  const paymentsQuery = usePaymentsList();

  const linkedPayments = useMemo(
    () => (paymentsQuery.data ?? []).filter((p) => p.event_id === eventId),
    [paymentsQuery.data, eventId],
  );

  return <LinkedPaymentsList payments={linkedPayments} />;
}
