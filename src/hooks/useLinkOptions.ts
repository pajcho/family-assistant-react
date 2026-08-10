import { useMemo } from "react";
import { format } from "date-fns";

import type { ActivitySchedule } from "@/types/database";
import type { PaymentLinkKind } from "@/hooks/usePaymentLinks";
import { useActivities } from "@/hooks/useActivities";
import { useActivityOverrides } from "@/hooks/useActivityOverrides";
import { useActivityParticipants } from "@/hooks/useActivityParticipants";
import { useActivitySchedule } from "@/hooks/useActivitySchedule";
import { useBirthdaysData } from "@/hooks/useBirthdays";
import { useEventsList } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useToday } from "@/hooks/useToday";
import { activityScheduleLabel, normalizeTime, resolveBlocksInRange } from "@/utils/activity";
import { daysUntilBirthday, nextBirthdayDate } from "@/utils/birthday";
import { subtractMonth } from "@/utils/date";
import {
  rankLinkSuggestions,
  type CandidateSlot,
  type LinkSuggestion,
  type SuggestionContext,
} from "@/utils/linkSuggestions";

/**
 * The pickable link-to targets, and the ranked subset of them the forms
 * offer up front.
 *
 * Split out of `PaymentLinkField` so the suggestion layer sits with the other
 * data hooks instead of inside a component (and so the picker sheet, the
 * combobox and the receipt preview all read the same list).
 */

export type LinkOption = {
  kind: PaymentLinkKind;
  id: string;
  name: string;
  /** Events: first day of the span. Birthdays: the next occurrence. */
  date?: string;
  /** Events: inclusive last day of a multi-day span. */
  endDate?: string | null;
  /** Events: span-edge times ("HH:MM"), both nullable for all-day events. */
  startTime?: string | null;
  endTime?: string | null;
  /**
   * Assigned family members - shown as badges so same-named activities/events
   * for DIFFERENT members are tellable apart ("Engleski" for Nikola vs Sonja).
   */
  personIds: string[];
  /**
   * Activities: the termini that fire on the suggestion context's date. Only
   * filled by {@link useLinkSuggestions}; the plain option list leaves it out.
   */
  daySlots?: ReadonlyArray<CandidateSlot>;
  /** Activities: their weekly shape, so a picker row is not just a name. */
  scheduleLabel?: string | null;
};

/** How far back the event options reach - recent past + everything upcoming. */
export const EVENT_LOOKBACK_MONTHS = 3;

/** Every link kind, and the default for pickers that do not narrow it. */
export const ALL_LINK_KINDS: ReadonlyArray<PaymentLinkKind> = ["activity", "event", "birthday"];

/**
 * The pickable link targets, merged and ordered: ALL activities (they're few),
 * events from the last {@link EVENT_LOOKBACK_MONTHS} months onward (canceled
 * ones dropped - linking to something that isn't happening is never the
 * intent), then birthdays soonest-first. Shared by the desktop combobox and
 * the mobile picker sheet.
 */
