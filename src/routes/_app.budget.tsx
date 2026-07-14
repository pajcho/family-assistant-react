import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockClosedIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { AddButton } from "@/components/common/AddButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MemberBadges } from "@/components/common/MemberBadges";
import { ExpenseFormDialog } from "@/components/budget/ExpenseFormDialog";
import type { ExpenseFormPayload } from "@/components/budget/ExpenseForm";
import { categoryIcon } from "@/components/budget/categoryIcons";
import {
  useCreateExpense,
  useDeleteExpense,
  useExpenses,
  useUpdateExpense,
} from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import type { Expense } from "@/types/database";
import { currentMonthYYYYMM } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { monthLabel, monthRange, shiftMonth } from "@/utils/budget";

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

/** Short "dd.MM." day label for a YYYY-MM-DD date inside a month view. */
function dayLabel(dateStr: string): string {
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}.`;
}

function BudgetPage() {
  const [month, setMonth] = useState<string>(() => currentMonthYYYYMM());
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Expense | null>(null);

  const range = useMemo(() => monthRange(month), [month]);
  const { expenses, isLoading } = useExpenses(range);
  const { categories, byId: categoriesById } = useExpenseCategories();

  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();

  const totalSpent = useMemo(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);

  // Per-category totals, sorted most-spent first (an "Bez kategorije" bucket
  // collects null-category rows).
  const breakdown = useMemo<CategoryBreakdown[]>(() => {
    const totals = new Map<string, { total: number; count: number }>();
    for (const e of expenses) {
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
  }, [expenses, categoriesById]);

  const maxCategoryTotal = breakdown.length > 0 ? breakdown[0].total : 0;

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setAddOpen(true);
  };

  const openEdit = (expense: Expense) => {
    // Auto rows (from payments) are read-only.
    if (expense.source !== "manual") return;
    setEditing(expense);
    setFormError(null);
    setAddOpen(true);
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

  const handleDeleteConfirm = async () => {
    if (!toDelete) return;
    try {
      await deleteExpense.mutateAsync(toDelete.id);
      setToDelete(null);
    } catch {
      /* hook toasts; keep dialog open to retry */
    }
  };

  const showEmpty = !isLoading && expenses.length === 0;

  return (
    <div className="animate-fade-in pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Budžet</h1>
        <AddButton label="Dodaj trošak" onClick={openAdd} />
      </div>

      {/* Month switcher */}
      <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
        <button
          type="button"
          aria-label="Prethodni mesec"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="inline-flex size-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <div className="min-w-[9rem] text-center text-base font-medium text-gray-900 dark:text-gray-100">
          {monthLabel(month)}
        </div>
        <button
          type="button"
          aria-label="Sledeći mesec"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="inline-flex size-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ChevronRightIcon className="size-5" />
        </button>
      </div>

      {/* Summary header */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="text-sm text-gray-500 dark:text-gray-400">Potrošeno ovog meseca</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-white">
          {formatAmount(totalSpent)}
        </div>
      </div>

      {isLoading ? <div className="mt-6 text-gray-500">Učitavanje…</div> : null}

      {/* Per-category breakdown */}
      {breakdown.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">
            Po kategorijama
          </h2>
          <ul className="space-y-3">
            {breakdown.map((row) => {
              const Icon = categoryIcon(row.icon);
              const pct = maxCategoryTotal > 0 ? (row.total / maxCategoryTotal) * 100 : 0;
              return (
                <li key={row.key}>
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
                      {formatAmount(row.total)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/60">
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: row.color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Expenses list */}
      {showEmpty ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Nema troškova za ovaj mesec. Dodaj prvi trošak.
        </div>
      ) : null}

      {!isLoading && expenses.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">Troškovi</h2>
          <ul className="space-y-2">
            {expenses.map((e) => {
              const category = e.category_id ? categoriesById.get(e.category_id) : null;
              const Icon = categoryIcon(category?.icon);
              const color = category?.color ?? "#9ca3af";
              const isAuto = e.source !== "manual";
              const primary = e.note?.trim() || category?.name || "Trošak";
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                >
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
                      {isAuto ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                          <LockClosedIcon className="size-2.5" />
                          iz plaćanja
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>{dayLabel(e.spent_on)}</span>
                      {category && (e.note?.trim() ?? "") !== "" ? (
                        <span className="truncate">· {category.name}</span>
                      ) : null}
                      <MemberBadges personIds={e.person_id ? [e.person_id] : []} size="xs" />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {formatAmount(e.amount)}
                  </span>
                  {!isAuto ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Izmeni trošak"
                        onClick={() => openEdit(e)}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        <PencilSquareIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Obriši trošak"
                        onClick={() => setToDelete(e)}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {categories.length === 0 ? (
            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              Automatski uneti troškovi iz plaćanja se ne mogu menjati ovde.
            </p>
          ) : null}
        </section>
      ) : null}

      <ExpenseFormDialog
        open={addOpen}
        onOpenChange={handleDialogOpenChange}
        expense={editing}
        error={formError}
        saving={createExpense.isPending || updateExpense.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Obriši trošak"
        message={`Da li sigurno želiš da obrišeš ovaj trošak (${
          toDelete ? formatAmount(toDelete.amount) : ""
        })?`}
        loading={deleteExpense.isPending}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />
    </div>
  );
}
