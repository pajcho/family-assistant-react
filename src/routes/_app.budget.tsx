import { lazy, Suspense, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BanknotesIcon,
  ChevronRightIcon,
  LockClosedIcon,
  ReceiptPercentIcon,
} from "@heroicons/react/24/outline";

import { Amount, AmountOriginal } from "@/components/common/Amount";
import { FilterBar } from "@/components/common/FilterBar";
import {
  AppliedFilterChips,
  FilterSection,
  FilterSheet,
  useMemberAppliedFilters,
} from "@/components/common/FilterSheet";
import { MonthPicker } from "@/components/common/PeriodPicker";
import { PersonFilterChips } from "@/components/common/PersonFilterChips";
import { ToggleChip } from "@/components/common/ToggleChip";
import { useToday } from "@/hooks/useToday";
import { BudgetAddMenu } from "@/components/budget/BudgetAddMenu";
import { CategoryDetailSheet } from "@/components/budget/CategoryDetailSheet";
import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import { ReceiptExpenseDialog } from "@/components/budget/ReceiptExpenseDialog";
import { IncomesSheet } from "@/components/budget/IncomesSheet";
import { CategoriesSheet } from "@/components/budget/CategoriesSheet";
import { BudgetTrend } from "@/components/budget/BudgetTrend";
import { BudgetTimeline } from "@/components/budget/BudgetTimeline";
import { PaymentDetailDialog } from "@/components/dashboard/PaymentDetailDialog";
import { PaymentFormDialog } from "@/components/payments/PaymentFormDialog";
import type { PaymentFormPayload } from "@/components/payments/PaymentForm";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { categoryIcon } from "@/components/budget/categoryIcons";
import {
  MIN_EXPENSE_SEARCH_CHARS,
  useCreateExpense,
  useDeleteExpense,
  useExpenses,
  useExpenseSearch,
  useReceiptItemCounts,
  useUpdateExpense,
  type ExpenseSearchHit,
} from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useIncomes } from "@/hooks/useIncomes";
import { useIncomeEntries } from "@/hooks/useIncomeEntries";
import { hasPaymentHistory, usePaymentsList, useUpdatePayment } from "@/hooks/usePayments";
import { usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import type { Expense, ExpenseCategory, Payment } from "@/types/database";
import { currentMonthYYYYMM, formatDate } from "@/utils/date";
import { computeMonthlyCycle, monthLabel, monthRange, shiftMonth } from "@/utils/budget";
import { cn } from "@/lib/cn";

// Lazy chunk: the scanner pulls in the camera code + jsQR, so it must stay out
// of the main bundle. Loaded on the first "Skeniraj račun".
const ReceiptScanDialog = lazy(() => import("@/components/budget/receipt/ReceiptScanDialog"));

export const Route = createFileRoute("/_app/budget")({
  component: BudgetPage,
});

const UNCATEGORIZED = "__none__";

type CategoryBreakdown = {
  key: string;
  name: string;
  color: string;
  icon: string;
  total: number;
  count: number;
};

/** Expense-source facet for the budget filter sheet. */
const SOURCE_OPTIONS = [
  { key: "manual", label: "Ručno" },
  { key: "receipt", label: "Račun" },
  { key: "payment", label: "Iz plaćanja" },
] as const;

function BudgetPage() {
  const [month, setMonth] = useState<string>(() => currentMonthYYYYMM());
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<Expense | null>(null);
  // Payment-sourced expense tapped → open that payment's detail popup.
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  // Its "Izmeni" opens the payment edit form INLINE (no /payments redirect).
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentHasHistory, setPaymentHasHistory] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [incomesOpen, setIncomesOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  // Category drill-down (tap on a "Po kategorijama" row).
  const [categoryDetail, setCategoryDetail] = useState<CategoryBreakdown | null>(null);
  // Filter sheet: person + expense source, both with the empty-set = "no
  // filter" convention. They narrow the VISIBLE lists (breakdown, timeline,
  // modules) — the cycle summary stays family-level.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedPersonIds, setSelectedPersonIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(() => new Set());
  // "Projekcija do kraja meseca" row — collapsed by default, tap to expand.
  const [projOpen, setProjOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Stays true after the first open so the lazy chunk loads once and the close
  // animation can play; the dialog releases the camera whenever `open` is false.
  const [scanMounted, setScanMounted] = useState(false);

  // Search (note/merchant + receipt line items) — spans ALL months, so while
  // active it replaces the month sections below.
  const [searchTerm, setSearchTerm] = useState("");
  const search = useExpenseSearch(searchTerm);
  const searchActive = searchTerm.trim().length >= MIN_EXPENSE_SEARCH_CHARS;

  const currentMonth = currentMonthYYYYMM();
  const range = useMemo(() => monthRange(month), [month]);
  const { expenses, isLoading } = useExpenses(range);
  // Previous month, for the "+14% vs jun" comparison up to the same day.
  const prevMonth = useMemo(() => shiftMonth(month, -1), [month]);
  const prevRange = useMemo(() => monthRange(prevMonth), [prevMonth]);
  const { expenses: prevExpenses } = useExpenses(prevRange);
  const { categories, byId: categoriesById } = useExpenseCategories();
  const { incomes } = useIncomes();
  const { entries: incomeEntries } = useIncomeEntries(month);
  const paymentsQuery = usePaymentsList({ hidePaid: false });
  const { byKey: paymentOverrides } = usePaymentOverrides();
  const { byPayment } = usePaymentParticipants();

  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const updatePayment = useUpdatePayment();

  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);

  // Person/source filters narrow what the lists show. The cycle summary
  // (Prihodi/Potrošeno/Preostalo) intentionally stays family-level — income
  // isn't per-person, so a filtered "Preostalo" would lie.
  const filteredExpenses = useMemo(() => {
    if (selectedPersonIds.size === 0 && selectedSources.size === 0) return expenses;
    return expenses.filter((e) => {
      if (selectedPersonIds.size > 0 && !(e.person_id && selectedPersonIds.has(e.person_id))) {
        return false;
      }
      if (selectedSources.size > 0 && !selectedSources.has(e.source)) return false;
      return true;
    });
  }, [expenses, selectedPersonIds, selectedSources]);

  const togglePerson = (personId: string) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };
  const toggleSource = (source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };
  const filterCount = selectedPersonIds.size + selectedSources.size;
  const resetFilters = () => {
    setSelectedPersonIds(new Set());
    setSelectedSources(new Set());
  };
  const memberApplied = useMemberAppliedFilters(selectedPersonIds, togglePerson);
  const appliedFilters = [
    ...memberApplied,
    ...SOURCE_OPTIONS.filter((o) => selectedSources.has(o.key)).map((o) => ({
      key: `source-${o.key}`,
      label: o.label,
      onRemove: () => toggleSource(o.key),
    })),
  ];

  const cycle = useMemo(
    () =>
      computeMonthlyCycle({
        month,
        currentMonth,
        incomes,
        incomeEntries,
        expenses,
        payments,
        paymentOverrides,
        categories,
      }),
    [month, currentMonth, incomes, incomeEntries, expenses, payments, paymentOverrides, categories],
  );

  // Share of confirmed income already spent — fills the budget bar and picks its
  // color (green under 75%, amber 75–100%, red once over budget).
  const spentPct = cycle.confirmedIncome > 0 ? (cycle.totalSpent / cycle.confirmedIncome) * 100 : 0;
  const budgetBarColor = spentPct >= 100 ? "#ef4444" : spentPct >= 75 ? "#f59e0b" : "#10b981";

  // Safe-to-spend pace + month-over-month delta — current month only (pace
  // means nothing for history, and MoM compares "up to the same day").
  const { date: todayDate, str: todayStr } = useToday();
  const isCurrentMonth = month === currentMonth;
  const dailyPace = useMemo(() => {
    if (!isCurrentMonth || !cycle.hasIncome || cycle.remaining <= 0) return null;
    const lastDay = Number(range.to.slice(8, 10));
    const daysLeft = Math.max(1, lastDay - todayDate.getDate() + 1);
    return Math.round(cycle.remaining / daysLeft);
  }, [isCurrentMonth, cycle.hasIncome, cycle.remaining, range.to, todayDate]);
  const momDelta = useMemo(() => {
    if (!isCurrentMonth || cycle.totalSpent <= 0) return null;
    const dayCut = todayStr.slice(8, 10);
    const prevToDate = prevExpenses.reduce(
      (sum, e) => (e.spent_on.slice(8, 10) <= dayCut ? sum + e.amount : sum),
      0,
    );
    if (prevToDate <= 0) return null;
    return {
      pct: Math.round(((cycle.totalSpent - prevToDate) / prevToDate) * 100),
      prevLabel: monthLabel(prevMonth).split(" ")[0].toLowerCase(),
    };
  }, [isCurrentMonth, cycle.totalSpent, todayStr, prevExpenses, prevMonth]);

  // Recurring sources not yet confirmed for THIS month — the "potvrdi platu"
  // reminder. Only surfaced for the current month (don't nag while browsing
  // history); confirming happens in the Prihodi sheet.
  const pendingIncomeCount = useMemo(() => {
    if (month !== currentMonth) return 0;
    const confirmedSourceIds = new Set(
      incomeEntries.filter((e) => e.income_id).map((e) => e.income_id),
    );
    return incomes.filter((i) => i.active && !confirmedSourceIds.has(i.id)).length;
  }, [month, currentMonth, incomes, incomeEntries]);

  // Per-category totals, sorted most-spent first (an "Bez kategorije" bucket
  // collects null-category rows).
  const breakdown = useMemo<CategoryBreakdown[]>(() => {
    const totals = new Map<string, { total: number; count: number }>();
    for (const e of filteredExpenses) {
      const key = e.category_id ?? UNCATEGORIZED;
      const cur = totals.get(key) ?? { total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      totals.set(key, cur);
    }
    const rows: CategoryBreakdown[] = [];
    for (const [key, { total, count }] of totals) {
      if (key === UNCATEGORIZED) {
        rows.push({ key, name: "Bez kategorije", color: "#9ca3af", icon: "tag", total, count });
      } else {
        const c = categoriesById.get(key);
        rows.push({
          key,
          name: c?.name ?? "Kategorija",
          color: c?.color ?? "#9ca3af",
          icon: c?.icon ?? "tag",
          total,
          count,
        });
      }
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [filteredExpenses, categoriesById]);

  const maxCategoryTotal = breakdown.length > 0 ? breakdown[0].total : 0;

  // Line-item counts for the month's receipt rows (the "N stavki" subtitle).
  const receiptExpenseIds = useMemo(
    () => filteredExpenses.filter((e) => e.source === "receipt").map((e) => e.id),
    [filteredExpenses],
  );
  const { data: itemCounts } = useReceiptItemCounts(receiptExpenseIds);

  // Fixed (auto rows from payments) vs variable (everything else) — the
  // Monarch "flex budgeting" split in one stacked bar.
  const fixedVar = useMemo(() => {
    let fixed = 0;
    let variable = 0;
    for (const e of filteredExpenses) {
      if (e.source === "payment") fixed += e.amount;
      else variable += e.amount;
    }
    return { fixed, variable, total: fixed + variable };
  }, [filteredExpenses]);

  // Top merchants from scanned receipts — "12.400 od toga u Maxiju" is what
  // turns awareness into action (N26 Wrap-Up pattern).
  const topMerchants = useMemo(() => {
    const byMerchant = new Map<string, { total: number; count: number }>();
    for (const e of filteredExpenses) {
      const name = e.merchant?.trim();
      if (!name) continue;
      const cur = byMerchant.get(name) ?? { total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      byMerchant.set(name, cur);
    }
    return [...byMerchant.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  }, [filteredExpenses]);

  // Category-limit lookup (spent vs monthly_limit) from the cycle, for the
  // amber (≥80%) / red (≥100%) breakdown coloring.
  const limitByCategory = useMemo(() => {
    const m = new Map<string, { limit: number; pct: number }>();
    for (const c of cycle.perCategory) {
      if (c.limit != null && c.limit > 0) m.set(c.categoryId, { limit: c.limit, pct: c.pct });
    }
    return m;
  }, [cycle.perCategory]);

  // ONE shared scale for every breakdown bar: length ∝ spend (matches the
  // most-spent-first sort), the limit is a tick on the same scale. The 1.08
  // headroom keeps even the largest tick visibly inside the track.
  const barScaleMax = useMemo(() => {
    let maxLimit = 0;
    for (const row of breakdown) {
      const info = limitByCategory.get(row.key);
      if (info && info.limit > maxLimit) maxLimit = info.limit;
    }
    return 1.08 * Math.max(maxCategoryTotal, maxLimit);
  }, [breakdown, limitByCategory, maxCategoryTotal]);

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setAddOpen(true);
  };

  const openScan = () => {
    setScanMounted(true);
    setScanOpen(true);
  };

  const openEdit = (expense: Expense) => {
    // Auto rows (from payments) are read-only.
    if (expense.source !== "manual") return;
    setEditing(expense);
    setFormError(null);
    setAddOpen(true);
  };

  // A "source: payment" expense links back to its payment via payment_id — tap
  // it to open the payment detail popup in its read-only "info" variant (the
  // expense row is a PAST paid occurrence; occurrence actions here would hit
  // the NEXT one).
  const openPaymentDetail = (expense: Expense) => {
    if (!expense.payment_id) return;
    setSelectedPayment(payments.find((p) => p.id === expense.payment_id) ?? null);
  };

  // "Izmeni" in that popup — full payment edit form, right here on /budget.
  const openEditPayment = async (payment: Payment) => {
    setEditingPayment(payment);
    setPaymentHasHistory(false);
    setPaymentFormError(null);
    setPaymentFormOpen(true);
    // Async — disable the recurrence radios once we know history exists.
    try {
      setPaymentHasHistory(await hasPaymentHistory(payment.id));
    } catch {
      /* keep false — radios stay enabled */
    }
  };

  const handlePaymentSubmit = async (payload: PaymentFormPayload) => {
    if (!editingPayment) return;
    setPaymentFormError(null);
    try {
      await updatePayment.mutateAsync({ id: editingPayment.id, payload });
      setPaymentFormOpen(false);
      setEditingPayment(null);
      setPaymentHasHistory(false);
    } catch (err) {
      setPaymentFormError(
        err instanceof Error && err.message ? err.message : "Greška pri izmeni plaćanja",
      );
    }
  };

  const handlePaymentFormOpenChange = (open: boolean) => {
    setPaymentFormOpen(open);
    if (!open) {
      setEditingPayment(null);
      setPaymentHasHistory(false);
      setPaymentFormError(null);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      setEditing(null);
      setFormError(null);
    }
  };

  const handleSubmit = async (payload: ExpenseFormPayload) => {
    setFormError(null);
    try {
      if (editing) {
        await updateExpense.mutateAsync({ id: editing.id, payload });
      } else {
        await createExpense.mutateAsync(payload);
      }
      setAddOpen(false);
      setEditing(null);
    } catch (err) {
      const fallback = editing ? "Greška pri izmeni troška" : "Greška pri dodavanju troška";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  // Delete lives inside the edit modal now (bottom-left "Obriši" → confirm
  // sub-view) — no separate row action.
  const handleDeleteEditing = async () => {
    if (!editing) return;
    try {
      await deleteExpense.mutateAsync(editing.id);
      setAddOpen(false);
      setEditing(null);
    } catch {
      /* hook toasts; keep dialog open to retry */
    }
  };

  return (
    <div className="animate-fade-in mx-auto w-full max-w-5xl pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Budžet</h1>
        {/* One entry point for money data (skeniraj / trošak / prihod);
            Prihodi and Kategorije management moved next to their data. */}
        <BudgetAddMenu
          onScanReceipt={openScan}
          onAddExpense={openAdd}
          onAddIncome={() => setIncomesOpen(true)}
        />
      </div>

      {/* One-row toolbar — the shared FilterBar pattern. */}
      <div className="mt-4 space-y-3">
        <FilterBar
          picker={<MonthPicker value={month} onChange={setMonth} />}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Pretraži troškove i stavke…"
          searchAriaLabel="Pretraži troškove"
          filterCount={filterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />
        <AppliedFilterChips filters={appliedFilters} onClearAll={resetFilters} />
      </div>

      {searchActive ? (
        <BudgetSearchResults
          hits={search.hits}
          isSearching={search.isSearching}
          categoriesById={categoriesById}
          onOpenReceipt={setReceiptDetail}
          onEditManual={openEdit}
        />
      ) : null}

      {/* Cycle header — when the family has incomes it shows the full cycle
          (Prihodi · Potrošeno · Preostalo + projection); otherwise just the
          month's spend, with a nudge to add incomes. */}
      {!searchActive && cycle.hasIncome ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          {/* The three amounts stay on ONE baseline — nothing may push them
              apart; extra context (pace, MoM) lives under the bar. */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {/* flex-col + justify-start: buttons vertically CENTER their
                content by default, so when the pill makes the middle column
                taller this cell would sink below the other two. */}
            <button
              type="button"
              onClick={() => setIncomesOpen(true)}
              className="group flex flex-col items-center justify-start rounded-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <span className="flex items-center justify-center gap-0.5 text-xs text-gray-500 group-hover:text-blue-600 dark:text-gray-400 dark:group-hover:text-blue-400">
                Prihodi
                <ChevronRightIcon className="size-3" />
              </span>
              <span className="mt-0.5 block text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                <Amount value={cycle.confirmedIncome} round />
              </span>
            </button>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Potrošeno</div>
              <div className="mt-0.5 text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                <Amount value={cycle.totalSpent} round />
              </div>
              {/* MoM sits centered UNDER the amount — the three values above
                  stay on one baseline. */}
              {momDelta ? (
                <div className="mt-1 flex justify-center">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      momDelta.pct > 0
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        : momDelta.pct < 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
                    )}
                    title="Potrošnja do današnjeg dana u odnosu na isti dan prošlog meseca"
                  >
                    {momDelta.pct > 0 ? "+" : ""}
                    {momDelta.pct}% vs {momDelta.prevLabel}
                  </span>
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Preostalo</div>
              <div
                className={cn(
                  "mt-0.5 text-base font-semibold tabular-nums",
                  cycle.remaining < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                <Amount value={cycle.remaining} round />
              </div>
            </div>
          </div>
          {cycle.confirmedIncome > 0 ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${Math.min(100, Math.max(spentPct, 2))}%`,
                  backgroundColor: budgetBarColor,
                }}
              />
            </div>
          ) : null}
          {/* Under the bar: daily pace (safe-to-spend). */}
          {dailyPace != null ? (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              ≈{" "}
              <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                <Amount value={dailyPace} round />
              </span>
              /dan do kraja meseca
            </div>
          ) : null}
          {cycle.projectedUnpaid > 0 || cycle.expectedIncome > 0 ? (
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700/60">
              {/* Projection is ONE row; tap reveals what it folds in. */}
              <button
                type="button"
                onClick={() => setProjOpen((p) => !p)}
                aria-expanded={projOpen}
                className="flex w-full items-center justify-between gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Projekcija do kraja meseca
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      cycle.projectedRemaining < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-900 dark:text-gray-100",
                    )}
                  >
                    <Amount value={cycle.projectedRemaining} round />
                  </span>
                  <ChevronRightIcon
                    className={cn(
                      "size-4 text-gray-400 transition-transform dark:text-gray-500",
                      projOpen && "rotate-90",
                    )}
                  />
                </span>
              </button>
              {projOpen ? (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {cycle.expectedIncome > 0 ? (
                    <span>
                      očekivani prihod +<Amount value={cycle.expectedIncome} round />
                    </span>
                  ) : null}
                  {cycle.projectedUnpaid > 0 ? (
                    <span>
                      neplaćeno −<Amount value={cycle.projectedUnpaid} round />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : !searchActive ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">Potrošeno ovog meseca</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-white">
            <Amount value={cycle.totalSpent} round />
          </div>
          <button
            type="button"
            onClick={() => setIncomesOpen(true)}
            className="mt-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Dodaj prihode za mesečni pregled →
          </button>
        </div>
      ) : null}

      {/* Reminder to confirm this month's salaries (only for the current month). */}
      {!searchActive && pendingIncomeCount > 0 ? (
        <button
          type="button"
          onClick={() => setIncomesOpen(true)}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left transition-colors hover:bg-amber-100/70 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none dark:border-amber-800/50 dark:bg-amber-900/15 dark:hover:bg-amber-900/25"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <BanknotesIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {pendingIncomeCount === 1
                  ? "1 prihod za potvrdu"
                  : `${pendingIncomeCount} prihoda za potvrdu`}
              </div>
              <div className="truncate text-xs text-amber-700 dark:text-amber-300/80">
                Potvrdi da je plata legla i tačan iznos.
              </div>
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium text-amber-700 dark:text-amber-300">
            Potvrdi →
          </span>
        </button>
      ) : null}

      {!searchActive && isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {/* Breakdown + insights left, day-by-day timeline right (xl); a single
          column below that, in the same order. */}
      {!searchActive ? (
        <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-8">
          <div>
            {breakdown.length > 0 ? (
              <section className="mt-6">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Po kategorijama
                  </h2>
                  {/* Category management lives next to the categories. */}
                  <button
                    type="button"
                    onClick={() => setCategoriesOpen(true)}
                    className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                  >
                    Uredi ›
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {breakdown.map((row) => {
                    const Icon = categoryIcon(row.icon);
                    const limitInfo = limitByCategory.get(row.key);
                    const limit = limitInfo?.limit ?? null;
                    // One scale for every bar: length ∝ spend, tick = limit.
                    const fillPct = barScaleMax > 0 ? (row.total / barScaleMax) * 100 : 0;
                    const tickPct =
                      limit != null && barScaleMax > 0 ? (limit / barScaleMax) * 100 : null;
                    const overLimit = limit != null && row.total >= limit;
                    const nearLimit = limit != null && !overLimit && row.total >= 0.8 * limit;
                    const barColor = overLimit ? "#ef4444" : nearLimit ? "#f59e0b" : row.color;
                    return (
                      <li key={row.key}>
                        <button
                          type="button"
                          onClick={() => setCategoryDetail(row)}
                          className="-mx-1.5 block w-full rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:hover:bg-gray-800/60"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon className="size-4 shrink-0" style={{ color: row.color }} />
                              <span className="truncate text-sm text-gray-800 dark:text-gray-200">
                                {row.name}
                              </span>
                              <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                                · {row.count}
                              </span>
                            </div>
                            <span className="shrink-0 text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
                              <Amount value={row.total} />
                              {limit != null ? (
                                <span className="font-normal text-gray-400 dark:text-gray-500">
                                  {" / "}
                                  <Amount value={limit} />
                                </span>
                              ) : null}
                              {overLimit && limit != null ? (
                                <span className="ml-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                  +<Amount value={row.total - limit} round />
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div className="relative h-2 rounded-full bg-gray-100 dark:bg-gray-700/60">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-[width]"
                              style={{
                                width: `${Math.max(fillPct, 2)}%`,
                                backgroundColor: barColor,
                              }}
                            />
                            {tickPct != null ? (
                              <div
                                className="absolute -inset-y-0.5 w-0.5 rounded-full bg-gray-700 dark:bg-gray-300"
                                style={{ left: `${tickPct}%` }}
                                aria-hidden="true"
                              />
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {/* Fixed vs variable — auto rows from payments vs everything else. */}
            {fixedVar.fixed > 0 && fixedVar.variable > 0 ? (
              <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Fiksno vs varijabilno
                </h2>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
                  <div
                    className="bg-blue-700 dark:bg-blue-500"
                    style={{ width: `${(fixedVar.fixed / fixedVar.total) * 100}%` }}
                  />
                  <div className="flex-1 bg-blue-200 dark:bg-blue-900/70" />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-blue-700 dark:bg-blue-500" />
                    Iz plaćanja{" "}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      <Amount value={fixedVar.fixed} round />
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-blue-200 dark:bg-blue-900/70" />
                    Ostalo{" "}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      <Amount value={fixedVar.variable} round />
                    </span>
                  </span>
                </div>
              </section>
            ) : null}

            {/* Top merchants from scanned receipts. */}
            {topMerchants.length > 0 ? (
              <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Top prodavnice
                </h2>
                <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700/60">
                  {topMerchants.map((m) => (
                    <li key={m.name} className="flex items-baseline gap-2 py-2 text-sm">
                      <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                        {m.name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                        · {m.count} {m.count === 1 ? "račun" : "računa"}
                      </span>
                      <span className="ml-auto shrink-0 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                        <Amount value={m.total} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div>
            {/* Troškovi kao timeline po danu */}
            {!isLoading ? (
              <section className="mt-6">
                <h2 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Troškovi
                </h2>
                <BudgetTimeline
                  expenses={filteredExpenses}
                  categoriesById={categoriesById}
                  itemCounts={itemCounts}
                  onOpenReceipt={setReceiptDetail}
                  onEditManual={openEdit}
                  onOpenPayment={openPaymentDetail}
                />
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {!searchActive ? <BudgetTrend month={month} onSelectMonth={setMonth} /> : null}

      <IncomesSheet open={incomesOpen} onOpenChange={setIncomesOpen} month={month} />

      <CategoriesSheet open={categoriesOpen} onOpenChange={setCategoriesOpen} />

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        isActive={filterCount > 0}
        onReset={resetFilters}
      >
        <FilterSection title="Članovi">
          <PersonFilterChips selected={selectedPersonIds} onToggle={togglePerson} />
        </FilterSection>
        <FilterSection title="Izvor troška">
          {SOURCE_OPTIONS.map((option) => (
            <ToggleChip
              key={option.key}
              active={selectedSources.size === 0 || selectedSources.has(option.key)}
              onToggle={() => toggleSource(option.key)}
            >
              {option.label}
            </ToggleChip>
          ))}
        </FilterSection>
      </FilterSheet>

      <CategoryDetailSheet
        open={!!categoryDetail}
        onOpenChange={(open) => {
          if (!open) setCategoryDetail(null);
        }}
        row={
          categoryDetail
            ? {
                categoryId: categoryDetail.key === UNCATEGORIZED ? null : categoryDetail.key,
                name: categoryDetail.name,
                color: categoryDetail.color,
                icon: categoryDetail.icon,
              }
            : null
        }
        category={
          categoryDetail && categoryDetail.key !== UNCATEGORIZED
            ? (categoriesById.get(categoryDetail.key) ?? null)
            : null
        }
        month={month}
        expenses={filteredExpenses}
      />

      <ExpenseFormDialog
        open={addOpen}
        onOpenChange={handleDialogOpenChange}
        expense={editing}
        error={formError}
        saving={createExpense.isPending || updateExpense.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
        onScanReceipt={() => {
          setAddOpen(false);
          openScan();
        }}
        onDelete={() => {
          void handleDeleteEditing();
        }}
        deleting={deleteExpense.isPending}
      />

      {scanMounted ? (
        <Suspense fallback={null}>
          <ReceiptScanDialog open={scanOpen} onOpenChange={setScanOpen} onJumpToMonth={setMonth} />
        </Suspense>
      ) : null}

      <ReceiptExpenseDialog
        open={!!receiptDetail}
        onOpenChange={(open) => {
          if (!open) setReceiptDetail(null);
        }}
        expense={receiptDetail}
      />

      <PaymentDetailDialog
        open={!!selectedPayment}
        onOpenChange={(open) => {
          if (!open) setSelectedPayment(null);
        }}
        payment={selectedPayment}
        personIds={selectedPayment ? (byPayment.get(selectedPayment.id) ?? []) : []}
        onEdit={(p) => {
          void openEditPayment(p);
        }}
        variant="info"
      />

      <PaymentFormDialog
        open={paymentFormOpen}
        onOpenChange={handlePaymentFormOpenChange}
        payment={editingPayment}
        initialPersonIds={editingPayment ? (byPayment.get(editingPayment.id) ?? []) : []}
        hasHistory={paymentHasHistory}
        error={paymentFormError}
        saving={updatePayment.isPending}
        onSubmit={(payload) => {
          void handlePaymentSubmit(payload);
        }}
      />
    </div>
  );
}

interface BudgetSearchResultsProps {
  hits: ExpenseSearchHit[];
  isSearching: boolean;
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  onOpenReceipt: (expense: Expense) => void;
  onEditManual: (expense: Expense) => void;
}

/**
 * Search-mode replacement for the month sections: flat list of matches across
 * ALL months. Receipt rows open the receipt detail, manual rows the edit form;
 * auto rows (from payments) are informational.
 */
function BudgetSearchResults({
  hits,
  isSearching,
  categoriesById,
  onOpenReceipt,
  onEditManual,
}: BudgetSearchResultsProps) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">
        Rezultati pretrage <span className="font-normal">· svi meseci</span>
      </h2>
      {hits.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          {isSearching ? "Pretraga…" : "Nema troškova koji odgovaraju pretrazi."}
        </div>
      ) : (
        <ul className="space-y-2">
          {hits.map(({ expense: e, matchedItems }) => {
            const category = e.category_id ? categoriesById.get(e.category_id) : null;
            const Icon = categoryIcon(category?.icon);
            const color = category?.color ?? "#9ca3af";
            const isReceipt = e.source === "receipt";
            const isManual = e.source === "manual";
            const primary = isReceipt
              ? e.merchant || e.note?.trim() || category?.name || "Račun"
              : e.note?.trim() || category?.name || "Trošak";

            const inner = (
              <>
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${color}22` }}
                >
                  <Icon className="size-5" style={{ color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {primary}
                    </span>
                    {isReceipt ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                        <ReceiptPercentIcon className="size-2.5" />
                        račun
                      </span>
                    ) : e.source === "payment" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                        <LockClosedIcon className="size-2.5" />
                        iz plaćanja
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>{formatDate(e.spent_on)}</span>
                    {category ? <span className="truncate">· {category.name}</span> : null}
                  </div>
                  {matchedItems.length > 0 ? (
                    <div className="mt-0.5 truncate text-xs text-violet-600 dark:text-violet-400">
                      Stavka: {matchedItems.slice(0, 3).join(", ")}
                      {matchedItems.length > 3 ? ` +${matchedItems.length - 3}` : ""}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  <Amount value={e.amount} />
                  <AmountOriginal
                    amount={e.original_amount}
                    currency={e.currency}
                    className="block text-[10px] font-normal"
                  />
                </span>
              </>
            );

            if (isReceipt || isManual) {
              return (
                <li
                  key={e.id}
                  className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                >
                  <button
                    type="button"
                    onClick={() => (isReceipt ? onOpenReceipt(e) : onEditManual(e))}
                    className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:hover:bg-gray-700/40"
                  >
                    {inner}
                    <ChevronRightIcon className="size-4 shrink-0 text-gray-300 dark:text-gray-600" />
                  </button>
                </li>
              );
            }

            return (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                {inner}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
