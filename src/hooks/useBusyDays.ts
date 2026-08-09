import { useMemo } from "react";

import { useBirthdaysList } from "@/hooks/useBirthdays";
import { useEventsList } from "@/hooks/useEvents";
import { usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import { usePaymentsList } from "@/hooks/usePayments";
import { expandPaymentOccurrences } from "@/utils/payment";
import { shiftIsoByDays } from "@/utils/pickerGrid";

/**
 * "How full is this day" for the date picker's occupancy dots. Deliberately a
 * cheap projection - events (span-aware), payment occurrences and birthday
 * anniversaries - rather than the full `useAgenda` pipeline: the picker only
 * needs a hint, and mounting a second agenda is expensive (see the project's
 * "one useAgenda at a time" note).
 *
 * All three underlying queries are the app's shared, already-cached lists, so
 * opening a picker normally costs nothing extra.
 */
export type BusyDays = ReadonlyMap<string, number>;

const EMPTY: BusyDays = new Map();
const NONE: never[] = [];

/** Annual recurrence: does `birthDate`'s day-of-year fall inside [from, to]? */
function birthdayHitsInRange(birthDate: string, from: string, to: string): string[] {
  const mmdd = birthDate.slice(5);
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const hits: string[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    const iso = `${year}-${mmdd}`;
    if (iso >= from && iso <= to) hits.push(iso);
  }
  return hits;
}

export function useBusyDays(from: string | null, to: string | null, enabled = true): BusyDays {
  const active = enabled && !!from && !!to;
  // The gate has to be passed explicitly. An empty filter object is NOT a gate:
  // it just asked for the whole events table instead, unfiltered - and every
  // mounted DateField holds one of these, so a dozen closed pickers were a
  // dozen full-table fetches. Keep the real range in the key across the flip.
  const eventsQuery = useEventsList({
    from: from ?? undefined,
    to: to ?? undefined,
    enabled: active,
  });
  const paymentsQuery = usePaymentsList();
  const birthdaysQuery = useBirthdaysList();
  const { byKey } = usePaymentOverrides();

  const events = active ? (eventsQuery.data ?? NONE) : NONE;
  const payments = active ? (paymentsQuery.data ?? NONE) : NONE;
  const birthdays = active ? (birthdaysQuery.data ?? NONE) : NONE;

  return useMemo(() => {
    if (!active || !from || !to) return EMPTY;
    const counts = new Map<string, number>();
    const bump = (iso: string) => {
      if (iso < from || iso > to) return;
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
    };

    for (const event of events) {
      if (event.canceled_at) continue;
      // Multi-day events mark every day of their span (the agenda's
      // `eventDaySlices` behaviour, reduced to a dot per day).
      let day: string | null = event.date;
      const last = event.end_date ?? event.date;
      let guard = 0;
      while (day && day <= last && guard < 400) {
        bump(day);
        day = shiftIsoByDays(day, 1);
        guard += 1;
      }
    }

    for (const payment of payments) {
      for (const occurrence of expandPaymentOccurrences(payment, from, to, byKey)) {
        bump(occurrence.effectiveDate);
      }
    }

    for (const birthday of birthdays) {
      for (const iso of birthdayHitsInRange(birthday.birth_date, from, to)) bump(iso);
    }

    return counts;
  }, [active, from, to, events, payments, birthdays, byKey]);
}
