import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { PullToRefresh } from "@/components/common/PullToRefresh";
import { DashboardBirthdayCard } from "@/components/dashboard/DashboardBirthdayCard";
import { DashboardEventCard } from "@/components/dashboard/DashboardEventCard";
import { DashboardListsCard } from "@/components/dashboard/DashboardListsCard";
import { DashboardPaymentCard } from "@/components/dashboard/DashboardPaymentCard";
import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { ListFormDialog } from "@/components/lists/ListFormDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import type { EventFormPayload } from "@/components/events/EventForm";
import type { ListFormPayload } from "@/components/lists/ListForm";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import { useCreateBirthday, useUpdateBirthday, useBirthdaysList } from "@/hooks/useBirthdays";
import { useCreateEvent, useEventsList, useUpdateEvent } from "@/hooks/useEvents";
import { useCreateList, useListsWithItems } from "@/hooks/useLists";
import {
  hasPaymentHistory,
  useCreatePayment,
  usePaymentsList,
  useUpdatePayment,
} from "@/hooks/usePayments";
import { useProfile } from "@/hooks/useProfile";
import type { Birthday, Event, ListWithItems, Payment } from "@/types/database";

/**
 * Dashboard route — a 2×2 card grid: events, payments, birthdays, lists.
 *
 * Each card owns its own detail popup; the dashboard owns the per-feature
 * add/edit form dialogs and threads them in via `onAdd` / `onEdit`
 * callbacks. The Lists card uses a thinner contract (only `onAdd`) since
 * list interactions belong on the /lists page, not a modal.
 *
 * Pull-to-refresh invalidates every list query so a downward drag on mobile
 * refreshes the whole dashboard. Realtime subscriptions in each hook handle
 * cross-device sync; pull-to-refresh exists for the "I'm not sure I see the
 * latest" reassurance gesture.
 */
export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  const queryClient = useQueryClient();
  const { familyId, familyName } = useProfile();

  // Lists — each subscribes to realtime internally.
  const eventsQuery = useEventsList();
  const paymentsQuery = usePaymentsList();
  const birthdaysQuery = useBirthdaysList();
  const listsQuery = useListsWithItems();

  const events: Event[] = eventsQuery.data ?? [];
  const payments: Payment[] = paymentsQuery.data ?? [];
  const birthdays: Birthday[] = birthdaysQuery.data ?? [];
  const lists: ListWithItems[] = listsQuery.data ?? [];

  // Mutations — only the create/update side; deletes happen on feature pages.
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const createBirthday = useCreateBirthday();
  const updateBirthday = useUpdateBirthday();
  const createList = useCreateList();

  // Per-feature dialog state. Each card surfaces an `onAdd` + `onEdit` that
  // drives this state; submit handlers route to create vs update based on
  // whether `editing*` is set.
  const [eventDialogOpen, setEventDialogOpen] = React.useState(false);
  const [editingEvent, setEditingEvent] = React.useState<Event | null>(null);
  const [eventError, setEventError] = React.useState<string | null>(null);

  const [paymentDialogOpen, setPaymentDialogOpen] = React.useState(false);
  const [editingPayment, setEditingPayment] = React.useState<Payment | null>(null);
  const [paymentError, setPaymentError] = React.useState<string | null>(null);
  const [paymentHasHistory, setPaymentHasHistory] = React.useState(false);

  const [birthdayDialogOpen, setBirthdayDialogOpen] = React.useState(false);
  const [editingBirthday, setEditingBirthday] = React.useState<Birthday | null>(null);
  const [birthdayError, setBirthdayError] = React.useState<string | null>(null);

  const [listDialogOpen, setListDialogOpen] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);

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

  const openAddList = () => {
    setListError(null);
    setListDialogOpen(true);
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
    // The Phase 3 PaymentForm disables the recurrence radios when history
    // exists. Look it up before opening so the radios start correctly.
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

  const handleListSubmit = async (payload: ListFormPayload) => {
    setListError(null);
    try {
      await createList.mutateAsync(payload);
      setListDialogOpen(false);
    } catch (err) {
      setListError(err instanceof Error && err.message ? err.message : "Greška pri kreiranju liste");
    }
  };

  /* --- Pull-to-refresh --------------------------------------------------- */

  // Invalidate every list query so each refetches from Supabase. Resolves
  // when all four refetches settle so the pulltorefreshjs spinner stays
  // visible until the cards have repainted.
  const handleRefresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["events", familyId] }),
      queryClient.invalidateQueries({ queryKey: ["payments", familyId] }),
      queryClient.invalidateQueries({ queryKey: ["birthdays", familyId] }),
      queryClient.invalidateQueries({ queryKey: ["lists", familyId] }),
    ]);
  }, [queryClient, familyId]);

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

  const handleListDialogOpenChange = (open: boolean) => {
    setListDialogOpen(open);
    if (!open) {
      setListError(null);
    }
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
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
          <div className="stagger-fade-in mt-6 grid gap-4 sm:grid-cols-2">
            <DashboardEventCard events={events} onAdd={openAddEvent} onEdit={openEditEvent} />
            <DashboardPaymentCard
              payments={payments}
              onAdd={openAddPayment}
              onEdit={(payment) => {
                void openEditPayment(payment);
              }}
            />
            {/* Lists card sits above Birthdays — on mobile (single column)
                it appears earlier in scroll order; on desktop (two-col
                grid) it occupies the bottom-left slot. Reflects the
                day-to-day usage pattern: shopping comes up more often
                than birthdays. */}
            <DashboardListsCard lists={lists} onAdd={openAddList} />
            <DashboardBirthdayCard
              birthdays={birthdays}
              onAdd={openAddBirthday}
              onEdit={openEditBirthday}
            />
          </div>
        )}

        <EventFormDialog
          open={eventDialogOpen}
          onOpenChange={handleEventDialogOpenChange}
          event={editingEvent}
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

        <ListFormDialog
          open={listDialogOpen}
          onOpenChange={handleListDialogOpenChange}
          list={null}
          error={listError}
          saving={createList.isPending}
          onSubmit={(payload) => {
            void handleListSubmit(payload);
          }}
        />
      </div>
    </PullToRefresh>
  );
}
