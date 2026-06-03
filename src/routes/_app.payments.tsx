import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PaymentCancelDialog } from "@/components/payments/PaymentCancelDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import { PaymentHistoryPopup } from "@/components/payments/PaymentHistoryPopup";
import { PaymentRescheduleDialog } from "@/components/payments/PaymentRescheduleDialog";
import { PaymentUndoDialog } from "@/components/payments/PaymentUndoDialog";
import {
  PaymentListItem,
  type HistoryRowItem,
  type OccurrenceContext,
  type PaymentListItemUnion,
  type PaymentRowItem,
  type UpcomingRowItem,
} from "@/components/payments/PaymentListItem";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import {
  hasPaymentHistory,
  useCancelPaymentOccurrence,
  useCreatePayment,
  useDeletePayment,
  useMarkPaymentPaid,
  usePaymentHistory,
  usePaymentsList,
  useTogglePaymentPause,
  useUndoLastPayment,
  useUpdatePayment,
} from "@/hooks/usePayments";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import {
  overrideKey,
  useDeletePaymentOverride,
  usePaymentOverrides,
  useUpsertPaymentOverride,
} from "@/hooks/usePaymentOverrides";
import type { Payment, PaymentHistoryStatus, PaymentOverride } from "@/types/database";
import {
  currentMonthYYYYMM,
  getDueDateInMonth,
  getLimitedMonths as getLimitedMonthsFromDate,
  getWeeklyOccurrencesInMonth,
  isMonthlyOccurrenceMonth,
  isOverdue,
  subtractDay,
} from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { nextPaymentOccurrenceDate } from "@/utils/payment";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/_app/payments")({
  component: PaymentsPage,
});

/* --- Month filter chips (Sva + next 3 months) ----------------------------- */

const MONTH_NAMES_SR = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

type MonthFilter = { label: string; value: string };

function buildMonthFilters(today: Date): MonthFilter[] {
  const filters: MonthFilter[] = [{ label: "Sva", value: "all" }];
  for (let i = 0; i < 3; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthIndex = date.getMonth();
    filters.push({
      label: MONTH_NAMES_SR[monthIndex],
      value: `${date.getFullYear()}-${String(monthIndex + 1).padStart(2, "0")}`,
    });
  }
  return filters;
}

/* --- Summary computation -------------------------------------------------- */

type Summary =
  | { type: "all"; total: number }
  | { type: "month"; unpaidTotal: number; paidTotal: number };

