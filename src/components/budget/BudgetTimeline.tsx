import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ChevronRightIcon, LockClosedIcon, ReceiptPercentIcon } from "@heroicons/react/24/outline";

import { Amount, AmountOriginal } from "@/components/common/Amount";
import { MemberBadges } from "@/components/common/MemberBadges";
import { GroupHeader, StatusPill } from "@/components/money/moneyUi";
import { categoryIcon } from "@/components/budget/categoryIcons";
import type { Expense, ExpenseCategory } from "@/types/database";
import { addDays, srLocale } from "@/utils/date";
import { stavkeLabel } from "@/utils/plural";
import { useToday } from "@/hooks/useToday";

/**
 * The month's expenses ("troškovi") as a day-grouped ledger - the Troškovi tab
 * of Novac. Ordered newest day first (a ledger is read "what did we just
 * spend", unlike the forward-looking agenda), so the relative day tokens are
 * Danas / Juče rather than Danas / Sutra.
 *
 * Every row opens a modal on tap: manual → the edit form (with delete inside
 * it), receipt → the receipt detail, payment-sourced ("iz plaćanja") → the
 * underlying payment's detail popup. Events and birthdays are intentionally
 * NOT here - they don't cost anything, and any spend tied to them already
 * shows as a row.
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

/** "Danas · ponedeljak" / "Juče · nedelja" / "Sreda, 1. oktobar". */
function dayTitle(day: string, today: string, yesterday: string, tomorrow: string): string {
  const date = parseISO(`${day}T12:00:00`);
  const weekday = format(date, "EEEE", { locale: srLocale });
  if (day === today) return `Danas · ${weekday}`;
  if (day === yesterday) return `Juče · ${weekday}`;
  if (day === tomorrow) return `Sutra · ${weekday}`;
  const capitalized = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  return `${capitalized}, ${format(date, "d. MMMM", { locale: srLocale })}`;
}

function ExpenseRow({
  expense,
  categoriesById,
  itemCounts,
  isReceiptPart,
  onOpenReceipt,
  onEditManual,
  onOpenPayment,
}: {
  expense: Expense;
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  itemCounts: Record<string, number> | undefined;
  /** True when other expenses in this month share the same receipt. */
  isReceiptPart: boolean;
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
        className="flex w-full items-center gap-[11px] rounded-xl border border-border bg-card px-[13px] py-3 text-left shadow-card transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]"
      >
        {/* The category colour is user data, so the tile keeps it (tinted) -
            only the chrome around it follows the design tokens. */}
        <span
          className="grid size-[42px] shrink-0 place-items-center rounded-[14px]"
          style={{ backgroundColor: `${color}1f`, color }}
        >
          <Icon className="size-5" />
        </span>
        {/* Left column (title + meta) and right column (amount + original) are
            siblings, so the EUR annotation can never push the meta row down. */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] leading-tight font-semibold tracking-[-0.01em]">
              {primary}
            </span>
            <MemberBadges personIds={expense.person_id ? [expense.person_id] : []} size="xs" />
          </span>
          <span className="mt-[3px] flex items-center gap-1.5 text-[12.5px] font-normal text-muted-foreground">
            {category ? <span className="truncate">{category.name}</span> : null}
            {isPayment ? (
              <StatusPill tone="warn">
                <LockClosedIcon className="size-2.5" />
                iz plaćanja
              </StatusPill>
            ) : isReceipt ? (
              <StatusPill tone="accent">
                <ReceiptPercentIcon className="size-2.5" />
                {isReceiptPart ? "deo računa" : "račun"}
              </StatusPill>
            ) : (
              <span className="truncate">ručno</span>
            )}
            {isReceipt && itemCount > 0 ? (
              <span className="shrink-0 truncate">
                {itemCount} {stavkeLabel(itemCount)}
              </span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-right text-[15px] font-bold tracking-[-0.01em] tabular-nums">
          <Amount value={expense.amount} />
          <AmountOriginal
            amount={expense.original_amount}
            currency={expense.currency}
            className="block text-[10.5px] font-normal"
          />
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
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
  const yesterday = useMemo(() => format(addDays(todayDate, -1), "yyyy-MM-dd"), [todayDate]);
  const tomorrow = useMemo(() => format(addDays(todayDate, 1), "yyyy-MM-dd"), [todayDate]);

  // Receipts represented by MORE than one expense this month - their rows say
  // "deo računa" instead of "račun". Split parts share the receipt's date, so
  // the whole picture is always inside one month's list.
  const multiPartReceiptIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of expenses) {
      if (e.receipt_id) counts.set(e.receipt_id, (counts.get(e.receipt_id) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [expenses]);

  const dayGroups = useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    for (const e of expenses) {
      const bucket = byDay.get(e.spent_on);
      if (bucket) bucket.push(e);
      else byDay.set(e.spent_on, [e]);
    }
    // Newest day first. Within a day the query's `created_at DESC` keeps the
    // most recently entered row on top.
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [expenses]);

  // Empty months and empty filter results are the parent's job (BudgetPage
  // renders the EmptyState variants) - this component always has rows.
  return (
    <div>
      {dayGroups.map(([day, rows], i) => (
        <section key={day}>
          {/* Day groups sit tighter than the Pregled modules, and the first one
              opens the tab right under the chips - no gap to bridge there. */}
          <GroupHeader
            title={dayTitle(day, today, yesterday, tomorrow)}
            count={rows.length}
            className={i === 0 ? "mt-1" : "mt-6"}
          />
          <ul className="space-y-2">
            {rows.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                categoriesById={categoriesById}
                itemCounts={itemCounts}
                isReceiptPart={!!expense.receipt_id && multiPartReceiptIds.has(expense.receipt_id)}
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
