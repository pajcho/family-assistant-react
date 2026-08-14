import { useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, PlusIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { DetailActionRow } from "@/components/common/DetailSheet";
import { FieldGroupLabel } from "@/components/common/FormControls";
import { MemberBadges } from "@/components/common/MemberBadges";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenses } from "@/hooks/useExpenses";
import { useUpdateExpenseCategory } from "@/hooks/useExpenseCategories";
import { usePaymentLinkTargets } from "@/hooks/usePaymentLinks";
import type { Expense, ExpenseCategory } from "@/types/database";
import { formatDate } from "@/utils/date";
import { expenseLabels, monthLabel, monthOf, monthRange, shiftMonth } from "@/utils/budget";
import { cn } from "@/lib/cn";

/**
 * Drill-down for one row of the "Po kategorijama" breakdown: this month's
 * expenses in the category, a 6-month mini trend, and - for real categories -
 * the "Postavi/Izmeni limit" editor with a suggestion from the recent average.
 * `categoryId: null` is the "Bez kategorije" bucket (no limit editor).
 */
export type CategoryDetailRow = {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
};

export type CategoryDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: CategoryDetailRow | null;
  /** The full category row (limit editing); null for "Bez kategorije". */
  category: ExpenseCategory | null;
  month: string;
  /** The month's expenses (already person/source-filtered by the page). */
  expenses: Expense[];
  /**
   * Opens the expense form with this category already picked. Omit it (or land
   * on "Bez kategorije", which has no category to pre-pick) and the action row
   * is not rendered.
   */
  onAddExpense?: (categoryId: string) => void;
  /**
   * Opens one listed expense in its own detail (the ledger's rule: receipt ->
   * receipt detail, payment-sourced -> that payment, manual -> the edit form).
   * Omit it and the list stays a plain read-out.
   */
  onOpenExpense?: (expense: Expense) => void;
  /**
   * Close the overlay without tearing the drill-down down - for the moment the
   * expense form (or an expense detail opened from the list) above it owns the
   * screen. Dismissing that one brings this sheet back exactly as it was, now
   * including the expense just added.
   */
  hidden?: boolean;
};

/**
 * One listed expense. Tappable when the page hands down `onOpen` - the whole
 * reason someone reads this list is to check (and often fix) a single row, and
 * before this it was a dead end that sent you back to the ledger to find the
 * same expense again.
 *
 * No `categoryName` goes into the labels here: inside a category drill-down it
 * would title every row after the category you are already looking at.
 */
