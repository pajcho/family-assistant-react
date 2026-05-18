import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { PullToRefresh } from "@/components/common/PullToRefresh";
import { DashboardBirthdayCard } from "@/components/dashboard/DashboardBirthdayCard";
import { DashboardEventCard } from "@/components/dashboard/DashboardEventCard";
import { DashboardExpenseCard } from "@/components/dashboard/DashboardExpenseCard";
import { DashboardPaymentCard } from "@/components/dashboard/DashboardPaymentCard";
import { BirthdayFormDialog } from "@/components/birthdays/BirthdayFormDialog";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { ExpenseFormDialog } from "@/components/expenses/ExpenseFormDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { BirthdayFormPayload } from "@/components/birthdays/BirthdayForm";
import type { EventFormPayload } from "@/components/events/EventForm";
import type { ExpenseFormPayload } from "@/components/expenses/ExpenseForm";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import { useCreateBirthday, useUpdateBirthday, useBirthdaysList } from "@/hooks/useBirthdays";
import { useCreateEvent, useEventsList, useUpdateEvent } from "@/hooks/useEvents";
import { useCreateExpense, useExpensesList, useUpdateExpense } from "@/hooks/useExpenses";
import {
  hasPaymentHistory,
  useCreatePayment,
  usePaymentsList,
  useUpdatePayment,
} from "@/hooks/usePayments";
import { useProfile } from "@/hooks/useProfile";
import type { Birthday, Event, Expense, Payment } from "@/types/database";

/**
 * Dashboard route — replaces the Phase 1A stub with the full 2×2 card grid.
 *
 * Mirrors `pages/index.vue` from the Nuxt source: a `PullToRefresh` wrapper
 * around the family-name header + an animated grid of four cards (events,
 * payments, birthdays, expenses). Each card owns its own detail popup; the
 * dashboard owns the per-feature add/edit form dialogs and threads them in
 * via `onAdd` / `onEdit` callbacks so all four form dialogs live in one
 * place (matches the Vue page's structure).
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
  const expensesQuery = useExpensesList();

  const events: Event[] = eventsQuery.data ?? [];
  const payments: Payment[] = paymentsQuery.data ?? [];
  const birthdays: Birthday[] = birthdaysQuery.data ?? [];
  const expenses: Expense[] = expensesQuery.data ?? [];

  // Mutations — only the create/update side; deletes happen on feature pages.
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const createBirthday = useCreateBirthday();
  const updateBirthday = useUpdateBirthday();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();

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

  const [expenseDialogOpen, setExpenseDialogOpen] = React.useState(false);
  const [editingExpense, setEditingExpense] = React.useState<Expense | null>(null);
  const [expenseError, setExpenseError] = React.useState<string | null>(null);

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

  const openAddExpense = () => {
    setEditingExpense(null);
    setExpenseError(null);
    setExpenseDialogOpen(true);
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

  const openEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setExpenseError(null);
    setExpenseDialogOpen(true);
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

  const handleExpenseSubmit = async (payload: ExpenseFormPayload) => {
    setExpenseError(null);
    try {
      if (editingExpense) {
        await updateExpense.mutateAsync({ id: editingExpense.id, payload });
      } else {
        await createExpense.mutateAsync(payload);
      }
      setExpenseDialogOpen(false);
      setEditingExpense(null);
    } catch (err) {
      const fallback = editingExpense
        ? "Greška pri ažuriranju troška"
        : "Greška pri kreiranju troška";
      setExpenseError(err instanceof Error && err.message ? err.message : fallback);
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
      queryClient.invalidateQueries({ queryKey: ["expenses", familyId] }),
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

  const handleExpenseDialogOpenChange = (open: boolean) => {
    setExpenseDialogOpen(open);
    if (!open) {
      setEditingExpense(null);
      setExpenseError(null);
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
            <DashboardBirthdayCard
              birthdays={birthdays}
              onAdd={openAddBirthday}
              onEdit={openEditBirthday}
            />
            <DashboardExpenseCard
              expenses={expenses}
              onAdd={openAddExpense}
              onEdit={openEditExpense}
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

        <ExpenseFormDialog
          open={expenseDialogOpen}
          onOpenChange={handleExpenseDialogOpenChange}
          expense={editingExpense}
          error={expenseError}
          saving={createExpense.isPending || updateExpense.isPending}
          onSubmit={(payload) => {
            void handleExpenseSubmit(payload);
          }}
        />
      </div>
    </PullToRefresh>
  );
}
