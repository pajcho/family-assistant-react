import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EyeSlashIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddButton } from "@/components/common/AddButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MonthPicker } from "@/components/common/PeriodPicker";
import { PersonFilterChips } from "@/components/common/PersonFilterChips";
import { ToggleChip } from "@/components/common/ToggleChip";
import { LinkedEntityEditor } from "@/components/payments/LinkedEntityEditor";
import { PaymentCancelDialog } from "@/components/payments/PaymentCancelDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import { PaymentListSkeleton } from "@/components/payments/PaymentListSkeleton";
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
import { usePaymentLinkTargets, type PaymentLinkTarget } from "@/hooks/usePaymentLinks";
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

/* --- Search + pagination constants ----------------------------------------- */

/** Minimum characters before the client-side search kicks in. */
const MIN_SEARCH_CHARS = 2;
/** Rows revealed per "Prikaži još" click (and the initial page size). */
const PAGE_SIZE = 30;

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
  // Filters — default to the CURRENT month (the "Sva plaćanja" all-time view
  // lives inside the month picker's popup).
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthYYYYMM());
  const [hidePaid, setHidePaid] = useState(true);
  // Free-text search over name + description. While active it spans ALL
  // months (the month filter would hide the thing you're looking for).
  const [searchTerm, setSearchTerm] = useState("");
  const searchActive = searchTerm.trim().length >= MIN_SEARCH_CHARS;
  // Person filter — same convention as the dashboard's person facet: an empty
  // set means "no filter"; a non-empty set narrows to those members.
  const [selectedPersonIds, setSelectedPersonIds] = useState<ReadonlySet<string>>(() => new Set());

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

  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);
  const history = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

  // "Povezano sa" chips — resolve every linked payment's target once for the
  // whole list; tapping one opens the linked entity's edit form IN PLACE
  // (LinkedEntityEditor) instead of navigating away.
  const [linkEditTarget, setLinkEditTarget] = useState<PaymentLinkTarget | null>(null);
  const { targetFor } = usePaymentLinkTargets(payments);
  const handleOpenLink = (target: PaymentLinkTarget) => {
    setLinkEditTarget(target);
  };

  const togglePerson = (personId: string) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  // Person filter applied at the source, so the list AND the month summary
  // both reflect the selection. Same semantics as `matchesAgendaFilter` on the
  // dashboard: empty selection shows everything; with members selected only
  // payments assigned to at least one of them pass (unassigned ones hide).
  const visiblePayments = useMemo(() => {
    if (selectedPersonIds.size === 0) return payments;
    return payments.filter((p) =>
      (byPayment.get(p.id) ?? []).some((id) => selectedPersonIds.has(id)),
    );
  }, [payments, byPayment, selectedPersonIds]);

  const visibleHistory = useMemo(() => {
    if (selectedPersonIds.size === 0) return history;
    return history.filter((entry) =>
      (byPayment.get(entry.payment_id) ?? []).some((id) => selectedPersonIds.has(id)),
    );
  }, [history, byPayment, selectedPersonIds]);

  const combinedList = useMemo(
    () =>
      computeCombinedList({
        payments: visiblePayments,
        history: visibleHistory,
        selectedMonth,
        overridesByKey,
      }),
    [visiblePayments, visibleHistory, selectedMonth, overridesByKey],
  );

  // Search mode: match name/description over ALL payments (live rows, every
  // month, ignoring "Sakrij plaćena"), newest due date first. The month and
  // paid filters would hide exactly what the user is trying to find.
  const searchResults = useMemo<PaymentListItemUnion[]>(() => {
    if (!searchActive) return [];
    const q = searchTerm.trim().toLowerCase();
    const items: PaymentListItemUnion[] = visiblePayments
      .filter(
        (p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q),
      )
      .map((payment) => {
        const override = overridesByKey.get(overrideKey(payment.id, payment.due_date)) ?? null;
        const effectiveDate =
          override?.action === "reschedule" && override.override_date
            ? override.override_date
            : payment.due_date;
        return {
          ...payment,
          type: "payment" as const,
          occurrenceDate: payment.due_date,
          override,
          due_date: effectiveDate,
        };
      });
    items.sort((a, b) => b.due_date.localeCompare(a.due_date));
    return items;
  }, [searchActive, searchTerm, visiblePayments, overridesByKey]);

  const displayedList = useMemo<PaymentListItemUnion[]>(() => {
    if (searchActive) return searchResults;
    if (!hidePaid) return combinedList;
    return combinedList.filter((item) => {
      // Keep canceled history visible (so skips stay on screen); hide paid.
      if (item.type === "history") return item.status === "canceled";
      return !(item.type === "payment" && item.is_paid);
    });
  }, [searchActive, searchResults, combinedList, hidePaid]);

  // Long lists (all-time view, search) reveal in pages of PAGE_SIZE.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedMonth, hidePaid, searchTerm, selectedPersonIds]);
  const pagedList = useMemo(
    () => displayedList.slice(0, visibleCount),
    [displayedList, visibleCount],
  );
  const remainingCount = displayedList.length - pagedList.length;

  const summary = useMemo(
    () =>
      computeSummary({
        payments: visiblePayments,
        history: visibleHistory,
        selectedMonth,
        overridesByKey,
      }),
    [visiblePayments, visibleHistory, selectedMonth, overridesByKey],
  );

  const isLoading = paymentsQuery.isLoading || historyQuery.isLoading;
  const showEmpty = !isLoading && displayedList.length === 0;
  const emptyListMessage = searchActive
    ? "Nema plaćanja koja odgovaraju pretrazi."
    : combinedList.length === 0
      ? selectedPersonIds.size > 0
        ? "Nema plaćanja za izabrane članove."
        : "Nema plaćanja za prikaz."
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
        <AddButton label="Dodaj plaćanje" onClick={openAdd} />
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            allOptionLabel="Sva plaćanja"
          />
          <div className="relative min-w-0 flex-1 basis-52">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pretraži plaćanja…"
              aria-label="Pretraži plaćanja"
              className="pl-9"
            />
            {searchTerm ? (
              <button
                type="button"
                aria-label="Obriši pretragu"
                onClick={() => setSearchTerm("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100"
              >
                <XMarkIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PersonFilterChips selected={selectedPersonIds} onToggle={togglePerson} />
          <ToggleChip
            active={hidePaid}
            onToggle={() => setHidePaid((prev) => !prev)}
            icon={EyeSlashIcon}
          >
            Sakrij plaćena
          </ToggleChip>
        </div>
      </div>

      {searchActive ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Rezultati pretrage obuhvataju sve mesece (filteri meseca i plaćenih se ne primenjuju).
        </p>
      ) : null}

      {isLoading ? <PaymentListSkeleton className="mt-6" /> : null}

      {showEmpty ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          {emptyListMessage}
        </div>
      ) : null}

      {!isLoading && pagedList.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {pagedList.map((item) => (
            <li key={item.id} className={cn("rounded-lg p-4 shadow-sm", getItemClass(item))}>
              <PaymentListItem
                item={item}
                personIds={byPayment.get(paymentIdForItem(item)) ?? []}
                linkTarget={item.type === "payment" ? targetFor(item) : null}
                onOpenLink={handleOpenLink}
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

      {remainingCount > 0 ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            Prikaži još ({remainingCount})
          </Button>
        </div>
      ) : null}

      {!searchActive && combinedList.length > 0 ? (
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

      {/* "Povezano sa" chip → edit the linked entity right here, no redirect. */}
      <LinkedEntityEditor target={linkEditTarget} onClose={() => setLinkEditTarget(null)} />
    </div>
  );
}
