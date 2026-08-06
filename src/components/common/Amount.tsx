import { cn } from "@/lib/cn";
import { formatOriginalAmount } from "@/utils/currency";

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
  codeWhenFits = false,
}: {
  value: number;
  round?: boolean;
  className?: string;
  /**
   * Show "RSD" only when it fits beside the number (for cramped containers
   * like the weekly grid's ~85px columns): the row wraps and anything past the
   * first line is clipped away, so a too-long suffix vanishes instead of
   * overflowing the card. The code stays in the DOM, so screen readers still
   * announce the currency.
   */
  codeWhenFits?: boolean;
}) {
  const n = round ? Math.round(value) : value;
  return (
    <span
      className={cn(
        codeWhenFits
          ? "flex max-h-[1.3em] flex-wrap items-baseline overflow-hidden leading-tight"
          : "whitespace-nowrap",
        className,
      )}
    >
      {n.toLocaleString("sr-Latn-RS")}
      {/* Dimmer and lighter than the number it trails: at full
          `muted-foreground` weight the code competed with the value instead of
          annotating it. */}
      <span className="ml-[3px] text-[0.72em] font-medium tracking-[0.03em] text-muted-foreground/70">
        RSD
      </span>
    </span>
  );
}

/**
 * The original foreign-currency entry ("50 €") as a small dim annotation next
 * to an RSD <Amount>. Renders nothing for RSD rows (or legacy rows without an
 * original), so call sites can pass any expense unconditionally.
 */
export function AmountOriginal({
  amount,
  currency,
  className,
  parens = false,
}: {
  amount: number | null;
  currency: string;
  className?: string;
  /** Wrap in parentheses - for inline placement right after an <Amount>. */
  parens?: boolean;
}) {
  if (currency === "RSD" || amount == null) return null;
  const text = formatOriginalAmount(amount, currency);
  return (
    <span className={cn("whitespace-nowrap tabular-nums text-muted-foreground/70", className)}>
      {parens ? `(${text})` : text}
    </span>
  );
}
