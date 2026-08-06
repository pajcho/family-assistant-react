/**
 * Multi-currency helpers for the expenses ledger ("frozen rate" design):
 * a foreign-currency expense stores what was typed (`original_amount`,
 * `currency`) plus the NBS middle rate used (`exchange_rate`), while
 * `expenses.amount` is ALWAYS the converted RSD value every aggregation sums.
 * Conversion happens exactly once, at entry time - never when reading history.
 */

/** Every currency the app knows about, in display order (RSD = base, always
 *  first). Extend together with SUPPORTED_CURRENCIES in
 *  supabase/functions/exchange-rate. */
export const ALL_CURRENCIES = ["RSD", "EUR", "USD"] as const;

/** What a family starts with until they touch the Valute settings. */
export const DEFAULT_ENABLED_CURRENCIES = ["RSD", "EUR"];

/** Display label for a currency code - the code itself ("EUR", "USD", "RSD"):
 *  amounts read as "50 EUR" everywhere, matching how RSD is shown. */
export function currencySymbol(code: string): string {
  return code;
}

/**
 * Sanitizes a stored enabled-currencies list: unknown codes dropped, order
 * normalized to ALL_CURRENCIES, RSD forced in (it's the base currency - the
 * DB CHECK guarantees it too, this is belt-and-suspenders for stale caches).
 */
export function normalizeEnabledCurrencies(raw: string[] | null | undefined): string[] {
  const set = new Set(raw ?? DEFAULT_ENABLED_CURRENCIES);
  set.add("RSD");
  return ALL_CURRENCIES.filter((c) => set.has(c));
}

/**
 * Options a currency toggle offers: the family's enabled list PLUS the edited
 * entity's current currency - so an expense/payment saved in a since-disabled
 * currency still edits cleanly (but once switched to RSD and saved, the
 * disabled currency is no longer offered).
 */
export function currencyOptions(enabled: string[], current?: string | null): string[] {
  const set = new Set(enabled);
  if (current) set.add(current);
  return ALL_CURRENCIES.filter((c) => set.has(c));
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

/**
 * Keeps a typed amount to what {@link parseDecimal} can actually read: digits
 * plus at most one separator (comma or dot - sr-Latn keyboards give either).
 * Letters and stray symbols are dropped as they are typed, so an amount field
 * can never end up holding "q2asd" and silently failing validation.
 *
 * Partial input stays partial on purpose: "12," is what you have mid-typing,
 * and rewriting it to "12" would eat the keystroke.
 */
export function sanitizeDecimalInput(input: string): string {
  const cleaned = input.replace(/[^\d.,]/g, "");
  const firstSeparator = cleaned.search(/[.,]/);
  if (firstSeparator === -1) return cleaned;
  const head = cleaned.slice(0, firstSeparator + 1);
  const tail = cleaned.slice(firstSeparator + 1).replace(/[.,]/g, "");
  return head + tail;
}

/** amount × rate, rounded to 2 decimals (para). EPSILON guards float artifacts
 *  like 5868.755 → 5868.75 (should be 5868.76). */
export function convertToRsd(amount: number, rate: number): number {
  return Math.round((amount * rate + Number.EPSILON) * 100) / 100;
}

/** "50 EUR" / "50,5 EUR" - original-currency annotation shown next to an RSD amount. */
export function formatOriginalAmount(amount: number, currency: string): string {
  const formatted = amount.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 });
  return `${formatted} ${currencySymbol(currency)}`;
}

/** Rate as prefilled into the form's editable input ("117,3751" - comma decimal,
 *  round-trips through parseDecimal). */
export function formatRateInput(rate: number): string {
  return String(rate).replace(".", ",");
}
