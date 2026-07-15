import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Event, Payment } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useActivities } from "@/hooks/useActivities";
import { useBirthdaysData } from "@/hooks/useBirthdays";
import { useProfile } from "@/hooks/useProfile";

/**
 * Read-side lookup for payment ↔ activity/event/birthday links: resolves the
 * `activity_id` / `event_id` / `birthday_id` columns on a payment into a
 * displayable target (kind + name) for the "Povezano sa" rows.
 *
 * Activities and birthdays come from the existing family-wide caches (they're
 * few and always fetched wholesale). Events can't lean on `useEventsList` the
 * same way — its caches are windowed by `[from, to]`, and a linked event may
 * sit outside whatever window happens to be warm — so the hook batch-fetches
 * exactly the linked event ids in one query instead.
 */

export type PaymentLinkKind = "activity" | "event" | "birthday";

export interface PaymentLinkTarget {
  kind: PaymentLinkKind;
  id: string;
  name: string;
  /** The event's date (YYYY-MM-DD) — absent for activities, which have no single date. */
  date?: string;
}

async function fetchEventsByIds(ids: string[]): Promise<Event[]> {
  const { data, error } = await supabase.from("events").select("*").in("id", ids);
  if (error) return [];
  return (data as Event[]) ?? [];
}

export interface UsePaymentLinkTargetsResult {
  /**
   * Resolve one payment's link to its display target. Returns `null` when the
   * payment has no link OR the target hasn't loaded yet (callers just skip the
   * row — it appears on the next render).
   */
  targetFor: (
    payment: Pick<Payment, "activity_id" | "event_id" | "birthday_id">,
  ) => PaymentLinkTarget | null;
}

/**
 * Batch variant — mount ONCE per surface (page / dialog) and resolve every
 * row through `targetFor`, instead of one hook per row.
 */
export function usePaymentLinkTargets(
  payments: ReadonlyArray<Pick<Payment, "activity_id" | "event_id" | "birthday_id">>,
): UsePaymentLinkTargetsResult {
  const { familyId } = useProfile();
  const activitiesQuery = useActivities();
  const birthdaysQuery = useBirthdaysData();

  // Serialized so the query key stays stable across renders that rebuild the
  // payments array with the same links (same trick as PaymentForm's personSeed).
  const eventIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const p of payments) {
      if (p.event_id) ids.add(p.event_id);
    }
    return [...ids].sort().join(",");
  }, [payments]);

  const eventsQuery = useQuery({
    queryKey: ["events_by_id", familyId, eventIdsKey],
    queryFn: () => fetchEventsByIds(eventIdsKey.split(",")),
    enabled: !!familyId && eventIdsKey.length > 0,
  });

  const targetFor = useMemo(() => {
    const activitiesById = new Map((activitiesQuery.data ?? []).map((a) => [a.id, a]));
    const eventsById = new Map((eventsQuery.data ?? []).map((e) => [e.id, e]));
    const birthdaysById = new Map((birthdaysQuery.data ?? []).map((b) => [b.id, b]));
    return (
      payment: Pick<Payment, "activity_id" | "event_id" | "birthday_id">,
    ): PaymentLinkTarget | null => {
      if (payment.activity_id) {
        const activity = activitiesById.get(payment.activity_id);
        return activity ? { kind: "activity", id: activity.id, name: activity.name } : null;
      }
      if (payment.event_id) {
        const event = eventsById.get(payment.event_id);
        return event ? { kind: "event", id: event.id, name: event.name, date: event.date } : null;
      }
      if (payment.birthday_id) {
        const birthday = birthdaysById.get(payment.birthday_id);
        return birthday ? { kind: "birthday", id: birthday.id, name: birthday.name } : null;
      }
      return null;
    };
  }, [activitiesQuery.data, eventsQuery.data, birthdaysQuery.data]);

  return { targetFor };
}

/** Single-payment convenience for the detail dialogs. */
export function usePaymentLinkTarget(
  payment: Pick<Payment, "activity_id" | "event_id" | "birthday_id"> | null,
): PaymentLinkTarget | null {
  const paymentList = useMemo(() => (payment ? [payment] : []), [payment]);
  const { targetFor } = usePaymentLinkTargets(paymentList);
  return payment ? targetFor(payment) : null;
}
