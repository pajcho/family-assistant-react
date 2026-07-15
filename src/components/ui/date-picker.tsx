import { useCallback, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { format, parse } from "date-fns";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { srLocale } from "@/utils/date";

/**
 * Year range for the caption dropdowns: far enough back for birth dates
 * (100 years) and forward for scheduling (10 years). A `maxDate` cap
 * tightens the upper bound so the year dropdown can't outrun it.
 */
const YEARS_BACK = 100;
const YEARS_FORWARD = 10;

export type DatePickerProps = {
  /** ISO date (YYYY-MM-DD) or null when unset. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Disable selecting dates AFTER this ISO date (the boundary itself stays selectable). */
  maxDate?: string | null;
  /** Visually mark this ISO date on the calendar (e.g. the next recurring occurrence). */
  markedDate?: string | null;
};

const DISPLAY_FORMAT = "dd.MM.yyyy";
const STATE_FORMAT = "yyyy-MM-dd";

function parseStateDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, STATE_FORMAT, new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Izaberi datum",
  id,
  className,
  disabled,
  maxDate,
  markedDate,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseStateDate(value), [value]);
  const maxParsed = useMemo(() => parseStateDate(maxDate ?? null), [maxDate]);
  const markedParsed = useMemo(() => parseStateDate(markedDate ?? null), [markedDate]);
  const displayText = selected ? format(selected, DISPLAY_FORMAT) : "";

  const handleSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) {
        onChange(null);
      } else {
        onChange(format(date, STATE_FORMAT));
      }
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      // Stop the popover trigger from also handling the click.
      e.stopPropagation();
      e.preventDefault();
      onChange(null);
    },
    [onChange],
  );

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start pr-9 text-left font-normal",
              !displayText && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 opacity-60" />
            <span className="flex-1 truncate">{displayText || placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            autoFocus
            locale={srLocale}
            // Month + year dropdowns in the caption — jumping 10 years back is
            // two dropdown picks instead of 120 arrow clicks.
            captionLayout="dropdown"
            startMonth={new Date(new Date().getFullYear() - YEARS_BACK, 0)}
            endMonth={maxParsed ?? new Date(new Date().getFullYear() + YEARS_FORWARD, 11)}
            formatters={{
              formatMonthDropdown: (date) => format(date, "LLL", { locale: srLocale }),
            }}
            disabled={maxParsed ? { after: maxParsed } : undefined}
            modifiers={markedParsed ? { nextDue: markedParsed } : undefined}
            modifiersClassNames={{
              nextDue:
                "bg-amber-100 text-amber-900 rounded-md dark:bg-amber-900/40 dark:text-amber-200",
            }}
          />
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <button
          type="button"
          aria-label="Obriši datum"
          onClick={handleClear}
          className={cn(
            "absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground opacity-70 hover:opacity-100",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          )}
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
