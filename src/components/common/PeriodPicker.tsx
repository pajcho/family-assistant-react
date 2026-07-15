import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentMonthYYYYMM } from "@/utils/date";
import { monthLabel, shiftMonth } from "@/utils/budget";
import { cn } from "@/lib/cn";

/**
 * Shared period-switcher chrome: the ‹ label › pill used by the activities
 * week switcher, the budget month switcher and the payments month filter, so
 * all three read as the same control.
 *
 * `PeriodPickerShell` is just the pill (arrows + a center slot).
 * `MonthPicker` composes it into a full month control: arrows step a month,
 * the center label opens a month/year grid (fast jump years back), an
 * optional "all time" entry, and a built-in "Ovaj mesec" reset that appears
 * whenever the selection isn't the current month.
 */

export type PeriodPickerShellProps = {
  onPrev: () => void;
  onNext: () => void;
  prevAriaLabel: string;
  nextAriaLabel: string;
  /** Center element — a plain label or a popover trigger. */
  children: ReactNode;
  className?: string;
};

export function PeriodPickerShell({
  onPrev,
  onNext,
  prevAriaLabel,
  nextAriaLabel,
  children,
  className,
}: PeriodPickerShellProps) {
  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-md border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800",
        className,
      )}
    >
      <button
        type="button"
        onClick={onPrev}
        aria-label={prevAriaLabel}
        className="rounded-l-md p-2 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>
      {children}
      <button
        type="button"
        onClick={onNext}
        aria-label={nextAriaLabel}
        className="rounded-r-md p-2 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Sentinel `value` for the optional "all time" mode (payments). */
export const ALL_MONTHS = "all";

const MONTH_SHORT_SR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Maj",
  "Jun",
  "Jul",
  "Avg",
  "Sep",
  "Okt",
  "Nov",
  "Dec",
] as const;

export type MonthPickerProps = {
  /** "YYYY-MM", or {@link ALL_MONTHS} when `allOptionLabel` is enabled. */
  value: string;
  onChange: (value: string) => void;
  /** When set, the grid popup offers an "all time" entry with this label. */
  allOptionLabel?: string;
  /** Label of the back-to-current-month button. */
  resetLabel?: string;
  /** Inclusive "YYYY-MM" bounds — arrows/grid can't leave the range (e.g. birthdays: current year only). */
  minMonth?: string;
  maxMonth?: string;
  className?: string;
};

export function MonthPicker({
  value,
  onChange,
  allOptionLabel,
  resetLabel = "Ovaj mesec",
  minMonth,
  maxMonth,
  className,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const current = currentMonthYYYYMM();
  const isAll = value === ALL_MONTHS;
  // Arrows step from the current month while in "all" mode — there's no
  // anchored month to step from, and landing next to today is what you want.
  const baseMonth = isAll ? current : value;
  const [gridYear, setGridYear] = useState<number>(() => Number(baseMonth.slice(0, 4)));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setGridYear(Number(baseMonth.slice(0, 4)));
  };

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const inRange = (month: string) =>
    (!minMonth || month >= minMonth) && (!maxMonth || month <= maxMonth);
  const step = (delta: number) => {
    const next = shiftMonth(baseMonth, delta);
    if (inRange(next)) onChange(next);
  };
  const minYear = minMonth ? Number(minMonth.slice(0, 4)) : null;
  const maxYear = maxMonth ? Number(maxMonth.slice(0, 4)) : null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <PeriodPickerShell
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        prevAriaLabel="Prethodni mesec"
        nextAriaLabel="Sledeći mesec"
      >
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Izaberi mesec i godinu"
              className="min-w-[8.5rem] border-x border-gray-200 px-3 py-1.5 text-center text-sm font-medium tabular-nums text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {isAll ? (allOptionLabel ?? "Sve") : monthLabel(value)}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="center">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Prethodna godina"
                onClick={() => setGridYear((y) => y - 1)}
                disabled={minYear != null && gridYear <= minYear}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-gray-700"
              >
                <ChevronLeftIcon className="size-4" />
              </button>
              <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {gridYear}
              </span>
              <button
                type="button"
                aria-label="Sledeća godina"
                onClick={() => setGridYear((y) => y + 1)}
                disabled={maxYear != null && gridYear >= maxYear}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-gray-700"
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {MONTH_SHORT_SR.map((name, i) => {
                const month = `${gridYear}-${String(i + 1).padStart(2, "0")}`;
                const selected = !isAll && month === value;
                const isCurrent = month === current;
                return (
                  <button
                    key={month}
                    type="button"
                    onClick={() => pick(month)}
                    disabled={!inRange(month)}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40",
                      selected
                        ? "bg-blue-600 font-medium text-white"
                        : isCurrent
                          ? "bg-blue-50 font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700",
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            {allOptionLabel ? (
              <button
                type="button"
                onClick={() => pick(ALL_MONTHS)}
                className={cn(
                  "mt-2 w-full rounded-md border px-2 py-1.5 text-sm transition-colors",
                  isAll
                    ? "border-blue-300 bg-blue-50 font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                    : "border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700",
                )}
              >
                {allOptionLabel}
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      </PeriodPickerShell>
      {value !== current ? (
        <Button variant="outline" size="sm" onClick={() => onChange(current)}>
          {resetLabel}
        </Button>
      ) : null}
    </div>
  );
}
