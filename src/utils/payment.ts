import type { Payment, PaymentOverride, RecurrencePeriod } from "@/types/database";
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

/* ------------------------------------------------------------------------- */
/* Per-occurrence overrides — pure helpers                                   */
/*                                                                           */
/* Live next to the recurrence math (and free of React / Supabase) so the    */
/* unified `useAgenda` projection — and its unit tests — can read overrides   */
/* without dragging the `usePaymentOverrides` hook's Supabase client into a   */
/* non-React context. Re-exported from `@/hooks/usePaymentOverrides` for the  */
/* existing call sites.                                                       */
/* ------------------------------------------------------------------------- */

/** Override-map key: `${payment_id}|${occurrence_date}`. */
export function overrideKey(paymentId: string, occurrenceDate: string): string {
  return `${paymentId}|${occurrenceDate}`;
}

/**
 * The effective due date of a payment occurrence — the reschedule
 * `override_date` when moved, otherwise the original `dueDate`. Use this
 * wherever the UI decides "is it due today / soon" so a moved payment shows on
 * its new date.
 */
export function effectivePaymentDueDate(
  paymentId: string,
  dueDate: string,
  byKey: Map<string, PaymentOverride>,
): string {
  const ov = byKey.get(overrideKey(paymentId, dueDate));
  return ov?.action === "reschedule" && ov.override_date ? ov.override_date : dueDate;
}

/** True when the given occurrence has a cancel override. */
export function isPaymentOccurrenceCanceled(
  paymentId: string,
  dueDate: string,
  byKey: Map<string, PaymentOverride>,
): boolean {
  return byKey.get(overrideKey(paymentId, dueDate))?.action === "cancel";
}

/**
 * Whether a payment's CURRENT live occurrence is past due — unpaid, unpaused,
 * not canceled, and its effective due date is before `today` (YYYY-MM-DD).
 *
 * The live occurrence keys on `payment.due_date`, which advances as instalments
 * are paid/canceled, so an unpaid payment whose anchor already slipped into the
 * past is overdue. Reschedules move the effective date (a payment pushed to the
 * future is no longer overdue). Drives the dashboard "Prekoračeno" section —
 * past events/activities are NOT overdue, they simply happened.
 */
export function isPaymentOverdue(
  payment: Pick<Payment, "id" | "due_date" | "is_paid" | "is_paused">,
  byKey: Map<string, PaymentOverride>,
  today: string,
): boolean {
  if (payment.is_paid || payment.is_paused) return false;
  if (isPaymentOccurrenceCanceled(payment.id, payment.due_date, byKey)) return false;
  return effectivePaymentDueDate(payment.id, payment.due_date, byKey) < today;
}

/**
 * Whether a projected payment occurrence is a future repetition rather than the
 * series' live one. The live occurrence keys on `payment.due_date` — the next
 * unpaid instalment, which advances as occurrences are paid/canceled — and stays
 * fully actionable in the agenda; every later occurrence renders read-only
 * ("Nadolazeće"). Mirrors the payments page, where only the live `due_date` row
 * carries actions and the rest are synthetic "upcoming" rows.
 *
 * Deliberately occurrence-based, NOT date-based: the live occurrence is editable
 * even when its due date is still in the future (e.g. due tomorrow). The agenda
 * previously compared the effective date to "today", which wrongly locked the
 * first/next instalment before it came due.
 */
export function isUpcomingPaymentOccurrence(occurrence: {
  occurrenceDate: string;
  payment: Pick<Payment, "due_date">;
}): boolean {
  return occurrence.occurrenceDate !== occurrence.payment.due_date;
}

export interface PaymentOccurrence {
  /** The original projected due date this occurrence keys on (YYYY-MM-DD). */
  occurrenceDate: string;
  /** Where it actually falls — the reschedule `override_date` if moved, else `occurrenceDate`. */
  effectiveDate: string;
}

/**
 * Enumerate a payment's occurrences whose EFFECTIVE date lands within
 * `[from, to]` (inclusive, YYYY-MM-DD). Walks forward from the live `due_date`
 * by the recurrence step — mirroring `nextPaymentOccurrenceDate` / mark-paid:
 * weekly → +N weeks, monthly → +N months, limited → +1 month for up to
 * `remaining_occurrences`, one-time → a single occurrence. Each occurrence's
 * per-instance override is applied: a `cancel` drops it, a `reschedule` moves
 * its effective date.
 *
 * Pure (no React / Supabase) so the unified `useAgenda` layer — and the Phase 4
 * calendar — can project payments across a range and unit-test the walk.
 * Bucketed by `effectiveDate`, so a payment moved inside the window surfaces on
 * its new day. Known edge: an occurrence whose ORIGINAL date sits just past
 * `to` but is rescheduled INTO the window won't appear — reschedules are capped
 * at "the day before the next occurrence", so the gap is at most one step.
 */
export function expandPaymentOccurrences(
  payment: Pick<
    Payment,
    "id" | "due_date" | "recurrence_period" | "recurrence_interval" | "remaining_occurrences"
  >,
  from: string,
  to: string,
  overridesByKey: Map<string, PaymentOverride>,
): PaymentOccurrence[] {
  const period = payment.recurrence_period;
  const interval = Math.max(1, payment.recurrence_interval ?? 1);

  // Step to the next occurrence, or null when the series has just one.
  const step = (date: string): string | null => {
    if (period === "weekly") return addWeek(date, interval);
    if (period === "monthly") return addMonth(date, interval);
    if (period === "limited") return addMonth(date); // monthly cadence; interval ignored
    return null; // one-time / null
  };

  // `limited` has a fixed instalment count starting at due_date; everything
  // else just walks until it passes `to`.
  let remaining =
    period === "limited"
      ? Math.max(1, payment.remaining_occurrences ?? 1)
      : Number.POSITIVE_INFINITY;

  const out: PaymentOccurrence[] = [];
  let cur: string | null = payment.due_date;
  while (cur !== null && cur <= to && remaining > 0) {
    const ov = overridesByKey.get(overrideKey(payment.id, cur));
    if (ov?.action !== "cancel") {
      const effectiveDate =
        ov?.action === "reschedule" && ov.override_date ? ov.override_date : cur;
      if (effectiveDate >= from && effectiveDate <= to) {
        out.push({ occurrenceDate: cur, effectiveDate });
      }
    }
    remaining -= 1;
    cur = step(cur);
  }

  return out;
}
