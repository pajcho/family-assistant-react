import { useEffect, useRef } from "react";
import { addDays, format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import { getWeekStart } from "@/utils/activity";

/**
 * Todoist-style week strip for the "Uskoro" tab. A fixed Mon–Sun weekday header
 * over a horizontally-swipeable pager of week rows — one week per snap page.
 *
 * It follows the list: `activeDay` (the day at the top of the scrolled list) is
 * marked with a filled circle, and the pager auto-scrolls to that day's week, so
 * swiping right/left through the list walks the strip forward/back in step.
 * Tapping a day scrolls the list to it; swiping the strip to its end loads more
 * weeks (`onReachEnd`). Today is marked even when scrolled away; days with items
 * carry a dot.
 */

/** Monday-first two-letter weekday initials. */
const WEEKDAY_INITIALS = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"] as const;

export type WeekStripProps = {
  /** Week-start Mondays (yyyy-MM-dd), ascending — one page each. */
  weeks: string[];
  today: string;
  /** First selectable day (today — the Uskoro window now starts at today). */
  from: string;
  /** The day currently at the top of the list (scroll-spy), or null. */
  activeDay: string | null;
  /** day (yyyy-MM-dd) → item count. */
  countByDay: Map<string, number>;
  /** e.g. "Jun 2026". */
  monthLabel: string;
  onSelectDay: (day: string) => void;
  /** Fired when the pager is swiped to its last week — load more. */
  onReachEnd: () => void;
};

export function WeekStrip({
  weeks,
  today,
  from,
  activeDay,
  countByDay,
  monthLabel,
  onSelectDay,
  onReachEnd,
}: WeekStripProps) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  const activeWeek = activeDay ? getWeekStart(activeDay) : (weeks[0] ?? today);
  const activeWeekIndex = Math.max(0, weeks.indexOf(activeWeek));

  // Follow the list: page the strip to the active day's week.
  useEffect(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    pager.scrollTo({ left: activeWeekIndex * pager.clientWidth, behavior: "smooth" });
  }, [activeWeekIndex]);

  return (
    <div>
      <div className="mb-1.5 px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {monthLabel}
      </div>

      {/* Fixed weekday header — every week shares the same Mon–Sun columns. */}
      <div className="grid grid-cols-7 gap-1 px-1">
        {WEEKDAY_INITIALS.map((wd) => (
          <div
            key={wd}
            className="text-center text-[11px] font-medium text-gray-400 dark:text-gray-500"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Swipeable week pager. */}
      <div
        ref={pagerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) onReachEndRef.current();
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {weeks.map((weekStart) => {
          const base = parseISO(weekStart + "T12:00:00");
          return (
            <div
              key={weekStart}
              className="grid w-full shrink-0 snap-center grid-cols-7 gap-1 px-1"
            >
              {Array.from({ length: 7 }, (_, dow) => {
                const day = format(addDays(base, dow), "yyyy-MM-dd");
                const count = countByDay.get(day) ?? 0;
                const isToday = day === today;
                const isActive = day === activeDay;
                const isPast = day < today;
                // Any day from today on is tappable — the list renders a section
                // per day (empty ones too), so there's always somewhere to land.
                // The green dot below the number signals which days have events.
                const selectable = day >= from;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!selectable}
                    aria-label={`${day}${count > 0 ? ` — ${count}` : ""}`}
                    onClick={() => onSelectDay(day)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors",
                      isPast && "opacity-40",
                      !selectable && "cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                        isActive
                          ? "bg-blue-600 font-semibold text-white dark:bg-blue-500"
                          : isToday
                            ? "font-semibold text-blue-600 dark:text-blue-400"
                            : selectable
                              ? "font-medium text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700/60"
                              : "text-gray-400 dark:text-gray-500",
                      )}
                    >
                      {Number(day.slice(8, 10))}
                    </span>
                    <span className="flex h-1 items-center justify-center">
                      {count > 0 && !isActive && !isPast ? (
                        <span className="size-1 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
