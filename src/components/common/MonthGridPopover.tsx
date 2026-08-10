import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Slot } from "radix-ui";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/cn";
import { currentMonthYYYYMM } from "@/utils/date";

/**
 * A month grid for jumping far - a year with arrows, 12 months, a shortcut back
 * to the current month and (optionally) one extra row such as "all payments".
 *
 * Shared between Money (MonthPager) and the calendar's month view, so that
 * "pick a month and a year" looks and behaves the same everywhere. The trigger
 * arrives as `children` (asChild), so each screen keeps its own title styling.
 *
 * On desktop the popover is anchored to the title; on mobile it opens as a
 * bottom sheet - the same rule every picker in a form follows (PickerOverlay),
 * because on a phone a modal is easier to read and to pick from than a small
 * anchored panel.
 */

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

export function MonthGridPopover({
  value,
  onPick,
  extraOption,
  align = "start",
  children,
}: {
  /** The selected month ("YYYY-MM"), or null when none is (e.g. all payments). */
  value: string | null;
  onPick: (month: string) => void;
  /** An extra row in the footer (payments use it for "all payments"). */
  extraOption?: { label: string; active: boolean; onPick: () => void };
  align?: "start" | "center";
  /** The trigger - forwarded into PopoverTrigger asChild. */
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const current = currentMonthYYYYMM();
  const anchor = value ?? current;
  const [gridYear, setGridYear] = useState(() => Number(anchor.slice(0, 4)));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setGridYear(Number(anchor.slice(0, 4)));
  };

  const pick = (month: string) => {
    onPick(month);
    setOpen(false);
  };

  const grid = (
    <>
      <div className="flex items-center justify-between">
        <YearArrow
          icon={ChevronLeftIcon}
          label="Prethodna godina"
          onClick={() => setGridYear((y) => y - 1)}
        />
        <span className="text-sm font-bold tabular-nums">{gridYear}</span>
        <YearArrow
          icon={ChevronRightIcon}
          label="Sledeća godina"
          onClick={() => setGridYear((y) => y + 1)}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {MONTH_SHORT_SR.map((name, index) => {
          const month = `${gridYear}-${String(index + 1).padStart(2, "0")}`;
          const selected = month === value;
          const isCurrent = month === current;
          return (
            <button
              key={month}
              type="button"
              onClick={() => pick(month)}
              className={cn(
                "rounded-sm px-2 py-2 text-sm font-semibold transition-colors",
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
          className="rounded-sm px-2 py-2 text-left text-sm font-semibold text-accent-deep hover:bg-muted"
        >
          Ovaj mesec
        </button>
        {extraOption ? (
          <button
            type="button"
            onClick={() => {
              extraOption.onPick();
              setOpen(false);
            }}
            className={cn(
              "rounded-sm px-2 py-2 text-left text-sm font-semibold hover:bg-muted",
              extraOption.active ? "text-accent-deep" : "text-muted-foreground",
            )}
          >
            {extraOption.label}
          </button>
        ) : null}
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-64 rounded-xl p-3" align={align}>
          {grid}
        </PopoverContent>
      </Popover>
    );
  }

  // Mobile trigger: Slot merges onClick onto the passed button, so the trigger
  // stays the same element in both branches (no wrapper that would change the
  // title layout).
  return (
    <>
      <Slot.Root onClick={() => handleOpenChange(true)}>{children}</Slot.Root>
      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Izaberi mesec</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Izbor meseca i godine
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {grid}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

/** A 44px touch target around the small arrow in the grid header. */
function YearArrow({
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
