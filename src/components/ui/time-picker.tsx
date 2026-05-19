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
  /** Render the inline clear (X) button when a value is set. Defaults to `true`. */
  clearable?: boolean;
};

export function TimePicker({
  value,
  onChange,
  placeholder = "--:--",
  id,
  className,
  disabled,
  clearable = true,
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
      // stopPropagation prevents an ancestor <label htmlFor> from
      // re-targeting this click at its associated control.
      e.preventDefault();
      e.stopPropagation();
      onChange(null);
    },
    [onChange],
  );

  const showClear = clearable && !!value && !disabled;

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
          "pl-9",
          showClear ? "pr-9" : "pr-3",
          // iOS Safari enforces a minimum content-based width on
          // <input type="time"> and overlays its own picker indicator;
          // `appearance-none` lets the field actually shrink to the
          // container, and the calendar-picker-indicator overrides hide
          // the native chevron so our clock + X are the only controls.
          "appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
          // iOS Safari right-aligns the time value by default which can
          // push the bordered box past its parent; force left so it
          // honors `pl-9` and stays inside the container.
          "[&::-webkit-date-and-time-value]:text-left",
          value ? "" : "text-muted-foreground",
        )}
      />
      {showClear ? (
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
      ) : null}
    </div>
  );
}
