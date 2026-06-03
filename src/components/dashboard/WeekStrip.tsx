import { useMemo } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DAY_LABELS_SHORT, getWeekStart } from "@/utils/activity";

/**
 * Todoist-style week strip atop the "Uskoro" tab — a glanceable Mon–Sun grid of
 * the coming weeks. Each day chip shows a dot when it has agenda items and, when
 * clicked, scrolls the list to that day's section. Past days (before today) are
 * dimmed; today is ringed. Expands a couple of weeks at a time.
 *
 * Counts come straight from the agenda's `byDay`, so the strip and the list can
 * never disagree — a chip is only clickable when its day actually has a rendered
 * section (`count > 0`, which implies it's within the loaded horizon).
 */
export type WeekStripProps = {
  /** First selectable day — tomorrow (yyyy-MM-dd). */
  from: string;
  /** Today (yyyy-MM-dd) — for the past/today affordances. */
  today: string;
  weeksShown: number;
  /** day (yyyy-MM-dd) → item count. */
  countByDay: Map<string, number>;
  onSelectDay: (day: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
  canExpand: boolean;
};

export function WeekStrip({
  from,
  today,
  weeksShown,
  countByDay,
  onSelectDay,
  onExpand,
  onCollapse,
  canExpand,
}: WeekStripProps) {
  const weeks = useMemo(() => {
    const base = parseISO(getWeekStart(from) + "T12:00:00");
    return Array.from({ length: weeksShown }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => format(addDays(base, w * 7 + d), "yyyy-MM-dd")),
    );
  }, [from, weeksShown]);

  return (
    <div className="mb-5 rounded-lg border border-gray-200 bg-white/60 p-2 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="space-y-1">
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 gap-1">
            {week.map((day, dow) => {
              const count = countByDay.get(day) ?? 0;
              const isPast = day < today;
              const isToday = day === today;
              const selectable = day >= from && count > 0;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!selectable}
                  aria-label={`${day}${count > 0 ? ` — ${count}` : ""}`}
                  onClick={() => onSelectDay(day)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors",
                    isPast && "opacity-30",
                    selectable
                      ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/60"
                      : "cursor-default",
                    isToday && "ring-1 ring-blue-400 dark:ring-blue-500",
                  )}
                >
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {DAY_LABELS_SHORT[dow]}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      selectable
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-400 dark:text-gray-500",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  <span className="flex h-1.5 items-center justify-center">
                    {count > 0 && !isPast ? (
                      <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {canExpand || weeksShown > 2 ? (
        <div className="mt-1 flex justify-center gap-1">
          {weeksShown > 2 ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={onCollapse}
              className="text-gray-500 dark:text-gray-400"
            >
              <ChevronUpIcon className="size-3.5" />
              Skupi
            </Button>
          ) : null}
          {canExpand ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={onExpand}
              className="text-gray-500 dark:text-gray-400"
            >
              <ChevronDownIcon className="size-3.5" />
              Još nedelja
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
