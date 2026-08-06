import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { MonthGridPopover } from "@/components/common/MonthGridPopover";
import { NowPill } from "@/components/common/NowPill";
import { SectionHeading } from "@/components/common/SectionHeading";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { agendaItemDotColor } from "@/components/dashboard/agendaKindMeta";
import { type AgendaItem, agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useIsWide } from "@/hooks/useIsWide";
import { useToday } from "@/hooks/useToday";
import type { Birthday, Event, Payment } from "@/types/database";
import { DAY_LABELS_SHORT, getWeekStart } from "@/utils/activity";
import { type AgendaFilter, filterAgendaItems, groupAgendaByDay } from "@/utils/agendaFilters";
import { monthName as monthNameFor } from "@/utils/budget";
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
  /**
   * Where the month row portals to - the same fixed-header slot the week
   * strips use, so the "Avgust 2026" line sits at the exact same spot in all
   * three calendar views and switching them never shifts the content.
   */
  stripSlot?: HTMLElement | null;
  /** Hand a day off to the agenda view (deep-links `?view=agenda&day=`). */
  onOpenDay: (day: string) => void;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const MAX_DOTS = 3;

/** Named chips a desktop cell shows before collapsing the rest into "+ još N". */
const MAX_CHIPS = 3;

/** Below this travel we can't yet tell a vertical month-swipe from a tap. */
const AXIS_LOCK_PX = 6;
/** A vertical swipe past this many px pages the month… */
const SWIPE_MIN_PX = 56;
/** …or a quick flick: under this many ms with at least a little travel. */
const FLICK_MS = 250;
const FLICK_MIN_PX = 24;
/** The cell grid's row/column gap - the carousel pages keep it between pages. */
const GRID_GAP_PX = 3;

/** Stable "no items" so the held-peek effect doesn't refire on every render. */
const NO_ITEMS: AgendaItem[] = [];

/** Whole Mon-Sun weeks covering a month (leading/trailing days included). */
function monthGridWeeks(monthDate: Date): string[][] {
  const first = format(startOfMonth(monthDate), "yyyy-MM-dd");
  const last = format(endOfMonth(monthDate), "yyyy-MM-dd");
  const start = getWeekStart(first);
  const endWeekMonday = parseISO(getWeekStart(last) + "T12:00:00");
  const end = format(addDays(endWeekMonday, 6), "yyyy-MM-dd");
  const startDate = parseISO(start + "T12:00:00");
  // Inclusive day span / 7. The +1 belongs to the DAY count - adding it after
  // dividing by a week's ms rounded every month up to an extra trailing week.
  const weekCount =
    Math.round((parseISO(end + "T12:00:00").getTime() - startDate.getTime()) / 86_400_000 + 1) / 7;
  return Array.from({ length: weekCount }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => format(addDays(startDate, w * 7 + d), "yyyy-MM-dd")),
  );
}

