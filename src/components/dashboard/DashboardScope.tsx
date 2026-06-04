import { useState } from "react";

import { AddMenu } from "@/components/dashboard/AddMenu";
import { AgendaFilters } from "@/components/dashboard/AgendaFilters";
import { AgendaTodayTab } from "@/components/dashboard/AgendaTodayTab";
import { AgendaUpcomingTab } from "@/components/dashboard/AgendaUpcomingTab";
import { ViewToggle } from "@/components/dashboard/ViewToggle";
import { ActivityAddDialog } from "@/components/activities/ActivityAddDialog";
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
import { useAgendaFilters } from "@/hooks/useAgendaFilters";
import { type AgendaPage, useAgendaView } from "@/hooks/useAgendaView";
import { useProfile } from "@/hooks/useProfile";
import type { Birthday, Event, Payment } from "@/types/database";

/**
 * One dashboard scope — "Danas" (today) or "Uskoro" (today onward), each now a
 * route of its own (the bottom/top nav switches between them instead of in-page
 * tabs). Shared shell: the header + "Dodaj" menu, the type/person filter bar and
 * the per-page list↔calendar toggle, the scope's agenda, and the per-feature
 * add/edit FORM dialogs the agenda routes "Izmeni" back into via `onEdit*`.
 *
 * Filters live per page (the hook is called here, so each route instance has its
 * own selection); the list↔calendar choice persists in localStorage. Lists live
 * on /lists; activity edit deep-links to /activities (add is in the Dodaj menu).
 */
export function DashboardScope({ scope }: { scope: AgendaPage }) {
  const { familyId, familyName } = useProfile();

  const filters = useAgendaFilters();
  const view = useAgendaView(scope);

  // Participant maps — only needed to prefill the edit forms.
  const { byEvent: eventParticipantsByEvent } = useEventParticipants();
  const { byPayment: paymentParticipantsByPayment } = usePaymentParticipants();

  // Mutations — only the create/update side; deletes happen on feature pages.
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const createBirthday = useCreateBirthday();
  const updateBirthday = useUpdateBirthday();

  // Per-feature form dialog state. The Dodaj menu drives "add"; the agenda's
  // detail dialogs drive "edit" via the openEdit* handlers below.
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

  // Activity add is self-contained (the dialog owns its mutations); the scope
  // only flips it open. There's no edit path here — "Izmeni aktivnost" still
  // deep-links to /activities.
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);

  /* --- Add openers ------------------------------------------------------- */

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

  /* --- Edit openers ------------------------------------------------------ */

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
    const history = await hasPaymentHistory(payment.id);
    setPaymentHasHistory(history);
    setPaymentDialogOpen(true);
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
      if (editingEvent) {
        await updateEvent.mutateAsync({ id: editingEvent.id, payload });
      } else {
        await createEvent.mutateAsync(payload);
      }
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
      if (editingBirthday) {
        await updateBirthday.mutateAsync({ id: editingBirthday.id, payload });
      } else {
        await createBirthday.mutateAsync(payload);
      }
      setBirthdayDialogOpen(false);
      setEditingBirthday(null);
    } catch (err) {
      const fallback = editingBirthday
        ? "Greška pri ažuriranju rođendana"
        : "Greška pri kreiranju rođendana";
      setBirthdayError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  /* --- Dialog open-state guards ----------------------------------------- */

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

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {familyName ? `Porodica ${familyName}` : "Kontrolna tabla"}
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            {scope === "danas"
              ? "Današnje obaveze i prekoračeno."
              : "Sve što dolazi - od danas pa nadalje."}
          </p>
        </div>
        {familyId ? (
          <AddMenu
            onAddActivity={() => setActivityDialogOpen(true)}
            onAddEvent={openAddEvent}
            onAddPayment={openAddPayment}
            onAddBirthday={openAddBirthday}
          />
        ) : null}
      </div>

      {!familyId ? (
        <div className="mt-6 text-gray-500 dark:text-gray-400">Učitavanje…</div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <AgendaFilters
                filter={filters.filter}
                toggleKind={filters.toggleKind}
                togglePerson={filters.togglePerson}
                reset={filters.reset}
                isActive={filters.isActive}
                count={filters.count}
              />
            </div>
            <ViewToggle value={view.view} onChange={view.setView} />
          </div>

          {scope === "danas" ? (
            <AgendaTodayTab
              view={view.view}
              filter={filters.filter}
              onEditEvent={openEditEvent}
              onEditPayment={(payment) => {
                void openEditPayment(payment);
              }}
              onEditBirthday={openEditBirthday}
            />
          ) : (
            <AgendaUpcomingTab
              view={view.view}
              filter={filters.filter}
              onEditEvent={openEditEvent}
              onEditPayment={(payment) => {
                void openEditPayment(payment);
              }}
              onEditBirthday={openEditBirthday}
            />
          )}
        </div>
      )}

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

      <ActivityAddDialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen} />
    </div>
  );
}
