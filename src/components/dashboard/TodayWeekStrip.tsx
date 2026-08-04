import { useNavigate } from "@tanstack/react-router";
import { addDays, format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import { getWeekStart } from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { stavkeLabel } from "@/utils/plural";

/**
 * The slim week strip in the Danas header (redizajn 2.0).
 *
 * Deliberately much simpler than the agenda's pager strip: one week, no
 * swiping, no scroll-spy. It answers "how loaded is the rest of my week" at a
 * glance - up to three load dots per day - and hands off to Kalendar's agenda
 * for the actual day. Today is the only day marked as selected; past days of
 * the current week are dimmed and not tappable, because the agenda starts at
 * today (the "Uskoro počinje od danas" rule).
 */

/** Monday-first two-letter weekday initials. */
const WEEKDAY_INITIALS = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"] as const;

/** Load dots are capped so a heavy day doesn't grow the row. */
const MAX_DOTS = 3;

export function TodayWeekStrip({
  today,
  countByDay,
}: {
  today: string;
  /** day (yyyy-MM-dd) → item count, for the load dots. */
  countByDay: Map<string, number>;
}) {
  const navigate = useNavigate();
  const monday = parseISO(`${getWeekStart(today)}T12:00:00`);

  return (
    <div className="flex gap-1">
      {Array.from({ length: 7 }, (_, dow) => {
        const date = addDays(monday, dow);
        const day = format(date, "yyyy-MM-dd");
        const count = countByDay.get(day) ?? 0;
        const isToday = day === today;
        const isPast = day < today;
        const dots = Math.min(count, MAX_DOTS);
        const spokenDay = format(date, "EEEE, d. MMMM", { locale: srLocale });

        return (
          <button
            key={day}
            type="button"
            disabled={isPast}
            aria-current={isToday ? "date" : undefined}
            aria-label={count > 0 ? `${spokenDay} - ${count} ${stavkeLabel(count)}` : spokenDay}
            onClick={() => {
              void navigate({ to: "/kalendar", search: { view: "agenda", day } });
            }}
            className={cn(
              "flex-1 rounded-md border border-transparent py-1 text-center transition-colors",
              isPast && "opacity-40",
              isToday && "border-accent/40 bg-accent-soft text-accent-deep",
              !isToday && "text-muted-foreground",
            )}
          >
            <span className="block text-[9px] font-extrabold tracking-wide uppercase opacity-85">
              {WEEKDAY_INITIALS[dow]}
            </span>
            <span className="mt-px block text-sm font-extrabold tabular-nums">
              {Number(day.slice(8, 10))}
            </span>
            <span className="mt-0.5 flex h-1 items-center justify-center gap-px">
              {Array.from({ length: dots }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-1 rounded-full",
                    isToday ? "bg-accent-deep opacity-90" : "bg-muted-foreground opacity-40",
                  )}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
