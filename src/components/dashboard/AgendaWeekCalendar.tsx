import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import {
  AcademicCapIcon,
  BookOpenIcon,
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
import { TimetableEditor } from "@/components/activities/TimetableEditor";
import { type AgendaItem, agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useBellSchedule } from "@/hooks/useBellSchedule";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { useSchoolShiftAnchors } from "@/hooks/useSchoolShifts";
import { useSchoolTimetable } from "@/hooks/useSchoolTimetable";
import { useWeekSchool } from "@/hooks/useWeekSchool";
import type { Birthday, Event, Payment, TimetableVariant } from "@/types/database";
import {
  DAY_LABELS_SHORT,
  fallbackColorForProfile,
  getThisWeekStart,
  getWeekStart,
  timeToMinutes,
} from "@/utils/activity";
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

/**
 * Time gutter + 7 day columns. Fixed 140px columns below `sm` and the grid
 * scrolls sideways; from `sm` up the seven share the width.
 *
 * Squeezing all seven onto a phone (~46px each) was tried and reverted: at that
 * width every block is an unreadable sliver, the labels had to be hidden
 * outright, and a week you cannot read is not worth seeing whole. Two and a bit
 * days at a legible size, with the header and the hour gutter pinned so you
 * never lose your place, beats seven columns of coloured stripes.
 */
const GRID_COLS = "grid-cols-[44px_repeat(7,140px)] sm:grid-cols-[44px_repeat(7,minmax(0,1fr))]";

/** Width of the sticky hour gutter - the horizontal scroll offsets past it. */
const GUTTER_PX = 44;

/** All-day chips a day shows before collapsing the rest into "+ još N" (the
 *  month view's MAX_CHIPS rule, so the two grids behave alike). */
const MAX_ALL_DAY = 3;

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
  // Days whose all-day cell is expanded past MAX_ALL_DAY. Keyed by date (unique
  // across weeks), so navigating away and back keeps the choice - harmless
  // either way.
  const [expandedAllDay, setExpandedAllDay] = useState<ReadonlySet<string>>(new Set());
  const toggleAllDay = (date: string) =>
    setExpandedAllDay((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
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

  // Clicked school class → the SAME timetable editor the /activities grid
  // opens, pre-selected on the clicked variant + weekday (its pattern too).
  const [timetableMemberId, setTimetableMemberId] = useState<string | null>(null);
  const [timetableInitial, setTimetableInitial] = useState<{
    variant: TimetableVariant;
    day: number;
  } | null>(null);
  const { byId: peopleById } = useFamilyMembers();
  const { byPersonId: anchorsByPersonId } = useSchoolShiftAnchors();
  const timetableQuery = useSchoolTimetable();
  const { bell } = useBellSchedule();
  const timetableMember = timetableMemberId ? peopleById.get(timetableMemberId) : undefined;
  const openSchoolDetail = (block: ResolvedSchoolBlock) => {
    setTimetableMemberId(block.personId);
    setTimetableInitial({ variant: block.variant, day: block.dayOfWeek });
  };

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

  const isEmpty = !isLoading && items.length === 0 && schoolBlocks.length === 0;

  // Open on today, at the current hour. Read from refs and fired once per week
  // so the minute tick (which moves `nowTopPx`) can never yank the grid out from
  // under someone who has scrolled somewhere else.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledForRef = useRef<string | null>(null);
  const targetRef = useRef({ todayIndex: days.indexOf(todayStr), nowTopPx, nowInViewport });
  targetRef.current = { todayIndex: days.indexOf(todayStr), nowTopPx, nowInViewport };
  useEffect(() => {
    const box = scrollRef.current;
    // Wait for the data: the axis (and with it every offset) is derived from
    // what the week actually holds, so scrolling before it lands aims at a grid
    // that is about to change height.
    if (!box || isLoading) return;
    if (scrolledForRef.current === weekStart) return;
    scrolledForRef.current = weekStart;

    const { todayIndex, nowTopPx: top, nowInViewport: nowVisible } = targetRef.current;
    const cell =
      todayIndex >= 0 ? box.querySelector<HTMLElement>(`[data-day-index="${todayIndex}"]`) : null;
    // Today hard against the gutter, so it and the days after it are what you
    // see; a week without today starts at Monday.
    box.scrollLeft = cell ? Math.max(0, cell.offsetLeft - GUTTER_PX) : 0;
    // "Now" a third down rather than at the very top - the hour you are in
    // reads better with the morning still above it.
    box.scrollTop = nowVisible && todayIndex >= 0 ? Math.max(0, top - box.clientHeight / 3) : 0;
  }, [weekStart, isLoading]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* Week pager. */}
      <div className="flex items-center gap-2">
        <IconButton icon={ChevronLeftIcon} aria-label="Prethodna nedelja" onClick={goPrev} />
        <div className="flex-1 text-center text-sm font-bold tabular-nums">
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

      {/* The grid scrolls in BOTH directions inside this box, which is what lets
          the day header and the hour gutter stay pinned: `sticky` anchors to the
          nearest scrollport, so the box has to own both axes. The screen's own
          vertical scroll is off for this view (`fillBody`).

          The empty overlay sits on the RELATIVE WRAPPER around the box (not
          inside it), so it stays centered in the visible area instead of
          scrolling away with the grid. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-auto overscroll-contain rounded-lg border border-border bg-card shadow-card"
        >
          {/* `min-w-max` sizes this wrapper to its content instead of to the
              scrollport. Without it the inner grid overflows a wrapper that is
              only viewport-wide, and sticky-left breaks: the sticky element's
              containing block would end short of the scroll edges.

              It has to STOP at `sm`, where the columns become `1fr`: inside a
              max-content wrapper a fraction resolves to the column's own
              max-content width, so the grid grew past the viewport and the
              desktop week scrolled sideways for no reason. */}
          <div className="min-w-max sm:min-w-0">
            {/* Day headers - sticky on top. */}
            <div className={cn("sticky top-0 z-20 grid border-b border-border bg-card", GRID_COLS)}>
              {/* The top-left corner outranks both (z-30): it is over the gutter
                  AND over the day columns sliding under the header. */}
              <div className="sticky left-0 z-30 bg-card" />
              {days.map((date, i) => (
                <div
                  key={date}
                  data-day-index={i}
                  className={cn(
                    "border-l border-border px-2 py-1.5 text-center",
                    date === todayStr && "bg-accent-soft",
                  )}
                >
                  <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                    {DAY_LABELS_SHORT[i]}
                  </div>
                  <div
                    className={cn(
                      "text-[12.5px] font-bold tabular-nums",
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
                <div className="sticky left-0 z-10 bg-card px-1.5 py-1.5 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Ceo dan
                </div>
                {perDay.map((d) => {
                  const collapsible = d.allDayItems.length > MAX_ALL_DAY;
                  const expanded = collapsible && expandedAllDay.has(d.date);
                  const visible = expanded ? d.allDayItems : d.allDayItems.slice(0, MAX_ALL_DAY);
                  const hiddenCount = d.allDayItems.length - visible.length;
                  return (
                    <div
                      key={d.date}
                      className={cn(
                        "flex min-w-0 flex-col gap-1 overflow-hidden border-l border-border p-1",
                        d.date === todayStr && "bg-accent-soft/50",
                      )}
                    >
                      {visible.map((item) => (
                        <AllDayChip
                          key={agendaItemKey(item)}
                          item={item}
                          onClick={() => onSelect(item)}
                        />
                      ))}
                      {collapsible ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggleAllDay(d.date)}
                          className={cn(
                            "rounded-sm pl-1 text-left text-[10.5px] font-bold text-muted-foreground",
                            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          )}
                        >
                          {expanded ? "manje" : `+ još ${hiddenCount}`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
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
                    className="absolute right-1.5 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-muted-foreground"
                  >
                    {hl.label}
                  </div>
                ))}
                {nowInViewport ? (
                  <div
                    style={{ top: `${nowTopPx}px` }}
                    className="absolute right-1 -translate-y-1/2 rounded-full bg-neg px-1 text-[9.5px] font-bold tabular-nums text-white"
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
                        room={entry.block.room}
                        color={
                          peopleById.get(entry.block.personId)?.color ??
                          fallbackColorForProfile(entry.block.personId)
                        }
                        isPast={
                          d.date < todayStr ||
                          (d.date === todayStr && timeToMinutes(entry.endTime) <= nowMin)
                        }
                        onClick={() => openSchoolDetail(entry.block)}
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
        <p className="px-5 py-1 text-center text-[11.5px] font-normal text-muted-foreground">
          Školski blokovi dolaze iz rasporeda i smena (A/B nedelje).
        </p>
      ) : null}

      {dialogs}
      {/* Direct timetable edit from clicking a school block - mirrors the
          /activities page wiring. */}
      {timetableMember && bell ? (
        <TimetableEditor
          open={!!timetableMemberId}
          onOpenChange={(open) => {
            if (!open) {
              setTimetableMemberId(null);
              setTimetableInitial(null);
            }
          }}
          member={timetableMember}
          anchor={anchorsByPersonId.get(timetableMember.id)}
          entries={timetableQuery.data ?? []}
          bell={bell}
          initialVariant={timetableInitial?.variant}
          initialDay={timetableInitial?.day}
        />
      ) : null}
    </div>
  );
}

/**
 * A school class in the weekly grid, tinted with the child's color so two
 * kids' timetables shown at once stay tellable apart. Same visual language as
 * the /activities grid's school blocks (faint 10% fill, thin colored left
 * accent, book glyph) - deliberately quieter than the agenda blocks (16%,
 * 3px) so a full school day still reads as background structure. Tapping one
 * opens the shared timetable editor.
 */
function SchoolBlock({
  subject,
  room,
  color,
  isPast,
  lane,
  totalLanes,
  laneSpan,
  topPx,
  heightPx,
  startTime,
  onClick,
}: {
  subject: string;
  room: string | null;
  color: string;
  isPast: boolean;
  lane: number;
  totalLanes: number;
  laneSpan: number;
  topPx: number;
  heightPx: number;
  startTime: string;
  onClick: () => void;
}) {
  const widthPct = (laneSpan / totalLanes) * 100;
  const leftPct = ((lane - 1) / totalLanes) * 100;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, var(--card))`,
        borderLeftColor: color,
      }}
      className={cn(
        "absolute overflow-hidden rounded-sm border border-l-2 border-border px-1.5 py-0.5 text-left",
        "transition-[filter] hover:brightness-105",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        isPast && "opacity-60",
      )}
      title={`${subject}${room ? ` · ${room}` : ""} · ${startTime}`}
    >
      <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
        <BookOpenIcon className="size-2.5 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{startTime}</span>
      </div>
      <div className="truncate text-[10px] font-semibold text-foreground">{subject}</div>
    </button>
  );
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = parseISO(weekStart + "T12:00:00");
  const end = parseISO(weekEnd + "T12:00:00");
  return `${format(start, "dd.MM", { locale: srLocale })} - ${format(end, "dd.MM.yyyy", {
    locale: srLocale,
  })}`;
}
