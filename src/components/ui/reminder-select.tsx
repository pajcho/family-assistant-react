import * as React from "react";
import { BellIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Native `<select>` wrapped in Input-matching chrome. Native renders
 * give us the iOS / Android system picker for free, which is what
 * users expect on mobile (and is hard to beat with a custom dropdown).
 *
 * Value space depends on the caller: for events it's "minutes before
 * start_time"; for payments it's "days before due_date" (since payments
 * carry no time-of-day, the reminder fires at the user's morning_time).
 * Callers pass their own `options` so this component stays unaware of
 * the unit semantics.
 */

export type ReminderOption = { value: number | null; label: string };

export const EVENT_REMINDER_OPTIONS: ReadonlyArray<ReminderOption> = [
  { value: null, label: "Bez podsetnika" },
  { value: 5, label: "5 minuta ranije" },
  { value: 15, label: "15 minuta ranije" },
  { value: 30, label: "30 minuta ranije" },
];

export const PAYMENT_REMINDER_OPTIONS: ReadonlyArray<ReminderOption> = [
  { value: null, label: "Bez podsetnika" },
  { value: 0, label: "Na dan dospeća" },
  { value: 1, label: "Dan pre" },
  { value: 3, label: "3 dana pre" },
  { value: 7, label: "Nedelju dana pre" },
];

export type ReminderSelectProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  options?: ReadonlyArray<ReminderOption>;
  id?: string;
  className?: string;
  disabled?: boolean;
};

export function ReminderSelect({
  value,
  onChange,
  options = EVENT_REMINDER_OPTIONS,
  id,
  className,
  disabled,
}: ReminderSelectProps) {
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value;
      onChange(next === "" ? null : Number(next));
    },
    [onChange],
  );

  return (
    <div className={cn("relative", className)}>
      <BellIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      />
      <select
        id={id}
        value={value ?? ""}
        onChange={handleChange}
        disabled={disabled}
        className={cn(
          "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-9 pl-9 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          value == null ? "text-muted-foreground" : "",
        )}
      >
        {options.map((opt) => (
          <option key={opt.value ?? "none"} value={opt.value ?? ""}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Caret — purely decorative; the native picker is what actually
          opens on click. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
