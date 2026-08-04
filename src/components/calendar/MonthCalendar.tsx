import { useEffect, useMemo, useState } from "react";
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { agendaItemDotColor } from "@/components/dashboard/agendaKindMeta";
import { type AgendaItem, agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useToday } from "@/hooks/useToday";
import type { Birthday, Event, Payment } from "@/types/database";
import { DAY_LABELS_SHORT, getWeekStart } from "@/utils/activity";
import { type AgendaFilter, filterAgendaItems, groupAgendaByDay } from "@/utils/agendaFilters";
import { addDays, srLocale } from "@/utils/date";
import { cn } from "@/lib/cn";

/**
 * The calendar's MESEC view - the bird's-eye one, new in redizajn 2.0.
 *
 * A Mon-first month grid where each day carries up to three density dots
 * coloured by what is on it (a member's colour for their activities, the type
 * colour otherwise), multi-day events get a span bar under the grid, and
 * tapping a day opens that day's rows right below - no navigation, so scanning
 * the month and reading a day are the same gesture.
 *
 * Loaded as its own chunk: it is the one view not on the default path, and it
 * is the only one that needs `date-fns`' month helpers.
 *
 * Like the other two views it owns its own window and `useAgenda` fetch - the
 * container guarantees only one of them is mounted at a time.
 */

