import * as React from "react";
import { ShoppingBagIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import type { Expense } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";

/**
 * "Planirani troškovi" dashboard card. Direct port of
 * `components/dashboard/DashboardExpenseCard.vue`.
 *
 * Filters incoming list to `!is_paid` expenses, sorts by sort_order (already
 * applied by the hook), and shows the first 5. Each row uses the `purple`
 * accent — light-purple background, purple amount.
 */
export type DashboardExpenseCardProps = {
  expenses: Expense[];
  onAdd: () => void;
  onEdit: (expense: Expense) => void;
};

export function DashboardExpenseCard({ expenses, onAdd, onEdit }: DashboardExpenseCardProps) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedExpense, setSelectedExpense] = React.useState<Expense | null>(null);

  const unpaidExpenses = React.useMemo<Expense[]>(
    () => expenses.filter((e) => !e.is_paid),
    [expenses],
  );

  const visibleExpenses = unpaidExpenses.slice(0, 5);

  const openDetail = (expense: Expense) => {
    setSelectedExpense(expense);
    setDetailOpen(true);
  };

  const handleEdit = () => {
    if (!selectedExpense) return;
    setDetailOpen(false);
    onEdit(selectedExpense);
  };

  return (
    <>
      <DashboardCard
        icon={ShoppingBagIcon}
        title="Planirani troškovi"
        emptyMessage="Nema planiranih troškova"
        addLabel="Dodaj trošak"
        viewAllLink="/expenses"
        hasItems={unpaidExpenses.length > 0}
        accent="purple"
        onAdd={onAdd}
      >
        {visibleExpenses.map((expense) => (
          <DashboardCardItem
            key={expense.id}
            label={expense.name}
            value={formatAmount(expense.amount)}
            accent="purple"
            onClick={() => openDetail(expense)}
          />
        ))}
        {unpaidExpenses.length > 5 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            + još {unpaidExpenses.length - 5}
          </p>
        ) : null}
      </DashboardCard>

      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji troška</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {selectedExpense ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/50">
                  <ShoppingBagIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedExpense.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatAmount(selectedExpense.amount)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Status:</dt>
                    <dd
                      className={
                        selectedExpense.is_paid
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-purple-700 dark:text-purple-400"
                      }
                    >
                      {selectedExpense.is_paid ? "Plaćeno" : "Nije plaćeno"}
                    </dd>
                  </div>
                  {selectedExpense.paid_date ? (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Datum plaćanja:</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">
                        {formatDate(selectedExpense.paid_date)}
                      </dd>
                    </div>
                  ) : null}
                  {selectedExpense.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {selectedExpense.description}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          ) : null}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Zatvori
            </Button>
            <Button onClick={handleEdit}>Izmeni</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
