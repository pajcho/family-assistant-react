import * as React from "react";
import { ClockIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";

export type TimePickerProps = {
  /** Time in 24h `HH:mm` format, or null when unset. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
};

export function TimePicker({
  value,
  onChange,
  placeholder = "--:--",
  id,
  className,
  disabled,
}: TimePickerProps) {
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      onChange(next ? next : null);
    },
    [onChange],
  );

  const handleClear = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onChange(null);
    },
    [onChange],
  );

  return (
    <div className={cn("relative", className)}>
      <ClockIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      />
      <Input
        id={id}
        type="time"
        value={value ?? ""}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "pr-9 pl-9",
          // Hide WebKit's native time-picker indicator so we render a single,
          // consistent clock icon (matches the original Nuxt VueDatePicker look).
          "[&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
          value ? "" : "text-muted-foreground",
        )}
      />
      {value && !disabled && (
        <button
          type="button"
          aria-label="Obriši vreme"
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
