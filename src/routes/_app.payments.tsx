import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EyeSlashIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddButton } from "@/components/common/AddButton";
import { MonthPicker } from "@/components/common/PeriodPicker";
import { PersonFilterChips } from "@/components/common/PersonFilterChips";
import { ToggleChip } from "@/components/common/ToggleChip";
import { PaymentDetailDialog } from "@/components/dashboard/PaymentDetailDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import { PaymentListSkeleton } from "@/components/payments/PaymentListSkeleton";
import { PaymentOccurrenceDialog } from "@/components/payments/PaymentOccurrenceDialog";
import { PaymentTimeline } from "@/components/payments/PaymentTimeline";
import { PaymentUndoDialog } from "@/components/payments/PaymentUndoDialog";
import type {
  HistoryRowItem,
  PaymentListItemUnion,
  UpcomingRowItem,
} from "@/components/payments/paymentRowTypes";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import {
  hasPaymentHistory,
  useCreatePayment,
  usePaymentHistory,
  usePaymentsList,
  useUndoLastPayment,
  useUpdatePayment,
} from "@/hooks/usePayments";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { overrideKey, usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import type { Payment, PaymentHistoryStatus, PaymentOverride } from "@/types/database";
import {
  currentMonthYYYYMM,
  getDueDateInMonth,
  getLimitedMonths as getLimitedMonthsFromDate,
  getWeeklyOccurrencesInMonth,
  isMonthlyOccurrenceMonth,
} from "@/utils/date";
import { formatAmount } from "@/utils/format";

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
    status: PaymentHistoryStatus;
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

  // Payments for this month (real rows). Paused and canceled (soft-cancel
  // override, one-time) occurrences are treated as resolved — they don't enter
  // either total.
  for (const payment of payments) {
    if (!payment.due_date.startsWith(selectedMonth)) continue;
    if (payment.is_paused) continue;
    if (isCanceled(payment.id, payment.due_date)) continue;
    if (payment.is_paid) paidTotal += payment.amount;
    else unpaidTotal += payment.amount;
  }

  // History entries for this month (skip one-time due in this month —
  // already in payment count). Canceled (skipped) occurrences were never paid,
  // so they don't count toward "Plaćeno".
  const oneTimePaymentIdsInMonth = new Set(
    payments
      .filter((p) => p.recurrence_period === "one-time" && p.due_date.startsWith(selectedMonth))
      .map((p) => p.id),
  );
  for (const entry of history) {
    if (!entry.due_date.startsWith(selectedMonth)) continue;
    if (entry.status === "canceled") continue;
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
    name: string | null;
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
        // Snapshot name from the occurrence (frozen at pay/cancel time), falling
        // back to the live payment name for pre-migration rows.
        name: entry.name ?? paymentNameMap.get(entry.payment_id) ?? "Nepoznato plaćanje",
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

  // Form dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editingHasHistory, setEditingHasHistory] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail popups — the live occurrence gets the full manage dialog; paid /
  // skipped / upcoming rows get the read-only occurrence dialog.
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<
    HistoryRowItem | UpcomingRowItem | null
  >(null);

  // Undo confirmation (from the occurrence popup's "Poništi")
  const [undoDialogOpen, setUndoDialogOpen] = useState(false);
  const [historyToUndo, setHistoryToUndo] = useState<HistoryRowItem | null>(null);

  // Data — always fetch everything (hidePaid is a client-side display toggle here, matching Vue)
  const paymentsQuery = usePaymentsList({ hidePaid: false });
  const historyQuery = usePaymentHistory();
  const { byPayment } = usePaymentParticipants();
  const { byKey: overridesByKey } = usePaymentOverrides();

  // Mutations — the detail dialogs own the rest (mark paid, pause, reschedule,
  // cancel, delete), so the page keeps only create/edit + undo.
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const undoMutation = useUndoLastPayment();

  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);
  const history = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

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
      // "Sakrij plaćena" hides everything RESOLVED — paid AND canceled — so the
      // list shows only what's still outstanding. Paused rows stay (they're on
      // hold, not done); resolved occurrences remain in the history popup.
      if (item.type === "history") return false;
      if (item.type === "payment" && item.is_paid) return false;
      const override = "override" in item ? item.override : null;
      if (override?.action === "cancel") return false;
      return true;
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
      : 'Nema neplaćenih stavki. Sve je plaćeno ili otkazano i sakriveno filtom "Sakrij plaćena".';

  /* --- Action handlers -------------------------------------------------- */

  const openAdd = () => {
    setEditingPayment(null);
    setEditingHasHistory(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = async (payment: Payment) => {
    setEditingPayment(payment);
    setFormError(null);
    setDialogOpen(true);
    // Async — disable recurrence radios if payment_history exists.
    try {
      setEditingHasHistory(await hasPaymentHistory(payment.id));
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

  // Row tap → the right detail popup. The live occurrence carries the full
  // manage dialog (mark paid / pause / reschedule / cancel / delete / edit);
  // paid, skipped and upcoming rows open the read-only occurrence dialog. The
  // live row's `due_date` is the EFFECTIVE (rescheduled) date, but the manage
  // dialog keys overrides off the ORIGINAL due_date — so hand it the raw
  // payment from the query, not the transformed row item.
  const handleSelect = (item: PaymentListItemUnion) => {
    if (item.type === "payment") {
      setSelectedPayment(payments.find((p) => p.id === item.id) ?? null);
    } else {
      setSelectedOccurrence(item);
    }
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

  // Underlying series row for the selected occurrence (history / upcoming) —
  // powers that dialog's Izmeni / Istorija / Poništi.
  const occurrencePaymentId = selectedOccurrence
    ? selectedOccurrence.type === "history"
      ? selectedOccurrence.payment_id
      : selectedOccurrence.paymentId
    : null;
  const occurrencePayment = occurrencePaymentId
    ? (payments.find((p) => p.id === occurrencePaymentId) ?? null)
    : null;

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

      {/* Summary — pinned above the list: what's still due vs already paid. */}
      {!searchActive && combinedList.length > 0 ? (
        summary.type === "all" ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Ukupno za platiti
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {formatAmount(summary.total)}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                <span className="size-1.5 rounded-full bg-amber-500" />
                Za platiti
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatAmount(summary.unpaidTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Plaćeno
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatAmount(summary.paidTotal)}
              </div>
            </div>
          </div>
        )
      ) : null}

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
        <div className="mt-6">
          <PaymentTimeline
            items={pagedList}
            byPayment={byPayment}
            onSelect={handleSelect}
            flat={searchActive}
          />
        </div>
      ) : null}

      {remainingCount > 0 ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            Prikaži još ({remainingCount})
          </Button>
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

      <PaymentDetailDialog
        open={!!selectedPayment}
        onOpenChange={(open) => {
          if (!open) setSelectedPayment(null);
        }}
        payment={selectedPayment}
        personIds={selectedPayment ? (byPayment.get(selectedPayment.id) ?? []) : []}
        onEdit={(p) => {
          void openEdit(p);
        }}
        variant="manage"
      />

      <PaymentOccurrenceDialog
        open={!!selectedOccurrence}
        onOpenChange={(open) => {
          if (!open) setSelectedOccurrence(null);
        }}
        item={selectedOccurrence}
        personIds={occurrencePaymentId ? (byPayment.get(occurrencePaymentId) ?? []) : []}
        payment={occurrencePayment}
        onEdit={(p) => {
          void openEdit(p);
        }}
        onUndo={confirmUndo}
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
    </div>
  );
}
