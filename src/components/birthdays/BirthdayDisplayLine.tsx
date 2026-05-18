import { CakeIcon, CalendarIcon, ClockIcon } from "@heroicons/react/24/outline";
import { currentAge, daysUntilBirthday } from "@/utils/birthday";
import { formatDate } from "@/utils/date";

/**
 * Compact display line for a birthday — name on the first line, then a row of
 * icon-prefixed metadata (next age, formatted date, "days until" label).
 *
 * Direct port of `components/birthdays/BirthdayDisplayLine.vue`. Kept as its
 * own component because the dashboard birthday card reuses it (with
 * `hideDays`) and that card lands in Phase 4.
 */
export type BirthdayDisplayLineProps = {
  name: string;
  birthDate: string;
  /**
   * When true, suppress the "za N dana" cluster. The dashboard card sets this
   * because it renders the day count separately on the right side of the row.
   */
  hideDays?: boolean;
};

/**
 * "za N dana" pluralization. Matches the Vue source verbatim: 0 → "danas",
 * 1 → "sutra", everything else → `za N dana`. The Vue component does not
 * branch on dan/dana/dana — the migration-plan callout to "port Serbian
 * pluralization for dan/dana" refers to keeping this exact mapping.
 */
function daysLabel(days: number): string {
  if (days === 0) return "danas";
  if (days === 1) return "sutra";
  return `za ${days} dana`;
}

export function BirthdayDisplayLine({
  name,
  birthDate,
  hideDays = false,
}: BirthdayDisplayLineProps) {
  const nextAge = currentAge(birthDate) + 1;
  const dateStr = formatDate(birthDate);
  const days = daysUntilBirthday(birthDate);

  return (
    <div className="flex flex-col flex-wrap gap-x-3 gap-y-1">
      <span className="shrink-0 font-medium text-gray-900 dark:text-gray-100">{name}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs leading-none text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <CakeIcon className="h-3.5 w-3.5 shrink-0" />
          {nextAge}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          {dateStr}
        </span>
        {!hideDays && (
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="h-3.5 w-3.5 shrink-0" />
            {daysLabel(days)}
          </span>
        )}
      </span>
    </div>
  );
}
