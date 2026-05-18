import * as React from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { format, parse } from "date-fns";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DatePickerProps = {
  /** ISO date (YYYY-MM-DD) or null when unset. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
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
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(() => parseStateDate(value), [value]);
  const displayText = selected ? format(selected, DISPLAY_FORMAT) : "";

  const handleSelect = React.useCallback(
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

  const handleClear = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
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
          <Calendar mode="single" selected={selected} onSelect={handleSelect} autoFocus />
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
