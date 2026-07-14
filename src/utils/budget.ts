import { addMonths, format, lastDayOfMonth, parseISO } from "date-fns";

import type { Expense, ExpenseCategory, Income, Payment, PaymentOverride } from "@/types/database";
import { expandPaymentOccurrences } from "@/utils/payment";

/**
 * Pure budget helpers (NO React / Supabase) so the Budget page and its unit
 * tests share one implementation. Month strings are "YYYY-MM"; date strings are
 * "YYYY-MM-DD".
 */

const MONTH_NAMES_SR = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

/** Inclusive first/last calendar day of a "YYYY-MM" month. */
export function monthRange(month: string): { from: string; to: string } {
  const first = parseISO(`${month}-01T12:00:00`);
  const last = lastDayOfMonth(first);
  return { from: format(first, "yyyy-MM-dd"), to: format(last, "yyyy-MM-dd") };
}

/** Shift a "YYYY-MM" month by `delta` months (can be negative). */
export function shiftMonth(month: string, delta: number): string {
  const next = addMonths(parseISO(`${month}-01T12:00:00`), delta);
  return format(next, "yyyy-MM");
}

/** Human label for a "YYYY-MM" month, e.g. "Jul 2026". */
export function monthLabel(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const name = MONTH_NAMES_SR[(monthNum - 1) % 12] ?? month;
  return `${name} ${year}`;
}

/** The "YYYY-MM" a date string falls in. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/* ------------------------------------------------------------------------- */
/* Monthly cycle: income − spent = remaining, plus a projection to month-end */
/* ------------------------------------------------------------------------- */

/** Per-category spend + optional limit for a month. */
export interface CategoryCycle {
  categoryId: string;
  spent: number;
  limit: number | null;
  /** spent / limit as a percentage (0 when no positive limit). */
  pct: number;
}

export interface MonthlyCycle {
  /** False when the family has no active incomes — the UI hides the cycle. */
  hasIncome: boolean;
  totalIncome: number;
  totalSpent: number;
  /** totalIncome − totalSpent (money left after what's already been spent). */
  remaining: number;
  /** Sum of still-unpaid known payment occurrences due within this month. */
  projectedUnpaid: number;
  /** remaining − projectedUnpaid (expected money left at month-end). */
  projectedRemaining: number;
  /** One entry per category (spend + limit math), for the breakdown coloring. */
  perCategory: CategoryCycle[];
}

export interface MonthlyCycleInput {
  month: string;
  incomes: Income[];
  /** Any expenses; filtered to `month` by spent_on internally. */
  expenses: Expense[];
  /** All payments (paused / paid ones are skipped for the projection). */
  payments: Payment[];
  /** Per-occurrence override map (`overrideKey` keyed), for the resolver. */
  paymentOverrides: Map<string, PaymentOverride>;
  categories: ExpenseCategory[];
}

/**
 * The monthly budget cycle. Pure — the projection reuses the shared payment
 * occurrence resolver (`expandPaymentOccurrences`), never a private copy.
 *
 * Semantics:
 *   - `totalIncome` = sum of ACTIVE incomes (the household's monthly income;
 *     one-offs without a date anchor are treated as this month's income).
 *   - `totalSpent`  = sum of expenses whose `spent_on` is in `month` (this
 *     already includes the auto-expenses written when a payment was paid).
 *   - `projectedUnpaid` = sum of payment occurrences that are still unpaid and
 *     fall within `month`. The live `due_date` is the next-unpaid occurrence, so
 *     the resolver never re-counts an occurrence already paid (its auto-expense
 *     is in `totalSpent`). Paid one-time / paused payments are skipped outright.
 *   - `projectedRemaining` = `remaining − projectedUnpaid`.
 *
 * A month with no active incomes returns `hasIncome=false` (and zeroed totals
 * except `totalSpent`) so the page can show spend-only.
 */
export function computeMonthlyCycle(input: MonthlyCycleInput): MonthlyCycle {
  const { month, incomes, expenses, payments, paymentOverrides, categories } = input;
  const { from, to } = monthRange(month);

  const activeIncomes = incomes.filter((i) => i.active);
  const totalIncome = activeIncomes.reduce((sum, i) => sum + i.amount, 0);

  const monthExpenses = expenses.filter((e) => monthOf(e.spent_on) === month);
  const totalSpent = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Projection: still-unpaid known occurrences due within the month.
  let projectedUnpaid = 0;
  for (const payment of payments) {
    // A paid one-time or a paused payment has no upcoming spend.
    if (payment.is_paid || payment.is_paused) continue;
    const occurrences = expandPaymentOccurrences(payment, from, to, paymentOverrides);
    projectedUnpaid += occurrences.length * payment.amount;
  }

  const remaining = totalIncome - totalSpent;
  const projectedRemaining = remaining - projectedUnpaid;

  // Per-category spend + limit math.
  const spentByCategory = new Map<string, number>();
  for (const e of monthExpenses) {
    if (!e.category_id) continue;
    spentByCategory.set(e.category_id, (spentByCategory.get(e.category_id) ?? 0) + e.amount);
  }
  const perCategory: CategoryCycle[] = categories.map((c) => {
    const spent = spentByCategory.get(c.id) ?? 0;
    const limit = c.monthly_limit;
    const pct = limit && limit > 0 ? (spent / limit) * 100 : 0;
    return { categoryId: c.id, spent, limit, pct };
  });

  return {
    hasIncome: activeIncomes.length > 0,
    totalIncome,
    totalSpent,
    remaining,
    projectedUnpaid,
    projectedRemaining,
    perCategory,
  };
}