function computeSummary({
  payments,
  history,
  selectedMonth,
  overridesByKey,
}: {
  payments: Payment[];
  history: ReadonlyArray<{
    payment_id: string;
    due_date: string;
    amount: number;
  }>;
  selectedMonth: string;
  overridesByKey: Map<string, PaymentOverride>;
}): Summary {
  const isCanceled = (paymentId: string, date: string) =>
    overridesByKey.get(overrideKey(paymentId, date))?.action === "cancel";

  if (selectedMonth === "all") {
    const total = payments
      .filter((p) => !p.is_paid && !p.is_paused && !isCanceled(p.id, p.due_date))
      .reduce((sum, p) => sum + p.amount, 0);
    return { type: "all", total };
  }

  const currentMonth = currentMonthYYYYMM();
  let unpaidTotal = 0;
  let paidTotal = 0;

  // Payments for this month (real rows)
  for (const payment of payments) {
    if (!payment.due_date.startsWith(selectedMonth)) continue;
    if (payment.is_paused) continue;
    if (payment.is_paid) paidTotal += payment.amount;
    else unpaidTotal += payment.amount;
  }

  // History entries for this month (skip one-time due in this month —
  // already in payment count)
  const oneTimePaymentIdsInMonth = new Set(
    payments
      .filter((p) => p.recurrence_period === "one-time" && p.due_date.startsWith(selectedMonth))
      .map((p) => p.id),
  );
  for (const entry of history) {
    if (!entry.due_date.startsWith(selectedMonth)) continue;
    if (oneTimePaymentIdsInMonth.has(entry.payment_id)) continue;
    paidTotal += entry.amount;
  }

  // Include upcoming amounts for this month in unpaid total (same logic as combinedList)
  if (selectedMonth >= currentMonth) {
    const paymentIdsWithHistoryInMonth = new Set(
      history.filter((e) => e.due_date.startsWith(selectedMonth)).map((e) => e.payment_id),
    );
    const paidDatesByPayment = new Map<string, Set<string>>();
    for (const entry of history) {
      if (!entry.due_date.startsWith(selectedMonth)) continue;
      let set = paidDatesByPayment.get(entry.payment_id);
      if (!set) {
        set = new Set<string>();
        paidDatesByPayment.set(entry.payment_id, set);
      }
      set.add(entry.due_date);
    }
    for (const payment of payments) {
      if (payment.is_paid || payment.is_paused) continue;
      const hasRealRow = payment.due_date.startsWith(selectedMonth);

      const interval = Math.max(1, payment.recurrence_interval ?? 1);

      if (payment.recurrence_period === "weekly") {
        const occurrences = getWeeklyOccurrencesInMonth(payment.due_date, selectedMonth, interval);
        const paidDates = paidDatesByPayment.get(payment.id) ?? new Set<string>();
        for (const occurrenceDate of occurrences) {
          if (occurrenceDate === payment.due_date) continue;
          if (paidDates.has(occurrenceDate)) continue;
          unpaidTotal += payment.amount;
        }
        continue;
      }

      if (paymentIdsWithHistoryInMonth.has(payment.id)) continue;
      if (
        payment.recurrence_period === "monthly" &&
        !hasRealRow &&
        isMonthlyOccurrenceMonth(payment.due_date, selectedMonth, interval)
      ) {
        unpaidTotal += payment.amount;
      } else if (
        payment.recurrence_period === "limited" &&
        getLimitedMonthsFromDate(
          payment.due_date,
          Math.max(0, payment.remaining_occurrences ?? 0),
        ).includes(selectedMonth) &&
        !hasRealRow
      ) {
        unpaidTotal += payment.amount;
      }
    }
  }

  return { type: "month", unpaidTotal, paidTotal };
}

/* --- Combined list computation -------------------------------------------- */

