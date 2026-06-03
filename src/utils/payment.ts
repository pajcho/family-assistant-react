import type { Payment, RecurrencePeriod } from "@/types/database";
import { addMonth, addWeek, formatDate } from "@/utils/date";

/**
 * Short label for a payment's recurrence — used in list rows, dashboard cards,
 * and the detail popup. Returns the natural Serbian (Latin) phrasing based on
 * the period + interval combination.
 *
 *   one-time              → "Jednokratno"
 *   limited               → "Ograničeno"
 *   weekly, interval=1    → "Nedeljno"
 *   weekly, interval=2..4 → "Svake 2 nedelje" / "Svake 3 nedelje" / …
 *   monthly, interval=1   → "Mesečno"
 *   monthly, interval=2-4 → "Svaka 2 meseca" / "Svaka 3 meseca" / "Svaka 4 meseca"
 *   monthly, interval=5+  → "Svakih 6 meseci" / "Svakih 12 meseci" / …
 *
 * The 2-4 vs 5+ split for months follows Serbian paucal grammar: `dva/tri/četiri
 * meseca` (paucal) vs `pet meseci` (plural genitive). Weeks (nedelja, feminine)
 * use `nedelje` for all paucal values, which is what speakers actually say.
 */
export function recurrenceLabel(period: RecurrencePeriod | null, interval: number = 1): string {
  if (period === "one-time" || period == null) return "Jednokratno";
  if (period === "limited") return "Ograničeno";
  const n = Math.max(1, Math.floor(interval));

  if (period === "weekly") {
    if (n === 1) return "Nedeljno";
    return `Svake ${n} nedelje`;
  }

  if (period === "monthly") {
    if (n === 1) return "Mesečno";
    if (n >= 2 && n <= 4) return `Svaka ${n} meseca`;
    return `Svakih ${n} meseci`;
  }

  return "Jednokratno";
}

/**
 * The date the series advances to after the current occurrence is resolved
 * (paid or canceled) — i.e. when the NEXT payment comes due. Mirrors the
 * advance in `useMarkPaymentPaid` / `useCancelPaymentOccurrence`: monthly →
 * +N months, weekly → +N weeks, limited → +1 month (null on the last
 * instalment). One-time payments have no next occurrence (null).
 *
 * Used both for the cancel-dialog copy and to cap the reschedule date picker
 * (you shouldn't move the current occurrence past the next one).
 */
export function nextPaymentOccurrenceDate(
  payment: Pick<
    Payment,
    "due_date" | "recurrence_period" | "recurrence_interval" | "remaining_occurrences"
  >,
): string | null {
  const period = payment.recurrence_period;
  const interval = Math.max(1, payment.recurrence_interval ?? 1);
  if (period === "weekly") return addWeek(payment.due_date, interval);
  if (period === "monthly") return addMonth(payment.due_date, interval);
  if (period === "limited") {
    return (payment.remaining_occurrences ?? 0) > 1 ? addMonth(payment.due_date) : null;
  }
  return null;
}

export type PaymentCancelCopy = {
  title: string;
  message: string;
  placeholder: string;
};

/**
 * Type-aware copy for the "cancel this occurrence" dialog. A one-time payment
 * reads as a plain cancel; a recurring one explains that the current occurrence
 * is skipped and names the date the next one comes due — computed the same way
 * mark-paid / cancel advance the series (monthly→+N months, weekly→+N weeks,
 * limited→+1 month unless it's the last). The placeholder matches the cadence.
 */
export function paymentCancelCopy(
  payment: Pick<
    Payment,
    "name" | "due_date" | "recurrence_period" | "recurrence_interval" | "remaining_occurrences"
  >,
): PaymentCancelCopy {
  const name = payment.name;
  const period = payment.recurrence_period;

  if (period === "one-time" || period == null) {
    return {
      title: "Otkaži plaćanje",
      message: `Otkazati plaćanje „${name}"? Neće se više prikazivati kao dospelo, ali možeš ga vratiti kasnije.`,
      placeholder: "npr. više nije potrebno",
    };
  }

  const nextDate = nextPaymentOccurrenceDate(payment);
  const placeholder =
    period === "weekly"
      ? "npr. preskačemo ovu nedelju"
      : period === "monthly"
        ? "npr. preskačemo ovaj mesec"
        : "npr. preskačemo ovu ratu";

  const message = nextDate
    ? `Otkazati ovu uplatu za „${name}"? Trenutno plaćanje se otkazuje, a sledeće dospeva ${formatDate(nextDate)}. Možeš ga vratiti kasnije.`
    : `Otkazati poslednju uplatu za „${name}"? Možeš je vratiti kasnije.`;

  return { title: "Otkaži ratu", message, placeholder };
}