export function MonthCalendar({
  filter,
  isFilterActive,
  stripSlot,
  onOpenDay,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: MonthCalendarProps) {
  const { str: todayStr } = useToday();
  const isWide = useIsWide();
  const [monthAnchor, setMonthAnchor] = useState<string>(() => todayStr.slice(0, 7) + "-01");
  // Starts on today and changes ONLY on a tap - paging months never moves it,
  // so the peek below keeps showing the picked day while months slide by.
  const [selectedDay, setSelectedDay] = useState<string>(todayStr);

  const monthDate = useMemo(() => parseISO(monthAnchor + "T12:00:00"), [monthAnchor]);

  // The grid covers whole Mon-Sun weeks around the month, and so does the
  // query: the leading/trailing days belong to neighbouring months but are
  // rendered (dimmed) and stay tappable, so they need their dots too.
  const weeks = useMemo(() => monthGridWeeks(monthDate), [monthDate]);
  const gridStart = weeks[0][0];
  const gridEnd = weeks[weeks.length - 1][6];

  // The neighbour months' grids, pre-rendered as the swipe carousel's hidden
  // pages (phones only) so a vertical swipe slides a REAL month in - the
  // WeekStrip mechanic, turned vertical. Their density dots fill in after the
  // month commits (the agenda query follows the visible month).
  const prevWeeks = useMemo(
    () => (isWide ? null : monthGridWeeks(addMonths(monthDate, -1))),
    [isWide, monthDate],
  );
  const nextWeeks = useMemo(
    () => (isWide ? null : monthGridWeeks(addMonths(monthDate, 1))),
    [isWide, monthDate],
  );
  const prevPrefix = format(addMonths(monthDate, -1), "yyyy-MM");
  const nextPrefix = format(addMonths(monthDate, 1), "yyyy-MM");

  // Neighbouring month grids usually SHARE their boundary week with the
  // current one (October's first week IS September's last). The carousel
  // pages drop that duplicate row, and the slide distance is trimmed so the
  // current grid's boundary row simply becomes the new month's edge row -
  // sliding past "28 29 30 · 1 2 3 4" twice in a row read as a glitch. The
  // shared row keeps the OLD month's dimming until the commit re-render
  // restyles it (deliberate: restyling mid-drag would flicker).
  const nextOverlapsCurrent = nextWeeks !== null && nextWeeks[0][0] === weeks[weeks.length - 1][0];
  const prevOverlapsCurrent =
    prevWeeks !== null && prevWeeks[prevWeeks.length - 1][0] === weeks[0][0];
  const nextPageWeeks = nextOverlapsCurrent ? nextWeeks.slice(1) : nextWeeks;
  const prevPageWeeks = prevOverlapsCurrent ? prevWeeks.slice(0, -1) : prevWeeks;

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
  const currentMonthName = monthNameFor(todayStr.slice(0, 7));

  const shiftMonth = (delta: number) => {
    const next = format(addMonths(monthDate, delta), "yyyy-MM-01");
    setMonthAnchor(next);
  };

  // Phone-only vertical swipe over the grid pages the month (up = next, the
  // iOS Calendar gesture). The grid opts out of native scrolling
  // (`touch-none`), so the page cannot scroll from a touch that starts on it -
  // scrolling the screen starts from the peek list below instead.
  //
  // A real carousel, the WeekStrip mechanic turned vertical: the track follows
  // the finger 1:1 with the neighbour month's grid sliding in from above or
  // below. Past the threshold the neighbour animates fully in, THEN the month
  // state commits; the layout effect below resets the transform before the
  // re-render paints, so the frame the state lands on shows the same pixels
  // the animation ended on.
  const trackRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef<HTMLDivElement>(null);
  const swipeGesture = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(
    null,
  );
  const animatingRef = useRef(false);

  const onGridTouchStart = (e: React.TouchEvent) => {
    if (isWide || animatingRef.current) return;
    const t = e.touches[0];
    swipeGesture.current = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null };
    if (trackRef.current) trackRef.current.style.transition = "none";
  };

  const onGridTouchMove = (e: React.TouchEvent) => {
    const g = swipeGesture.current;
    const track = trackRef.current;
    if (!g || !track) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (g.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
    }
    if (g.axis !== "y") return;
    // 1:1 follow, capped at one page - a single swipe moves a single month.
    const cap = track.offsetHeight + GRID_GAP_PX;
    track.style.transform = `translateY(${Math.max(-cap, Math.min(cap, dy))}px)`;
  };

  /** Animate the track to a resting offset (transition class back on). */
  const settleTrack = (targetY: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "";
    track.style.transform = targetY === 0 ? "" : `translateY(${targetY}px)`;
  };

  const onGridTouchEnd = (e: React.TouchEvent) => {
    const g = swipeGesture.current;
    swipeGesture.current = null;
    if (!g || g.axis !== "y") {
      if (!animatingRef.current) settleTrack(0);
      return;
    }
    const dy = e.changedTouches[0].clientY - g.y;
    const flick = e.timeStamp - g.t < FLICK_MS && Math.abs(dy) > FLICK_MIN_PX;
    const track = trackRef.current;
    if ((Math.abs(dy) > SWIPE_MIN_PX || flick) && track) {
      const delta: 1 | -1 = dy < 0 ? 1 : -1;
      // Page distance. Going up with a shared boundary week the slide stops
      // one row SHORT: the current grid's last row stays on screen as the new
      // month's first week (the next page starts at its second). Coming down
      // the prev page's own height is the distance either way - its trailing
      // shared week is dropped, the current grid's first row stands in for it.
      const rowH = (track.offsetHeight - (weeks.length - 1) * GRID_GAP_PX) / weeks.length;
      const distance =
        delta === 1
          ? nextOverlapsCurrent
            ? track.offsetHeight - rowH
            : track.offsetHeight + GRID_GAP_PX
          : (prevPageRef.current?.offsetHeight ?? track.offsetHeight + GRID_GAP_PX);
      animatingRef.current = true;
      settleTrack(delta === 1 ? -distance : distance);
      window.setTimeout(() => {
        animatingRef.current = false;
        shiftMonth(delta);
      }, 220);
    } else {
      settleTrack(0);
    }
  };

  const onGridTouchCancel = () => {
    swipeGesture.current = null;
    if (!animatingRef.current) settleTrack(0);
  };

  // The commit lands a re-render whose CURRENT grid is the month the animation
  // just slid in - so the track must snap back to rest with no transition, in
  // the same frame, or the finished slide would visibly replay backwards.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "none";
    track.style.transform = "";
    // Flush the no-transition state so the NEXT slide animates again.
    void track.offsetHeight;
    track.style.transition = "";
  }, [monthAnchor]);

  const monthPrefix = monthAnchor.slice(0, 7);

  // The peek survives month paging: while the selected day sits outside the
  // visible grid's (queried) window, the last loaded rows are held on screen -
  // they only change when the user taps another day (or the day's own data
  // window returns).
  const selectedInWindow = selectedDay >= gridStart && selectedDay <= gridEnd;
  const liveSelectedItems = selectedInWindow ? (byDay.get(selectedDay) ?? NO_ITEMS) : null;
  const [heldItems, setHeldItems] = useState<AgendaItem[]>(NO_ITEMS);
  useEffect(() => {
    if (liveSelectedItems && !isLoading) setHeldItems(liveSelectedItems);
  }, [liveSelectedItems, isLoading]);
  const selectedItems = liveSelectedItems ?? heldItems;

  // One month page of day cells - the current grid and both carousel
  // neighbours render through this, so a slid-in month looks exactly like a
  // committed one (its dots simply arrive once its query window loads).
  const renderCells = (cellWeeks: string[][], prefix: string) => (
    <div className="grid grid-cols-7 gap-[3px]">
      {cellWeeks.flat().map((day) => {
        const outside = !day.startsWith(prefix);
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
              "text-[13.5px] font-semibold tabular-nums transition-colors",
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
                  className="truncate rounded-sm border-l-[3px] px-1.5 py-px text-[11px] leading-tight font-semibold text-foreground"
                >
                  {chip.time ? `${chip.time} ` : ""}
                  {chip.label}
                </span>
              ))}
              {(chipsByDay.get(day)?.length ?? 0) > MAX_CHIPS ? (
                <span className="pl-1 text-[10.5px] font-bold text-muted-foreground">
                  + još {(chipsByDay.get(day)?.length ?? 0) - MAX_CHIPS}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );

  // The month row mirrors the week strips' header line exactly - same label
  // type, same 34px line - and lives in the same fixed-header slot, so
  // switching Agenda / Nedelja / Mesec never moves the "Avgust 2026" line.
  const monthRow = (
    <div className="flex min-h-[34px] items-center gap-2">
      {/* The title is the far-jump affordance - same grid the Novac pager
          opens, so "izaberi mesec i godinu" is one control app-wide. */}
      <MonthGridPopover value={monthPrefix} onPick={(month) => setMonthAnchor(`${month}-01`)}>
        <button
          type="button"
          aria-label="Izaberi mesec i godinu"
          className="-ml-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[13.5px] font-semibold transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="truncate">
            {monthName} {format(monthDate, "yyyy")}
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </MonthGridPopover>
      <span className="min-w-1 flex-1" />
      {monthPrefix !== todayStr.slice(0, 7) ? (
        <NowPill
          label={currentMonthName}
          aria-label="Vrati na tekući mesec"
          onClick={() => setMonthAnchor(`${todayStr.slice(0, 7)}-01`)}
        />
      ) : null}
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
  );

  return (
    <div className="space-y-3">
      {stripSlot ? createPortal(monthRow, stripSlot) : monthRow}

      <div>
        {/* Weekday labels stay put - only the day cells ride the carousel. */}
        <div className="mb-[3px] grid grid-cols-7 gap-[3px]">
          {DAY_LABELS_SHORT.map((label) => (
            <div
              key={label}
              className="py-1 text-center text-[10px] font-bold tracking-wide text-muted-foreground uppercase"
            >
              {label}
            </div>
          ))}
        </div>
        {/* The clip box: the track and its off-screen neighbour pages slide
            inside it without covering the labels above or the spans below. */}
        <div
          className={cn("overflow-hidden", !isWide && "touch-none")}
          onTouchStart={onGridTouchStart}
          onTouchMove={onGridTouchMove}
          onTouchEnd={onGridTouchEnd}
          onTouchCancel={onGridTouchCancel}
        >
          <div
            ref={trackRef}
            className="relative transition-transform duration-200 ease-out [will-change:transform]"
          >
            {/* `inert`: the hidden pages are clipped from sight but stay in
                the DOM - without it their buttons would still catch focus. */}
            {prevPageWeeks ? (
              <div
                ref={prevPageRef}
                inert
                aria-hidden="true"
                className="absolute inset-x-0 bottom-full pb-[3px]"
              >
                {renderCells(prevPageWeeks, prevPrefix)}
              </div>
            ) : null}
            {renderCells(weeks, monthPrefix)}
            {nextPageWeeks ? (
              <div inert aria-hidden="true" className="absolute inset-x-0 top-full pt-[3px]">
                {renderCells(nextPageWeeks, nextPrefix)}
              </div>
            ) : null}
          </div>
        </div>

        {spans.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {spans.map((span) => (
              <li
                key={span.key}
                className="flex items-center gap-[7px] px-1 text-[11.5px] font-semibold text-muted-foreground"
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
        {/* On phones the day line is the month view's one sticky element:
            scrolling a loaded day keeps its name (and the way into the
            agenda) pinned while the grid and filters scroll away. Opaque
            background, no backdrop-filter (iOS fails to repaint it). */}
        <div className="sticky top-0 z-20 -mx-1.5 mb-2 bg-background px-1.5 lg:static lg:mx-0 lg:bg-transparent lg:px-0">
          <button
            type="button"
            onClick={() => onOpenDay(selectedDay)}
            className="flex w-full items-center gap-2 rounded-md py-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <SectionHeading as="div" className="flex-1">
              {formatPeekHeading(selectedDay, todayStr)}
            </SectionHeading>
            <span className="shrink-0 text-[11.5px] font-bold text-accent-deep">
              Otvori u agendi
            </span>
          </button>
        </div>

        {/* Held rows (day outside the visible month) render as-is - no
            skeleton flash while the neighbouring month's window loads. */}
        {selectedInWindow && isLoading ? (
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
