import { useState } from "react";
import type { ReactNode } from "react";

import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import type { EventFormPayload } from "@/components/events/EventForm";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import type { AgendaItem } from "@/hooks/useAgenda";
import { useCreateBirthday, useUpdateBirthday } from "@/hooks/useBirthdays";
import { useCreateEvent, useUpdateEvent } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { hasPaymentHistory, useCreatePayment, useUpdatePayment } from "@/hooks/usePayments";
import type { Birthday, Event, Payment } from "@/types/database";

/**
 * Everything an agenda surface needs to be interactive: tapping a row opens the
 * shared detail sheet, and "Izmeni" from there opens the entity's form - all
 * without leaving the screen.
 *
 * Extracted so Danas, Kalendar and any future agenda view share one copy of the
 * wiring (mutations, prefill lookups, per-form error state) instead of each
 * route repeating ~150 lines of it.
 *
 * Add flows are exposed too, for the surfaces that offer them inline ("Prvi
 * koraci" leads straight into an empty event/payment form). Everything else
 * adds through the global "+" in the bottom bar.
 */
export interface UseAgendaSurfaceResult {
  /** Row click handler - opens the matching detail sheet. */
  onSelect: (item: AgendaItem) => void;
  /** Mount once, anywhere in the screen. */
  dialogs: ReactNode;
  openAddEvent: () => void;
  openAddPayment: () => void;
}

export function useAgendaSurface(): UseAgendaSurfaceResult {
  // Participant maps - only needed to prefill the edit forms.
  const { byEvent: eventParticipantsByEvent } = useEventParticipants();
  const { byPayment: paymentParticipantsByPayment } = usePaymentParticipants();

  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const createBirthday = useCreateBirthday();
  const updateBirthday = useUpdateBirthday();

  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentHasHistory, setPaymentHasHistory] = useState(false);

  const [birthdayDialogOpen, setBirthdayDialogOpen] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<Birthday | null>(null);
  const [birthdayError, setBirthdayError] = useState<string | null>(null);

  const openAddEvent = () => {
    setEditingEvent(null);
    setEventError(null);
    setEventDialogOpen(true);
  };

  const openAddPayment = () => {
    setEditingPayment(null);
    setPaymentHasHistory(false);
    setPaymentError(null);
    setPaymentDialogOpen(true);
  };

  const openEditEvent = (event: Event) => {
    setEditingEvent(event);
    setEventError(null);
    setEventDialogOpen(true);
  };

  const openEditPayment = async (payment: Payment) => {
    setEditingPayment(payment);
    setPaymentError(null);
    // The PaymentForm disables the recurrence radios when history exists. Look
    // it up before opening so the radios start correctly.
    setPaymentHasHistory(await hasPaymentHistory(payment.id));
    setPaymentDialogOpen(true);
  };

  const openEditBirthday = (birthday: Birthday) => {
    setEditingBirthday(birthday);
    setBirthdayError(null);
    setBirthdayDialogOpen(true);
  };

  const { onSelect, dialogs: detailDialogs } = useAgendaDetails({
    onEditEvent: openEditEvent,
    onEditPayment: (payment) => {
      void openEditPayment(payment);
    },
    onEditBirthday: openEditBirthday,
  });

  const handleEventSubmit = async (payload: EventFormPayload) => {
    setEventError(null);
    try {
      if (editingEvent) await updateEvent.mutateAsync({ id: editingEvent.id, payload });
      else await createEvent.mutateAsync(payload);
      setEventDialogOpen(false);
      setEditingEvent(null);
    } catch (err) {
      const fallback = editingEvent
        ? "Greška pri ažuriranju događaja"
        : "Greška pri kreiranju događaja";
      setEventError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handlePaymentSubmit = async (payload: PaymentFormPayload) => {
    setPaymentError(null);
    try {
      if (editingPayment) await updatePayment.mutateAsync({ id: editingPayment.id, payload });
      else
        await createPayment.mutateAsync({
          ...payload,
          is_recurring: payload.recurrence_period !== "one-time",
        });
      setPaymentDialogOpen(false);
      setEditingPayment(null);
    } catch (err) {
      const fallback = editingPayment
        ? "Greška pri ažuriranju plaćanja"
        : "Greška pri kreiranju plaćanja";
      setPaymentError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handleBirthdaySubmit = async (payload: BirthdayFormPayload) => {
    setBirthdayError(null);
    try {
      if (editingBirthday) await updateBirthday.mutateAsync({ id: editingBirthday.id, payload });
      else await createBirthday.mutateAsync(payload);
      setBirthdayDialogOpen(false);
      setEditingBirthday(null);
    } catch (err) {
      const fallback = editingBirthday
        ? "Greška pri ažuriranju rođendana"
        : "Greška pri kreiranju rođendana";
      setBirthdayError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const dialogs = (
    <>
      {detailDialogs}

      <EventFormDialog
        open={eventDialogOpen}
        onOpenChange={(open) => {
          setEventDialogOpen(open);
          if (!open) {
            setEditingEvent(null);
            setEventError(null);
          }
        }}
        event={editingEvent}
        initialPersonIds={editingEvent ? (eventParticipantsByEvent.get(editingEvent.id) ?? []) : []}
        error={eventError}
        saving={createEvent.isPending || updateEvent.isPending}
        onSubmit={(payload) => {
          void handleEventSubmit(payload);
        }}
      />

      <PaymentFormDialog
        open={paymentDialogOpen}
        onOpenChange={(open) => {
          setPaymentDialogOpen(open);
          if (!open) {
            setEditingPayment(null);
            setPaymentError(null);
            setPaymentHasHistory(false);
          }
        }}
        payment={editingPayment}
        initialPersonIds={
          editingPayment ? (paymentParticipantsByPayment.get(editingPayment.id) ?? []) : []
        }
        hasHistory={paymentHasHistory}
        error={paymentError}
        saving={createPayment.isPending || updatePayment.isPending}
        onSubmit={(payload) => {
          void handlePaymentSubmit(payload);
        }}
      />

      <BirthdayFormDialog
        open={birthdayDialogOpen}
        onOpenChange={(open) => {
          setBirthdayDialogOpen(open);
          if (!open) {
            setEditingBirthday(null);
            setBirthdayError(null);
          }
        }}
        birthday={editingBirthday}
        error={birthdayError}
        saving={createBirthday.isPending || updateBirthday.isPending}
        onSubmit={(payload) => {
          void handleBirthdaySubmit(payload);
        }}
      />
    </>
  );

  return { onSelect, dialogs, openAddEvent, openAddPayment };
}