function ExpenseLine({
  expense,
  linkName,
  onOpen,
}: {
  expense: Expense;
  /** Activity/event this expense is linked to, already resolved by the sheet. */
  linkName?: string | null;
  onOpen?: (expense: Expense) => void;
}) {
  const { title, detail } = expenseLabels(expense, { linkName });
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-normal text-foreground">{title}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">
            {formatDate(expense.spent_on)}
            {detail ? ` · ${detail}` : ""}
          </span>
          {expense.person_id ? <MemberBadges personIds={[expense.person_id]} size="xs" /> : null}
        </span>
      </span>
      <span className="shrink-0 text-right font-semibold tabular-nums text-foreground">
        <Amount value={expense.amount} />
        <AmountOriginal
          amount={expense.original_amount}
          currency={expense.currency}
          className="block text-[10px] font-normal"
        />
      </span>
    </>
  );

  if (!onOpen) {
    return <div className="flex items-center justify-between gap-3 px-3 py-2.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(expense)}
      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {body}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

export function CategoryDetailSheet({
  open,
  onOpenChange,
  row,
  category,
  month,
  expenses,
  onAddExpense,
  onOpenExpense,
  hidden = false,
}: CategoryDetailSheetProps) {
  const updateCategory = useUpdateExpenseCategory();
  const [limitInput, setLimitInput] = useState("");

  // Seed the limit editor whenever a different category (or fresh open) shows.
  useEffect(() => {
    if (open) setLimitInput(category?.monthly_limit ? String(category.monthly_limit) : "");
  }, [open, category]);

  const catExpenses = useMemo(() => {
    if (!row) return [];
    return expenses
      .filter((e) => (e.category_id ?? null) === row.categoryId)
      .toSorted((a, b) => b.spent_on.localeCompare(a.spent_on));
  }, [expenses, row]);
  const total = useMemo(() => catExpenses.reduce((sum, e) => sum + e.amount, 0), [catExpenses]);

  // Activity/event names for the listed rows. Activities and birthdays come
  // from caches this page already holds; the events query only fires when a
  // listed expense actually points at one.
  const { targetFor } = usePaymentLinkTargets(catExpenses);

  // Six months ending at `month` - the SAME range/key the page's BudgetTrend
  // uses, so this piggybacks on an already-cached query.
  const trendMonths = useMemo(
    () => Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)),
    [month],
  );
  const trendRange = useMemo(
    () => ({ from: monthRange(trendMonths[0]).from, to: monthRange(month).to }),
    [trendMonths, month],
  );
  const { expenses: trendExpenses } = useExpenses(trendRange);
  const trend = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of trendExpenses) {
      if ((e.category_id ?? null) !== (row?.categoryId ?? null)) continue;
      const mo = monthOf(e.spent_on);
      totals.set(mo, (totals.get(mo) ?? 0) + e.amount);
    }
    return trendMonths.map((mo) => ({ month: mo, total: totals.get(mo) ?? 0 }));
  }, [trendExpenses, trendMonths, row]);
  const trendMax = Math.max(...trend.map((t) => t.total), 1);

  // Suggestion = average of the previous months that had any spend, rounded
  // to the nearest 500 - a sane starting limit, not a prescription.
  const suggestion = useMemo(() => {
    const prior = trend.filter((t) => t.month !== month && t.total > 0);
    if (prior.length === 0) return null;
    const avg = prior.reduce((s, t) => s + t.total, 0) / prior.length;
    return Math.max(500, Math.round(avg / 500) * 500);
  }, [trend, month]);

  const limit = category?.monthly_limit ?? null;
  const pct = limit && limit > 0 ? (total / limit) * 100 : null;
  // Over / near the limit takes over the bar with the money-semantics tokens;
  // otherwise the bar keeps the category's own (user-picked) color.
  const barColor =
    pct == null ? row?.color : pct >= 100 ? "var(--neg)" : pct >= 80 ? "var(--warn)" : row?.color;

  const parsedLimit = limitInput.trim() === "" ? null : Number(limitInput);
  const limitValid = parsedLimit === null || (Number.isFinite(parsedLimit) && parsedLimit > 0);
  const limitDirty = (limit ?? null) !== (parsedLimit ?? null);

  const saveLimit = async () => {
    if (!category || !limitValid) return;
    try {
      await updateCategory.mutateAsync({
        id: category.id,
        payload: { monthly_limit: parsedLimit },
      });
    } catch {
      // Toast surfaced by the hook.
    }
  };

  const Icon = categoryIcon(row?.icon);
  const addCategoryId = row?.categoryId ?? null;

  return (
    <ResponsiveDialog open={open && !hidden} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>{row?.name ?? "Kategorija"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {row ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className="grid size-[50px] shrink-0 place-items-center rounded-[17px]"
                style={{ backgroundColor: `${row.color}22` }}
              >
                <Icon className="size-6" style={{ color: row.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold text-foreground">{row.name}</p>
                <p className="text-sm text-muted-foreground">
                  {monthLabel(month)} · {catExpenses.length}{" "}
                  {catExpenses.length === 1 ? "trošak" : "troškova"}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-[34px] font-bold tracking-[-0.03em] tabular-nums text-foreground">
                  <Amount value={total} />
                </span>
                {limit ? (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    / <Amount value={limit} />
                  </span>
                ) : null}
              </div>
              {pct != null ? (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${Math.min(100, Math.max(pct, 2))}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
              ) : null}
              {pct != null && pct >= 100 && limit ? (
                <p className="mt-1.5 text-xs font-semibold text-neg">
                  Preko limita za <Amount value={total - limit} round />
                </p>
              ) : null}
            </div>

            {/* The one emphasized action, straight under the numbers it adds
                to - the whole reason someone opens a category they overspent
                is usually to record the next trošak in it. */}
            {onAddExpense && addCategoryId ? (
              <DetailActionRow
                icon={PlusIcon}
                tone="primary"
                label="Dodaj trošak"
                description={`Kategorija ${row.name} je već izabrana`}
                onClick={() => onAddExpense(addCategoryId)}
              />
            ) : null}

            {/* 6-month mini trend for the category. */}
            <div className="rounded-xl border border-border bg-card p-3 shadow-card">
              <div className="flex h-20 items-end gap-1.5">
                {trend.map((bar) => (
                  <div key={bar.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div
                      className={cn("w-full rounded-t", bar.month === month ? "" : "opacity-40")}
                      style={{
                        height: `${Math.max((bar.total / trendMax) * 56, bar.total > 0 ? 3 : 1)}px`,
                        backgroundColor: bar.total > 0 ? row.color : "var(--border)",
                      }}
                      title={`${monthLabel(bar.month)}: ${Math.round(bar.total).toLocaleString("sr-Latn-RS")} RSD`}
                    />
                    <span
                      className={cn(
                        "text-[10px]",
                        bar.month === month
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {monthLabel(bar.month).split(" ")[0].slice(0, 3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {category ? (
              <div className="space-y-2">
                <Label htmlFor="category-limit-input">Mesečni limit</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="category-limit-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="Bez limita"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!limitValid || !limitDirty || updateCategory.isPending}
                    onClick={() => {
                      void saveLimit();
                    }}
                  >
                    Sačuvaj
                  </Button>
                </div>
                {suggestion != null && suggestion !== limit ? (
                  <button
                    type="button"
                    onClick={() => setLimitInput(String(suggestion))}
                    className="text-xs font-normal text-accent-deep underline-offset-4 hover:underline"
                  >
                    Predlog: {suggestion.toLocaleString("sr-Latn-RS")} RSD (prosek prethodnih
                    meseci)
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Troškovi bez kategorije - dodeli kategoriju izmenom pojedinačnog troška.
              </p>
            )}

            {catExpenses.length > 0 ? (
              <div>
                <FieldGroupLabel>Troškovi</FieldGroupLabel>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-sm">
                  {catExpenses.map((e) => (
                    <ExpenseLine
                      key={e.id}
                      expense={e}
                      linkName={targetFor(e)?.name}
                      onOpen={onOpenExpense}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Zatvori
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
