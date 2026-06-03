import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AddFab } from "@/components/dashboard/AddFab";
import { AgendaTodayTab } from "@/components/dashboard/AgendaTodayTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useProfile } from "@/hooks/useProfile";
import type { Birthday, Event, Payment } from "@/types/database";

/**
 * Dashboard route — two agenda tabs: "Danas" (everything today) and "Uskoro"
 * (from tomorrow). Both read the unified `useAgenda` layer.
 *
 * The route still owns the per-feature add/edit FORM dialogs (events, payments,
 * birthdays) and threads them in: the floating "Dodaj" button opens the add
 * forms, and the agenda's detail dialogs route "Izmeni" back here through the
 * `onEdit*` callbacks. Lists are no longer on the dashboard — they live on
 * /lists. Activity add/edit lives on /activities.
 */
type DashboardTab = "danas" | "uskoro";

export const Route = createFileRoute("/_app/")({
  // Deep-linkable active tab. Unknown / missing values fall back to "Danas".
  validateSearch: (search: Record<string, unknown>): { tab?: DashboardTab } => {
    const tab = search.tab;
    return tab === "uskoro" || tab === "danas" ? { tab } : {};
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { familyId, familyName } = useProfile();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const active: DashboardTab = tab ?? "danas";

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

  // Per-feature form dialog state. The FAB drives "add"; the agenda's detail
  // dialogs drive "edit" via the openEdit* handlers below.
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
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
        {familyName ? `Porodica ${familyName}` : "Kontrolna tabla"}
      </h1>
      <p className="mt-1 text-gray-600 dark:text-gray-400">
        Dobrodošli nazad! Pregled nadolazećih obaveza.
      </p>

      {!familyId ? (
        <div className="mt-6 text-gray-500 dark:text-gray-400">Učitavanje…</div>
      ) : (
        <Tabs
          value={active}
          onValueChange={(value) =>
            void navigate({
              to: "/",
              search: value === "danas" ? {} : { tab: value as DashboardTab },
              replace: true,
            })
          }
          className="mt-6 gap-6"
        >
          <TabsList className="w-full max-w-xs">
            <TabsTrigger value="danas">Danas</TabsTrigger>
            <TabsTrigger value="uskoro">Uskoro</TabsTrigger>
          </TabsList>
          <TabsContent value="danas">
            <AgendaTodayTab
              onEditEvent={openEditEvent}
              onEditPayment={(payment) => {
                void openEditPayment(payment);
              }}
              onEditBirthday={openEditBirthday}
            />
          </TabsContent>
          <TabsContent value="uskoro">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Uskoro stiže — pregled narednih dana.
            </p>
          </TabsContent>
        </Tabs>
      )}

      {familyId ? (
        <AddFab
          onAddEvent={openAddEvent}
          onAddPayment={openAddPayment}
          onAddBirthday={openAddBirthday}
        />
      ) : null}

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
    </div>
  );
}
