import { format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import { srLocale } from "@/utils/date";

/**
 * Shared day divider for the agenda lists (Danas + Uskoro). Renders e.g.
 * "4. jun · Danas · Četvrtak" — the date and the relative token (Danas/Sutra,
 * omitted for later days) in bold, the weekday lighter, dot-separated, under a
 * hairline rule. `today`/`tomorrow` are passed as yyyy-MM-dd so the relative
 * token is decided by string match, without re-deriving "now" per header.
 *
 * `muted` dims the WHOLE header uniformly to a disabled-looking gray — used by
 * the Uskoro list for days that carry no items (now always shown). The relative
 * token (Danas/Sutra) drops its bold too, so an empty day reads as plainly
 * inactive rather than half-highlighted.
 */
export function AgendaDateHeader({
  day,
  today,
  tomorrow,
  muted = false,
  className,
}: {
  day: string;
  today: string;
  tomorrow: string;
  muted?: boolean;
  className?: string;
}) {
  const date = parseISO(day + "T12:00:00");
  const dayMonth = format(date, "d. MMMM", { locale: srLocale });
  const weekdayRaw = format(date, "EEEE", { locale: srLocale });
  const weekday = `${weekdayRaw.charAt(0).toUpperCase()}${weekdayRaw.slice(1)}`;
  const relative = day === today ? "Danas" : day === tomorrow ? "Sutra" : null;

  return (
    <h2
      className={cn(
        "border-b pb-2 text-sm",
        muted ? "border-gray-100 dark:border-gray-800" : "border-gray-200 dark:border-gray-700",
        className,
      )}
    >
      <span
        className={cn(
          muted
            ? "font-medium text-gray-400 dark:text-gray-600"
            : "font-semibold text-gray-900 dark:text-white",
        )}
      >
        {dayMonth}
      </span>
      <span
        className={muted ? "text-gray-300 dark:text-gray-700" : "text-gray-400 dark:text-gray-500"}
      >
        {" · "}
      </span>
      {relative ? (
        <>
          <span
            className={cn(
              muted
                ? "font-medium text-gray-400 dark:text-gray-600"
                : "font-semibold text-gray-900 dark:text-white",
            )}
          >
            {relative}
          </span>
          <span
            className={
              muted ? "text-gray-300 dark:text-gray-700" : "text-gray-400 dark:text-gray-500"
            }
          >
            {" · "}
          </span>
        </>
      ) : null}
      <span
        className={muted ? "text-gray-400 dark:text-gray-600" : "text-gray-500 dark:text-gray-400"}
      >
        {weekday}
      </span>
    </h2>
  );
}
