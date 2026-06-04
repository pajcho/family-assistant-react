import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import {
  AllDayChip,
  buildHourLabels,
  computeRange,
  GRID_TOP_PADDING_PX,
  gridHeightPx,
  type PositionedEntry,
  positionEntries,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  splitAgendaItems,
  TimedBlock,
  useMinuteTick,
} from "@/components/dashboard/agendaCalendarShared";
import { type AgendaItem, agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import type { Birthday, Event, Payment } from "@/types/database";
import { DAY_LABELS_SHORT, getThisWeekStart } from "@/utils/activity";
import { type AgendaFilter, filterAgendaItems } from "@/utils/agendaFilters";
import { srLocale } from "@/utils/date";
import { cn } from "@/lib/cn";

/**
 * Weekly Mon–Sun timetable for the "Uskoro" tab — the calendar counterpart of
 * the upcoming list. Seven day columns over a shared time axis (so every column
 * lines up), an all-day row per day, and a red "now" line in today's column.
 * Self-contained: owns the visible week + its own `useAgenda({week})` fetch, so
 * the list's growing-horizon query doesn't run while the calendar is shown.
 *
 * Reuses the same block/chip rendering + lane math as the single-day calendar
 * (`agendaCalendarShared`); structurally mirrors the activities `WeekGrid`
 * (sticky header, sticky-left gutter, fixed columns + horizontal scroll on
 * mobile, auto-scroll to today). This subsumes the standalone activities weekly
 * grid for day-to-day viewing.
 */
export type AgendaWeekCalendarProps = {
  filter: AgendaFilter;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

/** 56px time gutter + 7 day columns: fixed 128px (scroll) on mobile, flex sm+. */
const GRID_COLS = "grid-cols-[56px_repeat(7,128px)] sm:grid-cols-[56px_repeat(7,minmax(0,1fr))]";

export function AgendaWeekCalendar({
  filter,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaWeekCalendarProps) {
  const [weekStart, setWeekStart] = useState<string>(() => getThisWeekStart());
  const now = useMinuteTick();
  const todayStr = format(now, "yyyy-MM-dd");

  const days = useMemo(() => {
    const base = parseISO(weekStart + "T12:00:00");
    return Array.from({ length: 7 }, (_, i) => format(addDays(base, i), "yyyy-MM-dd"));
  }, [weekStart]);
  const weekEnd = days[6];

  const { items: allItems, isLoading } = useAgenda({ from: weekStart, to: weekEnd });
  const items = useMemo(() => filterAgendaItems(allItems, filter), [allItems, filter]);
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  // Split each day's items into all-day + timed, then lane the timed ones
  // against ONE shared axis spanning the whole week so all columns align.
  const perDay = useMemo(() => {
    const byDate = new Map<string, AgendaItem[]>();
    for (const item of items) {
      const arr = byDate.get(item.date);
      if (arr) arr.push(item);
      else byDate.set(item.date, [item]);
    }
    return days.map((date) => ({ date, ...splitAgendaItems(byDate.get(date) ?? []) }));
  }, [days, items]);

  const { startMin, endMin } = useMemo(
    () => computeRange(perDay.flatMap((d) => d.timedEntries)),
    [perDay],
  );

  const positionedByDate = useMemo(() => {
    const map = new Map<string, PositionedEntry[]>();
    for (const d of perDay) map.set(d.date, positionEntries(d.timedEntries, startMin));
    return map;
  }, [perDay, startMin]);

  const hasAnyAllDay = perDay.some((d) => d.allDayItems.length > 0);
  const hourLabels = buildHourLabels(startMin, endMin);
  const totalHeightPx = gridHeightPx(startMin, endMin);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowInViewport = nowMin >= startMin && nowMin <= endMin;
  const nowTopPx = GRID_TOP_PADDING_PX + ((nowMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX;

  const isCurrentWeek = weekStart === getThisWeekStart();
  const goPrev = () =>
    setWeekStart((w) => format(addDays(parseISO(w + "T12:00:00"), -7), "yyyy-MM-dd"));
  const goNext = () =>
    setWeekStart((w) => format(addDays(parseISO(w + "T12:00:00"), 7), "yyyy-MM-dd"));
  const goToday = () => setWeekStart(getThisWeekStart());

  // Land on today's column on mount / week change (mobile columns overflow).
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayIndex = days.indexOf(todayStr);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (todayIndex < 0) {
      container.scrollLeft = 0;
      return;
    }
    const cell = container.querySelector<HTMLElement>(`[data-day-index="${todayIndex}"]`);
    if (cell) container.scrollLeft = Math.max(0, cell.offsetLeft - 56);
  }, [todayIndex, weekStart]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={goPrev}
            className="rounded-l-md p-2 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Prethodna nedelja"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="border-x border-gray-200 px-3 py-1.5 text-sm font-medium tabular-nums dark:border-gray-700">
            {formatWeekRange(weekStart, weekEnd)}
          </div>
          <button
            type="button"
            onClick={goNext}
            className="rounded-r-md p-2 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
            aria-label="Sledeća nedelja"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        {!isCurrentWeek ? (
          <Button variant="outline" size="sm" onClick={goToday}>
            Ova sedmica
          </Button>
        ) : null}
        {isLoading ? <span className="text-xs text-muted-foreground">Učitavanje…</span> : null}
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="min-w-max">
          {/* Day headers — sticky on top. */}
          <div
            className={cn(
              "sticky top-0 z-20 grid border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800",
              GRID_COLS,
            )}
          >
            <div />
            {days.map((date, i) => (
              <div
                key={date}
                data-day-index={i}
                className={cn(
                  "border-l border-gray-200 px-2 py-2 text-center dark:border-gray-700",
                  date === todayStr && "bg-blue-50 dark:bg-blue-950/30",
                )}
              >
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                  {DAY_LABELS_SHORT[i]}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {format(parseISO(date + "T12:00:00"), "d.M.")}
                </div>
              </div>
            ))}
          </div>

          {/* All-day row — one cell per day; only rendered if the week has any. */}
          {hasAnyAllDay ? (
            <div className={cn("grid border-b border-gray-200 dark:border-gray-700", GRID_COLS)}>
              <div className="sticky left-0 z-10 bg-white px-1 py-1.5 text-[9px] tracking-wide text-muted-foreground uppercase dark:bg-gray-800">
                Ceo dan
              </div>
              {perDay.map((d) => (
                <div
                  key={d.date}
                  className={cn(
                    "flex flex-col gap-1 border-l border-gray-200 p-1 dark:border-gray-700",
                    d.date === todayStr && "bg-blue-50/40 dark:bg-blue-950/10",
                  )}
                >
                  {d.allDayItems.map((item) => (
                    <AllDayChip
                      key={agendaItemKey(item)}
                      item={item}
                      onClick={() => onSelect(item)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {/* Time grid. */}
          <div className={cn("grid", GRID_COLS)} style={{ height: `${totalHeightPx}px` }}>
            {/* Sticky-left time gutter. */}
            <div className="sticky left-0 z-10 bg-white dark:bg-gray-800">
              {hourLabels.map((hl) => (
                <div
                  key={hl.label}
                  style={{ top: `${hl.topPx}px` }}
                  className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                >
                  {hl.label}
                </div>
              ))}
              {nowInViewport ? (
                <div
                  style={{ top: `${nowTopPx}px` }}
                  className="absolute right-1 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white"
                >
                  {format(now, "HH:mm")}
                </div>
              ) : null}
            </div>

            {/* 7 day columns. */}
            {perDay.map((d) => (
              <div
                key={d.date}
                className={cn(
                  "relative border-l border-gray-200 dark:border-gray-700",
                  d.date === todayStr && "bg-blue-50/40 dark:bg-blue-950/10",
                )}
              >
                {hourLabels.map((hl) => (
                  <div
                    key={hl.label}
                    style={{ top: `${hl.topPx}px` }}
                    className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-700/60"
                  />
                ))}
                {(positionedByDate.get(d.date) ?? []).map((block) => (
                  <TimedBlock
                    key={agendaItemKey(block.item)}
                    block={block}
                    todayStr={todayStr}
                    nowMin={nowMin}
                    onClick={() => onSelect(block.item)}
                  />
                ))}
                {d.date === todayStr && nowInViewport ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
                    style={{ top: `${nowTopPx}px` }}
                  >
                    <span className="absolute top-0 left-0 size-2.5 -translate-y-1/2 rounded-full bg-red-500" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      {dialogs}
    </div>
  );
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = parseISO(weekStart + "T12:00:00");
  const end = parseISO(weekEnd + "T12:00:00");
  return `${format(start, "dd.MM", { locale: srLocale })} – ${format(end, "dd.MM.yyyy", {
    locale: srLocale,
  })}`;
}
