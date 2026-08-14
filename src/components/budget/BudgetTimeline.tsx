import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import {
  ChevronRightIcon,
  LinkSlashIcon,
  LockClosedIcon,
  ReceiptPercentIcon,
} from "@heroicons/react/24/outline";

import { Amount, AmountOriginal } from "@/components/common/Amount";
import { MemberBadges } from "@/components/common/MemberBadges";
import { GroupHeader, StatusPill } from "@/components/money/moneyUi";
import { categoryIcon } from "@/components/budget/categoryIcons";
import type { Expense, ExpenseCategory } from "@/types/database";
import { expenseLabels, isDetachedPaymentExpense } from "@/utils/budget";
import { addDays, srLocale } from "@/utils/date";
import { stavkeLabel } from "@/utils/plural";
import { usePaymentLinkTargets } from "@/hooks/usePaymentLinks";
import { useToday } from "@/hooks/useToday";

/**
 * The month's expenses as a day-grouped ledger - the expenses tab
 * of Novac. Ordered newest day first (a ledger is read "what did we just
 * spend", unlike the forward-looking agenda), so the relative day tokens are
 * today / yesterday rather than today / tomorrow.
 *
 * Every row opens a modal on tap: manual → the edit form (with delete inside
 * it), receipt -> the receipt detail, payment-sourced -> the
 * underlying payment's detail popup - unless that payment has been deleted, in
 * which case the row is a plain historical spend and opens the edit form like a
 * manual one. Events and birthdays are intentionally
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

/** The day heading: today / yesterday plus the weekday, or a full date. */
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
  linkName,
  onOpenReceipt,
  onEditManual,
  onOpenPayment,
}: {
  expense: Expense;
  categoriesById: ReadonlyMap<string, ExpenseCategory>;
  itemCounts: Record<string, number> | undefined;
  /** True when other expenses in this month share the same receipt. */
  isReceiptPart: boolean;
  /** Activity/event this expense is linked to, resolved once by the parent. */
  linkName?: string | null;
  onOpenReceipt: (expense: Expense) => void;
  onEditManual: (expense: Expense) => void;
  onOpenPayment: (expense: Expense) => void;
}) {
  const category = expense.category_id ? categoriesById.get(expense.category_id) : null;
  const Icon = categoryIcon(category?.icon);
  const color = category?.color ?? "#9ca3af";
  const isReceipt = expense.source === "receipt";
  // A payment-sourced row whose payment is gone has nothing to open and nothing
  // keeping it in sync, so it behaves (and reads) as a plain past expense.
  const isDetached = isDetachedPaymentExpense(expense);
  const isPayment = expense.source === "payment" && !isDetached;
  const itemCount = isReceipt ? (itemCounts?.[expense.id] ?? 0) : 0;
  // The category still feeds the TITLE chain (a row with nothing else to be
  // called reads "Namirnice" rather than "Trošak") - it just no longer spends a
  // line of its own down in the meta.
  const { title, detail } = expenseLabels(expense, { linkName, categoryName: category?.name });
  const hasMeta = !!detail || isPayment || isDetached || isReceipt;

  // Every row taps the whole surface into a modal: receipt → receipt detail,
  // payment → the payment's detail popup, manual (and detached) → the edit form
  // (delete lives inside it now, no inline actions).
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
            only the chrome around it follows the design tokens.

            The tile IS the category on this list: its icon and colour say it
            without spending a line of text on the name. `title` spells it out
            on hover, and the sr-only copy keeps it in the button's accessible
            name - a coloured square announces nothing on its own. On a phone
            the name is one tap away, in the row's own modal. */}
        <span
          className="grid size-[26px] shrink-0 place-items-center rounded-sm"
          style={{ backgroundColor: `${color}1f`, color }}
          title={category?.name}
        >
          <Icon className="size-3.5" />
        </span>
        {category ? <span className="sr-only">Kategorija: {category.name}</span> : null}
        {/* Left column (title + meta) and right column (amount + original) are
            siblings, so the EUR annotation can never push the meta row down. */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] leading-tight font-semibold tracking-[-0.01em]">
              {title}
            </span>
            <MemberBadges personIds={expense.person_id ? [expense.person_id] : []} size="xs" />
          </span>
          {/* Only what the row does NOT already say: a second identifier and
              the state pills. There is deliberately no "ručno" token - a hand
              typed expense is the default here, so the word marked almost every
              row and told you nothing; the pills are the exceptions worth
              calling out. Rows with nothing to add render no second line at
              all, and stay the same height anyway (the 42px tile is the
              floor). */}
          {hasMeta ? (
            <span className="mt-[3px] flex items-center gap-1.5 text-[12.5px] font-normal text-muted-foreground">
              {detail ? <span className="truncate">{detail}</span> : null}
              {isPayment ? (
                <StatusPill tone="warn">
                  <LockClosedIcon className="size-2.5" />
                  iz plaćanja
                </StatusPill>
              ) : isDetached ? (
                // No lock: the payment it came from is gone, so this row is not
                // locked to anything - and calling it payment-sourced would promise a
                // payment that no longer opens.
                <StatusPill tone="muted">
                  <LinkSlashIcon className="size-2.5" />
                  plaćanje obrisano
                </StatusPill>
              ) : isReceipt ? (
                <StatusPill tone="accent">
                  <ReceiptPercentIcon className="size-2.5" />
                  {isReceiptPart ? "deo računa" : "račun"}
                </StatusPill>
              ) : null}
              {isReceipt && itemCount > 0 ? (
                <span className="shrink-0 truncate">
                  {itemCount} {stavkeLabel(itemCount)}
                </span>
              ) : null}
            </span>
          ) : null}
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
  // One resolver for the whole ledger, not one hook per row.
  const { targetFor } = usePaymentLinkTargets(expenses);

  // Receipts represented by MORE than one expense this month - their rows say
  // a receipt PART instead of a whole receipt. Split parts share the receipt's date, so
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
                linkName={targetFor(expense)?.name}
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
