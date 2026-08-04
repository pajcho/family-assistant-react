import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import {
  AcademicCapIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { IconButton } from "@/components/common/IconButton";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import {
  AllDayChip,
  buildHourLabels,
  computeRange,
  expandRangeToNow,
  GRID_TOP_PADDING_PX,
  gridHeightPx,
  type Positioned,
  positionEntries,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  splitAgendaItems,
  TimedBlock,
  type TimeSpan,
  useMinuteTick,
} from "@/components/dashboard/agendaCalendarShared";
import { type AgendaItem, agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useWeekSchool } from "@/hooks/useWeekSchool";
import type { Birthday, Event, Payment } from "@/types/database";
import { DAY_LABELS_SHORT, getThisWeekStart, getWeekStart } from "@/utils/activity";
import { type AgendaFilter, filterAgendaItems, isAgendaFilterActive } from "@/utils/agendaFilters";
import type { ResolvedSchoolBlock } from "@/utils/schoolTimetable";
import { srLocale } from "@/utils/date";
import { cn } from "@/lib/cn";

/**
 * The calendar's NEDELJA view - a Mon-Sun timetable. Seven day columns over one
 * shared time axis (so every column lines up), an all-day row per day, and a
 * red "now" line in today's column. Self-contained: it owns the visible week
 * and its own `useAgenda({week})` fetch, so the agenda's growing-horizon query
 * doesn't run while the grid is shown.
 *
 * "Prikaži školu" folds the school timetable in (the same resolved blocks the
 * /activities grid draws, from the bell schedule + A/B shift anchors). School
 * classes are drawn quietly - dashed, neutral - and lane against the agenda
 * items in the SAME sweep, so an afternoon class that overlaps a training sits
 * beside it rather than under it.
 *
 * Reuses the block/chip rendering + lane math of the single-day calendar
 * (`agendaCalendarShared`); structurally mirrors the activities `WeekGrid`
 * (sticky header, sticky-left gutter, fixed columns + horizontal scroll on
 * mobile, auto-scroll to today).
 */
export type AgendaWeekCalendarProps = {
  filter: AgendaFilter;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

/** 44px time gutter + 7 day columns - fixed 200px (horizontal scroll) on
 *  mobile, equal flex columns filling the width on sm+. The fixed mobile px
 *  (not `1fr`) is deliberate: iOS Safari mis-sizes `1fr` tracks inside a
 *  min-width-expanded scroll box, collapsing the columns. */
const GRID_COLS = "grid-cols-[44px_repeat(7,200px)] sm:grid-cols-[44px_repeat(7,minmax(0,1fr))]";

/** One laneable entry in the grid: an agenda item or a school class. */
type WeekEntry = TimeSpan &
  ({ source: "agenda"; item: AgendaItem } | { source: "school"; block: ResolvedSchoolBlock });

/** Stable identity for "school is hidden", so the layout memo can skip work. */
const NO_SCHOOL_BLOCKS: ResolvedSchoolBlock[] = [];

export function AgendaWeekCalendar({
  filter,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaWeekCalendarProps) {
  const [weekStart, setWeekStart] = useState<string>(() => getThisWeekStart());
  const [showSchool, setShowSchool] = useState(true);
  const now = useMinuteTick();
  const todayStr = format(now, "yyyy-MM-dd");
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const thisWeekStart = getWeekStart(todayStr);
  const isCurrentWeek = weekStart === thisWeekStart;

  // Follow the week as the day rolls over. `useMinuteTick` re-syncs on focus, so
  // when the app resumes after the week changed while suspended, `thisWeekStart`
  // updates and we advance the visible week to match - but ONLY if the user was
  // parked on the current week; if they'd navigated elsewhere, leave them put.
  const prevWeekStartRef = useRef(thisWeekStart);
  useEffect(() => {
    const prev = prevWeekStartRef.current;
    if (thisWeekStart !== prev) {
      prevWeekStartRef.current = thisWeekStart;
      setWeekStart((w) => (w === prev ? thisWeekStart : w));
    }
  }, [thisWeekStart]);

  const days = useMemo(() => {
    const base = parseISO(weekStart + "T12:00:00");
    return Array.from({ length: 7 }, (_, i) => format(addDays(base, i), "yyyy-MM-dd"));
  }, [weekStart]);
  const weekEnd = days[6];

  const { items: allItems, isLoading } = useAgenda({ from: weekStart, to: weekEnd });
  const items = useMemo(() => filterAgendaItems(allItems, filter), [allItems, filter]);
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  // School obeys the SAME person filter as everything else on the screen (the
  // hook treats an empty set as "no filter", matching the chip semantics).
  const school = useWeekSchool(weekStart, filter.personIds);
  const schoolBlocks = useMemo(
    () => (showSchool ? school.blocks : NO_SCHOOL_BLOCKS),
    [showSchool, school.blocks],
  );
  const hasSchoolData = school.blocks.length > 0;

  // Split each day's items into all-day + timed, then merge in that day's
  // school classes so both go through one lane sweep per column.
  const perDay = useMemo(() => {
    const byDate = new Map<string, AgendaItem[]>();
    for (const item of items) {
      const arr = byDate.get(item.date);
      if (arr) arr.push(item);
      else byDate.set(item.date, [item]);
    }
    const schoolByDate = new Map<string, ResolvedSchoolBlock[]>();
    for (const block of schoolBlocks) {
      const arr = schoolByDate.get(block.date);
      if (arr) arr.push(block);
      else schoolByDate.set(block.date, [block]);
    }
    return days.map((date) => {
      const { allDayItems, timedEntries } = splitAgendaItems(byDate.get(date) ?? []);
      const entries: WeekEntry[] = [
        ...timedEntries.map(
          (e): WeekEntry => ({
            source: "agenda",
            item: e.item,
            startTime: e.startTime,
            endTime: e.endTime,
          }),
        ),
        ...(schoolByDate.get(date) ?? []).map(
          (block): WeekEntry => ({
            source: "school",
            block,
            startTime: block.startTime,
            endTime: block.endTime,
          }),
        ),
      ];
      return { date, allDayItems, entries };
    });
  }, [days, items, schoolBlocks]);

  const { startMin, endMin } = useMemo(() => {
    const base = computeRange(perDay.flatMap((d) => d.entries));
    // Today is in this week → keep "now" in the axis so the red line shows and
    // the open-on-now scroll has a target (mirrors the single-day calendar).
    return isCurrentWeek ? expandRangeToNow(base, nowMin) : base;
  }, [perDay, isCurrentWeek, nowMin]);

  const positionedByDate = useMemo(() => {
    const map = new Map<string, Positioned<WeekEntry>[]>();
    for (const d of perDay) map.set(d.date, positionEntries(d.entries, startMin));
    return map;
  }, [perDay, startMin]);

  const hasAnyAllDay = perDay.some((d) => d.allDayItems.length > 0);
  const hourLabels = buildHourLabels(startMin, endMin);
  const totalHeightPx = gridHeightPx(startMin, endMin);

  const nowInViewport = nowMin >= startMin && nowMin <= endMin;
  const nowTopPx = GRID_TOP_PADDING_PX + ((nowMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX;

  const goPrev = () =>
    setWeekStart((w) => format(addDays(parseISO(w + "T12:00:00"), -7), "yyyy-MM-dd"));
  const goNext = () =>
    setWeekStart((w) => format(addDays(parseISO(w + "T12:00:00"), 7), "yyyy-MM-dd"));
  const goToday = () => setWeekStart(thisWeekStart);

  // Land on today's column when the week renders - only matters once the days
  // overflow. Horizontal only; the screen owns vertical scroll.
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayIndex = days.indexOf(todayStr);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (todayIndex < 0) {
      container.scrollLeft = 0;
      return;
    }
    const cell = container.querySelector<HTMLElement>(`[data-day-index="${todayIndex}"]`);
    if (cell) container.scrollLeft = Math.max(0, cell.offsetLeft - 44);
  }, [todayIndex, weekStart]);

  const isEmpty = !isLoading && items.length === 0 && schoolBlocks.length === 0;

  return (
    <div className="space-y-2.5">
      {/* Week pager. */}
      <div className="flex items-center gap-2">
        <IconButton icon={ChevronLeftIcon} aria-label="Prethodna nedelja" onClick={goPrev} />
        <div className="flex-1 text-center text-sm font-extrabold tabular-nums">
          {formatWeekRange(weekStart, weekEnd)}
        </div>
        <IconButton icon={ChevronRightIcon} aria-label="Sledeća nedelja" onClick={goNext} />
      </div>

      <FilterChipRow ariaLabel="Prikaz nedelje">
        {hasSchoolData ? (
          <FilterChip
            active={showSchool}
            onToggle={() => setShowSchool((v) => !v)}
            icon={AcademicCapIcon}
          >
            Prikaži školu
          </FilterChip>
        ) : null}
        {!isCurrentWeek ? (
          <FilterChip active={false} onToggle={goToday} icon={ClockIcon}>
            Ova sedmica
          </FilterChip>
        ) : null}
        {isLoading ? (
          <span className="shrink-0 px-1 text-xs text-muted-foreground">Učitavanje…</span>
        ) : null}
      </FilterChipRow>

      {/* Horizontal scroll only (no max-height) - the screen owns vertical
          scroll. The empty overlay sits on a RELATIVE WRAPPER around the scroll
          container (not inside it), so it stays centered in the visible area
          instead of scrolling away with the fixed mobile columns. */}
      <div className="relative">
        <div
          ref={scrollRef}
          className="overflow-x-auto rounded-lg border border-border bg-card shadow-card"
        >
          {/* `min-w-max` sizes to the fixed columns on mobile (scrolls, like the
              activities grid); `sm:min-w-0` lets the 1fr columns fill the width
              on desktop without the all-day chips inflating max-content. */}
          <div className="min-w-max sm:min-w-0">
            {/* Day headers - sticky on top. */}
            <div className={cn("sticky top-0 z-20 grid border-b border-border bg-card", GRID_COLS)}>
              <div />
              {days.map((date, i) => (
                <div
                  key={date}
                  data-day-index={i}
                  className={cn(
                    "border-l border-border px-2 py-1.5 text-center",
                    date === todayStr && "bg-accent-soft",
                  )}
                >
                  <div className="text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase">
                    {DAY_LABELS_SHORT[i]}
                  </div>
                  <div
                    className={cn(
                      "text-[12.5px] font-extrabold tabular-nums",
                      date === todayStr ? "text-accent-deep" : "text-foreground",
                    )}
                  >
                    {format(parseISO(date + "T12:00:00"), "d.M.")}
                  </div>
                </div>
              ))}
            </div>

            {/* All-day row - one cell per day; only rendered if the week has any. */}
            {hasAnyAllDay ? (
              <div className={cn("grid border-b border-border", GRID_COLS)}>
                <div className="sticky left-0 z-10 bg-card px-1 py-1.5 text-[9px] font-bold tracking-wide text-muted-foreground uppercase">
                  Ceo dan
                </div>
                {perDay.map((d) => (
                  <div
                    key={d.date}
                    className={cn(
                      "flex min-w-0 flex-col gap-1 border-l border-border p-1",
                      d.date === todayStr && "bg-accent-soft/50",
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
              <div className="sticky left-0 z-10 bg-card">
                {hourLabels.map((hl) => (
                  <div
                    key={hl.label}
                    style={{ top: `${hl.topPx}px` }}
                    className="absolute right-1.5 -translate-y-1/2 text-[9.5px] font-bold tabular-nums text-muted-foreground"
                  >
                    {hl.label}
                  </div>
                ))}
                {nowInViewport ? (
                  <div
                    style={{ top: `${nowTopPx}px` }}
                    className="absolute right-1 -translate-y-1/2 rounded-full bg-neg px-1 text-[9.5px] font-extrabold tabular-nums text-white"
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
                    "relative border-l border-border",
                    d.date === todayStr && "bg-accent-soft/50",
                  )}
                >
                  {hourLabels.map((hl) => (
                    <div
                      key={hl.label}
                      style={{ top: `${hl.topPx}px` }}
                      className="absolute inset-x-0 border-t border-border/60"
                    />
                  ))}
                  {(positionedByDate.get(d.date) ?? []).map((entry) => {
                    const box = {
                      lane: entry.lane,
                      totalLanes: entry.totalLanes,
                      laneSpan: entry.laneSpan,
                      topPx: entry.topPx,
                      heightPx: entry.heightPx,
                      startTime: entry.startTime,
                      endTime: entry.endTime,
                    };
                    return entry.source === "school" ? (
                      <SchoolBlock
                        key={`school-${entry.block.entryId}-${entry.block.date}`}
                        {...box}
                        subject={entry.block.subject}
                      />
                    ) : (
                      <TimedBlock
                        key={agendaItemKey(entry.item)}
                        block={{ ...box, item: entry.item }}
                        todayStr={todayStr}
                        nowMin={nowMin}
                        onClick={() => onSelect(entry.item)}
                      />
                    );
                  })}
                  {d.date === todayStr && nowInViewport ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 border-t-2 border-neg"
                      style={{ top: `${nowTopPx}px` }}
                    >
                      <span className="absolute top-0 left-0 size-2.5 -translate-y-1/2 rounded-full bg-neg" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* AFTER the scroll container in DOM so it paints above the sticky-left
            time gutter (z-10) and the sticky day header (z-20, earlier). */}
        {isEmpty ? (
          isAgendaFilterActive(filter) ? (
            <EmptyState variant="overlay" description="Nema stavki za izabrane filtere." />
          ) : (
            <EmptyState
              variant="overlay"
              title="Nedelja je još prazna"
              description="Sve što dodaš - događaji, aktivnosti, plaćanja, rođendani - pojaviće se ovde."
            />
          )
        ) : null}
      </div>

      {showSchool && hasSchoolData ? (
        <p className="px-5 py-1 text-center text-[11.5px] font-semibold text-muted-foreground">
          Školski blokovi dolaze iz rasporeda i smena (A/B nedelje).
        </p>
      ) : null}

      {dialogs}
    </div>
  );
}

/**
 * A school class in the weekly grid. Deliberately the quietest thing on the
 * canvas - dashed, neutral, no click target - so a full school day frames the
 * extracurriculars instead of drowning them out. (Editing the timetable stays
 * on /activities, where the editor lives.)
 */
function SchoolBlock({
  subject,
  lane,
  totalLanes,
  laneSpan,
  topPx,
  heightPx,
}: {
  subject: string;
  lane: number;
  totalLanes: number;
  laneSpan: number;
  topPx: number;
  heightPx: number;
}) {
  const widthPct = (laneSpan / totalLanes) * 100;
  const leftPct = ((lane - 1) / totalLanes) * 100;
  return (
    <div
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
      className="absolute overflow-hidden rounded-sm border border-dashed border-border bg-muted px-1.5 py-0.5 text-left"
    >
      <div className="truncate text-[10px] font-bold text-muted-foreground">{subject}</div>
    </div>
  );
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = parseISO(weekStart + "T12:00:00");
  const end = parseISO(weekEnd + "T12:00:00");
  return `${format(start, "dd.MM", { locale: srLocale })} - ${format(end, "dd.MM.yyyy", {
    locale: srLocale,
  })}`;
}
