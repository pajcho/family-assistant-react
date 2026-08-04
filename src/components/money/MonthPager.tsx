import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { currentMonthYYYYMM } from "@/utils/date";
import { monthLabel, shiftMonth } from "@/utils/budget";

/**
 * Novac's month pager: `‹ Oktobar 2026 ›`, centered under the segments.
 *
 * It replaces the old bordered `MonthPicker` pill on this screen - inside a
 * fixed header the arrows want to be quiet chrome, not a boxed control. The
 * label still opens the month/year grid (fast jump back over years), so the
 * behaviour the budget and payments pages had is intact; the all-time entry is
 * only offered where it means something (Plaćanja).
 */

/** Sentinel month value for the payments "all time" view. */
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
  const [open, setOpen] = useState(false);
  const current = currentMonthYYYYMM();
  const isAll = value === ALL_MONTHS;
  // In "all" mode the arrows step from today - there is no anchored month to
  // step from, and landing next to the current one is what you want.
  const baseMonth = isAll ? current : value;
  const [gridYear, setGridYear] = useState(() => Number(baseMonth.slice(0, 4)));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setGridYear(Number(baseMonth.slice(0, 4)));
  };

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className={cn("flex items-center justify-center gap-3.5", className)}>
      <PagerArrow
        icon={ChevronLeftIcon}
        label="Prethodni mesec"
        onClick={() => onChange(shiftMonth(baseMonth, -1))}
      />
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Izaberi mesec i godinu"
            className="min-w-[7.5rem] rounded-sm px-2 py-1 text-center text-sm font-extrabold tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {isAll ? (allOptionLabel ?? "Sve") : monthLabel(value)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 rounded-xl p-3" align="center">
          <div className="flex items-center justify-between">
            <PagerArrow
              icon={ChevronLeftIcon}
              label="Prethodna godina"
              onClick={() => setGridYear((y) => y - 1)}
            />
            <span className="text-sm font-extrabold tabular-nums">{gridYear}</span>
            <PagerArrow
              icon={ChevronRightIcon}
              label="Sledeća godina"
              onClick={() => setGridYear((y) => y + 1)}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {MONTH_SHORT_SR.map((name, index) => {
              const month = `${gridYear}-${String(index + 1).padStart(2, "0")}`;
              const selected = !isAll && month === value;
              const isCurrent = month === current;
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => pick(month)}
                  className={cn(
                    "rounded-sm px-2 py-2 text-sm font-bold transition-colors",
                    selected
                      ? "bg-accent text-accent-foreground"
                      : isCurrent
                        ? "bg-accent-soft text-accent-deep"
                        : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => pick(current)}
              className="rounded-sm px-2 py-2 text-left text-sm font-bold text-accent-deep hover:bg-muted"
            >
              Ovaj mesec
            </button>
            {allOptionLabel ? (
              <button
                type="button"
                onClick={() => pick(ALL_MONTHS)}
                className={cn(
                  "rounded-sm px-2 py-2 text-left text-sm font-bold hover:bg-muted",
                  isAll ? "text-accent-deep" : "text-muted-foreground",
                )}
              >
                {allOptionLabel}
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <PagerArrow
        icon={ChevronRightIcon}
        label="Sledeći mesec"
        onClick={() => onChange(shiftMonth(baseMonth, 1))}
      />
    </div>
  );
}

/** 30px visual, 44px hit area - the arrows must stay tappable in the header. */
function PagerArrow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ChevronLeftIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon className="size-4" />
    </button>
  );
}