function computeCombinedList({
  payments,
  history,
  selectedMonth,
  overridesByKey,
}: {
  payments: Payment[];
  history: ReadonlyArray<{
    id: string;
    payment_id: string;
    due_date: string;
    paid_date: string | null;
    amount: number;
    status: PaymentHistoryStatus;
    note: string | null;
    created_at: string;
  }>;
  selectedMonth: string;
  overridesByKey: Map<string, PaymentOverride>;
}): PaymentListItemUnion[] {
  const items: PaymentListItemUnion[] = [];
  const currentMonth = currentMonthYYYYMM();
  const paymentNameMap = new Map<string, string>();
  for (const p of payments) paymentNameMap.set(p.id, p.name);

  // 1. Payments (real rows: due in this month, or all when "Sva").
  //    A per-occurrence override moves (reschedule) or marks (cancel) the
  //    live occurrence at `payment.due_date` — display only; the DB row and
  //    mark-paid accounting are untouched.
  for (const payment of payments) {
    if (selectedMonth !== "all" && !payment.due_date.startsWith(selectedMonth)) continue;
    const override = overridesByKey.get(overrideKey(payment.id, payment.due_date)) ?? null;
    const effectiveDate =
      override?.action === "reschedule" && override.override_date
        ? override.override_date
        : payment.due_date;
    items.push({
      ...payment,
      type: "payment",
      occurrenceDate: payment.due_date,
      override,
      due_date: effectiveDate,
    });
  }

  // 2. History + upcoming only when filtering by month
  if (selectedMonth !== "all") {
    // One-time payments due in this month — already shown above as payment rows.
    // Their history entries should NOT also appear (dedupe).
    const oneTimePaymentIdsInMonth = new Set(
      payments
        .filter((p) => p.recurrence_period === "one-time" && p.due_date.startsWith(selectedMonth))
        .map((p) => p.id),
    );

    // Find the latest history entry per payment (only its row gets the Undo button)
    const lastHistoryByPayment = new Map<string, { id: string; created_at: string }>();
    for (const entry of history) {
      const existing = lastHistoryByPayment.get(entry.payment_id);
      if (!existing || entry.created_at > existing.created_at) {
        lastHistoryByPayment.set(entry.payment_id, {
          id: entry.id,
          created_at: entry.created_at,
        });
      }
    }

    for (const entry of history) {
      if (!entry.due_date.startsWith(selectedMonth)) continue;
      if (oneTimePaymentIdsInMonth.has(entry.payment_id)) continue;
      const historyItem: HistoryRowItem = {
        type: "history",
        id: entry.id,
        payment_id: entry.payment_id,
        name: paymentNameMap.get(entry.payment_id) ?? "Nepoznato plaćanje",
        amount: entry.amount,
        due_date: entry.due_date,
        paid_date: entry.paid_date,
        status: entry.status,
        note: entry.note,
        isLast: lastHistoryByPayment.get(entry.payment_id)?.id === entry.id,
      };
      items.push(historyItem);
    }

    // 3. Synthetic upcoming rows for current/future months.
    //    Skip if that month's instance was already paid (history entry exists).
    if (selectedMonth >= currentMonth) {
      const paymentIdsWithHistoryInMonth = new Set(
        history.filter((e) => e.due_date.startsWith(selectedMonth)).map((e) => e.payment_id),
      );
      const paidDatesByPayment = new Map<string, Set<string>>();
      for (const entry of history) {
        if (!entry.due_date.startsWith(selectedMonth)) continue;
        let set = paidDatesByPayment.get(entry.payment_id);
        if (!set) {
          set = new Set<string>();
          paidDatesByPayment.set(entry.payment_id, set);
        }
        set.add(entry.due_date);
      }
      for (const payment of payments) {
        if (payment.is_paid || payment.is_paused) continue;
        const period = payment.recurrence_period;
        const hasRealRow = payment.due_date.startsWith(selectedMonth);
        const interval = Math.max(1, payment.recurrence_interval ?? 1);

        if (period === "weekly") {
          // Weekly can fire multiple times in the same month — emit one
          // upcoming row per occurrence that ISN'T the live row and ISN'T
          // already a history row.
          const occurrences = getWeeklyOccurrencesInMonth(
            payment.due_date,
            selectedMonth,
            interval,
          );
          const paidDates = paidDatesByPayment.get(payment.id) ?? new Set<string>();
          for (const occurrenceDate of occurrences) {
            if (occurrenceDate === payment.due_date) continue;
            if (paidDates.has(occurrenceDate)) continue;
            const override = overridesByKey.get(overrideKey(payment.id, occurrenceDate)) ?? null;
            const effectiveDate =
              override?.action === "reschedule" && override.override_date
                ? override.override_date
                : occurrenceDate;
            const upcoming: UpcomingRowItem = {
              type: "upcoming",
              id: `upcoming-${payment.id}-${occurrenceDate}`,
              paymentId: payment.id,
              name: payment.name,
              amount: payment.amount,
              due_date: effectiveDate,
              occurrenceDate,
              override,
              description: payment.description,
              recurrence_period: payment.recurrence_period,
              recurrence_interval: interval,
              remaining_occurrences: payment.remaining_occurrences,
            };
            items.push(upcoming);
          }
          continue;
        }

        if (paymentIdsWithHistoryInMonth.has(payment.id)) continue;

        if (period === "monthly") {
          if (!hasRealRow && isMonthlyOccurrenceMonth(payment.due_date, selectedMonth, interval)) {
            const occurrenceDate = getDueDateInMonth(selectedMonth, payment.due_date);
            const override = overridesByKey.get(overrideKey(payment.id, occurrenceDate)) ?? null;
            const effectiveDate =
              override?.action === "reschedule" && override.override_date
                ? override.override_date
                : occurrenceDate;
            const upcoming: UpcomingRowItem = {
              type: "upcoming",
              id: `upcoming-${payment.id}-${selectedMonth}`,
              paymentId: payment.id,
              name: payment.name,
              amount: payment.amount,
              due_date: effectiveDate,
              occurrenceDate,
              override,
              description: payment.description,
              recurrence_period: payment.recurrence_period,
              recurrence_interval: interval,
              remaining_occurrences: payment.remaining_occurrences,
            };
            items.push(upcoming);
          }
        } else if (period === "limited") {
          const months = getLimitedMonthsFromDate(
            payment.due_date,
            Math.max(0, payment.remaining_occurrences ?? 0),
          );
          if (months.includes(selectedMonth) && !hasRealRow) {
            const occurrenceDate = getDueDateInMonth(selectedMonth, payment.due_date);
            const override = overridesByKey.get(overrideKey(payment.id, occurrenceDate)) ?? null;
            const effectiveDate =
              override?.action === "reschedule" && override.override_date
                ? override.override_date
                : occurrenceDate;
            const upcoming: UpcomingRowItem = {
              type: "upcoming",
              id: `upcoming-${payment.id}-${selectedMonth}`,
              paymentId: payment.id,
              name: payment.name,
              amount: payment.amount,
              due_date: effectiveDate,
              occurrenceDate,
              override,
              description: payment.description,
              recurrence_period: payment.recurrence_period,
              recurrence_interval: interval,
              remaining_occurrences: payment.remaining_occurrences,
            };
            items.push(upcoming);
          }
        }
        // one-time: no upcoming rows, only real row in due month
      }
    }
  }

  items.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return items;
}

