import { useMemo } from "react";
import { format } from "date-fns";

import type { AgendaItem } from "@/hooks/useAgenda";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import { usePaymentsList } from "@/hooks/usePayments";
import { effectivePaymentDueDate, isPaymentOverdue } from "@/utils/payment";

/**
 * Overdue payments as agenda rows — unpaid, unpaused payments whose live
 * occurrence's effective due date already slipped before today. One row per
 * payment (the current live occurrence), oldest first.
 *
 * Sits beside `useAgenda` rather than inside it: overdue lives BEFORE any agenda
 * window (`[today, …]`), so it isn't "in range". The underlying payment queries
 * are shared via React Query's cache, so calling both in a tab costs no extra
 * fetch. The dashboard renders these in the "Prekoračeno" section above today.
 */
export interface UseOverduePaymentsResult {
  items: AgendaItem[];
  isLoading: boolean;
}

export function useOverduePayments(): UseOverduePaymentsResult {
  const paymentsQuery = usePaymentsList();
  const { byPayment } = usePaymentParticipants();
  const { byKey: overridesByKey } = usePaymentOverrides();

  const today = format(new Date(), "yyyy-MM-dd");

  const items = useMemo<AgendaItem[]>(() => {
    const out: AgendaItem[] = [];
    for (const payment of paymentsQuery.data ?? []) {
      if (!isPaymentOverdue(payment, overridesByKey, today)) continue;
      const effectiveDate = effectivePaymentDueDate(payment.id, payment.due_date, overridesByKey);
      out.push({
        kind: "payment",
        date: effectiveDate,
        sortKey: 0,
        payment,
        occurrenceDate: payment.due_date,
        effectiveDate,
        personIds: byPayment.get(payment.id) ?? [],
      });
    }
    // Oldest overdue first — longest-outstanding at the top.
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [paymentsQuery.data, byPayment, overridesByKey, today]);

  return { items, isLoading: paymentsQuery.isLoading };
}
