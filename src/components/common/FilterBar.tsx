import { useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { FunnelIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

/**
 * Shared single-row list toolbar: `[period] [🔍] [Filteri •N]`. On mobile the
 * search collapses to an icon that expands over the whole row (with "Otkaži");
 * from `sm` up the input stays visible inline. Sheet-based filters hang off
 * the trailing `FilterTriggerButton` - the sheet itself is the page's
 * `FilterSheet`.
 */
export type FilterBarProps = {
  /** Period control (MonthPicker / week switcher). Optional. */
  picker?: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel?: string;
  /** Non-default filters currently applied; badges the Filteri button. */
  filterCount?: number;
  /** Omit to render the toolbar without a Filteri button. */
  onOpenFilters?: () => void;
};

export function FilterBar({
  picker,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  filterCount = 0,
  onOpenFilters,
}: FilterBarProps) {
  // Mobile-only expansion; a non-empty query keeps the field open so the
  // active search is never invisible.
  const [searchOpen, setSearchOpen] = useState(false);
  const expanded = searchOpen || searchValue.length > 0;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const collapseSearch = () => {
    onSearchChange("");
    setSearchOpen(false);
  };

  return (
    // flex-wrap: when the picker carries its "Ovaj mesec" reset (or a long
    // "Svi …" label) the trailing buttons wrap to a second line instead of
    // clipping - the single-row promise holds in the common case.
    <div className="flex flex-wrap items-center gap-2">
      {picker ? (
        <div className={cn("flex min-w-0 items-center", expanded && "hidden sm:flex")}>
          {picker}
        </div>
      ) : null}

      <div className={cn("relative min-w-0 flex-1", !expanded && "hidden sm:block")}>
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel ?? searchPlaceholder}
          className="pl-9"
        />
        {searchValue ? (
          <button
            type="button"
            aria-label="Obriši pretragu"
            onClick={() => onSearchChange("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100"
          >
            <XMarkIcon className="size-4" />
          </button>
        ) : null}
      </div>

      {!expanded ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Pretraga"
          className="sm:hidden"
          onClick={() => setSearchOpen(true)}
        >
          <MagnifyingGlassIcon className="size-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 sm:hidden"
          onClick={collapseSearch}
        >
          Otkaži
        </Button>
      )}

      {onOpenFilters ? (
        <FilterTriggerButton
          count={filterCount}
          onClick={onOpenFilters}
          className={cn(expanded && "hidden sm:inline-flex")}
        />
      ) : null}
    </div>
  );
}

/**
 * The "Filteri" trigger - outline pill with a funnel icon and a count badge;
 * turns blue while any non-default filter is applied. Shared by every list
 * page and the dashboard so the affordance reads identically everywhere.
 */
export function FilterTriggerButton({
  count = 0,
  className,
  ...props
}: ComponentProps<typeof Button> & { count?: number }) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "relative shrink-0",
        count > 0 &&
          "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50",
        className,
      )}
      {...props}
    >
      <FunnelIcon className="size-4" />
      Filteri
      {/* Overlaid on the corner so appearing/disappearing never changes the
          button's width - the toolbar row can't reflow when a filter lands. */}
      {count > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white tabular-nums shadow-sm">
          {count}
        </span>
      ) : null}
    </Button>
  );
}
