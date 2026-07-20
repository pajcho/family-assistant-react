import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

export interface ExchangeRateResult {
  /** Unit middle rate: 1 unit of `currency` = `rate` RSD. */
  rate: number;
  /** The NBS list date the rate came from (weekends resolve to the last list). */
  source_date: string;
}

/**
 * Official NBS middle rate for (currency, date), via the `exchange-rate` edge
 * function (which caches every resolved pair in `exchange_rates`). Used only
 * while entering a foreign-currency expense — the chosen rate is frozen into
 * the expense row, so nothing ever re-fetches rates for existing data.
 *
 * Historical rates are immutable → staleTime Infinity. A future `date` (NBS
 * publishes no forward rates) is clamped to today, whose list is the best
 * available answer.
 */
export function useExchangeRate(currency: string, date: string | null) {
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local tz
  const effectiveDate = date && date > today ? today : date;

  return useQuery({
    queryKey: ["exchange-rate", currency, effectiveDate],
    enabled: currency !== "RSD" && !!effectiveDate,
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<ExchangeRateResult> => {
      const { data, error } = await supabase.functions.invoke("exchange-rate", {
        body: { currency, date: effectiveDate },
      });
      if (error || !data || typeof data.rate !== "number" || !(data.rate > 0)) {
        throw new Error("Kurs trenutno nije dostupan");
      }
      return { rate: data.rate, source_date: String(data.source_date ?? effectiveDate) };
    },
  });
}