/* --- Row class helper (overdue/paused/paid/history/upcoming) -------------- */

function getItemClass(item: PaymentListItemUnion): string {
  const override = "override" in item ? item.override : null;
  if (override?.action === "cancel") {
    return "border border-gray-200/80 bg-gray-50 opacity-75 dark:border-gray-700 dark:bg-gray-800/80";
  }
  if (override?.action === "reschedule") {
    return "border border-indigo-200/70 bg-indigo-50/40 dark:border-indigo-800/50 dark:bg-indigo-900/10";
  }
  if (item.type === "history") {
    if (item.status === "canceled") {
      return "border border-red-200/70 bg-red-50/40 opacity-80 dark:border-red-800/50 dark:bg-red-900/10";
    }
    return "border border-gray-200/80 bg-gray-50 opacity-75 dark:border-gray-700 dark:bg-gray-800/80";
  }
  if (item.type === "upcoming") {
    return "border border-sky-200/80 bg-sky-50/50 opacity-60 dark:border-sky-800/50 dark:bg-sky-900/10";
  }
  if (item.is_paused) {
    return "border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 opacity-60";
  }
  if (item.is_paid) {
    return "border border-gray-200/80 bg-gray-50 opacity-75 dark:border-gray-700 dark:bg-gray-800/80";
  }
  // Overdue unpaid: subtle red border + tint so it stands out
  if (item.type === "payment" && isOverdue(item.due_date)) {
    return "border border-red-200 dark:border-red-800/60 bg-red-50/50 dark:bg-red-900/20";
  }
  return "border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800";
}

/** The owning payment id for any list-item shape (used to look up assignees). */
function paymentIdForItem(item: PaymentListItemUnion): string {
  if (item.type === "payment") return item.id;
  if (item.type === "upcoming") return item.paymentId;
  return item.payment_id;
}

/* --- The page itself ------------------------------------------------------ */

