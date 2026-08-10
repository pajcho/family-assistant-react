import { cn } from "@/lib/cn";

/**
 * Segmented control - the redesign's in-page view switcher (Kalendar's
 * agenda/week/month, Money's overview/expenses/payments).
 *
 * Distinct from filter chips on purpose: segments are exclusive and always
 * show the full set, so they read as "which view am I in", while chips are
 * additive filters. Selected segment is a soft accent tint, never a solid
 * fill - a filled segment would compete with the accent-filled "+" in the bar.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex gap-0.5 rounded-md border border-border bg-card p-[3px]", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-sm px-1 py-1.5 text-[13px] font-semibold transition-colors",
              active ? "bg-accent-soft text-accent-deep" : "text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
