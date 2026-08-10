import type { ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import type { Expense, Payment } from "@/types/database";
import { formatDate, isOverdue } from "@/utils/date";
import { Amount, AmountOriginal } from "@/components/common/Amount";
import { recurrenceLabel } from "@/utils/payment";

/** Compact status pill - same colorway as the payments list row states. */
function PaymentStatusPill({ payment }: { payment: Payment }) {
  if (payment.is_paid) {
    return (
      <span className="rounded-full bg-pos-soft px-2 py-[3px] text-[10.5px] font-bold text-pos">
        Plaćeno
      </span>
    );
  }
  if (payment.is_paused) {
    return (
      <span className="rounded-full bg-muted px-2 py-[3px] text-[10.5px] font-bold text-muted-foreground">
        Pauzirano
      </span>
    );
  }
  if (isOverdue(payment.due_date)) {
    return (
      <span className="rounded-full bg-neg-soft px-2 py-[3px] text-[10.5px] font-bold text-neg">
        Prekoračeno
      </span>
    );
  }
  return null;
}

/**
 * One money row inside the linked boxes. With `onSelect` the row is a button
 * (opens that entry's detail - see `LinkedMoneyViewer`) and grows a chevron;
 * without it the row stays static text (form contexts).
 */
function MoneyRow({
  title,
  pill,
  subtitle,
  amount,
  onSelect,
  selectLabel,
}: {
  title: string;
  pill?: ReactNode;
  subtitle: string;
  amount: ReactNode;
  onSelect?: () => void;
  selectLabel: string;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {pill}
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="shrink-0 text-right text-sm font-bold tracking-[-0.01em] tabular-nums text-foreground">
        {amount}
      </span>
    </>
  );

  if (!onSelect) {
    return <div className="flex items-center justify-between gap-3">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={selectLabel}
      className="-mx-1.5 flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {body}
      <ChevronRightIcon className="-ml-1.5 size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * Payments box listing the payments linked to one activity, event or
 * birthday - the reverse side of the payment link. Renders nothing when the
 * list is empty, so callers can mount it unconditionally. With `onSelect` the
 * rows open that payment's detail popup. `children` slots extra read-only
 * content into the same box (the activity side appends its per-month
 * attendance breakdown there).
 */
export function LinkedPaymentsList({
  payments,
  onSelect,
  children,
}: {
  payments: ReadonlyArray<Payment>;
  onSelect?: (payment: Payment) => void;
  children?: ReactNode;
}) {
  if (payments.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        Plaćanja
      </p>
      <ul className="space-y-2">
        {payments.map((payment) => (
          <li key={payment.id}>
            <MoneyRow
              title={payment.name}
              pill={<PaymentStatusPill payment={payment} />}
              subtitle={`Dospeva ${formatDate(payment.due_date)} · ${recurrenceLabel(
                payment.recurrence_period,
                payment.recurrence_interval,
              )}`}
              amount={
                <>
                  <Amount value={payment.amount} />
                  <AmountOriginal
                    amount={payment.original_amount}
                    currency={payment.currency}
                    className="block text-[10px] font-normal"
                  />
                </>
              }
              onSelect={onSelect ? () => onSelect(payment) : undefined}
              selectLabel={`Detalji plaćanja ${payment.name}`}
            />
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/** Display title for an expense row: merchant, else note, else a generic label. */
export function expenseRowTitle(expense: Expense): string {
  return expense.merchant?.trim() || expense.note?.trim() || "Trošak";
}

/**
 * Expenses box - manual + receipt expenses linked to one activity or event
 * (see `useLinkedExpenses`; payment-sourced auto rows are excluded there).
 * Same row anatomy as the payments box; with `onSelect` a row opens the
 * expense's detail (receipt) or edit form (manual).
 */
export function LinkedExpensesList({
  expenses,
  onSelect,
}: {
  expenses: ReadonlyArray<Expense>;
  onSelect?: (expense: Expense) => void;
}) {
  if (expenses.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        Troškovi
      </p>
      <ul className="space-y-2">
        {expenses.map((expense) => (
          <li key={expense.id}>
            <MoneyRow
              title={expenseRowTitle(expense)}
              subtitle={`${formatDate(expense.spent_on)}${
                expense.source === "receipt" ? " · fiskalni račun" : ""
              }`}
              amount={
                <>
                  <Amount value={expense.amount} />
                  <AmountOriginal
                    amount={expense.original_amount}
                    currency={expense.currency}
                    className="block text-[10px] font-normal"
                  />
                </>
              }
              onSelect={onSelect ? () => onSelect(expense) : undefined}
              selectLabel={`Detalji troška ${expenseRowTitle(expense)}`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
