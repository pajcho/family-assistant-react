import { format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import { srLocale } from "@/utils/date";

/**
 * Shared day divider for the agenda lists (Danas + Uskoro). Renders e.g.
 * "4. jun · Danas · Četvrtak" — the date and the relative token (Danas/Sutra,
 * omitted for later days) in bold, the weekday lighter, dot-separated, under a
 * hairline rule. `today`/`tomorrow` are passed as yyyy-MM-dd so the relative
 * token is decided by string match, without re-deriving "now" per header.
 */
export function AgendaDateHeader({
  day,
  today,
  tomorrow,
  className,
}: {
  day: string;
  today: string;
  tomorrow: string;
  className?: string;
}) {
  const date = parseISO(day + "T12:00:00");
  const dayMonth = format(date, "d. MMMM", { locale: srLocale });
  const weekdayRaw = format(date, "EEEE", { locale: srLocale });
  const weekday = `${weekdayRaw.charAt(0).toUpperCase()}${weekdayRaw.slice(1)}`;
  const relative = day === today ? "Danas" : day === tomorrow ? "Sutra" : null;

  return (
    <h2 className={cn("border-b border-gray-200 pb-2 text-sm dark:border-gray-700", className)}>
      <span className="font-semibold text-gray-900 dark:text-white">{dayMonth}</span>
      <span className="text-gray-400 dark:text-gray-500"> · </span>
      {relative ? (
        <>
          <span className="font-semibold text-gray-900 dark:text-white">{relative}</span>
          <span className="text-gray-400 dark:text-gray-500"> · </span>
        </>
      ) : null}
      <span className="text-gray-500 dark:text-gray-400">{weekday}</span>
    </h2>
  );
}
