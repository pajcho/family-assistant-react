import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { IconButton } from "@/components/common/IconButton";
import { MonthGridPopover } from "@/components/common/MonthGridPopover";
import { NowPill } from "@/components/common/NowPill";
import { cn } from "@/lib/cn";
import { currentMonthYYYYMM } from "@/utils/date";
import { monthName, shiftMonth } from "@/utils/budget";

/**
 * Novac's month row - the same header the calendar's Mesec view has, so the two
 * month screens read as one control: serif month name on the left (the title
 * doubles as the month/year grid trigger), small card arrows on the right, and
 * a NowPill back to the current month whenever you are off it.
 *
 * Replaced the centered `‹ Oktobar 2026 ›` pager (2026-08): two detached
 * arrows around a bare label read as an empty divider cutting the screen, and
 * the way back to the current month was buried in the popover.
 */

/** Sentinel month value for the payments "all time" view. */
export const ALL_MONTHS = "all";

export function MonthPager({
  value,
  onChange,
  allOptionLabel,
  className,
}: {
  /** "YYYY-MM", or {@link ALL_MONTHS} when `allOptionLabel` is set. */
  value: string;
  onChange: (next: string) => void;
  allOptionLabel?: string;
  className?: string;
}) {
  const current = currentMonthYYYYMM();
  const isAll = value === ALL_MONTHS;
  // In "all" mode the arrows step from today - there is no anchored month to
  // step from, and landing next to the current one is what you want.
  const baseMonth = isAll ? current : value;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <MonthGridPopover
        value={isAll ? null : value}
        onPick={onChange}
        extraOption={
          allOptionLabel
            ? { label: allOptionLabel, active: isAll, onPick: () => onChange(ALL_MONTHS) }
            : undefined
        }
      >
        <button
          type="button"
          aria-label="Izaberi mesec i godinu"
          className="-mx-1 flex min-w-0 items-baseline gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="truncate font-serif text-[27px] leading-none font-semibold tracking-[-0.01em]">
            {isAll ? (allOptionLabel ?? "Sve") : monthName(value)}
          </span>
          {isAll ? null : (
            <span className="text-sm font-semibold text-muted-foreground tabular-nums">
              {value.slice(0, 4)}.
            </span>
          )}
          <ChevronDownIcon className="size-4 shrink-0 self-center text-muted-foreground" />
        </button>
      </MonthGridPopover>
      <span className="min-w-1 flex-1" />
      {value !== current ? (
        <NowPill
          label={monthName(current)}
          aria-label="Vrati na tekući mesec"
          onClick={() => onChange(current)}
        />
      ) : null}
      <IconButton
        icon={ChevronLeftIcon}
        size="sm"
        aria-label="Prethodni mesec"
        onClick={() => onChange(shiftMonth(baseMonth, -1))}
      />
      <IconButton
        icon={ChevronRightIcon}
        size="sm"
        aria-label="Sledeći mesec"
        onClick={() => onChange(shiftMonth(baseMonth, 1))}
      />
    </div>
  );
}