export function usePaymentLinkOptions(
  kinds: ReadonlyArray<PaymentLinkKind> = ALL_LINK_KINDS,
): LinkOption[] {
  const today = useToday();
  const activitiesQuery = useActivities();
  const activityParticipantsQuery = useActivityParticipants();
  const eventsQuery = useEventsList({ from: subtractMonth(today.str, EVENT_LOOKBACK_MONTHS) });
  const { byEvent } = useEventParticipants();
  const birthdaysQuery = useBirthdaysData();
  const scheduleQuery = useActivitySchedule();

  // activity_id → assigned person ids (siblings can share one activity name).
  const byActivity = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of activityParticipantsQuery.data ?? []) {
      const list = m.get(row.activity_id);
      if (list) list.push(row.person_id);
      else m.set(row.activity_id, [row.person_id]);
    }
    return m;
  }, [activityParticipantsQuery.data]);

  // activity_id → its weekly termini, for the row's "Pon, Sre · 17:00" line.
  const rulesByActivity = useMemo(() => {
    const m = new Map<string, ActivitySchedule[]>();
    for (const rule of scheduleQuery.data ?? []) {
      const list = m.get(rule.activity_id);
      if (list) list.push(rule);
      else m.set(rule.activity_id, [rule]);
    }
    return m;
  }, [scheduleQuery.data]);

  const kindsKey = kinds.join(",");
  return useMemo<LinkOption[]>(() => {
    const wanted = new Set(kindsKey.split(","));
    const activities = wanted.has("activity")
      ? (activitiesQuery.data ?? []).map(
          (a): LinkOption => ({
            kind: "activity",
            id: a.id,
            name: a.name,
            personIds: byActivity.get(a.id) ?? [],
            scheduleLabel: activityScheduleLabel(rulesByActivity.get(a.id) ?? []),
          }),
        )
      : [];
    const events = wanted.has("event")
      ? (eventsQuery.data ?? [])
          .filter((e) => !e.canceled_at)
          .map(
            (e): LinkOption => ({
              kind: "event",
              id: e.id,
              name: e.name,
              date: e.date,
              endDate: e.end_date,
              startTime: normalizeTime(e.start_time) || null,
              endTime: normalizeTime(e.end_time) || null,
              personIds: byEvent.get(e.id) ?? [],
            }),
          )
      : [];
    const birthdays = wanted.has("birthday")
      ? [...(birthdaysQuery.data ?? [])]
          .sort((a, b) => daysUntilBirthday(a.birth_date) - daysUntilBirthday(b.birth_date))
          .map(
            (b): LinkOption => ({
              kind: "birthday",
              id: b.id,
              name: b.name,
              date: format(nextBirthdayDate(b.birth_date), "yyyy-MM-dd"),
              personIds: [],
            }),
          )
      : [];
    return [...activities, ...events, ...birthdays];
  }, [
    kindsKey,
    activitiesQuery.data,
    eventsQuery.data,
    birthdaysQuery.data,
    byActivity,
    byEvent,
    rulesByActivity,
  ]);
}

/**
 * The ranked suggestions for a money entry being added - see
 * `utils/linkSuggestions` for the signals and how they are weighted.
 *
 * Activity termini are resolved here (the ranker is pure and can't query):
 * exactly the context date is projected through `resolveBlocksInRange`, and
 * canceled / moved-away occurrences are dropped so a termin that isn't
 * actually happening never argues for a link. Pass `null` to switch the whole
 * thing off (edit mode - an entry's name matching its own link is noise).
 */
export function useLinkSuggestions(
  context: SuggestionContext | null | undefined,
  kinds: ReadonlyArray<PaymentLinkKind> = ALL_LINK_KINDS,
  limit = 3,
): LinkSuggestion<LinkOption>[] {
  const options = usePaymentLinkOptions(kinds);
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const participantsQuery = useActivityParticipants();
  const overridesQuery = useActivityOverrides();
  const { byPersonId: shiftAnchorsByPersonId } = useSchoolShiftAnchors();

  // A null context means "no suggestions" (edit mode): every signal goes null,
  // and a context with nothing in it can't match anything by construction.
  const name = context?.name ?? null;
  const date = context?.date?.trim() || null;
  const time = context?.time ?? null;
  const wantsActivities = kinds.includes("activity");

  // activity_id → the termini running on `date`, deduped by time (siblings in
  // one activity share a termin and must not double it in the label).
  const slotsByActivity = useMemo(() => {
    const map = new Map<string, CandidateSlot[]>();
    if (!date || !wantsActivities) return map;
    const blocks = resolveBlocksInRange({
      from: date,
      to: date,
      activities: activitiesQuery.data ?? [],
      schedule: scheduleQuery.data ?? [],
      participants: participantsQuery.data ?? [],
      shiftAnchorsByPersonId,
      overrides: overridesQuery.data ?? [],
    });
    for (const block of blocks) {
      // A canceled termin and the ghost a reschedule left behind are both
      // "did not happen here" - only real occurrences count as evidence.
      if (block.override?.action === "cancel" || block.override?.movedTo) continue;
      const slots = map.get(block.activityId) ?? [];
      const startTime = normalizeTime(block.startTime);
      const endTime = normalizeTime(block.endTime);
      if (!slots.some((s) => s.startTime === startTime && s.endTime === endTime)) {
        slots.push({ startTime, endTime });
      }
      map.set(block.activityId, slots);
    }
    for (const slots of map.values()) slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [
    date,
    wantsActivities,
    activitiesQuery.data,
    scheduleQuery.data,
    participantsQuery.data,
    overridesQuery.data,
    shiftAnchorsByPersonId,
  ]);

  return useMemo(() => {
    const candidates = options.map((option) =>
      option.kind === "activity"
        ? { ...option, daySlots: slotsByActivity.get(option.id) ?? [] }
        : option,
    );
    return rankLinkSuggestions(candidates, { name, date, time }, limit);
  }, [options, slotsByActivity, name, date, time, limit]);
}
