/**
 * Multi-currency helpers for the expenses ledger ("frozen rate" design):
 * a foreign-currency expense stores what was typed (`original_amount`,
 * `currency`) plus the NBS middle rate used (`exchange_rate`), while
 * `expenses.amount` is ALWAYS the converted RSD value every aggregation sums.
 * Conversion happens exactly once, at entry time — never when reading history.
 */

/** Currencies the expense form offers. RSD first = the default. Extend together
 *  with SUPPORTED_CURRENCIES in supabase/functions/exchange-rate. */
export const EXPENSE_CURRENCIES = ["RSD", "EUR"] as const;

/** Display symbol for a currency code ("EUR" → "€"; unknown codes pass through). */
export function currencySymbol(code: string): string {
  return code === "EUR" ? "€" : code;
}

/**
 * Parse user-typed decimal input accepting a comma as the decimal separator
 * (sr-Latn keyboards). Returns NaN for empty/invalid input.
 */
export function parseDecimal(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return NaN;
  return Number(trimmed.replace(",", "."));
}

/** amount × rate, rounded to 2 decimals (para). EPSILON guards float artifacts
 *  like 5868.755 → 5868.75 (should be 5868.76). */
export function convertToRsd(amount: number, rate: number): number {
  return Math.round((amount * rate + Number.EPSILON) * 100) / 100;
}

/** "50 €" / "50,5 €" — original-currency annotation shown next to an RSD amount. */
export function formatOriginalAmount(amount: number, currency: string): string {
  const formatted = amount.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 });
  return `${formatted} ${currencySymbol(currency)}`;
}

/** Rate as prefilled into the form's editable input ("117,3751" — comma decimal,
 *  round-trips through parseDecimal). */
export function formatRateInput(rate: number): string {
  return String(rate).replace(".", ",");
}
