import { useEffect, useMemo, useState } from "react";

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
import { Amount } from "@/components/common/Amount";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { useExpenses } from "@/hooks/useExpenses";
import { useUpdateExpenseCategory } from "@/hooks/useExpenseCategories";
import type { Expense, ExpenseCategory } from "@/types/database";
import { formatDate } from "@/utils/date";
import { monthLabel, monthOf, monthRange, shiftMonth } from "@/utils/budget";
import { cn } from "@/lib/cn";

/**
 * Drill-down for one row of the "Po kategorijama" breakdown: this month's
 * expenses in the category, a 6-month mini trend, and — for real categories —
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
};

function expenseTitle(e: Expense): string {
  if (e.source === "receipt") return e.merchant || e.note?.trim() || "Račun";
  return e.note?.trim() || (e.source === "payment" ? "Iz plaćanja" : "Trošak");
}

export function CategoryDetailSheet({
  open,
  onOpenChange,
  row,
  category,
  month,
  expenses,
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

  // Six months ending at `month` — the SAME range/key the page's BudgetTrend
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
  // to the nearest 500 — a sane starting limit, not a prescription.
  const suggestion = useMemo(() => {
    const prior = trend.filter((t) => t.month !== month && t.total > 0);
    if (prior.length === 0) return null;
    const avg = prior.reduce((s, t) => s + t.total, 0) / prior.length;
    return Math.max(500, Math.round(avg / 500) * 500);
  }, [trend, month]);

  const limit = category?.monthly_limit ?? null;
  const pct = limit && limit > 0 ? (total / limit) * 100 : null;
  const barColor =
    pct == null ? row?.color : pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : row?.color;

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

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>{row?.name ?? "Kategorija"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {row ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className="flex size-12 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${row.color}22` }}
              >
                <Icon className="size-6" style={{ color: row.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {row.name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {monthLabel(month)} · {catExpenses.length}{" "}
                  {catExpenses.length === 1 ? "trošak" : "troškova"}
                </p>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-3xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
                  <Amount value={total} />
                </span>
                {limit ? (
                  <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
                    / <Amount value={limit} />
                  </span>
                ) : null}
              </div>
              {pct != null ? (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
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
                <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                  Preko limita za <Amount value={total - limit} round />
                </p>
              ) : null}
            </div>

            {/* 6-month mini trend for the category. */}
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex h-20 items-end gap-1.5">
                {trend.map((bar) => (
                  <div key={bar.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div
                      className={cn("w-full rounded-t", bar.month === month ? "" : "opacity-40")}
                      style={{
                        height: `${Math.max((bar.total / trendMax) * 56, bar.total > 0 ? 3 : 1)}px`,
                        backgroundColor: bar.total > 0 ? row.color : "#d1d5db",
                      }}
                      title={`${monthLabel(bar.month)}: ${Math.round(bar.total).toLocaleString("sr-Latn-RS")} RSD`}
                    />
                    <span
                      className={cn(
                        "text-[10px]",
                        bar.month === month
                          ? "font-semibold text-gray-900 dark:text-gray-100"
                          : "text-gray-400 dark:text-gray-500",
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
                    className="text-xs text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                  >
                    Predlog: {suggestion.toLocaleString("sr-Latn-RS")} RSD (prosek prethodnih
                    meseci)
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Troškovi bez kategorije — dodeli kategoriju izmenom pojedinačnog troška.
              </p>
            )}

            {catExpenses.length > 0 ? (
              <div className="divide-y divide-gray-100 border-t border-gray-100 text-sm dark:divide-gray-700/60 dark:border-gray-700/60">
                {catExpenses.map((e) => (
                  <div key={e.id} className="flex items-baseline justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
                        {expenseTitle(e)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(e.spent_on)}
                      </span>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      <Amount value={e.amount} />
                    </span>
                  </div>
                ))}
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
