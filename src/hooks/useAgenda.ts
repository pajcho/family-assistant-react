import { useMemo } from "react";

import type {
  Activity,
  Birthday,
  Event,
  ExternalCalendarEvent,
  Payment,
  Profile,
} from "@/types/database";
import { normalizeTime, resolveBlocksInRange, type ResolvedActivityBlock } from "@/utils/activity";
import { expandBirthdayOccurrences } from "@/utils/birthday";
import { eventDaySlices } from "@/utils/event";
import { expandPaymentOccurrences } from "@/utils/payment";
import { useActivities } from "@/hooks/useActivities";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useBirthdaysList } from "@/hooks/useBirthdays";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useEventsList } from "@/hooks/useEvents";
import { useExternalEventsList } from "@/hooks/useExternalEvents";
import { useExternalEventLocal } from "@/hooks/useExternalEventLocal";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import { usePaymentsList } from "@/hooks/usePayments";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";

/**
 * Unified agenda layer - merges activities, events, payments and birthdays for
 * a date range `[from, to]` into one chronologically-sorted list, generalizing
 * the today-only merge that used to live in `DashboardTodayCard`.
 *
 * Both dashboard tabs consume this: "Danas" with `from === to === today`,
 * "Uskoro" with a growing `[tomorrow, horizon]` window. The Phase 4 calendar
 * will feed off the same layer.
 *
 * All recurrence is expanded client-side by the pure helpers in `utils/`
 * (`resolveBlocksInRange`, `expandPaymentOccurrences`, `expandBirthdayOccurrences`)
 * over data the underlying hooks already load wholesale - only the events query
 * is range-scoped, so growing the horizon costs at most one extra events fetch.
 */

/** Within-day ordering buckets, continuing the scheme from the old today card. */
const ALL_DAY_SORT_KEY = 24 * 60 + 1; // 1441 - after every timed minute of the day
const BIRTHDAY_SORT_KEY = ALL_DAY_SORT_KEY + 1; // 1442 - after all-day events
const PAYMENT_SORT_KEY = ALL_DAY_SORT_KEY + 2; // 1443 - at the very bottom

export type AgendaItem =
  | {
      kind: "activity";
      date: string;
      sortKey: number;
      block: ResolvedActivityBlock;
      person: Profile | undefined;
      activity: Activity | undefined;
      /**
       * A parent cancelled THIS occurrence. Only ever true when the caller
       * asked for `includeCanceled` - everywhere else these are dropped, so
       * the field reads as `false` and no renderer has to think about it.
       */
      canceled: boolean;
    }
  | {
      kind: "event";
      date: string;
      sortKey: number;
      event: Event;
      isAllDay: boolean;
      /**
       * THIS day's slice of the event (normalized HH:mm) - for a multi-day
       * span only the first day carries `startTime` and only the last day
       * `endTime`, so continuation days land in the all-day row. Single-day
       * events carry their times verbatim. Renderers must read these, not
       * `event.start_time`/`event.end_time`.
       */
      startTime: string | null;
      endTime: string | null;
      /** 1-based day position within the span - `1/1` for single-day events. */
      dayIndex: number;
      totalDays: number;
      personIds: string[];
      /** The event carries `canceled_at`. See the activity arm's note. */
      canceled: boolean;
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
    }
  | {
      kind: "external";
      date: string;
      sortKey: number;
      event: ExternalCalendarEvent;
      isAllDay: boolean;
      personIds: string[];
    };

