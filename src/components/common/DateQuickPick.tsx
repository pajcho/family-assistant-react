import { addMonths, format, startOfMonth } from "date-fns";

import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToday } from "@/hooks/useToday";
import { addDays } from "@/utils/date";
import { cn } from "@/lib/cn";

/**
 * DatePicker + a row of quick-pick chips — the "Brzi unos" date field. The
 * chips cover the common dates in one tap; the picker stays for everything
 * else. Two orientations: `future` (due dates — Danas · Sutra · Za 7 dana ·
 * 1. of next month) and `past` (spent-on dates — Danas · Juče · Prekjuče).
 * Chip targets come from `useToday()` so a sheet left open across midnight /
 * PWA resume still offers the right dates.
 */
export type DateQuickPickProps = {
  id?: string;
  label: string;
  /** ISO `yyyy-MM-dd` or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Chip direction: `future` (default, due dates) or `past` (spent-on). */
  mode?: "future" | "past";
};

export function DateQuickPick({
  id,
  label,
  value,
  onChange,
  placeholder,
  mode = "future",
}: DateQuickPickProps) {
  const today = useToday();
  const firstOfNext = startOfMonth(addMonths(today.date, 1));
  const chips: Array<{ label: string; iso: string }> =
    mode === "past"
      ? [
          { label: "Danas", iso: today.str },
          { label: "Juče", iso: format(addDays(today.date, -1), "yyyy-MM-dd") },
          { label: "Prekjuče", iso: format(addDays(today.date, -2), "yyyy-MM-dd") },
        ]
      : [
          { label: "Danas", iso: today.str },
          { label: "Sutra", iso: format(addDays(today.date, 1), "yyyy-MM-dd") },
          { label: "Za 7 dana", iso: format(addDays(today.date, 7), "yyyy-MM-dd") },
          { label: format(firstOfNext, "dd.MM."), iso: format(firstOfNext, "yyyy-MM-dd") },
        ];

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <DatePicker id={id} value={value} onChange={onChange} placeholder={placeholder} />
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const selected = value === chip.iso;
          return (
            <button
              type="button"
              key={chip.iso}
              onClick={() => onChange(chip.iso)}
              aria-pressed={selected}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                selected
                  ? "border-blue-600 bg-blue-600/10 font-medium text-blue-700 dark:text-blue-300"
                  : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
