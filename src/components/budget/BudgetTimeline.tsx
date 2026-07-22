import { useMemo } from "react";
import { format } from "date-fns";
import { ChevronRightIcon, LockClosedIcon, ReceiptPercentIcon } from "@heroicons/react/24/outline";

import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { MemberBadges } from "@/components/common/MemberBadges";
import { categoryIcon } from "@/components/budget/categoryIcons";
import type { Expense, ExpenseCategory } from "@/types/database";
import { addDays } from "@/utils/date";
import { stavkeLabel } from "@/utils/plural";
import { useToday } from "@/hooks/useToday";

/**
 * The month's expenses ("troškovi") as a day-grouped timeline — the same
 * "Uskoro"/payments day grouping applied to the ledger (reuses
 * `AgendaDateHeader`). Every row opens a modal on tap: manual → the edit form
 * (with delete inside it), receipt → the receipt detail, payment-sourced
 * ("iz plaćanja") → the underlying payment's detail popup. Events and
 * birthdays are intentionally NOT here — they don't cost anything, and any
 * spend tied to them already shows as a row.
 */
export type BudgetTimelineProps = {
  expenses: Expense[];
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  itemCounts: Record<string, number> | undefined;
  onOpenReceipt: (expense: Expense) => void;
  onEditManual: (expense: Expense) => void;
  /** Open the payment detail for a "source: payment" row (via its payment_id). */
  onOpenPayment: (expense: Expense) => void;
};

function ExpenseRow({
  expense,
  categoriesById,
  itemCounts,
  onOpenReceipt,
  onEditManual,
  onOpenPayment,
}: {
  expense: Expense;
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  itemCounts: Record<string, number> | undefined;
  onOpenReceipt: (expense: Expense) => void;
  onEditManual: (expense: Expense) => void;
  onOpenPayment: (expense: Expense) => void;
}) {
  const category = expense.category_id ? categoriesById.get(expense.category_id) : null;
  const Icon = categoryIcon(category?.icon);
  const color = category?.color ?? "#9ca3af";
  const isReceipt = expense.source === "receipt";
  const isPayment = expense.source === "payment";
  const itemCount = isReceipt ? (itemCounts?.[expense.id] ?? 0) : 0;
  const primary = isReceipt
    ? expense.merchant || expense.note?.trim() || category?.name || "Račun"
    : expense.note?.trim() || category?.name || "Trošak";

  const inner = (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}22` }}
      >
        <Icon className="size-5" style={{ color }} />
      </span>
      {/* Left column (title + meta) and right column (amount + original) are
          siblings, so the € annotation can never push the meta row down. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {primary}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {isPayment ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
              <LockClosedIcon className="size-2.5" />
              iz plaćanja
            </span>
          ) : isReceipt ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              <ReceiptPercentIcon className="size-2.5" />
              račun
            </span>
          ) : null}
          {isReceipt && itemCount > 0 ? (
            <span className="truncate">
              {itemCount} {stavkeLabel(itemCount)}
            </span>
          ) : category ? (
            <span className="truncate">{category.name}</span>
          ) : null}
          <span className="shrink-0">
            <MemberBadges personIds={expense.person_id ? [expense.person_id] : []} size="xs" />
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        <Amount value={expense.amount} />
        <AmountOriginal
          amount={expense.original_amount}
          currency={expense.currency}
          className="block text-[10px] font-normal"
        />
      </span>
    </>
  );

  // Every row taps the whole surface into a modal: receipt → receipt detail,
  // payment → the payment's detail popup, manual → the edit form (delete lives
  // inside it now, no inline actions).
  const handleClick = () => {
    if (isReceipt) onOpenReceipt(expense);
    else if (isPayment) onOpenPayment(expense);
    else onEditManual(expense);
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:hover:bg-gray-800/70"
      >
        {inner}
        <ChevronRightIcon className="size-4 shrink-0 text-gray-300 dark:text-gray-600" />
      </button>
    </li>
  );
}

export function BudgetTimeline({
  expenses,
  categoriesById,
  itemCounts,
  onOpenReceipt,
  onEditManual,
  onOpenPayment,
}: BudgetTimelineProps) {
  const { str: today, date: todayDate } = useToday();
  const tomorrow = useMemo(() => format(addDays(todayDate, 1), "yyyy-MM-dd"), [todayDate]);

  const dayGroups = useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    for (const e of expenses) {
      const bucket = byDay.get(e.spent_on);
      if (bucket) bucket.push(e);
      else byDay.set(e.spent_on, [e]);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [expenses]);

  if (dayGroups.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        Nema troškova za ovaj mesec. Dodaj prvi trošak.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dayGroups.map(([day, rows]) => (
        <section key={day}>
          <AgendaDateHeader day={day} today={today} tomorrow={tomorrow} />
          <ul className="mt-2 space-y-1">
            {rows.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                categoriesById={categoriesById}
                itemCounts={itemCounts}
                onOpenReceipt={onOpenReceipt}
                onEditManual={onEditManual}
                onOpenPayment={onOpenPayment}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