/** Stable React key for an agenda row - unique per occurrence across kinds. */
export function agendaItemKey(item: AgendaItem): string {
  switch (item.kind) {
    case "activity":
      return `activity-${item.block.scheduleId}-${item.block.date}-${item.block.personId}`;
    case "event":
      // Date suffix: a multi-day event expands into one item per covered day.
      return `event-${item.event.id}-${item.date}`;
    case "payment":
      return `payment-${item.payment.id}-${item.occurrenceDate}`;
    case "birthday":
      return `birthday-${item.birthday.id}-${item.date}`;
    case "external":
      return `external-${item.event.id}`;
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

/** True for an occurrence a parent cancelled - the only kinds that can be. */
export function isCanceledAgendaItem(item: AgendaItem): boolean {
  return (item.kind === "activity" || item.kind === "event") && item.canceled;
}

export interface UseAgendaOptions {
  /** Inclusive window start, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive window end, `YYYY-MM-DD`. */
  to: string;
  /**
   * Keep cancelled occurrences in the output, flagged `canceled: true`, instead
   * of dropping them (the default).
   *
   * Off for the whole grown-up app on purpose: a parent DID the cancelling, so
   * the thing disappearing is the expected outcome, and every count, calendar
   * cell and week column stays exactly as it was. The kid shell turns it on,
   * because a child is a passive reader - to them a cancellation is news, and a
   * row that silently vanishes reads as "I must have misremembered".
   *
   * Moved-away ghosts are dropped either way: the occurrence surfaces at its new
   * date, and a second row at the old time would say the opposite of the truth.
   */
  includeCanceled?: boolean;
}

export function useAgenda({
  from,
  to,
  includeCanceled = false,
}: UseAgendaOptions): UseAgendaResult {
  // Activity inputs - same raw queries `useWeekActivities` composes.
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const overridesQuery = useActivityOverrides();
  const participantsQuery = useActivityParticipants();
  const { byPersonId: shiftAnchorsByPerson, isLoading: shiftsLoading } = useSchoolShiftAnchors();
  const { byId: peopleById } = useFamilyMembers();

  // Events are range-scoped at the query level; the rest load wholesale.
  const eventsQuery = useEventsList({ from, to });
  // Mirrored Google events are range-scoped on local_date, same as events.
  const externalQuery = useExternalEventsList({ from, to });
  // Local enrichment (assignment / reminder) merged in by ical_uid.
  const { byUid: externalLocalByUid } = useExternalEventLocal();
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
      // Show what actually happens: drop moved-away ghosts (the moved-here
      // block surfaces on its new date), and drop cancellations unless the
      // caller asked to be told about them. Mirrors the old today-card rules.
      const canceled = block.override?.action === "cancel";
      if (canceled && !includeCanceled) continue;
      if (block.override?.movedTo) continue;
      out.push({
        kind: "activity",
        date: block.date,
        // Cancelled or not, it keeps its slot: a struck-through row where the
        // child expects it is the whole point of showing it.
        sortKey: timeToMin(block.startTime),
        block,
        person: peopleById.get(block.personId),
        activity: activitiesById.get(block.activityId),
        canceled,
      });
    }

    // ── Events ──────────────────────────────────────────────────────────
    // Multi-day events expand into one item per covered day (clamped to the
    // window), the same way the gcal sync expands Google events into per-day
    // rows: day 1 timed (when it has a start), the rest all-day continuations.
    for (const event of eventsQuery.data ?? []) {
      const canceled = Boolean(event.canceled_at);
      if (canceled && !includeCanceled) continue;
      for (const slice of eventDaySlices(event, from, to)) {
        const startTime = slice.startTime ? normalizeTime(slice.startTime) : null;
        out.push({
          kind: "event",
          date: slice.date,
          sortKey: startTime ? timeToMin(startTime) : ALL_DAY_SORT_KEY,
          event,
          isAllDay: !startTime,
          startTime,
          endTime: slice.endTime ? normalizeTime(slice.endTime) : null,
          dayIndex: slice.dayIndex,
          totalDays: slice.totalDays,
          personIds: byEvent.get(event.id) ?? [],
          canceled,
        });
      }
    }

    // ── External (Google) events ────────────────────────────────────────
    // Read-only mirror; declined/cancelled were already dropped at sync time.
    for (const ext of externalQuery.data ?? []) {
      const startTime = ext.start_time ? normalizeTime(ext.start_time) : null;
      const local = ext.ical_uid ? externalLocalByUid.get(ext.ical_uid) : undefined;
      const assigned = local?.assigned_person_id ?? null;
      out.push({
        kind: "external",
        date: ext.local_date,
        sortKey: startTime ? timeToMin(startTime) : ALL_DAY_SORT_KEY,
        event: {
          ...ext,
          assigned_person_id: assigned,
          remind_minutes_before: local?.remind_minutes_before ?? null,
        },
        isAllDay: ext.is_all_day || !startTime,
        personIds: assigned ? [assigned] : [],
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
    includeCanceled,
    activitiesQuery.data,
    scheduleQuery.data,
    participantsQuery.data,
    overridesQuery.data,
    shiftAnchorsByPerson,
    peopleById,
    activitiesById,
    eventsQuery.data,
    externalQuery.data,
    externalLocalByUid,
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
    externalQuery.isLoading ||
    paymentsQuery.isLoading ||
    birthdaysQuery.isLoading;

  return { items, byDay, days, isLoading };
}
