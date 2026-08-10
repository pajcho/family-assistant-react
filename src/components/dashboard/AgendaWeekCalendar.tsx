import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { AcademicCapIcon, BookOpenIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { FilterChip, FilterChipRow } from "@/components/common/FilterChips";
import { WeekStrip } from "@/components/dashboard/WeekStrip";
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
import { TimetableEditor } from "@/components/school/TimetableEditor";
import {
  WEEK_GRID_COL_PX,
  WEEK_GRID_GUTTER_PX,
  WeekTimeGridShell,
  type WeekGridDay,
} from "@/components/calendar/WeekTimeGridShell";
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
 * The show-school toggle folds the school timetable in (the same resolved blocks the
 * /activities grid draws, from the bell schedule + A/B shift anchors). School
 * classes are drawn quietly - dashed, neutral - and lane against the agenda
 * items in the SAME sweep, so an afternoon class that overlaps a training sits
 * beside it rather than under it.
 *
 * Reuses the block/chip rendering + lane math of the single-day calendar
 * (`agendaCalendarShared`); structurally mirrors the activities `WeekGrid`
 * (sticky header, sticky-left gutter, fixed columns + horizontal scroll on
 * mobile, opening with today centered).
 */
export type AgendaWeekCalendarProps = {
  filter: AgendaFilter;
  /** Where the week strip portals to - a slot in the screen's fixed header
   *  (desktop) or in a sticky box inside the scroll body (phones). */
  stripSlot?: HTMLElement | null;
  /**
   * Phones: the grid renders at FULL height and the page scrolls, instead of
   * being a fixed-height pane with its own two-axis scrollport. The horizontal
   * axis (fixed 140px columns) still scrolls inside the box; vertical
   * scrolling belongs to the screen (drags over the grid chain up to it), with
   * the week strip sticky above. The trade: the grid's own day-header row no
   * longer pins - the strip is the day context.
   */
  pageScroll?: boolean;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

/** Strip range: 26 weeks back, 26 forward - a year of weeks, half each way. */
const STRIP_WEEKS_BACK = 26;
const STRIP_WEEKS_FORWARD = 26;

/** All-day chips a day shows before collapsing the rest into "+ N more" (the
 *  month view's MAX_CHIPS rule, so the two grids behave alike). */
const MAX_ALL_DAY = 3;

/** One laneable entry in the grid: an agenda item or a school class. */
type WeekEntry = TimeSpan &
  ({ source: "agenda"; item: AgendaItem } | { source: "school"; block: ResolvedSchoolBlock });

/** Stable identity for "school is hidden", so the layout memo can skip work. */
const NO_SCHOOL_BLOCKS: ResolvedSchoolBlock[] = [];
const NO_BREAK_DAYS = new Map<string, string>();

export function AgendaWeekCalendar({
  filter,
  stripSlot,
  pageScroll = false,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaWeekCalendarProps) {
  const [weekStart, setWeekStart] = useState<string>(() => getThisWeekStart());
  // The strip's focused column (0-6): follows the grid's horizontal scroll on
  // phones, and is what a strip tap or a week jump aims the grid at.
  const [selCol, setSelCol] = useState<number>(() => {
    const now = new Date();
    return (now.getDay() + 6) % 7;
  });
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

  // The shell's day-header cells ("Pon / 3.8.").
  const dayHeaders = useMemo<WeekGridDay[]>(
    () =>
      days.map((date, i) => ({
        date,
        label: DAY_LABELS_SHORT[i],
        dayNum: format(parseISO(date + "T12:00:00"), "d.M."),
      })),
    [days],
  );

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

  // Raspust labels under the day numbers. Deliberately NOT gated on
  // `hasSchoolData`: during the summer break there is no class left to toggle,
  // and this label is the only thing saying why the school is missing.
  const breakNotes = useMemo(
    () => (showSchool ? school.breakDays : NO_BREAK_DAYS),
    [showSchool, school.breakDays],
  );

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

  const isEmpty = !isLoading && items.length === 0 && schoolBlocks.length === 0;

  /* ------------------------------- week strip ------------------------------ */

  // Load dots: agenda items only (school is background structure, not load).
  // Only the loaded week has data - other pages' dots fill in as you arrive.
  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.date, (map.get(item.date) ?? 0) + 1);
    return map;
  }, [items]);

  // Strip pages: half a year back, half forward, anchored on the current week.
  const stripWeeks = useMemo(() => {
    const base = parseISO(thisWeekStart + "T12:00:00");
    return Array.from({ length: STRIP_WEEKS_BACK + STRIP_WEEKS_FORWARD + 1 }, (_, i) =>
      format(addDays(base, (i - STRIP_WEEKS_BACK) * 7), "yyyy-MM-dd"),
    );
  }, [thisWeekStart]);
  const stripMaxDay = useMemo(
    () =>
      format(addDays(parseISO(stripWeeks[stripWeeks.length - 1] + "T12:00:00"), 6), "yyyy-MM-dd"),
    [stripWeeks],
  );

  // The month the shown week mostly sits in - Thursday's month, ISO-style.
  const monthLabel = useMemo(() => {
    const label = format(addDays(parseISO(weekStart + "T12:00:00"), 3), "LLLL yyyy", {
      locale: srLocale,
    });
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }, [weekStart]);

  const activeDay = days[Math.min(Math.max(selCol, 0), 6)];

  // Open with the focused day CENTERED in the strip of columns right of the
  // gutter. Deliberately no vertical auto-scroll to "now": with the phone
  // chrome scrolling away, a jump-to-now yanked the tabs off screen the moment
  // the view opened; the red line still marks the hour, reachable by hand.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledForRef = useRef<string | null>(null);
  // A cross-week strip jump lands the grid on the tapped column once the new
  // week has rendered, instead of the default today-or-Monday.
  const pendingColRef = useRef<number | null>(null);
  // While a tap-driven smooth scroll runs, the horizontal spy is pinned so it
  // doesn't re-select every column passed on the way.
  const spyPinRef = useRef(false);
  const targetRef = useRef({ todayIndex: days.indexOf(todayStr) });
  targetRef.current = { todayIndex: days.indexOf(todayStr) };

  /** scrollLeft that parks a day column centered in the area past the gutter. */
  const centeredLeft = (box: HTMLElement, cell: HTMLElement) =>
    Math.max(
      0,
      cell.offsetLeft -
        WEEK_GRID_GUTTER_PX -
        Math.max(0, (box.clientWidth - WEEK_GRID_GUTTER_PX - cell.offsetWidth) / 2),
    );

  useEffect(() => {
    const box = scrollRef.current;
    // Wait for the data: the axis (and with it every offset) is derived from
    // what the week actually holds, so scrolling before it lands aims at a grid
    // that is about to change height.
    if (!box || isLoading) return;
    if (scrolledForRef.current === weekStart) return;
    scrolledForRef.current = weekStart;

    const { todayIndex } = targetRef.current;
    // A strip jump aims at its column; otherwise today, centered; a week
    // without today starts at Monday.
    const focusIndex = pendingColRef.current ?? todayIndex;
    pendingColRef.current = null;
    const cell =
      focusIndex >= 0 ? box.querySelector<HTMLElement>(`[data-day-index="${focusIndex}"]`) : null;
    box.scrollLeft = cell ? centeredLeft(box, cell) : 0;
  }, [weekStart, isLoading]);

  // Aim the grid's horizontal scroll at a column - phones only: from `sm` up
  // all seven columns share the width and there is nothing to scroll.
  const scrollGridToCol = (col: number) => {
    const box = scrollRef.current;
    if (!box || box.scrollWidth <= box.clientWidth + 8) return;
    const cell = box.querySelector<HTMLElement>(`[data-day-index="${col}"]`);
    if (!cell) return;
    spyPinRef.current = true;
    const release = () => {
      spyPinRef.current = false;
      box.removeEventListener("scrollend", release);
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(release, 1000);
    box.addEventListener("scrollend", release, { once: true });
    box.scrollTo({ left: centeredLeft(box, cell), behavior: "smooth" });
  };

  // A strip tap / swipe-carry / mini-calendar pick. Same week: slide the grid
  // to that column. Another week: switch weeks and land on the column once the
  // new grid renders (the auto-open effect above).
  const handleStripDay = (day: string) => {
    const monday = getWeekStart(day);
    const dow = differenceInCalendarDays(
      parseISO(day + "T12:00:00"),
      parseISO(monday + "T12:00:00"),
    );
    setSelCol(dow);
    if (monday === weekStart) {
      scrollGridToCol(dow);
      return;
    }
    pendingColRef.current = dow;
    setWeekStart(monday);
  };

  // Horizontal scroll-spy: the strip's focused column follows whichever day
  // column sits against the gutter. Phones only (see `scrollGridToCol`).
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      if (spyPinRef.current) return;
      if (box.scrollWidth <= box.clientWidth + 8) return;
      // Inverse of `centeredLeft`: the focused column is the one whose center
      // sits mid-viewport (past the gutter), not the one against the gutter.
      const centering = Math.max(0, (box.clientWidth - WEEK_GRID_GUTTER_PX - WEEK_GRID_COL_PX) / 2);
      const col = Math.min(
        6,
        Math.max(0, Math.round((box.scrollLeft + centering) / WEEK_GRID_COL_PX)),
      );
      setSelCol((prev) => (prev === col ? prev : col));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={cn("flex flex-col gap-2.5", !pageScroll && "h-full min-h-0")}>
      {/* The week strip lives in the screen's FIXED header (slot portal): the
          same strip the agenda has, wired as this view's pager and minimap -
          swiping it changes the week, tapping a day slides the grid to that
          column, and the grid's horizontal scroll walks its focused cell. */}
      {stripSlot
        ? createPortal(
            <WeekStrip
              weeks={stripWeeks}
              today={todayStr}
              from={stripWeeks[0]}
              activeDay={activeDay}
              countByDay={countByDay}
              monthLabel={monthLabel}
              maxDay={stripMaxDay}
              onSelectDay={handleStripDay}
              onJumpToDay={handleStripDay}
              onReachEnd={() => {}}
              nowPill={{
                label: "Ova sedmica",
                show: !isCurrentWeek,
                onClick: () => handleStripDay(todayStr),
              }}
              showArrows
            />,
            stripSlot,
          )
        : null}

      {hasSchoolData || isLoading ? (
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
          {isLoading ? (
            <span className="shrink-0 px-1 text-xs text-muted-foreground">Učitavanje…</span>
          ) : null}
        </FilterChipRow>
      ) : null}

      {/* The shared week-grid shell (one frame for this view AND /activities).
          Desktop keeps `pane`: the box owns both axes so the day header and
          hour gutter pin against its scrollport; on phones the page scrolls
          and the box keeps only the horizontal axis.

          The empty overlay sits on the RELATIVE WRAPPER around the box (not
          inside it), so it stays centered in the visible area instead of
          scrolling away with the grid. */}
      <div className={cn("relative", !pageScroll && "min-h-0 flex-1")}>
        <WeekTimeGridShell
          scrollRef={scrollRef}
          pane={!pageScroll}
          days={dayHeaders}
          todayStr={todayStr}
          hourLabels={hourLabels}
          totalHeightPx={totalHeightPx}
          now={
            nowInViewport && days.includes(todayStr)
              ? { topPx: nowTopPx, label: format(now, "HH:mm") }
              : null
          }
          notesByDate={breakNotes}
          allDayRow={
            hasAnyAllDay
              ? {
                  label: "Ceo dan",
                  renderCell: (_day, i) => {
                    const d = perDay[i];
                    const collapsible = d.allDayItems.length > MAX_ALL_DAY;
                    const expanded = collapsible && expandedAllDay.has(d.date);
                    const visible = expanded ? d.allDayItems : d.allDayItems.slice(0, MAX_ALL_DAY);
                    const hiddenCount = d.allDayItems.length - visible.length;
                    return (
                      <>
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
                      </>
                    );
                  },
                }
              : null
          }
          renderColumn={(day) =>
            (positionedByDate.get(day.date) ?? []).map((entry) => {
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
                  color={
                    peopleById.get(entry.block.personId)?.color ??
                    fallbackColorForProfile(entry.block.personId)
                  }
                  isPast={
                    day.date < todayStr ||
                    (day.date === todayStr && timeToMinutes(entry.endTime) <= nowMin)
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
            })
          }
        />
        {/* AFTER the scroll container in DOM so it paints above the sticky-left
            time gutter (z-10) and the sticky day header (z-20, earlier). */}
        {isEmpty ? (
          isAgendaFilterActive(filter) ? (
            <EmptyState variant="overlay" description="Nema stavki za izabrane filtere." />
          ) : (
            <EmptyState
              variant="overlay"
              title="Nedelja je još prazna"
              description="Sve što dodaš - događaji, zadaci, aktivnosti, plaćanja, rođendani - pojaviće se ovde."
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
      title={`${subject} · ${startTime}`}
    >
      <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
        <BookOpenIcon className="size-2.5 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{startTime}</span>
      </div>
      <div className="truncate text-[10px] font-semibold text-foreground">{subject}</div>
    </button>
  );
}
