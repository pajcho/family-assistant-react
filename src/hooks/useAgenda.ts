import { useMemo } from "react";

import type { Activity, Birthday, Event, Payment, Profile } from "@/types/database";
import { normalizeTime, resolveBlocksInRange, type ResolvedActivityBlock } from "@/utils/activity";
import { expandBirthdayOccurrences } from "@/utils/birthday";
import { expandPaymentOccurrences } from "@/utils/payment";
import { useActivities } from "@/hooks/useActivities";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useBirthdaysList } from "@/hooks/useBirthdays";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useEventsList } from "@/hooks/useEvents";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import { usePaymentsList } from "@/hooks/usePayments";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";

/**
 * Unified agenda layer — merges activities, events, payments and birthdays for
 * a date range `[from, to]` into one chronologically-sorted list, generalizing
 * the today-only merge that used to live in `DashboardTodayCard`.
 *
 * Both dashboard tabs consume this: "Danas" with `from === to === today`,
 * "Uskoro" with a growing `[tomorrow, horizon]` window. The Phase 4 calendar
 * will feed off the same layer.
 *
 * All recurrence is expanded client-side by the pure helpers in `utils/`
 * (`resolveBlocksInRange`, `expandPaymentOccurrences`, `expandBirthdayOccurrences`)
 * over data the underlying hooks already load wholesale — only the events query
 * is range-scoped, so growing the horizon costs at most one extra events fetch.
 */

/** Within-day ordering buckets, continuing the scheme from the old today card. */
const ALL_DAY_SORT_KEY = 24 * 60 + 1; // 1441 — after every timed minute of the day
const BIRTHDAY_SORT_KEY = ALL_DAY_SORT_KEY + 1; // 1442 — after all-day events
const PAYMENT_SORT_KEY = ALL_DAY_SORT_KEY + 2; // 1443 — at the very bottom

export type AgendaItem =
  | {
      kind: "activity";
      date: string;
      sortKey: number;
      block: ResolvedActivityBlock;
      person: Profile | undefined;
      activity: Activity | undefined;
    }
  | {
      kind: "event";
      date: string;
      sortKey: number;
      event: Event;
      isAllDay: boolean;
      personIds: string[];
    }
  | {
      kind: "payment";
      date: string;
      sortKey: number;
      payment: Payment;
      occurrenceDate: string;
      effectiveDate: string;
      personIds: string[];
    }
  | {
      kind: "birthday";
      date: string;
      sortKey: number;
      birthday: Birthday;
    };

/** Stable React key for an agenda row — unique per occurrence across kinds. */
export function agendaItemKey(item: AgendaItem): string {
  switch (item.kind) {
    case "activity":
      return `activity-${item.block.scheduleId}-${item.block.date}-${item.block.personId}`;
    case "event":
      return `event-${item.event.id}`;
    case "payment":
      return `payment-${item.payment.id}-${item.occurrenceDate}`;
    case "birthday":
      return `birthday-${item.birthday.id}-${item.date}`;
  }
}

export interface UseAgendaResult {
  /** Every item in range, sorted by (date, sortKey). */
  items: AgendaItem[];
  /** `YYYY-MM-DD` → that day's items (already sorted). */
  byDay: Map<string, AgendaItem[]>;
  /** Distinct days that have at least one item, ascending. */
  days: string[];
  isLoading: boolean;
}

function timeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function useAgenda({ from, to }: { from: string; to: string }): UseAgendaResult {
  // Activity inputs — same raw queries `useWeekActivities` composes.
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const overridesQuery = useActivityOverrides();
  const participantsQuery = useActivityParticipants();
  const { byPersonId: shiftAnchorsByPerson, isLoading: shiftsLoading } = useSchoolShiftAnchors();
  const { byId: peopleById } = useFamilyMembers();

  // Events are range-scoped at the query level; the rest load wholesale.
  const eventsQuery = useEventsList({ from, to });
  const { byEvent } = useEventParticipants();
  const paymentsQuery = usePaymentsList();
  const { byPayment } = usePaymentParticipants();
  const { byKey: paymentOverridesByKey } = usePaymentOverrides();
  const birthdaysQuery = useBirthdaysList();

  const activitiesById = useMemo(() => {
    const map = new Map<string, Activity>();
    for (const a of activitiesQuery.data ?? []) map.set(a.id, a);
    return map;
  }, [activitiesQuery.data]);

  const items = useMemo<AgendaItem[]>(() => {
    const out: AgendaItem[] = [];

    // ── Activities ──────────────────────────────────────────────────────
    const blocks = resolveBlocksInRange({
      from,
      to,
      activities: activitiesQuery.data ?? [],
      schedule: scheduleQuery.data ?? [],
      participants: participantsQuery.data ?? [],
      shiftAnchorsByPersonId: shiftAnchorsByPerson,
      overrides: overridesQuery.data ?? [],
    });
    for (const block of blocks) {
      // Show what actually happens: drop cancellations and moved-away ghosts
      // (the moved-here block surfaces on its new date). Mirrors the old
      // today-card rules.
      if (block.override?.action === "cancel") continue;
      if (block.override?.movedTo) continue;
      out.push({
        kind: "activity",
        date: block.date,
        sortKey: timeToMin(block.startTime),
        block,
        person: peopleById.get(block.personId),
        activity: activitiesById.get(block.activityId),
      });
    }

    // ── Events ──────────────────────────────────────────────────────────
    for (const event of eventsQuery.data ?? []) {
      if (event.canceled_at) continue;
      const startTime = event.start_time ? normalizeTime(event.start_time) : null;
      out.push({
        kind: "event",
        date: event.date,
        sortKey: startTime ? timeToMin(startTime) : ALL_DAY_SORT_KEY,
        event,
        isAllDay: !startTime,
        personIds: byEvent.get(event.id) ?? [],
      });
    }

    // ── Payments ────────────────────────────────────────────────────────
    // Paid / paused series are out (matches the today card + payments page);
    // the rest are projected into the window by effective date.
    for (const payment of paymentsQuery.data ?? []) {
      if (payment.is_paid || payment.is_paused) continue;
      for (const occ of expandPaymentOccurrences(payment, from, to, paymentOverridesByKey)) {
        out.push({
          kind: "payment",
          date: occ.effectiveDate,
          sortKey: PAYMENT_SORT_KEY,
          payment,
          occurrenceDate: occ.occurrenceDate,
          effectiveDate: occ.effectiveDate,
          personIds: byPayment.get(payment.id) ?? [],
        });
      }
    }

    // ── Birthdays ───────────────────────────────────────────────────────
    for (const birthday of birthdaysQuery.data ?? []) {
      for (const occ of expandBirthdayOccurrences(birthday, from, to)) {
        out.push({ kind: "birthday", date: occ.date, sortKey: BIRTHDAY_SORT_KEY, birthday });
      }
    }

    out.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.sortKey - b.sortKey));
    return out;
  }, [
    from,
    to,
    activitiesQuery.data,
    scheduleQuery.data,
    participantsQuery.data,
    overridesQuery.data,
    shiftAnchorsByPerson,
    peopleById,
    activitiesById,
    eventsQuery.data,
    byEvent,
    paymentsQuery.data,
    paymentOverridesByKey,
    byPayment,
    birthdaysQuery.data,
  ]);

  const { byDay, days } = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of items) {
      const arr = map.get(item.date);
      if (arr) arr.push(item);
      else map.set(item.date, [item]);
    }
    return { byDay: map, days: [...map.keys()].sort() };
  }, [items]);

  const isLoading =
    activitiesQuery.isLoading ||
    scheduleQuery.isLoading ||
    participantsQuery.isLoading ||
    overridesQuery.isLoading ||
    shiftsLoading ||
    eventsQuery.isLoading ||
    paymentsQuery.isLoading ||
    birthdaysQuery.isLoading;

  return { items, byDay, days, isLoading };
}
