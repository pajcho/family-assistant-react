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

/**
 * The on-screen form of an amount field: thousands grouped with dots, decimals
 * after a comma ("1234,5" → "1.234,5"). Takes the field's raw value - digits
 * plus at most one separator - so a seed like `String(1234.5)` reads its dot
 * as the decimal point. The grouping dots exist only on screen: the raw value
 * the form keeps, parses and copies never contains them.
 */
export function formatAmountInput(raw: string): string {
  const [intPart, decPart] = raw.replace(".", ",").split(",");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart === undefined ? grouped : `${grouped},${decPart}`;
}

/**
 * Reads pasted text as an amount in raw form ("1234,56"), whichever
 * convention it was written in. With both separators present the last one is
 * the decimal point ("1.234,56", "1,234.56"); a repeated one is grouping
 * ("1,234,567"). A lone comma is the Serbian decimal comma, and a lone dot is
 * the decimal point unless it groups thousands the way this app shows them
 * ("12.500" is twelve and a half thousand, "12.50" is twelve and a half).
 */
export function normalizePastedAmount(text: string): string {
  const cleaned = text.replace(/[^\d.,]/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let decimalAt = -1;
  if (lastDot !== -1 && lastComma !== -1) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastComma !== -1) {
    if (cleaned.indexOf(",") === lastComma) decimalAt = lastComma;
  } else if (lastDot !== -1) {
    if (cleaned.indexOf(".") === lastDot && !/^[1-9]\d{0,2}\.\d{3}$/.test(cleaned)) {
      decimalAt = lastDot;
    }
  }
  if (decimalAt === -1) return cleaned.replace(/[.,]/g, "");
  const intPart = cleaned.slice(0, decimalAt).replace(/[.,]/g, "");
  return `${intPart},${cleaned.slice(decimalAt + 1).replace(/[.,]/g, "")}`;
}

/** Raw amount tidied for display: no leading zeros, "0," before a bare comma. */
function tidyRawAmount(raw: string): string {
  const commaAt = raw.indexOf(",");
  const intPart = commaAt === -1 ? raw : raw.slice(0, commaAt);
  const rest = commaAt === -1 ? "" : raw.slice(commaAt);
  const trimmed = intPart.replace(/^0+/, "");
  return (trimmed === "" && (intPart !== "" || rest !== "") ? "0" : trimmed) + rest;
}

/**
 * Applies one edit to a formatted amount field: the text between `start` and
 * `end` of `display` is replaced with `inserted` (typed or pasted). Returns
 * the new raw value, its formatted display and where the caret goes, so the
 * grouping dots can come and go under the member's typing without the caret
 * jumping.
 *
 * - Deleting only a grouping dot deletes the digit beside it instead: the dot
 *   is not really there, so Backspace on "1.|234" gives "234".
 * - A typed dot or comma is the decimal comma, and only one is kept.
 * - Anything longer than one character is read as a paste
 *   ({@link normalizePastedAmount}).
 */
export function editAmountInput(
  display: string,
  start: number,
  end: number,
  inserted: string,
  inputType?: string,
): { value: string; display: string; caret: number } {
  let before = display.slice(0, start).replace(/\./g, "");
  let after = display.slice(end).replace(/\./g, "");
  const removed = display.slice(start, end);
  if (inserted === "" && removed !== "" && /^\.+$/.test(removed)) {
    if (inputType === "deleteContentForward") after = after.slice(1);
    else before = before.slice(0, -1);
  }
  let added = inserted.length === 1 ? inserted.replace(/[.,]/, ",").replace(/[^\d,]/, "") : "";
  if (inserted.length > 1) added = normalizePastedAmount(inserted);
  if ((before + after).includes(",")) added = added.replace(",", "");
  const value = tidyRawAmount(before + added + after);
  const formatted = formatAmountInput(value);
  // The caret keeps the same raw characters AFTER it: counting from the end
  // stays right when tidying drops leading zeros or adds a "0," prefix.
  let caret = formatted.length;
  for (let kept = 0; caret > 0 && kept < after.length; caret--) {
    if (formatted[caret - 1] !== ".") kept++;
  }
  return { value, display: formatted, caret };
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
