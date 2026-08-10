import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BanknotesIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { MemberFilterChips } from "@/components/common/MemberFilterChips";
import { CategoryFilterChip } from "@/components/budget/CategoryFilterChip";
import { HeaderIconButton, MoneyCard, ProgressTrack } from "@/components/money/moneyUi";
import { PaymentDetailDialog } from "@/components/payments/PaymentDetailDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import { PaymentListSkeleton } from "@/components/payments/PaymentListSkeleton";
import { PaymentOccurrenceDialog } from "@/components/payments/PaymentOccurrenceDialog";
import { PaymentTimeline } from "@/components/payments/PaymentTimeline";
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
  useUpdatePayment,
} from "@/hooks/usePayments";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import { overrideKey, usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import type { Payment, PaymentHistoryStatus, PaymentOverride } from "@/types/database";
import { currentMonthYYYYMM, formatDate } from "@/utils/date";
import { paymentOccurrencesInMonth } from "@/utils/payment";
import { useToday } from "@/hooks/useToday";
import { Amount } from "@/components/common/Amount";
import { matchesCategoryFilter } from "@/utils/categoryFilter";

/* --- Search + pagination constants ----------------------------------------- */

/** Minimum characters before the client-side search kicks in. */
const MIN_SEARCH_CHARS = 2;
/** Rows revealed per show-more click (and the initial page size). */
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
  // override, one-time) occurrences are treated as resolved - they don't enter
  // either total.
  for (const payment of payments) {
    if (!payment.due_date.startsWith(selectedMonth)) continue;
    if (payment.is_paused) continue;
    if (isCanceled(payment.id, payment.due_date)) continue;
    if (payment.is_paid) paidTotal += payment.amount;
    else unpaidTotal += payment.amount;
  }

  // History entries for this month (skip one-time due in this month -
  // already in payment count). Canceled (skipped) occurrences were never paid,
  // so they don't count as paid.
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
      // Which instalments this series has in this month - the same walk the
      // agenda and the budget projection use, so the totals can't disagree
      // with what those surfaces show.
      const occurrences = paymentOccurrencesInMonth(payment, selectedMonth, overridesByKey);

      if (payment.recurrence_period === "weekly") {
        const paidDates = paidDatesByPayment.get(payment.id) ?? new Set<string>();
        for (const { occurrenceDate } of occurrences) {
          if (occurrenceDate === payment.due_date) continue;
          if (paidDates.has(occurrenceDate)) continue;
          unpaidTotal += payment.amount;
        }
        continue;
      }

      if (paymentIdsWithHistoryInMonth.has(payment.id)) continue;
      // monthly / limited fire at most once a month; one-time has no upcoming
      // amount beyond its own real row.
      if (
        (payment.recurrence_period === "monthly" || payment.recurrence_period === "limited") &&
        !hasRealRow &&
        occurrences.length > 0
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
    currency: string;
    original_amount: number | null;
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
  //    live occurrence at `payment.due_date` - display only; the DB row and
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
    // One-time payments due in this month - already shown above as payment rows.
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
        currency: entry.currency,
        original_amount: entry.original_amount,
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
        // One shared occurrence walk for every period - the dates here are the
        // dates the agenda, the budget and the "busy days" dots use, so an
        // override saved from this page is found by all of them.
        const occurrences = paymentOccurrencesInMonth(payment, selectedMonth, overridesByKey);

        if (period === "weekly") {
          // Weekly can fire multiple times in the same month - emit one
          // upcoming row per occurrence that ISN'T the live row and ISN'T
          // already a history row.
          const paidDates = paidDatesByPayment.get(payment.id) ?? new Set<string>();
          for (const { occurrenceDate, effectiveDate } of occurrences) {
            if (occurrenceDate === payment.due_date) continue;
            if (paidDates.has(occurrenceDate)) continue;
            const override = overridesByKey.get(overrideKey(payment.id, occurrenceDate)) ?? null;
            const upcoming: UpcomingRowItem = {
              type: "upcoming",
              id: `upcoming-${payment.id}-${occurrenceDate}`,
              paymentId: payment.id,
              name: payment.name,
              amount: payment.amount,
              currency: payment.currency,
              original_amount: payment.original_amount,
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

        // monthly / limited fire at most once a month, and the live row (the
        // one at payment.due_date) is already drawn above - hence !hasRealRow.
        // one-time: no upcoming rows, only real row in due month.
        if (period === "monthly" || period === "limited") {
          const occurrence = hasRealRow ? null : (occurrences[0] ?? null);
          if (occurrence) {
            const { occurrenceDate, effectiveDate } = occurrence;
            const override = overridesByKey.get(overrideKey(payment.id, occurrenceDate)) ?? null;
            const upcoming: UpcomingRowItem = {
              type: "upcoming",
              id: `upcoming-${payment.id}-${selectedMonth}`,
              paymentId: payment.id,
              name: payment.name,
              amount: payment.amount,
              currency: payment.currency,
              original_amount: payment.original_amount,
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
      }
    }
  }

  items.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return items;
}

/* --- The page itself ------------------------------------------------------ */

export interface PaymentsPageProps {
  /** "YYYY-MM" or "all" (every payment), owned by the Money hub's month pager. */
  month: string;
  /** Hub-owned search term; while active it spans ALL months. */
  searchTerm: string;
  /** Header node the hub lends this view for its "Dodaj" (null until mounted). */
  addSlot: HTMLElement | null;
}

/**
 * The payments view of Money: this month's bills, every status, grouped by
 * day. The month, the search field and the QR scanner live in the hub header
 * (see `MoneyScreen`); everything below - person filter, the resolved-rows
 * toggle, and the whole dialog layer - stays here.
 */
export function PaymentsPage({ month, searchTerm, addSlot }: PaymentsPageProps) {
  // The hub owns the month; "all" (every payment) is picked in its pager.
  const selectedMonth = month;
  // Resolved (paid/canceled) rows are hidden by default - the list opens with
  // what's still outstanding. Revealing them is a chip AND the
  // hidden-count link under the list.
  const [showPaid, setShowPaid] = useState(false);
  const searchActive = searchTerm.trim().length >= MIN_SEARCH_CHARS;
  // Person + category filters - same convention as the dashboard's person
  // facet: an empty set means "no filter"; a non-empty set narrows to those.
  const [selectedPersonIds, setSelectedPersonIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Form dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editingHasHistory, setEditingHasHistory] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Starter-chip prefill ("+ Kirija" on the empty state) - seeds the add
  // form's name via the dialog's reseed effect.
  const [addInitialName, setAddInitialName] = useState<string | null>(null);

  // Detail popups - the live occurrence gets the full manage dialog; paid /
  // skipped / upcoming rows get the read-only occurrence dialog.
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<
    HistoryRowItem | UpcomingRowItem | null
  >(null);

  // Data - always fetch everything (hidePaid is a client-side display toggle here, matching Vue)
  const paymentsQuery = usePaymentsList({ hidePaid: false });
  const historyQuery = usePaymentHistory();
  const { byPayment } = usePaymentParticipants();
  const { byKey: overridesByKey } = usePaymentOverrides();

  // Mutations - the detail dialogs own the rest (mark paid, pause, reschedule,
  // cancel, delete, undo), so the page keeps only create/edit.
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();

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

  // A history row carries no category of its own - the category classifies the
  // SERIES, not the instalment (see the payment→expense sync trigger), so the
  // live payment is the only place to read it from. `payment_id` is NOT NULL
  // with ON DELETE CASCADE, so every history row still has one.
  const categoryByPayment = useMemo(
    () => new Map(payments.map((p) => [p.id, p.category_id])),
    [payments],
  );

  // Person and category filters applied at the source, so the list AND the
  // month summary both reflect the selection. Same semantics as
  // `matchesAgendaFilter` on the dashboard: empty selection shows everything;
  // with members selected only payments assigned to at least one of them pass
  // (unassigned ones hide).
  const visiblePayments = useMemo(() => {
    if (selectedPersonIds.size === 0 && selectedCategoryIds.size === 0) return payments;
    return payments.filter((p) => {
      if (
        selectedPersonIds.size > 0 &&
        !(byPayment.get(p.id) ?? []).some((id) => selectedPersonIds.has(id))
      ) {
        return false;
      }
      return matchesCategoryFilter(p.category_id, selectedCategoryIds);
    });
  }, [payments, byPayment, selectedPersonIds, selectedCategoryIds]);

  const visibleHistory = useMemo(() => {
    if (selectedPersonIds.size === 0 && selectedCategoryIds.size === 0) return history;
    return history.filter((entry) => {
      if (
        selectedPersonIds.size > 0 &&
        !(byPayment.get(entry.payment_id) ?? []).some((id) => selectedPersonIds.has(id))
      ) {
        return false;
      }
      return matchesCategoryFilter(
        categoryByPayment.get(entry.payment_id) ?? null,
        selectedCategoryIds,
      );
    });
  }, [history, byPayment, categoryByPayment, selectedPersonIds, selectedCategoryIds]);

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
  // month, ignoring the hide-paid toggle), newest due date first. The month and
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
    if (showPaid) return combinedList;
    return combinedList.filter((item) => {
      // The default view hides everything RESOLVED - paid AND canceled - so the
      // list shows only what's still outstanding. Paused rows stay (they're on
      // hold, not done); resolved occurrences remain in the history popup.
      if (item.type === "history") return false;
      if (item.type === "payment" && item.is_paid) return false;
      const override = "override" in item ? item.override : null;
      if (override?.action === "cancel") return false;
      return true;
    });
  }, [searchActive, searchResults, combinedList, showPaid]);

  // How many resolved rows the default view is hiding - feeds the quiet
  // hidden-count link under the list.
  const hiddenResolvedCount =
    searchActive || showPaid ? 0 : combinedList.length - displayedList.length;

  // Long lists (all-time view, search) reveal in pages of PAGE_SIZE.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedMonth, showPaid, searchTerm, selectedPersonIds, selectedCategoryIds]);
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

  // Counts + next due date for the month summary card (a paid-of-total count, the next due date:
  // 15.07."). Canceled and paused occurrences are neither paid nor due.
  const { str: todayStr } = useToday();
  const monthStats = useMemo(() => {
    if (selectedMonth === "all") return null;
    let paidCount = 0;
    let dueCount = 0;
    let nextDue: string | null = null;
    for (const item of combinedList) {
      const override = "override" in item ? item.override : null;
      if (override?.action === "cancel") continue;
      if (item.type === "history") {
        if (item.status === "paid") paidCount += 1;
        continue;
      }
      if (item.type === "payment") {
        if (item.is_paused) continue;
        if (item.is_paid) {
          paidCount += 1;
          continue;
        }
      }
      dueCount += 1;
      if (item.due_date >= todayStr && (nextDue === null || item.due_date < nextDue)) {
        nextDue = item.due_date;
      }
    }
    return { paidCount, totalCount: paidCount + dueCount, nextDue };
  }, [combinedList, selectedMonth, todayStr]);

  const filtersActive = selectedPersonIds.size > 0 || selectedCategoryIds.size > 0 || showPaid;
  const resetFilters = () => {
    setSelectedPersonIds(new Set());
    setSelectedCategoryIds(new Set());
    setShowPaid(false);
  };

  const isLoading = paymentsQuery.isLoading || historyQuery.isLoading;
  const showEmpty = !isLoading && displayedList.length === 0;
  const emptyListMessage = searchActive
    ? "Nema plaćanja koja odgovaraju pretrazi."
    : combinedList.length === 0
      ? selectedPersonIds.size > 0 || selectedCategoryIds.size > 0
        ? "Nema plaćanja za izabrane filtere."
        : "Nema plaćanja za prikaz."
      : "Nema neplaćenih stavki - sve za ovaj mesec je rešeno. 🎉";

  /* --- Action handlers -------------------------------------------------- */

  const openAdd = () => {
    setEditingPayment(null);
    setEditingHasHistory(false);
    setFormError(null);
    setAddInitialName(null);
    setDialogOpen(true);
  };

  const openAddWithName = (name: string) => {
    setEditingPayment(null);
    setEditingHasHistory(false);
    setFormError(null);
    setAddInitialName(name);
    setDialogOpen(true);
  };

  const openEdit = async (payment: Payment) => {
    setEditingPayment(payment);
    setFormError(null);
    setDialogOpen(true);
    // Async - disable recurrence radios if payment_history exists.
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
      setAddInitialName(null);
    }
  };

  // Row tap → the right detail popup. The live occurrence carries the full
  // manage dialog (mark paid / pause / reschedule / cancel / delete / edit);
  // paid, skipped and upcoming rows open the read-only occurrence dialog. The
  // live row's `due_date` is the EFFECTIVE (rescheduled) date, but the manage
  // dialog keys overrides off the ORIGINAL due_date - so hand it the raw
  // payment from the query, not the transformed row item.
  const handleSelect = (item: PaymentListItemUnion) => {
    if (item.type === "payment") {
      setSelectedPayment(payments.find((p) => p.id === item.id) ?? null);
    } else {
      setSelectedOccurrence(item);
    }
  };

  // Underlying series row for the selected occurrence (history / upcoming) -
  // powers that dialog's edit / history / undo.
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
      {/* The bottom bar's "+" is the touch entry point; on desktop the button
          sits in the Novac header with the rest of the chrome, so it stays put
          across all three tabs instead of floating over each view's content. */}
      {addSlot
        ? createPortal(
            <HeaderIconButton
              icon={PlusIcon}
              label="Dodaj plaćanje"
              onClick={openAdd}
              className="hidden lg:grid"
            />,
            addSlot,
          )
        : null}

      {/* One swipeable line, same shape as Danas / Kalendar / Aktivnosti: the
          neutral chip first, then the facets, then a chip per member. The
          members used to hide behind a sheet trigger here alone, which meant
          two different member pickers in one app. */}
      <FilterChipRow className="mb-3" ariaLabel="Filter plaćanja">
        <FilterChip active={!filtersActive} onToggle={resetFilters}>
          Sva
        </FilterChip>
        <CategoryFilterChip selected={selectedCategoryIds} onChange={setSelectedCategoryIds} />
        <FilterChip active={showPaid} onToggle={() => setShowPaid((v) => !v)}>
          Samo plaćena
        </FilterChip>
        {/* Same member chips as Danas / Kalendar, emoji and all - this row used
            to draw its own, without them. One member = nobody to narrow to, and
            the shared component drops itself on that rule. */}
        <MemberFilterChips selected={selectedPersonIds} onToggle={togglePerson} />
      </FilterChipRow>

      {/* Summary - one card: how far through the month's bills we are. */}
      {!searchActive && combinedList.length > 0 ? (
        summary.type === "all" ? (
          <MoneyCard className="px-3.5 py-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              <span className="size-1.5 rounded-full bg-warn" />
              Ukupno za platiti
            </div>
            <div className="mt-1 text-[22px] font-bold tracking-[-0.03em] tabular-nums">
              <Amount value={summary.total} />
            </div>
          </MoneyCard>
        ) : (
          <MoneyCard className="px-3.5 py-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Plaćeno ovog meseca
              </span>
              {monthStats && monthStats.totalCount > 0 ? (
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {monthStats.paidCount} od {monthStats.totalCount}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-[22px] font-bold tracking-[-0.03em] tabular-nums">
                <Amount value={summary.paidTotal} />
              </span>
              <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
                od <Amount value={summary.paidTotal + summary.unpaidTotal} />
              </span>
            </div>
            <ProgressTrack
              className="mt-2.5"
              segments={[
                {
                  key: "paid",
                  pct:
                    summary.paidTotal + summary.unpaidTotal > 0
                      ? Math.max(
                          (summary.paidTotal / (summary.paidTotal + summary.unpaidTotal)) * 100,
                          summary.paidTotal > 0 ? 2 : 0,
                        )
                      : 0,
                  className: "bg-pos",
                },
              ]}
            />
            <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px] font-normal text-muted-foreground">
              {summary.unpaidTotal > 0 ? (
                <span>
                  Preostalo{" "}
                  <span className="font-bold tabular-nums text-foreground">
                    <Amount value={summary.unpaidTotal} />
                  </span>
                </span>
              ) : (
                <span className="font-semibold text-pos">Sve je plaćeno 🎉</span>
              )}
              {monthStats?.nextDue && summary.unpaidTotal > 0 ? (
                <span>Sledeće: {formatDate(monthStats.nextDue)}</span>
              ) : null}
            </div>
          </MoneyCard>
        )
      ) : null}

      {searchActive ? (
        <p className="mt-3 text-xs font-normal text-muted-foreground">
          Rezultati pretrage obuhvataju sve mesece (filteri meseca i plaćenih se ne primenjuju).
        </p>
      ) : null}

      {isLoading ? <PaymentListSkeleton className="mt-6" /> : null}

      {showEmpty ? (
        payments.length === 0 && history.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={BanknotesIcon}
            tone="amber"
            title="Sva porodična plaćanja na jednom mestu"
            description="Kirija, struja, vrtić... Dodaj plaćanje i stiže podsetnik pre roka."
            action={{ label: "Dodaj plaćanje", onClick: openAdd }}
            examples={["Kirija", "Struja", "Internet", "Vrtić"].map((name) => ({
              label: name,
              onClick: () => openAddWithName(name),
            }))}
          />
        ) : (
          <EmptyState className="mt-6" variant="filter" description={emptyListMessage} />
        )
      ) : null}

      {!isLoading && pagedList.length > 0 ? (
        <div className="mt-4">
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

      {/* Quiet reveal for the default hide-resolved view (Gmail-style). */}
      {hiddenResolvedCount > 0 ? (
        <div className="mt-4 text-center text-[12.5px] font-normal text-muted-foreground">
          Sakriveno {hiddenResolvedCount}{" "}
          {hiddenResolvedCount === 1 ? "plaćeno/otkazano" : "plaćenih/otkazanih"} ·{" "}
          <button
            type="button"
            onClick={() => setShowPaid(true)}
            className="px-1 py-1.5 font-bold text-accent-deep underline-offset-4 hover:underline"
          >
            Prikaži
          </button>
        </div>
      ) : null}

      <PaymentFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        payment={editingPayment}
        initialName={addInitialName ?? undefined}
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
      />
    </div>
  );
}