function PaymentsPage() {
  // Filters
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [hidePaid, setHidePaid] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editingHasHistory, setEditingHasHistory] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);

  // Undo confirmation (from a history row)
  const [undoDialogOpen, setUndoDialogOpen] = useState(false);
  const [historyToUndo, setHistoryToUndo] = useState<HistoryRowItem | null>(null);

  // History popup
  const [historyPopupOpen, setHistoryPopupOpen] = useState(false);
  const [selectedPaymentForHistory, setSelectedPaymentForHistory] = useState<Payment | null>(null);

  // Per-occurrence reschedule / cancel
  const [rescheduleCtx, setRescheduleCtx] = useState<OccurrenceContext | null>(null);
  const [cancelCtx, setCancelCtx] = useState<Payment | null>(null);

  // Data — always fetch everything (hidePaid is a client-side display toggle here, matching Vue)
  const paymentsQuery = usePaymentsList({ hidePaid: false });
  const historyQuery = usePaymentHistory();
  const { byPayment } = usePaymentParticipants();
  const { byKey: overridesByKey } = usePaymentOverrides();

  // Mutations
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const deletePayment = useDeletePayment();
  const markPaidMutation = useMarkPaymentPaid();
  const togglePauseMutation = useTogglePaymentPause();
  const undoMutation = useUndoLastPayment();
  const upsertOverride = useUpsertPaymentOverride();
  const deleteOverride = useDeletePaymentOverride();
  const cancelOccurrence = useCancelPaymentOccurrence();

  // Stable today reference — chips only need to recompute on month boundary,
  // but we accept the once-per-mount cost.
  const monthFilters = useMemo(() => buildMonthFilters(new Date()), []);

  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);
  const history = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

  const combinedList = useMemo(
    () => computeCombinedList({ payments, history, selectedMonth, overridesByKey }),
    [payments, history, selectedMonth, overridesByKey],
  );

  const displayedList = useMemo<PaymentListItemUnion[]>(() => {
    if (!hidePaid) return combinedList;
    return combinedList.filter((item) => {
      // Keep canceled history visible (so skips stay on screen); hide paid.
      if (item.type === "history") return item.status === "canceled";
      return !(item.type === "payment" && item.is_paid);
    });
  }, [combinedList, hidePaid]);

  const summary = useMemo(
    () => computeSummary({ payments, history, selectedMonth, overridesByKey }),
    [payments, history, selectedMonth, overridesByKey],
  );

  const isLoading = paymentsQuery.isLoading || historyQuery.isLoading;
  const showEmpty = !isLoading && displayedList.length === 0;
  const emptyListMessage =
    combinedList.length === 0
      ? "Nema plaćanja za prikaz."
      : 'Nema neplaćenih stavki. Sve je plaćeno i sakriveno filtom "Sakrij plaćena".';

  /* --- Action handlers -------------------------------------------------- */

  const openAdd = () => {
    setEditingPayment(null);
    setEditingHasHistory(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = async (item: PaymentRowItem) => {
    setEditingPayment(item);
    setFormError(null);
    setDialogOpen(true);
    // Async — disable recurrence radios if payment_history exists.
    try {
      const exists = await hasPaymentHistory(item.id);
      setEditingHasHistory(exists);
    } catch {
      setEditingHasHistory(false);
    }
  };

  const handleSubmit = async (payload: PaymentFormPayload) => {
    setFormError(null);
    try {
      if (editingPayment) {
        await updatePayment.mutateAsync({ id: editingPayment.id, payload });
      } else {
        await createPayment.mutateAsync(payload);
      }
      setDialogOpen(false);
      setEditingPayment(null);
      setEditingHasHistory(false);
    } catch (err) {
      const fallback = editingPayment
        ? "Greška pri izmeni plaćanja"
        : "Greška pri dodavanju plaćanja";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingPayment(null);
      setEditingHasHistory(false);
      setFormError(null);
    }
  };

  const handleMarkPaid = (item: PaymentRowItem) => {
    void markPaidMutation.mutateAsync(item.id).catch(() => {
      /* error toasted by hook */
    });
  };

  const handleTogglePause = (item: PaymentRowItem) => {
    void togglePauseMutation.mutateAsync(item.id).catch(() => {
      /* error toasted by hook */
    });
  };

  const confirmDelete = (item: PaymentRowItem) => {
    setPaymentToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!paymentToDelete) return;
    try {
      await deletePayment.mutateAsync(paymentToDelete.id);
      setDeleteDialogOpen(false);
      setPaymentToDelete(null);
    } catch {
      /* hook toasts; keep dialog open so the user can retry */
    }
  };

  const openHistory = (item: PaymentRowItem) => {
    setSelectedPaymentForHistory(item);
    setHistoryPopupOpen(true);
  };

  const handleHistoryPopupOpenChange = (open: boolean) => {
    setHistoryPopupOpen(open);
    if (!open) setSelectedPaymentForHistory(null);
  };

  const confirmUndo = (item: HistoryRowItem) => {
    setHistoryToUndo(item);
    setUndoDialogOpen(true);
  };

  const handleUndoConfirm = async () => {
    if (!historyToUndo) return;
    try {
      await undoMutation.mutateAsync(historyToUndo.payment_id);
      setUndoDialogOpen(false);
      setHistoryToUndo(null);
    } catch {
      /* hook toasts */
    }
  };

  const handleUndoDialogOpenChange = (open: boolean) => {
    setUndoDialogOpen(open);
    if (!open) setHistoryToUndo(null);
  };

  /* --- Per-occurrence reschedule / cancel handlers ---------------------- */

  const handleRescheduleOccurrence = (ctx: OccurrenceContext) => setRescheduleCtx(ctx);
  const handleCancelOccurrence = (ctx: {
    paymentId: string;
    occurrenceDate: string;
    name: string;
    isRecurring: boolean;
  }) => setCancelCtx(payments.find((p) => p.id === ctx.paymentId) ?? null);
  const handleRestoreOccurrence = (ctx: { paymentId: string; occurrenceDate: string }) => {
    void deleteOverride.mutateAsync(ctx).catch(() => {
      /* hook toasts */
    });
  };

  const handleRescheduleSubmit = async (date: string, reason: string | null) => {
    if (!rescheduleCtx) return;
    try {
      if (rescheduleCtx.isRecurring) {
        // Recurring: move just this occurrence — the rest of the series stays.
        await upsertOverride.mutateAsync({
          paymentId: rescheduleCtx.paymentId,
          occurrenceDate: rescheduleCtx.occurrenceDate,
          action: "reschedule",
          overrideDate: date,
          reason,
        });
      } else {
        // One-time: just change the due date — nothing to mark "moved".
        await updatePayment.mutateAsync({
          id: rescheduleCtx.paymentId,
          payload: { due_date: date },
        });
      }
      setRescheduleCtx(null);
    } catch {
      /* hook toasts; keep dialog open to retry */
    }
  };

  const handleCancelSubmit = async (reason: string | null) => {
    if (!cancelCtx) return;
    const isRecurring =
      cancelCtx.recurrence_period !== "one-time" && cancelCtx.recurrence_period != null;
    try {
      if (isRecurring) {
        // Recurring: record the skip in history + advance to the next occurrence
        // (the next becomes the active/current due).
        await cancelOccurrence.mutateAsync({ id: cancelCtx.id, reason });
      } else {
        // One-time: display-only soft cancel (struck "Otkazano", restorable).
        await upsertOverride.mutateAsync({
          paymentId: cancelCtx.id,
          occurrenceDate: cancelCtx.due_date,
          action: "cancel",
          reason,
        });
      }
      setCancelCtx(null);
    } catch {
      /* hook toasts; keep dialog open to retry */
    }
  };

  const deleteConfirmMessage = `Da li ste sigurni da želite da obrišete "${
    paymentToDelete?.name ?? ""
  }"?`;

  // Cap the reschedule picker at the day BEFORE the next occurrence (so the
  // current one can't land on/after it — no two payments on the same day) and
  // mark the next occurrence on the calendar.
  const reschedulePayment = rescheduleCtx
    ? (payments.find((p) => p.id === rescheduleCtx.paymentId) ?? null)
    : null;
  const rescheduleNext = reschedulePayment ? nextPaymentOccurrenceDate(reschedulePayment) : null;
  const rescheduleMax = rescheduleNext ? subtractDay(rescheduleNext) : null;

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Plaćanja</h1>
        <Button onClick={openAdd} className="w-full sm:w-auto">
          <PlusIcon className="mr-2 h-5 w-5" />
          Dodaj plaćanje
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {monthFilters.map((filter) => (
            <Button
              key={filter.value}
              variant={selectedMonth === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedMonth(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={hidePaid}
            onChange={(e) => setHidePaid(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-blue-500"
          />
          Sakrij plaćena
        </label>
      </div>

      {isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {showEmpty ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          {emptyListMessage}
        </div>
      ) : null}

      {!isLoading && displayedList.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {displayedList.map((item) => (
            <li key={item.id} className={cn("rounded-lg p-4 shadow-sm", getItemClass(item))}>
              <PaymentListItem
                item={item}
                personIds={byPayment.get(paymentIdForItem(item)) ?? []}
                onMarkPaid={handleMarkPaid}
                onTogglePause={handleTogglePause}
                onOpenHistory={openHistory}
                onEdit={(p) => {
                  void openEdit(p);
                }}
                onDelete={confirmDelete}
                onUndo={confirmUndo}
                onRescheduleOccurrence={handleRescheduleOccurrence}
                onCancelOccurrence={handleCancelOccurrence}
                onRestoreOccurrence={handleRestoreOccurrence}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {combinedList.length > 0 ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          {summary.type === "all" ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Ukupno za platiti:
              </span>
              <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatAmount(summary.total)}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex items-center justify-between sm:gap-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Za platiti:
                </span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {formatAmount(summary.unpaidTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between sm:gap-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Plaćeno:
                </span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatAmount(summary.paidTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <PaymentFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        payment={editingPayment}
        initialPersonIds={editingPayment ? (byPayment.get(editingPayment.id) ?? []) : []}
        hasHistory={editingHasHistory}
        error={formError}
        saving={createPayment.isPending || updatePayment.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
      />

      <PaymentHistoryPopup
        open={historyPopupOpen}
        onOpenChange={handleHistoryPopupOpenChange}
        payment={selectedPaymentForHistory}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setPaymentToDelete(null);
        }}
        title="Obriši plaćanje"
        message={deleteConfirmMessage}
        loading={deletePayment.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />

      <PaymentUndoDialog
        open={undoDialogOpen}
        onOpenChange={handleUndoDialogOpenChange}
        paymentName={historyToUndo?.name ?? ""}
        loading={undoMutation.isPending}
        onConfirm={() => {
          void handleUndoConfirm();
        }}
      />

      <PaymentRescheduleDialog
        open={!!rescheduleCtx}
        onOpenChange={(open) => {
          if (!open) setRescheduleCtx(null);
        }}
        paymentName={rescheduleCtx?.name ?? ""}
        currentDate={rescheduleCtx?.currentDate ?? null}
        showReason={rescheduleCtx?.isRecurring ?? false}
        maxDate={rescheduleMax}
        markedDate={rescheduleNext}
        saving={upsertOverride.isPending || updatePayment.isPending}
        onSubmit={(date, reason) => {
          void handleRescheduleSubmit(date, reason);
        }}
      />

      <PaymentCancelDialog
        open={!!cancelCtx}
        onOpenChange={(open) => {
          if (!open) setCancelCtx(null);
        }}
        payment={cancelCtx}
        saving={upsertOverride.isPending || cancelOccurrence.isPending}
        onConfirm={(reason) => {
          void handleCancelSubmit(reason);
        }}
      />
    </div>
  );
}
