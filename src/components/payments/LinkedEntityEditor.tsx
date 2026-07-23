import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog";
import type { ActivityFormPayload } from "@/components/activities/ActivityForm";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import type { EventFormPayload } from "@/components/events/EventForm";
import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import type { BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import { useActivities, useUpdateActivity } from "@/hooks/useActivities";
import {
  useActivityParticipants,
  useReplaceActivityParticipants,
} from "@/hooks/useActivityParticipants";
import { useActivitySchedule, useReplaceActivitySchedule } from "@/hooks/useActivitySchedule";
import { useBirthdaysData, useUpdateBirthday } from "@/hooks/useBirthdays";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { useUpdateEvent } from "@/hooks/useEvents";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useProfile } from "@/hooks/useProfile";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { hasPaymentHistory, useUpdatePayment } from "@/hooks/usePayments";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import type { Event, Payment } from "@/types/database";
import { supabase } from "@/lib/supabase";

/**
 * In-place edit dialog for an entity referenced from somewhere else - a
 * payment's "Povezano sa" chip, or a global-search hit. Instead of navigating
 * to the entity's page, the caller mounts this and the edit form opens right
 * where the user is.
 *
 * Renders nothing until `target` is set, so the data hooks below only fire
 * once actually opened (the inner component mounts lazily).
 */
export type EditableEntityRef = {
  kind: "activity" | "event" | "birthday" | "payment";
  id: string;
};

export type LinkedEntityEditorProps = {
  target: EditableEntityRef | null;
  onClose: () => void;
};

export function LinkedEntityEditor({ target, onClose }: LinkedEntityEditorProps) {
  if (!target) return null;
  if (target.kind === "activity") return <ActivityLinkEditor id={target.id} onClose={onClose} />;
  if (target.kind === "event") return <EventLinkEditor id={target.id} onClose={onClose} />;
  if (target.kind === "payment") return <PaymentEditor id={target.id} onClose={onClose} />;
  return <BirthdayLinkEditor id={target.id} onClose={onClose} />;
}

type EditorProps = { id: string; onClose: () => void };

/** Mirrors the /activities page edit wiring (update + rules + participants). */
function ActivityLinkEditor({ id, onClose }: EditorProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const { profile } = useProfile();
  const { members } = useFamilyMembers();
  const activitiesQuery = useActivities();
  const scheduleQuery = useActivitySchedule();
  const participantsQuery = useActivityParticipants();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();

  const updateActivity = useUpdateActivity();
  const replaceSchedule = useReplaceActivitySchedule();
  const replaceParticipants = useReplaceActivityParticipants();

  const activity = (activitiesQuery.data ?? []).find((a) => a.id === id) ?? null;
  const existingRules = useMemo(
    () => (scheduleQuery.data ?? []).filter((rule) => rule.activity_id === id),
    [scheduleQuery.data, id],
  );
  const existingPersonIds = useMemo(
    () =>
      (participantsQuery.data ?? []).filter((p) => p.activity_id === id).map((p) => p.person_id),
    [participantsQuery.data, id],
  );
  const peopleWithShift = useMemo(() => {
    const set = new Set<string>();
    for (const [personId, anchor] of anchorsByPersonId) {
      if (anchor.is_alternating) set.add(personId);
    }
    return set;
  }, [anchorsByPersonId]);

  const handleSubmit = async (payload: ActivityFormPayload) => {
    setFormError(null);
    try {
      const { rules, person_ids, ...activityPayload } = payload;
      await updateActivity.mutateAsync({ id, payload: activityPayload });
      await replaceSchedule.mutateAsync({ activityId: id, rules });
      await replaceParticipants.mutateAsync({ activityId: id, personIds: person_ids });
      onClose();
    } catch (err) {
      const fallback = "Greška pri ažuriranju aktivnosti";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  // Wait for the activity + its rules/participants so the form opens filled.
  const loading =
    activitiesQuery.isLoading || scheduleQuery.isLoading || participantsQuery.isLoading;
  if (loading || !activity) return null;

  return (
    <ActivityFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      activity={activity}
      existingRules={existingRules}
      existingPersonIds={existingPersonIds}
      people={members}
      peopleWithShift={peopleWithShift}
      defaultPersonId={profile?.id ?? null}
      error={formError}
      saving={
        updateActivity.isPending || replaceSchedule.isPending || replaceParticipants.isPending
      }
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}

function EventLinkEditor({ id, onClose }: EditorProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const { familyId } = useProfile();
  const { byEvent } = useEventParticipants();
  const updateEvent = useUpdateEvent();

  // By-id fetch: the linked event can be outside any warm list window.
  const eventQuery = useQuery({
    queryKey: ["events_by_id", familyId, id],
    queryFn: async (): Promise<Event | null> => {
      const { data, error } = await supabase.from("events").select("*").eq("id", id).single();
      if (error || !data) return null;
      return data as Event;
    },
    enabled: !!familyId,
  });

  const event = eventQuery.data ?? null;

  const handleSubmit = async (payload: EventFormPayload) => {
    setFormError(null);
    try {
      await updateEvent.mutateAsync({ id, payload });
      onClose();
    } catch (err) {
      const fallback = "Greška pri ažuriranju događaja";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  if (!event) return null;

  return (
    <EventFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      event={event}
      initialPersonIds={byEvent.get(id) ?? []}
      error={formError}
      saving={updateEvent.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}

/** Mirrors the /payments page edit wiring (by-id fetch + hasHistory check). */
function PaymentEditor({ id, onClose }: EditorProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const { familyId } = useProfile();
  const { byPayment } = usePaymentParticipants();
  const updatePayment = useUpdatePayment();

  const paymentQuery = useQuery({
    queryKey: ["payment_by_id", familyId, id],
    queryFn: async (): Promise<Payment | null> => {
      const { data, error } = await supabase.from("payments").select("*").eq("id", id).single();
      if (error || !data) return null;
      return data as Payment;
    },
    enabled: !!familyId,
  });
  const payment = paymentQuery.data ?? null;

  // Recurrence radios lock once real history exists (same as /payments).
  useEffect(() => {
    let alive = true;
    void hasPaymentHistory(id).then((exists) => {
      if (alive) setHasHistory(exists);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const handleSubmit = async (payload: PaymentFormPayload) => {
    setFormError(null);
    try {
      await updatePayment.mutateAsync({ id, payload });
      onClose();
    } catch (err) {
      const fallback = "Greška pri izmeni plaćanja";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  if (!payment) return null;

  return (
    <PaymentFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      payment={payment}
      initialPersonIds={byPayment.get(id) ?? []}
      hasHistory={hasHistory}
      error={formError}
      saving={updatePayment.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}

function BirthdayLinkEditor({ id, onClose }: EditorProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const { data: birthdays, isLoading } = useBirthdaysData();
  const updateBirthday = useUpdateBirthday();

  const birthday = (birthdays ?? []).find((b) => b.id === id) ?? null;

  const handleSubmit = async (payload: BirthdayFormPayload) => {
    setFormError(null);
    try {
      await updateBirthday.mutateAsync({ id, payload });
      onClose();
    } catch (err) {
      const fallback = "Greška pri ažuriranju rođendana";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  if (isLoading || !birthday) return null;

  return (
    <BirthdayFormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      birthday={birthday}
      error={formError}
      saving={updateBirthday.isPending}
      onSubmit={(payload) => {
        void handleSubmit(payload);
      }}
    />
  );
}
