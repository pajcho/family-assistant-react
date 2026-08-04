import { useCallback, useEffect, useState } from "react";

import { Amount } from "@/components/common/Amount";
import { FormInput, SegmentedPills } from "@/components/common/FormControls";
import { Label } from "@/components/ui/label";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { convertToRsd, currencySymbol, formatRateInput, parseDecimal } from "@/utils/currency";
import { formatDate } from "@/utils/date";

/**
 * Shared multi-currency plumbing for the entry forms (ExpenseForm,
 * PaymentForm): one hook that owns the currency + editable NBS rate, and two
 * small pieces the forms place wherever their layout wants them -
 * `<CurrencyToggle>` (next to the amount label) and `<ExchangeRateRow>` (the
 * "Kurs" input + live RSD preview + status line).
 *
 * The "frozen rate" contract lives in `freeze()`: at submit time the typed
 * amount + rate become `{ amount: RSD, currency, original_amount,
 * exchange_rate }` - conversion happens exactly once, never on read.
 */

/** What `freeze()` contributes to a submit payload. */
export interface FrozenCurrencyAmount {
  /** Always RSD. */
  amount: number;
  currency: string;
  original_amount: number | null;
  exchange_rate: number | null;
}

export interface CurrencyAmountControl {
  currency: string;
  isForeign: boolean;
  /** Raw editable rate input (comma decimals accepted). */
  rateInput: string;
  rateNum: number;
  suggestedRate: number | undefined;
  sourceDate: string | undefined;
  rateLoading: boolean;
  rateError: boolean;
  setCurrency(code: string): void;
  setRateInput(value: string): void;
  resetToSuggested(): void;
  /** Reseed from the edited entity (call from the form's reseed effect). */
  reset(currency: string | null | undefined, rate: number | null | undefined): void;
  /** Live RSD preview for the typed amount, or null while not computable. */
  preview(amountNum: number): number | null;
  /** Submit-time conversion; null = foreign without a valid rate (block submit). */
  freeze(amountNum: number): FrozenCurrencyAmount | null;
}

export function useCurrencyAmount(
  initial: { currency?: string | null; exchange_rate?: number | null } | null | undefined,
  /** Transaction date driving the NBS lookup (spent_on / due_date). */
  date: string | null,
): CurrencyAmountControl {
  const seedCurrency = initial?.currency ?? "RSD";
  const seedRate = initial?.exchange_rate ?? null;

  const [currency, setCurrencyState] = useState(seedCurrency);
  const [rateInput, setRateInputState] = useState(
    seedRate != null ? formatRateInput(seedRate) : "",
  );
  // Editing an existing foreign row keeps its stored (frozen) rate: a fresh
  // NBS fetch must not silently rewrite a conversion that was already saved.
  const [rateTouched, setRateTouched] = useState(seedCurrency !== "RSD" && seedRate != null);

  const isForeign = currency !== "RSD";
  const rateQuery = useExchangeRate(currency, date);
  const suggestedRate = rateQuery.data?.rate;

  // Prefill / follow the NBS rate while the member hasn't overridden it (a
  // date change refetches and re-fills through this same path).
  useEffect(() => {
    if (!isForeign || suggestedRate == null) return;
    const next = formatRateInput(suggestedRate);
    setRateInputState((prev) => (rateTouched || prev === next ? prev : next));
  }, [isForeign, suggestedRate, rateTouched]);

  const setCurrency = useCallback((code: string) => {
    setCurrencyState((prev) => {
      if (prev === code) return prev;
      setRateInputState("");
      setRateTouched(false);
      return code;
    });
  }, []);

  const setRateInput = useCallback((value: string) => {
    setRateInputState(value);
    setRateTouched(true);
  }, []);

  const resetToSuggested = useCallback(() => {
    if (suggestedRate == null) return;
    setRateInputState(formatRateInput(suggestedRate));
    setRateTouched(false);
  }, [suggestedRate]);

  const reset = useCallback((c: string | null | undefined, r: number | null | undefined) => {
    const nextCurrency = c ?? "RSD";
    setCurrencyState(nextCurrency);
    setRateInputState(r != null ? formatRateInput(r) : "");
    setRateTouched(nextCurrency !== "RSD" && r != null);
  }, []);

  const rateNum = parseDecimal(rateInput);

  const preview = useCallback(
    (amountNum: number): number | null =>
      isForeign && amountNum > 0 && rateNum > 0 ? convertToRsd(amountNum, rateNum) : null,
    [isForeign, rateNum],
  );

  const freeze = useCallback(
    (amountNum: number): FrozenCurrencyAmount | null => {
      if (!isForeign) {
        return { amount: amountNum, currency, original_amount: null, exchange_rate: null };
      }
      if (!(rateNum > 0)) return null;
      return {
        amount: convertToRsd(amountNum, rateNum),
        currency,
        original_amount: amountNum,
        exchange_rate: rateNum,
      };
    },
    [isForeign, currency, rateNum],
  );

  return {
    currency,
    isForeign,
    rateInput,
    rateNum,
    suggestedRate,
    sourceDate: rateQuery.data?.source_date,
    rateLoading: rateQuery.isLoading,
    rateError: rateQuery.isError,
    setCurrency,
    setRateInput,
    resetToSuggested,
    reset,
    preview,
    freeze,
  };
}

