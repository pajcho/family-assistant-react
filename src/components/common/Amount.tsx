import { cn } from "@/lib/cn";

/**
 * An RSD money value with the "RSD" suffix rendered smaller and dimmer, so the
 * currency takes less visual space than the number it trails. The number
 * inherits the surrounding text color/size (pass amount-specific classes on the
 * parent); only the suffix is restyled. `round` drops the para (whole dinars).
 *
 * Locale formatting matches `formatAmount` (sr-Latn-RS): dot thousands, comma
 * decimals.
 */
export function Amount({
  value,
  round = false,
  className,
}: {
  value: number;
  round?: boolean;
  className?: string;
}) {
  const n = round ? Math.round(value) : value;
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {n.toLocaleString("sr-Latn-RS")}
      <span className="ml-1 text-[0.72em] font-medium text-gray-400 dark:text-gray-500">RSD</span>
    </span>
  );
}