export type MonthCalendarProps = {
  filter: AgendaFilter;
  isFilterActive: boolean;
  /** Hand a day off to the agenda view (deep-links `?view=agenda&day=`). */
  onOpenDay: (day: string) => void;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const MAX_DOTS = 3;

/** Named chips a desktop cell shows before collapsing the rest into "+ još N". */
const MAX_CHIPS = 3;

export function MonthCalendar({
  filter,
  isFilterActive,
  onOpenDay,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: MonthCalendarProps) {
  const { str: todayStr } = useToday();
  const [monthAnchor, setMonthAnchor] = useState<string>(() => todayStr.slice(0, 7) + "-01");
  const [selectedDay, setSelectedDay] = useState<string>(todayStr);

  const monthDate = useMemo(() => parseISO(monthAnchor + "T12:00:00"), [monthAnchor]);

  // The grid covers whole Mon-Sun weeks around the month, and so does the
  // query: the leading/trailing days belong to neighbouring months but are
  // rendered (dimmed) and stay tappable, so they need their dots too.
  const { gridStart, gridEnd, weeks } = useMemo(() => {
    const first = format(startOfMonth(monthDate), "yyyy-MM-dd");
    const last = format(endOfMonth(monthDate), "yyyy-MM-dd");
    const start = getWeekStart(first);
    const endWeekMonday = parseISO(getWeekStart(last) + "T12:00:00");
    const end = format(addDays(endWeekMonday, 6), "yyyy-MM-dd");
    const startDate = parseISO(start + "T12:00:00");
    const weekCount = Math.round(
      (parseISO(end + "T12:00:00").getTime() - startDate.getTime()) / (7 * 86_400_000) + 1,
    );
    return {
      gridStart: start,
      gridEnd: end,
      weeks: Array.from({ length: weekCount }, (_, w) =>
        Array.from({ length: 7 }, (_, d) => format(addDays(startDate, w * 7 + d), "yyyy-MM-dd")),
      ),
    };
  }, [monthDate]);

  const { items: allItems, isLoading } = useAgenda({ from: gridStart, to: gridEnd });
  const items = useMemo(() => filterAgendaItems(allItems, filter), [allItems, filter]);
  const { byDay } = useMemo(() => groupAgendaByDay(items), [items]);
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  // Up to three dots per day, deduped by colour so a day with four activities
  // for the same child shows one dot, not four identical ones.
  const dotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [day, dayItems] of byDay) {
      const colors: string[] = [];
      for (const item of dayItems) {
        const color = agendaItemDotColor(item);
        if (!colors.includes(color)) colors.push(color);
        if (colors.length === MAX_DOTS) break;
      }
      map.set(day, colors);
    }
    return map;
  }, [byDay]);

  // Desktop cells have room for names, so each day also carries up to three
  // labelled chips ("+ još N" for the rest). Phones keep the dots - a 46px
  // cell cannot hold a word.
  const chipsByDay = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; color: string; time: string | null }[]
    >();
    for (const [day, dayItems] of byDay) {
      map.set(
        day,
        dayItems.map((item) => ({
          key: agendaItemKey(item),
          label: monthChipLabel(item),
          color: agendaItemDotColor(item),
          time: monthChipTime(item),
        })),
      );
    }
    return map;
  }, [byDay]);

  // Multi-day events crossing the visible grid, as span bars under it. Keyed by
  // event so a span appears once however many days of it are in view.
  const spans = useMemo(() => collectSpans(items), [items]);

  const monthName = useMemo(() => {
    const label = format(monthDate, "LLLL", { locale: srLocale });
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }, [monthDate]);

  const shiftMonth = (delta: number) => {
    const next = format(addMonths(monthDate, delta), "yyyy-MM-01");
    setMonthAnchor(next);
  };

  // Keep the peek pointing at something in view: when the month changes, land
  // on today if it is in the new month, otherwise on the 1st.
  useEffect(() => {
    setSelectedDay((current) => {
      if (current >= gridStart && current <= gridEnd) return current;
      return todayStr.slice(0, 7) === monthAnchor.slice(0, 7) ? todayStr : monthAnchor;
    });
  }, [gridStart, gridEnd, monthAnchor, todayStr]);

  const selectedItems = byDay.get(selectedDay) ?? [];
  const monthPrefix = monthAnchor.slice(0, 7);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2.5 px-[3px]">
        <span className="font-serif text-[27px] leading-none font-bold tracking-[-0.01em]">
          {monthName}
        </span>
        <span className="text-sm font-bold text-muted-foreground">
          {format(monthDate, "yyyy")}.
        </span>
        <span className="flex-1" />
        <IconButton
          icon={ChevronLeftIcon}
          size="sm"
          aria-label="Prethodni mesec"
          onClick={() => shiftMonth(-1)}
        />
        <IconButton
          icon={ChevronRightIcon}
          size="sm"
          aria-label="Sledeći mesec"
          onClick={() => shiftMonth(1)}
        />
      </div>

      <div>
        <div className="grid grid-cols-7 gap-[3px]">
          {DAY_LABELS_SHORT.map((label) => (
            <div
              key={label}
              className="py-1 text-center text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase"
            >
              {label}
            </div>
          ))}
          {weeks.flat().map((day) => {
            const outside = !day.startsWith(monthPrefix);
            const dots = dotsByDay.get(day) ?? [];
            const isToday = day === todayStr;
            const isSelected = day === selectedDay;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(day)}
                aria-pressed={isSelected}
                aria-label={format(parseISO(day + "T12:00:00"), "d. MMMM yyyy.", {
                  locale: srLocale,
                })}
                className={cn(
                  "flex aspect-[0.92] min-h-11 flex-col items-center justify-center gap-[3px] rounded-md border border-transparent",
                  "text-[13.5px] font-bold tabular-nums transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  "lg:aspect-auto lg:h-[104px] lg:items-stretch lg:justify-start lg:gap-1 lg:p-1.5 lg:text-left",
                  outside && "opacity-35",
                  isSelected
                    ? "border-accent bg-accent-soft text-accent-deep"
                    : isToday
                      ? "border-accent text-accent-deep"
                      : "text-foreground lg:hover:bg-muted",
                )}
              >
                <span className="lg:pl-0.5">{Number(day.slice(8))}</span>
                <span className="flex h-[5px] items-center gap-[2.5px] lg:hidden">
                  {dots.map((color, i) => (
                    <span
                      key={`${color}-${i}`}
                      aria-hidden="true"
                      style={{ backgroundColor: color }}
                      className="size-[4.5px] rounded-full"
                    />
                  ))}
                </span>
                <span className="hidden min-h-0 flex-1 flex-col gap-[3px] overflow-hidden lg:flex">
                  {(chipsByDay.get(day) ?? []).slice(0, MAX_CHIPS).map((chip) => (
                    <span
                      key={chip.key}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${chip.color} 16%, var(--card))`,
                        borderColor: chip.color,
                      }}
                      className="truncate rounded-sm border-l-[3px] px-1.5 py-px text-[11px] leading-tight font-bold text-foreground"
                    >
                      {chip.time ? `${chip.time} ` : ""}
                      {chip.label}
                    </span>
                  ))}
                  {(chipsByDay.get(day)?.length ?? 0) > MAX_CHIPS ? (
                    <span className="pl-1 text-[10.5px] font-extrabold text-muted-foreground">
                      + još {(chipsByDay.get(day)?.length ?? 0) - MAX_CHIPS}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {spans.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {spans.map((span) => (
              <li
                key={span.key}
                className="flex items-center gap-[7px] px-1 text-[11.5px] font-bold text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-[74px] shrink-0 rounded-full bg-accent opacity-50"
                />
                <span className="min-w-0 truncate">
                  {span.name} · {span.range}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => onOpenDay(selectedDay)}
          className="mb-2 flex w-full items-center gap-2 rounded-md py-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <SectionHeading as="div" className="flex-1">
            {formatPeekHeading(selectedDay, todayStr)}
          </SectionHeading>
          <span className="shrink-0 text-[11.5px] font-extrabold text-accent-deep">
            Otvori u agendi
          </span>
        </button>

        {isLoading ? (
          <AgendaListSkeleton rows={3} />
        ) : selectedItems.length === 0 ? (
          <EmptyState
            variant="filter"
            description={
              isFilterActive ? "Nema stavki za izabrane filtere." : "Slobodan dan - ništa u planu."
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {selectedItems.map((item) => (
              <AgendaItemRow key={agendaItemKey(item)} item={item} onClick={() => onSelect(item)} />
            ))}
          </ul>
        )}
      </div>

      {dialogs}
    </div>
  );
}

type MonthSpan = { key: string; name: string; range: string };

/** Multi-day events in view, one entry each, with a "12-14. okt" style range. */
/** Cell chip label - the shortest thing that identifies the item. */
function monthChipLabel(item: AgendaItem): string {
  switch (item.kind) {
    case "activity":
      return item.activity?.name ?? "Aktivnost";
    case "event":
      return item.event.name;
    case "external":
      return item.event.title ?? "(bez naslova)";
    case "payment":
      return item.payment.name;
    case "birthday":
      return item.birthday.name;
  }
}

/** Start time for the chip, when the item has one worth showing. */
function monthChipTime(item: AgendaItem): string | null {
  if (item.kind === "activity") return item.block.startTime;
  if (item.kind === "event" && !item.isAllDay) return item.startTime;
  if (item.kind === "external" && !item.isAllDay && item.event.start_time) {
    return item.event.start_time.slice(0, 5);
  }
  return null;
}

function collectSpans(items: AgendaItem[]): MonthSpan[] {
  const byEvent = new Map<string, { name: string; days: string[] }>();
  for (const item of items) {
    if (item.kind !== "event" || item.totalDays <= 1) continue;
    const entry = byEvent.get(item.event.id);
    if (entry) entry.days.push(item.date);
    else byEvent.set(item.event.id, { name: item.event.name, days: [item.date] });
  }
  return [...byEvent.entries()].map(([id, { name, days }]) => {
    const sorted = [...days].sort();
    const first = parseISO(sorted[0] + "T12:00:00");
    const last = parseISO(sorted[sorted.length - 1] + "T12:00:00");
    const sameMonth = format(first, "MM") === format(last, "MM");
    const range = sameMonth
      ? `${format(first, "d")}-${format(last, "d. MMM", { locale: srLocale })}`
      : `${format(first, "d. MMM", { locale: srLocale })} - ${format(last, "d. MMM", { locale: srLocale })}`;
    return { key: id, name, range };
  });
}

function formatPeekHeading(day: string, todayStr: string): string {
  const date = parseISO(day + "T12:00:00");
  const weekdayRaw = format(date, "EEEE", { locale: srLocale });
  const weekday = `${weekdayRaw.charAt(0).toUpperCase()}${weekdayRaw.slice(1)}`;
  const dayMonth = format(date, "d. MMMM", { locale: srLocale });
  return day === todayStr ? `${weekday}, ${dayMonth} · Danas` : `${weekday}, ${dayMonth}`;
}
