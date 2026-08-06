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
 * Mreža meseci za daleki skok - godina sa strelicama, 12 meseci, prečica
 * "Ovaj mesec" i (opciono) jedan dodatni red poput "Sva plaćanja".
 *
 * Deljena između Novca (MonthPager) i Kalendarovog Mesec prikaza, da "izaberi
 * mesec i godinu" svuda izgleda i radi isto. Okidač dolazi kao `children`
 * (asChild), pa svaki ekran zadržava svoj izgled naslova.
 *
 * Na desktopu je popover usidren uz naslov; na mobilnom se otvara kao bottom
 * sheet - isto pravilo kao svi pickeri u formama (PickerOverlay), jer je modal
 * na telefonu pregledniji i lakši za izbor od malog usidrenog panela.
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
  /** Označeni mesec ("YYYY-MM"), ili null kad nijedan nije (npr. "sva plaćanja"). */
  value: string | null;
  onPick: (month: string) => void;
  /** Dodatni red u podnožju (Plaćanja: "Sva plaćanja"). */
  extraOption?: { label: string; active: boolean; onPick: () => void };
  align?: "start" | "center";
  /** Okidač - prosleđuje se u PopoverTrigger asChild. */
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

  // Mobilni okidač: Slot spaja onClick na prosleđeno dugme, pa okidač ostaje
  // isti element u obe grane (bez omotača koji bi menjao layout naslova).
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

/** 44px dodirna meta oko male strelice u zaglavlju mreže. */
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
