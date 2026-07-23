import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEnabledCurrencies } from "@/hooks/useCurrencySettings";
import { ALL_CURRENCIES } from "@/utils/currency";

const CURRENCY_LABELS: Record<string, string> = {
  RSD: "Dinar (RSD)",
  EUR: "Evro (EUR)",
  USD: "Dolar (USD)",
};

/**
 * Family-level currency setting (Porodica tab): which currencies the entry
 * forms offer. RSD is the base currency - every amount is STORED in RSD (NBS
 * middle rate frozen at entry), so it's always on and can't be unchecked.
 * Disabling a currency never touches existing rows; it only removes the option
 * for new entries (rows already in that currency still edit cleanly - but once
 * switched to RSD and saved, the disabled currency is no longer offered).
 *
 * Saving goes through the "Admins can update own family" RLS policy, so the
 * toggles are read-only for non-admins.
 */
export function CurrenciesCard() {
  const { enabled, isAdmin, update } = useEnabledCurrencies();

  const toggle = (code: string, on: boolean) => {
    update.mutate(on ? [...enabled, code] : enabled.filter((c) => c !== code));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Valute</CardTitle>
        <CardDescription>
          U kojim valutama se mogu unositi troškovi i plaćanja. Svi iznosi se čuvaju u dinarima po
          srednjem kursu NBS na dan unosa; isključivanje valute ne menja postojeće unose, samo
          sklanja opciju za nove.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ALL_CURRENCIES.map((code) => {
          const isBase = code === "RSD";
          return (
            <div key={code} className="flex items-center gap-3">
              <input
                id={`currency-${code}-toggle`}
                type="checkbox"
                checked={isBase || enabled.includes(code)}
                onChange={(e) => toggle(code, e.target.checked)}
                disabled={isBase || !isAdmin || update.isPending}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed"
              />
              <label
                htmlFor={`currency-${code}-toggle`}
                className="cursor-pointer text-sm text-gray-700 dark:text-gray-200"
              >
                {CURRENCY_LABELS[code] ?? code}
                {isBase ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    osnovna valuta - uvek uključena
                  </span>
                ) : null}
              </label>
            </div>
          );
        })}
        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">
            Samo administrator porodice može da menja valute.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