/**
 * Segmented currency picker for a form's amount label row. Renders NOTHING
 * when there's only one option (family disabled all foreign currencies) -
 * the form then behaves exactly like the pre-multi-currency app.
 */
export function CurrencyToggle({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  options: string[];
  className?: string;
}) {
  if (options.length <= 1) return null;
  // Currency is always a CODE (RSD / EUR), never a symbol - the app-wide rule.
  return (
    <SegmentedPills
      value={value}
      onChange={onChange}
      options={options}
      ariaLabel="Valuta"
      className={className}
    />
  );
}

/**
 * The "Kurs" row for a foreign-currency entry: editable NBS-prefilled rate,
 * live "= X RSD" preview and a status line (loading / NBS list date / manual
 * fallback when the rate service is unreachable / "Vrati NBS kurs" after a
 * manual override). Renders nothing while the currency is RSD.
 */
export function ExchangeRateRow({
  control,
  amountNum,
  inputId,
}: {
  control: CurrencyAmountControl;
  amountNum: number;
  inputId: string;
}) {
  const c = control;
  if (!c.isForeign) return null;
  const rsdPreview = c.preview(amountNum);
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left">
      <div className="flex items-center gap-2">
        <Label htmlFor={inputId} className="shrink-0 text-xs font-bold text-muted-foreground">
          Kurs
        </Label>
        <FormInput
          id={inputId}
          value={c.rateInput}
          onChange={(e) => c.setRateInput(e.target.value)}
          inputMode="decimal"
          required
          placeholder={c.rateLoading ? "…" : "0,00"}
          className="w-28 py-1.5 text-right tabular-nums"
        />
        <span className="min-w-0 flex-1 truncate text-right text-sm font-bold tabular-nums">
          {rsdPreview != null ? (
            <>
              = <Amount value={rsdPreview} />
            </>
          ) : null}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {c.rateLoading ? (
          "Učitavam srednji kurs NBS…"
        ) : c.rateError ? (
          "Kurs NBS trenutno nije dostupan - unesi kurs ručno."
        ) : c.suggestedRate != null && c.rateNum !== c.suggestedRate ? (
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={c.resetToSuggested}
          >
            Vrati NBS kurs ({formatRateInput(c.suggestedRate)})
          </button>
        ) : c.sourceDate ? (
          `Srednji kurs NBS (${formatDate(c.sourceDate)})`
        ) : null}
      </p>
    </div>
  );
}

/** Re-export for form suffixes ("EUR" / "USD" / "RSD"). */
export { currencySymbol };
