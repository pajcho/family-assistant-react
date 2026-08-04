import { useState, type ReactNode } from "react";

import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import type { EventFormPayload } from "@/components/events/EventForm";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import { useCreateBirthday, useUpdateBirthday } from "@/hooks/useBirthdays";
import { useCreateEvent, useUpdateEvent } from "@/hooks/useEvents";
import { useEventParticipants } from "@/hooks/useEventParticipants";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { hasPaymentHistory, useCreatePayment, useUpdatePayment } from "@/hooks/usePayments";
import type { Birthday, Event, Payment } from "@/types/database";

/**
 * The add/edit FORM dialogs an agenda screen needs to host.
 *
 * A row click opens a DETAIL dialog (see `useAgendaDetails`); its "Izmeni"
 * action has to land somewhere, and that somewhere is the feature's full form.
 * Rather than every agenda surface wiring up three mutations, three pieces of
 * dialog state and three error strings, they all mount this once and pass the
 * returned `openEdit*` callbacks down.
 *
 * Activities are deliberately absent: `useAgendaDetails` opens the activity
 * form inline itself, since its schedule/participants data is already warm.
 */

export interface AgendaEditForms {
  openAddEvent: () => void;
  openAddPayment: () => void;
  openAddBirthday: () => void;
  openEditEvent: (event: Event) => void;
  /** Async: looks up payment history first, so the form's recurrence radios
   *  start in the right (possibly locked) state. */
  openEditPayment: (payment: Payment) => void;
  openEditBirthday: (birthday: Birthday) => void;
  dialogs: ReactNode;
}

export function useAgendaEditForms(): AgendaEditForms {
  // Participant maps - only needed to prefill the edit forms.
  const { byEvent: eventParticipantsByEvent } = useEventParticipants();
  const { byPayment: paymentParticipantsByPayment } = usePaymentParticipants();

  // Create/update only; deletes happen in the detail dialogs.
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

  /* --- Openers ----------------------------------------------------------- */

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

  const openAddBirthday = () => {
    setEditingBirthday(null);
    setBirthdayError(null);
    setBirthdayDialogOpen(true);
  };

  const openEditEvent = (event: Event) => {
    setEditingEvent(event);
    setEventError(null);
    setEventDialogOpen(true);
  };

  const openEditPayment = (payment: Payment) => {
    setEditingPayment(payment);
    setPaymentError(null);
    setPaymentDialogOpen(true);
    // The PaymentForm disables the recurrence radios when history exists. Look
    // it up alongside the open so the radios settle correctly.
    void hasPaymentHistory(payment.id).then(setPaymentHasHistory);
  };

  const openEditBirthday = (birthday: Birthday) => {
    setEditingBirthday(birthday);
    setBirthdayError(null);
    setBirthdayDialogOpen(true);
  };

  /* --- Submit handlers --------------------------------------------------- */

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
      if (editingPayment) {
        await updatePayment.mutateAsync({ id: editingPayment.id, payload });
      } else {
        await createPayment.mutateAsync({
          ...payload,
          is_recurring: payload.recurrence_period !== "one-time",
        });
      }
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

  /* --- Open-state guards -------------------------------------------------- */

  const handleEventDialogOpenChange = (open: boolean) => {
    setEventDialogOpen(open);
    if (!open) {
      setEditingEvent(null);
      setEventError(null);
    }
  };

  const handlePaymentDialogOpenChange = (open: boolean) => {
    setPaymentDialogOpen(open);
    if (!open) {
      setEditingPayment(null);
      setPaymentError(null);
      setPaymentHasHistory(false);
    }
  };

  const handleBirthdayDialogOpenChange = (open: boolean) => {
    setBirthdayDialogOpen(open);
    if (!open) {
      setEditingBirthday(null);
      setBirthdayError(null);
    }
  };

  const dialogs = (
    <>
      <EventFormDialog
        open={eventDialogOpen}
        onOpenChange={handleEventDialogOpenChange}
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
        onOpenChange={handlePaymentDialogOpenChange}
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
        onOpenChange={handleBirthdayDialogOpenChange}
        birthday={editingBirthday}
        error={birthdayError}
        saving={createBirthday.isPending || updateBirthday.isPending}
        onSubmit={(payload) => {
          void handleBirthdaySubmit(payload);
        }}
      />
    </>
  );

  return {
    openAddEvent,
    openAddPayment,
    openAddBirthday,
    openEditEvent,
    openEditPayment,
    openEditBirthday,
    dialogs,
  };
}
