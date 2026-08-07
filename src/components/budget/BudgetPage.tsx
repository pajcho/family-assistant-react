import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentType, ReactNode } from "react";
import {
  BanknotesIcon,
  BuildingStorefrontIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LinkSlashIcon,
  LockClosedIcon,
  QrCodeIcon,
  ReceiptPercentIcon,
  ShoppingCartIcon,
  SwatchIcon,
  WalletIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { useToday } from "@/hooks/useToday";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { BudgetAddMenu } from "@/components/budget/BudgetAddMenu";
import { CategoryDetailSheet } from "@/components/budget/CategoryDetailSheet";
import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import { ReceiptExpenseDialog } from "@/components/budget/ReceiptExpenseDialog";
import { IncomesSheet } from "@/components/budget/IncomesSheet";
import { CategoriesSheet } from "@/components/budget/CategoriesSheet";
import { BudgetTrend } from "@/components/budget/BudgetTrend";
import { BudgetTimeline } from "@/components/budget/BudgetTimeline";
import { CategoryFilterChip } from "@/components/budget/CategoryFilterChip";
import {
  GroupHeader,
  GroupHeaderAction,
  MoneyCard,
  ProgressTrack,
  StatusPill,
} from "@/components/money/moneyUi";
import { PaymentDetailDialog } from "@/components/payments/PaymentDetailDialog";
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
import { useCreateExpenseCategory, useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useIncomes } from "@/hooks/useIncomes";
import { useIncomeEntries } from "@/hooks/useIncomeEntries";
import { hasPaymentHistory, usePaymentsList, useUpdatePayment } from "@/hooks/usePayments";
import { usePaymentOverrides } from "@/hooks/usePaymentOverrides";
import { usePaymentParticipants } from "@/hooks/usePaymentParticipants";
import type { Expense, ExpenseCategory, Payment } from "@/types/database";
import { currentMonthYYYYMM, formatDate } from "@/utils/date";
import {
  computeMonthlyCycle,
  isDetachedPaymentExpense,
  monthLabel,
  monthRange,
  shiftMonth,
} from "@/utils/budget";
import { fallbackColorForProfile } from "@/utils/activity";
import { UNCATEGORIZED, matchesCategoryFilter } from "@/utils/categoryFilter";
import { getDisplayName } from "@/utils/identity";
import { cn } from "@/lib/cn";

type CategoryBreakdown = {
  key: string;
  name: string;
  color: string;
  icon: string;
  total: number;
  count: number;
};

/**
 * One-tap starter set offered while the family has no categories (a new
 * family starts with zero). Icons/colors come from the standard pickers, so
 * everything stays editable in "Uredi kategorije" afterwards.
 */
const SUGGESTED_CATEGORIES: ReadonlyArray<{ name: string; icon: string; color: string }> = [
  { name: "Hrana", icon: "cart", color: "#22c55e" },
  { name: "Računi", icon: "bolt", color: "#f59e0b" },
  { name: "Prevoz", icon: "truck", color: "#3b82f6" },
  { name: "Deca", icon: "heart", color: "#ec4899" },
  { name: "Ostalo", icon: "tag", color: "#6b7280" },
];

/** Expense-source facet, shown as chips on the Troškovi tab. */
const SOURCE_OPTIONS = [
  { key: "manual", label: "Ručno" },
  { key: "receipt", label: "Račun" },
  { key: "payment", label: "Iz plaćanja" },
] as const;

export type BudgetView = "pregled" | "troskovi";

export interface BudgetPageProps {
  /** Which of Novac's two budget views to render. */
  view: BudgetView;
  /** "YYYY-MM" - owned by the Novac hub, shared with the payments view. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Hub-owned search term; while set it replaces the month sections. */
  searchTerm: string;
  /** Opens the hub's receipt scanner. */
  onScanReceipt: () => void;
  /** Header node the hub lends this view for its "Dodaj" (null until mounted). */
  addSlot: HTMLElement | null;
}

/**
 * The Pregled and Troškovi views of Novac.
 *
 * Both live in one component because they read the same month of expenses and
 * share the whole modal layer (expense form, receipt detail, the payment popup
 * a "iz plaćanja" row opens). `view` only decides which sections render.
 */
export function BudgetPage({
  view,
  month,
  onMonthChange,
  searchTerm,
  onScanReceipt,
  addSlot,
}: BudgetPageProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<Expense | null>(null);
  // Payment-sourced expense tapped → open that payment's detail popup.
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  // Its "Izmeni" opens the payment edit form INLINE (no /novac?tab=placanja hop).
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentHasHistory, setPaymentHasHistory] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [incomesOpen, setIncomesOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  // Category drill-down (tap on a "Po kategorijama" row).
  const [categoryDetail, setCategoryDetail] = useState<CategoryBreakdown | null>(null);
  // Set while the expense form was opened FROM that drill-down: it pre-picks
  // the category, and the sheet underneath only hides, so closing the form
  // lands back on the category (with the new trošak already in its list).
  const [addCategoryId, setAddCategoryId] = useState<string | null>(null);
  // Filters: person + expense source + category, all with the empty-set = "no
  // filter" convention. They narrow the VISIBLE lists (breakdown, timeline,
  // modules) - the cycle summary stays family-level.
  const [selectedPersonIds, setSelectedPersonIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // "Projekcija do kraja meseca" row - collapsed by default, tap to expand.
  const [projOpen, setProjOpen] = useState(false);

  // Search (note/merchant + receipt line items) - spans ALL months, so while
  // active it replaces the month sections below.
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
  const { members } = useFamilyMembers();

  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const updatePayment = useUpdatePayment();

  const payments = useMemo(() => paymentsQuery.data ?? [], [paymentsQuery.data]);

  // Person/source/category filters narrow what the lists show. The cycle
  // summary (Prihodi/Potrošeno/Preostalo) intentionally stays family-level -
  // income isn't per-person, so a filtered "Preostalo" would lie.
  const filteredExpenses = useMemo(() => {
    if (
      selectedPersonIds.size === 0 &&
      selectedSources.size === 0 &&
      selectedCategoryIds.size === 0
    ) {
      return expenses;
    }
    return expenses.filter((e) => {
      if (selectedPersonIds.size > 0 && !(e.person_id && selectedPersonIds.has(e.person_id))) {
        return false;
      }
      if (selectedSources.size > 0 && !selectedSources.has(e.source)) return false;
      if (!matchesCategoryFilter(e.category_id, selectedCategoryIds)) return false;
      return true;
    });
  }, [expenses, selectedPersonIds, selectedSources, selectedCategoryIds]);

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
  const resetFilters = () => {
    setSelectedPersonIds(new Set());
    setSelectedSources(new Set());
    setSelectedCategoryIds(new Set());
  };
  const filtersActive =
    selectedPersonIds.size > 0 || selectedSources.size > 0 || selectedCategoryIds.size > 0;

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

  // Share of confirmed income already spent - fills the budget bar and picks its
  // color (green under 75%, amber 75-100%, red once over budget).
  const spentPct = cycle.confirmedIncome > 0 ? (cycle.totalSpent / cycle.confirmedIncome) * 100 : 0;
  const budgetBarClass = spentPct >= 100 ? "bg-neg" : spentPct >= 75 ? "bg-warn" : "bg-pos";

  // Safe-to-spend pace + month-over-month delta - current month only (pace
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

  // Recurring sources not yet confirmed for THIS month - the "potvrdi platu"
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

  // Fixed (auto rows from payments) vs variable (everything else) - the
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

  // Top merchants from scanned receipts - "12.400 od toga u Maxiju" is what
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
    setAddCategoryId(null);
    setFormError(null);
    setAddOpen(true);
  };

  // "Dodaj trošak" inside the category drill-down.
  const openAddInCategory = (categoryId: string) => {
    setEditing(null);
    setAddCategoryId(categoryId);
    setFormError(null);
    setAddOpen(true);
  };

  // ---- First-use onboarding -------------------------------------------------
  // "New family" proxy: no expense rows in this OR the previous month. Incomes
  // and categories are deliberately NOT part of the signal - completing those
  // steps must not dismiss the starter card mid-onboarding; it retires with
  // the first recorded expense.
  const isFirstUse = !isLoading && expenses.length === 0 && prevExpenses.length === 0;

  // One-tap suggested category set - offered while the family has none (in the
  // starter checklist and as a standalone prompt); gone after the first
  // category exists, however it was created.
  const createCategory = useCreateExpenseCategory();
  const [seedingCategories, setSeedingCategories] = useState(false);
  const seedCategories = async () => {
    if (seedingCategories || categories.length > 0) return;
    setSeedingCategories(true);
    try {
      // Sequential on purpose: the insert appends after the current max
      // sort_order, so parallel inserts would race to the same slot.
      for (const c of SUGGESTED_CATEGORIES) await createCategory.mutateAsync(c);
    } catch {
      /* hook toasts; the button stays for a retry */
    } finally {
      setSeedingCategories(false);
    }
  };

  const openEdit = (expense: Expense) => {
    // Auto rows (from payments) are read-only - EXCEPT once their payment has
    // been deleted, when nothing regenerates them and the ledger row is all
    // that is left of the spend.
    if (expense.source !== "manual" && !isDetachedPaymentExpense(expense)) return;
    setEditing(expense);
    setAddCategoryId(null);
    setFormError(null);
    setAddOpen(true);
  };

  // A "source: payment" expense links back to its payment via payment_id - tap
  // it to open the payment detail popup in its read-only "info" variant (the
  // expense row is a PAST paid occurrence; occurrence actions here would hit
  // the NEXT one).
  //
  // Deleting a payment nulls that link (ON DELETE SET NULL, so the spend
  // survives its payment) and used to leave the row a dead end: nothing to open
  // here, and `openEdit` refused it for not being manual. Fall through to the
  // expense form instead, which is now the row's only remaining home.
  const openPaymentDetail = (expense: Expense) => {
    if (isDetachedPaymentExpense(expense)) {
      openEdit(expense);
      return;
    }
    // Still linked: nothing to show until the payments list has landed.
    setSelectedPayment(payments.find((p) => p.id === expense.payment_id) ?? null);
  };

  // "Izmeni" in that popup - full payment edit form, right here on Novac.
  const openEditPayment = async (payment: Payment) => {
    setEditingPayment(payment);
    setPaymentHasHistory(false);
    setPaymentFormError(null);
    setPaymentFormOpen(true);
    // Async - disable the recurrence radios once we know history exists.
    try {
      setPaymentHasHistory(await hasPaymentHistory(payment.id));
    } catch {
      /* keep false - radios stay enabled */
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
      setAddCategoryId(null);
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
      handleDialogOpenChange(false);
    } catch (err) {
      const fallback = editing ? "Greška pri izmeni troška" : "Greška pri dodavanju troška";
      setFormError(err instanceof Error && err.message ? err.message : fallback);
    }
  };

  // Delete lives inside the edit modal now (bottom-left "Obriši" → confirm
  // sub-view) - no separate row action.
  const handleDeleteEditing = async () => {
    if (!editing) return;
    try {
      await deleteExpense.mutateAsync(editing.id);
      handleDialogOpenChange(false);
    } catch {
      /* hook toasts; keep dialog open to retry */
    }
  };

  const isOverview = view === "pregled" && !searchActive;
  const isExpenses = view === "troskovi" && !searchActive;

  return (
    <div className="animate-fade-in">
      {/* The bottom bar's "+" is the touch entry point; on desktop the button
          sits in the Novac header with the rest of the chrome, so it stays put
          across all three tabs instead of floating over each view's content. */}
      {addSlot
        ? createPortal(
            <BudgetAddMenu
              onScanReceipt={onScanReceipt}
              onAddExpense={openAdd}
              onAddIncome={() => setIncomesOpen(true)}
            />,
            addSlot,
          )
        : null}

      {searchActive ? (
        <BudgetSearchResults
          hits={search.hits}
          isSearching={search.isSearching}
          categoriesById={categoriesById}
          onOpenReceipt={setReceiptDetail}
          onEditManual={openEdit}
        />
      ) : null}

      {/* ---------------------------- Pregled ---------------------------- */}

      {/* Cycle header - when the family has incomes it shows the full cycle
          (Prihodi · Potrošeno · Preostalo + projection); otherwise just the
          month's spend, with a nudge to add incomes. */}
      {isOverview && cycle.hasIncome ? (
        <MoneyCard>
          {/* The three amounts stay on ONE baseline - nothing may push them
              apart; extra context (pace, MoM) lives under each. */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {/* items-start: buttons vertically CENTER their content, so a
                taller neighbour would otherwise sink this cell. */}
            <button
              type="button"
              onClick={() => setIncomesOpen(true)}
              className="group flex flex-col items-center justify-start rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <CycleLabel>
                Prihodi
                <ChevronRightIcon className="size-3" />
              </CycleLabel>
              <CycleAmount>
                <Amount value={cycle.confirmedIncome} round />
              </CycleAmount>
              {pendingIncomeCount > 0 ? (
                <CycleFoot>
                  {pendingIncomeCount === 1 ? "1 za potvrdu" : `${pendingIncomeCount} za potvrdu`}
                </CycleFoot>
              ) : null}
            </button>
            <div>
              <CycleLabel>Potrošeno</CycleLabel>
              <CycleAmount>
                <Amount value={cycle.totalSpent} round />
              </CycleAmount>
              {momDelta ? (
                <div className="mt-1 flex justify-center">
                  <StatusPill
                    tone={momDelta.pct > 0 ? "warn" : momDelta.pct < 0 ? "pos" : "muted"}
                    className="tabular-nums"
                  >
                    <span title="Potrošnja do današnjeg dana u odnosu na isti dan prošlog meseca">
                      {momDelta.pct > 0 ? "+" : ""}
                      {momDelta.pct}% vs {momDelta.prevLabel}
                    </span>
                  </StatusPill>
                </div>
              ) : null}
            </div>
            <div>
              <CycleLabel>Preostalo</CycleLabel>
              <CycleAmount className={cycle.remaining < 0 ? "text-neg" : "text-pos"}>
                <Amount value={cycle.remaining} round />
              </CycleAmount>
              {dailyPace != null ? (
                <CycleFoot>
                  ≈ <Amount value={dailyPace} round />
                  /dan
                </CycleFoot>
              ) : null}
            </div>
          </div>
          {cycle.confirmedIncome > 0 ? (
            <ProgressTrack
              className="mt-3"
              segments={[
                {
                  key: "spent",
                  pct: Math.min(100, Math.max(spentPct, 2)),
                  className: budgetBarClass,
                },
              ]}
            />
          ) : null}
          {cycle.projectedUnpaid > 0 || cycle.expectedIncome > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              {/* Projection is ONE row; tap reveals what it folds in. */}
              <button
                type="button"
                onClick={() => setProjOpen((p) => !p)}
                aria-expanded={projOpen}
                className="flex w-full items-center justify-between gap-2 rounded-sm text-[12.5px] font-normal text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span>Projekcija do kraja meseca</span>
                <span className="flex items-center gap-1">
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      cycle.projectedRemaining < 0 ? "text-neg" : "text-foreground",
                    )}
                  >
                    <Amount value={cycle.projectedRemaining} round />
                  </span>
                  <ChevronDownIcon
                    className={cn("size-4 transition-transform", projOpen && "rotate-180")}
                  />
                </span>
              </button>
              {projOpen ? (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-normal text-muted-foreground">
                  {cycle.expectedIncome > 0 ? (
                    <span>
                      očekivani prihod +<Amount value={cycle.expectedIncome} round />
                    </span>
                  ) : null}
                  {cycle.projectedUnpaid > 0 ? (
                    <span>
                      neplaćeno -<Amount value={cycle.projectedUnpaid} round />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </MoneyCard>
      ) : isOverview && !isFirstUse ? (
        <MoneyCard>
          <CycleLabel>Potrošeno ovog meseca</CycleLabel>
          <div className="mt-1 text-[30px] leading-none font-bold tracking-[-0.03em] tabular-nums">
            <Amount value={cycle.totalSpent} round />
          </div>
          <button
            type="button"
            onClick={() => setIncomesOpen(true)}
            className="mt-2.5 text-[13px] font-semibold text-accent-deep hover:underline"
          >
            Dodaj prihode za mesečni pregled →
          </button>
        </MoneyCard>
      ) : null}

      {/* Reminder to confirm this month's salaries (only for the current month). */}
      {isOverview && pendingIncomeCount > 0 ? (
        <button
          type="button"
          onClick={() => setIncomesOpen(true)}
          // Two lines, not one: the count is the headline and the "why" reads
          // underneath it. A single wrapped sentence was measurably harder to
          // scan, so this keeps the pre-redesign structure (bordered card,
          // banknote icon, "Potvrdi ->" on the right) in the new tokens.
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-[15px] border border-warn/25 bg-warn-soft p-3 text-left transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <BanknotesIcon className="size-5 shrink-0 text-warn" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-warn">
                {pendingIncomeCount === 1
                  ? "1 prihod za potvrdu"
                  : `${pendingIncomeCount} prihoda za potvrdu`}
              </span>
              {/* Wraps rather than truncates: on a 375px screen the sentence
                  does not fit beside "Potvrdi", and an ellipsis hides the very
                  part that says what to check. */}
              <span className="block text-xs leading-snug font-normal text-warn/85">
                Potvrdi da je plata legla i tačan iznos.
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13.5px] font-semibold text-warn">
            Potvrdi
            <ChevronRightIcon className="size-3.5" />
          </span>
        </button>
      ) : null}

      {isOverview && isLoading ? (
        <p className="mt-6 text-sm font-normal text-muted-foreground">Učitavanje…</p>
      ) : null}

      {/* First use: a 3-step starter instead of the "0 RSD" card, the empty
          Troškovi column and a six-zero trend. Retires with the first expense. */}
      {isOverview && isFirstUse ? (
        <EmptyState
          className="mt-4"
          icon={WalletIcon}
          tone="emerald"
          title="Postavi porodični budžet"
          description="Tri koraka i svaki dinar ima svoje mesto."
        >
          <div className="mx-auto mt-4 max-w-md divide-y divide-border text-left">
            <BudgetStarterStep
              icon={BanknotesIcon}
              label="Dodaj primanja"
              description="Plate i redovni prilivi - osnova mesečnog pregleda."
              done={incomes.length > 0}
              onClick={() => setIncomesOpen(true)}
            />
            <BudgetStarterStep
              icon={QrCodeIcon}
              label="Skeniraj račun ili unesi trošak"
              description={'QR sa fiskalnog računa uvozi stavke sam; ručni unos je u „Dodaj".'}
              done={false}
              onClick={onScanReceipt}
            />
            <BudgetStarterStep
              icon={SwatchIcon}
              label={seedingCategories ? "Ubacujem kategorije…" : "Ubaci predložene kategorije"}
              description="Hrana, Računi, Prevoz, Deca, Ostalo - kasnije ih menjaš po želji."
              done={categories.length > 0}
              busy={seedingCategories}
              onClick={() => {
                void seedCategories();
              }}
            />
          </div>
          <p className="mt-4 text-xs font-normal text-muted-foreground">
            Pregled potrošnje i trend se pojavljuju posle prvog troška.
          </p>
        </EmptyState>
      ) : null}

      {/* Established family without categories (they are opt-in): the same
          one-tap set as a slim prompt. Disappears with the first category. */}
      {isOverview && !isLoading && !isFirstUse && categories.length === 0 ? (
        <MoneyCard className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Još nemaš kategorije troškova</div>
            <div className="text-xs font-normal text-muted-foreground">
              Predloženi set: Hrana, Računi, Prevoz, Deca, Ostalo.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={seedingCategories}
            onClick={() => {
              void seedCategories();
            }}
          >
            {seedingCategories ? "Ubacujem…" : "Ubaci predloženi set"}
          </Button>
        </MoneyCard>
      ) : null}

      {isOverview && !isFirstUse ? (
        // Desktop lays the analysis cards out in two columns - stacked, they
        // pushed the trend below the fold on every screen wider than a phone.
        <div className="contents lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
          {breakdown.length > 0 ? (
            <section>
              <GroupHeader
                title="Po kategorijama"
                action={
                  <GroupHeaderAction onClick={() => setCategoriesOpen(true)}>
                    Uredi
                    <ChevronRightIcon className="size-3" />
                  </GroupHeaderAction>
                }
              />
              <MoneyCard className="px-3.5 py-1.5">
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
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => setCategoryDetail(row)}
                      className="flex w-full items-center gap-[11px] border-b border-border py-[11px] text-left last:border-b-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span
                        className="grid size-[34px] shrink-0 place-items-center rounded-[11px]"
                        style={{ backgroundColor: `${row.color}1f`, color: row.color }}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2 text-[13.5px] font-semibold">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="truncate">{row.name}</span>
                            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                              · {row.count}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                            <span className="font-bold text-foreground">
                              <Amount value={row.total} />
                            </span>
                            {limit != null ? (
                              <>
                                {" / "}
                                <Amount value={limit} />
                              </>
                            ) : null}
                            {overLimit && limit != null ? (
                              <span className="ml-1.5 font-bold text-neg">
                                +<Amount value={row.total - limit} round />
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="relative mt-1.5 block h-1.5 rounded-full bg-muted">
                          <span
                            className={cn(
                              "absolute inset-y-0 left-0 rounded-full transition-[width]",
                              overLimit ? "bg-neg" : nearLimit ? "bg-warn" : null,
                            )}
                            style={{
                              width: `${Math.max(fillPct, 2)}%`,
                              backgroundColor: overLimit || nearLimit ? undefined : row.color,
                            }}
                          />
                          {tickPct != null ? (
                            <span
                              className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground/70"
                              style={{ left: `${tickPct}%` }}
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </MoneyCard>
            </section>
          ) : null}

          {/* Fixed vs variable - auto rows from payments vs everything else. */}
          {fixedVar.fixed > 0 && fixedVar.variable > 0 ? (
            <section>
              <GroupHeader title="Fiksno vs varijabilno" />
              <MoneyCard className="px-3.5 py-3.5">
                <ProgressTrack
                  segments={[
                    {
                      key: "fixed",
                      pct: (fixedVar.fixed / fixedVar.total) * 100,
                      className: "bg-accent",
                    },
                    {
                      key: "variable",
                      pct: (fixedVar.variable / fixedVar.total) * 100,
                      className: "ml-0.5 bg-pos",
                    },
                  ]}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] font-normal text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-[7px] rounded-full bg-accent" />
                    Iz plaćanja{" "}
                    <span className="font-bold tabular-nums text-foreground">
                      <Amount value={fixedVar.fixed} round />
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-[7px] rounded-full bg-pos" />
                    Ostalo{" "}
                    <span className="font-bold tabular-nums text-foreground">
                      <Amount value={fixedVar.variable} round />
                    </span>
                  </span>
                </div>
              </MoneyCard>
            </section>
          ) : null}

          {/* Top merchants from scanned receipts. */}
          {topMerchants.length > 0 ? (
            <section>
              <GroupHeader title="Top prodavnice" />
              <MoneyCard className="px-3.5 py-1">
                {topMerchants.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center gap-[11px] border-b border-border py-[11px] last:border-b-0"
                  >
                    <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-deep">
                      <BuildingStorefrontIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2 text-[13.5px] font-semibold">
                        <span className="truncate">{m.name}</span>
                        <span className="shrink-0 font-bold tabular-nums">
                          <Amount value={m.total} />
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[12px] font-normal text-muted-foreground">
                        {m.count} {m.count === 1 ? "račun" : "računa"}
                      </span>
                    </span>
                  </div>
                ))}
              </MoneyCard>
            </section>
          ) : null}

          <BudgetTrend month={month} onSelectMonth={onMonthChange} />
        </div>
      ) : null}

      {/* --------------------------- Troškovi ---------------------------- */}

      {isExpenses ? (
        <>
          {/* Same shape as the Plaćanja tab next door: neutral chip, facets,
              then one chip per member. Kategorija leads the facets because it
              is the one you reach for most, and it must not scroll off. */}
          <FilterChipRow className="mb-3" ariaLabel="Filter troškova">
            <FilterChip active={!filtersActive} onToggle={resetFilters}>
              Svi
            </FilterChip>
            <CategoryFilterChip selected={selectedCategoryIds} onChange={setSelectedCategoryIds} />
            {SOURCE_OPTIONS.map((option) => (
              <FilterChip
                key={option.key}
                active={selectedSources.has(option.key)}
                onToggle={() => toggleSource(option.key)}
              >
                {option.label}
              </FilterChip>
            ))}
            {/* One member = nobody to narrow to (same rule as Danas / Kalendar). */}
            {members.length > 1
              ? members.map((member) => (
                  <FilterChip
                    key={member.id}
                    active={selectedPersonIds.has(member.id)}
                    onToggle={() => togglePerson(member.id)}
                    color={member.color ?? fallbackColorForProfile(member.id)}
                  >
                    {getDisplayName({
                      firstName: member.first_name,
                      lastName: member.last_name,
                      email: null,
                    }) || "Bez imena"}
                  </FilterChip>
                ))
              : null}
          </FilterChipRow>

          {isLoading ? (
            <p className="mt-6 text-sm font-normal text-muted-foreground">Učitavanje…</p>
          ) : expenses.length === 0 && isFirstUse ? (
            <EmptyState
              icon={ShoppingCartIcon}
              tone="rose"
              title="Još nema troškova"
              description="Zabeleži prvi trošak - ili skeniraj QR sa fiskalnog računa, pa stavke stignu same."
              action={{ label: "Dodaj trošak", onClick: openAdd }}
            />
          ) : expenses.length === 0 ? (
            <EmptyState
              variant="filter"
              description="Nema troškova za ovaj mesec."
              secondaryAction={{ label: "Dodaj trošak", onClick: openAdd }}
            />
          ) : filteredExpenses.length === 0 ? (
            <EmptyState
              variant="filter"
              description="Nema troškova za izabrane filtere."
              secondaryAction={{ label: "Očisti filtere", onClick: resetFilters }}
            />
          ) : (
            <BudgetTimeline
              expenses={filteredExpenses}
              categoriesById={categoriesById}
              itemCounts={itemCounts}
              onOpenReceipt={setReceiptDetail}
              onEditManual={openEdit}
              onOpenPayment={openPaymentDetail}
            />
          )}
        </>
      ) : null}

      <IncomesSheet open={incomesOpen} onOpenChange={setIncomesOpen} month={month} />

      <CategoriesSheet open={categoriesOpen} onOpenChange={setCategoriesOpen} />

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
        onAddExpense={openAddInCategory}
        hidden={addOpen && addCategoryId !== null}
      />

      <ExpenseFormDialog
        open={addOpen}
        onOpenChange={handleDialogOpenChange}
        expense={editing}
        initialCategoryId={addCategoryId}
        error={formError}
        saving={createExpense.isPending || updateExpense.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
        onScanReceipt={() => {
          // The scanner is a context of its own - hand it the whole screen
          // rather than parking a category drill-down behind it.
          handleDialogOpenChange(false);
          setCategoryDetail(null);
          onScanReceipt();
        }}
        onDelete={() => {
          void handleDeleteEditing();
        }}
        deleting={deleteExpense.isPending}
      />

      <ReceiptExpenseDialog
        open={!!receiptDetail}
        onOpenChange={(open) => {
          if (!open) setReceiptDetail(null);
        }}
        expense={receiptDetail}
        onOpenExpense={setReceiptDetail}
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

/* --- Cycle card typography ------------------------------------------------ */

function CycleLabel({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center justify-center gap-0.5 text-[10.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function CycleAmount({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn("mt-1 block text-[17px] font-bold tracking-[-0.01em] tabular-nums", className)}
    >
      {children}
    </span>
  );
}

function CycleFoot({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 block text-[12px] font-normal tabular-nums text-muted-foreground">
      {children}
    </span>
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
 * auto rows (from payments) are informational - unless their payment has been
 * deleted, which leaves the expense editable like a manual one.
 */
function BudgetSearchResults({
  hits,
  isSearching,
  categoriesById,
  onOpenReceipt,
  onEditManual,
}: BudgetSearchResultsProps) {
  return (
    <section>
      <GroupHeader title="Rezultati pretrage · svi meseci" count={hits.length} className="mt-1" />
      {hits.length === 0 ? (
        <MoneyCard className="text-center text-sm font-normal text-muted-foreground">
          {isSearching ? "Pretraga…" : "Nema troškova koji odgovaraju pretrazi."}
        </MoneyCard>
      ) : (
        <ul className="space-y-2">
          {hits.map(({ expense: e, matchedItems }) => {
            const category = e.category_id ? categoriesById.get(e.category_id) : null;
            const Icon = categoryIcon(category?.icon);
            const color = category?.color ?? "#9ca3af";
            const isReceipt = e.source === "receipt";
            const isDetached = isDetachedPaymentExpense(e);
            const isManual = e.source === "manual" || isDetached;
            const primary = isReceipt
              ? e.merchant || e.note?.trim() || category?.name || "Račun"
              : e.note?.trim() || category?.name || "Trošak";

            const inner = (
              <>
                <span
                  className="grid size-[42px] shrink-0 place-items-center rounded-[14px]"
                  style={{ backgroundColor: `${color}1f`, color }}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">{primary}</span>
                    {isReceipt ? (
                      <StatusPill tone="accent">
                        <ReceiptPercentIcon className="size-2.5" />
                        račun
                      </StatusPill>
                    ) : isDetached ? (
                      <StatusPill tone="muted">
                        <LinkSlashIcon className="size-2.5" />
                        plaćanje obrisano
                      </StatusPill>
                    ) : e.source === "payment" ? (
                      <StatusPill tone="warn">
                        <LockClosedIcon className="size-2.5" />
                        iz plaćanja
                      </StatusPill>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-normal text-muted-foreground">
                    <span>{formatDate(e.spent_on)}</span>
                    {category ? <span className="truncate">· {category.name}</span> : null}
                  </div>
                  {matchedItems.length > 0 ? (
                    <div className="mt-0.5 truncate text-[12px] font-normal text-accent-deep">
                      Stavka: {matchedItems.slice(0, 3).join(", ")}
                      {matchedItems.length > 3 ? ` +${matchedItems.length - 3}` : ""}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-right text-[15px] font-bold tracking-[-0.01em] tabular-nums">
                  <Amount value={e.amount} />
                  <AmountOriginal
                    amount={e.original_amount}
                    currency={e.currency}
                    className="block text-[10.5px] font-normal"
                  />
                </span>
              </>
            );

            if (isReceipt || isManual) {
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => (isReceipt ? onOpenReceipt(e) : onEditManual(e))}
                    className="flex w-full items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3 text-left shadow-card transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
                  >
                    {inner}
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            }

            return (
              <li
                key={e.id}
                className="flex items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3 shadow-card"
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

/**
 * One row of the first-use starter checklist: icon tile, label + hint, and
 * either a chevron (todo) or a green check (done, disabled). The dashed-circle
 * "todo" affordance matches the planned "Prvi koraci" card on Danas.
 */
function BudgetStarterStep({
  icon: Icon,
  label,
  description,
  done,
  busy = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  done: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={done || busy}
      className="flex w-full items-center gap-3 py-3 text-left transition-colors enabled:hover:bg-muted disabled:cursor-default"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[12px]",
          done ? "bg-pos-soft text-pos" : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <CheckIcon className="size-5" /> : <Icon className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-semibold",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {label}
        </span>
        <span className="block text-xs font-normal text-muted-foreground">{description}</span>
      </span>
      {!done ? <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
    </button>
  );
}
