import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { CalendarDaysIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { OverdueSection } from "@/components/dashboard/OverdueSection";
import { WeekStrip } from "@/components/dashboard/WeekStrip";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import { useToday } from "@/hooks/useToday";
import type { Birthday, Event, Payment } from "@/types/database";
import { getWeekStart, weeksBetween } from "@/utils/activity";
import {
  type AgendaFilter,
  filterAgendaItems,
  groupAgendaByDay,
  isAgendaFilterActive,
} from "@/utils/agendaFilters";
import { addDays, srLocale } from "@/utils/date";
import { cn } from "@/lib/cn";
import { getAppScrollEl, getAppScrollTop, offsetTopWithinApp, scrollAppTo } from "@/lib/appScroll";

/**
 * The calendar's AGENDA view - an overdue "Prekoračeno" section, then
 * everything from today onward grouped by day, with infinite scroll.
 *
 * The visible window starts at `INITIAL_DAYS` and grows `CHUNK_DAYS` at a time
 * as the sentinel scrolls into view, up to a `MAX_HORIZON_DAYS` soft cap. Only
 * the events query is range-scoped, so growing the horizon costs at most one
 * extra fetch; the rest is expanded client-side. EVERY day in the window is
 * rendered - days with no items show a dimmed header - so the agenda reads as a
 * continuous calendar rather than a sparse list. Each day section carries an
 * `id`, which is what `scrollToDay` (the Danas week strip's hand-off, and the
 * month grid's "open this day") aims at.
 *
 * Split out from the other views so only one is ever mounted - two `useAgenda`
 * instances would duplicate the whole fan-out of queries behind the agenda.
 */
export type AgendaUpcomingListProps = {
  filter: AgendaFilter;
  /**
   * yyyy-MM-dd to scroll to once its section exists. Comes from the `day`
   * search param, so a deep link lands on the right date; the window grows to
   * cover it first when it sits past the loaded horizon.
   */
  scrollToDay?: string;
  /**
   * Where the week strip portals to - a slot in the screen's fixed header
   * (desktop) or in a sticky box inside the scroll body (phones). The strip's
   * data (weeks, dots, scroll-spy) lives here with the list, but the strip
   * itself must not scroll away with it.
   */
  stripSlot?: HTMLElement | null;
  /**
   * Height (px) of the sticky strip box pinned over this list on phones.
   * The sticky day headers park below it, and the scroll-spy line and the
   * scroll-to-day target both shift down by it. 0 on desktop, where the strip
   * lives in the fixed header instead.
   */
  stickyOffset?: number;
  /** Opens the add-event dialog - the starter empty state's CTA. */
  onAddEvent: () => void;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const INITIAL_DAYS = 30;
const CHUNK_DAYS = 30;
const MAX_HORIZON_DAYS = 365;

/** A member touching the scroll cancels the jump's correction pass. */
const ABANDON_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

export function AgendaUpcomingList({
  filter,
  scrollToDay: requestedDay,
  stripSlot,
  stickyOffset = 0,
  onAddEvent,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingListProps) {
  const [horizonDays, setHorizonDays] = useState(INITIAL_DAYS);
  // The day the week strip marks - follows the list via the scroll-spy below,
  // and is set eagerly on tap so the strip answers before the scroll lands.
  const [activeDay, setActiveDay] = useState<string | null>(null);
  // Jump target beyond the loaded window - scrolled to once the horizon has
  // grown enough for its day section to exist.
  const [pendingJumpDay, setPendingJumpDay] = useState<string | null>(null);
  // While a tap-to-scroll tween runs, the spy is pinned to the tapped day so it
  // doesn't walk `activeDay` through every day passed on the way there.
  const programmaticScrollRef = useRef(false);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  // The strip's height reaches this list a render or two AFTER it mounts: the
  // screen can only measure the sticky box once the strip has portalled into
  // it. A deep-link jump is deferred through a rAF, so the callback that
  // finally runs is often from a render that still had 0 - and closing over
  // that lands the day a full strip-height too low, behind the strip (from
  // Danas' week strip with a warm cache this was every time). Read it live
  // instead. Written during render, not in an effect: the rAF can fire before
  // an effect from the same commit has run.
  const stickyOffsetRef = useRef(stickyOffset);
  stickyOffsetRef.current = stickyOffset;

  // Window = [today, end of the week containing today + horizonDays]. Today is
  // the first day group, prefixed by the overdue section. The end is snapped
  // out to that week's Sunday so the window covers whole Mon-Sun weeks. Derive
  // per horizon.
  const { str: todayStr, date: todayDate } = useToday();
  const { from, to, today, tomorrow } = useMemo(() => {
    const base = todayDate;
    const horizonEnd = format(addDays(base, horizonDays), "yyyy-MM-dd");
    const lastWeekMonday = parseISO(getWeekStart(horizonEnd) + "T12:00:00");
    return {
      from: format(base, "yyyy-MM-dd"),
      to: format(addDays(lastWeekMonday, 6), "yyyy-MM-dd"),
      today: todayStr,
      tomorrow: format(addDays(base, 1), "yyyy-MM-dd"),
    };
  }, [horizonDays, todayStr, todayDate]);

  const { items: allItems, isLoading } = useAgenda({ from, to });
  const overdue = useOverduePayments();
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  // Every day in the window, ascending - one section is rendered per day so the
  // agenda shows empty days too (dimmed), not just days that have items.
  const allDays = useMemo(() => {
    const start = parseISO(from + "T12:00:00");
    const count = differenceInCalendarDays(parseISO(to + "T12:00:00"), start) + 1;
    return Array.from({ length: count }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
  }, [from, to]);

  // Apply the shared filter, then regroup, so the day sections reflect it.
  const { byDay } = useMemo(
    () => groupAgendaByDay(filterAgendaItems(allItems, filter)),
    [allItems, filter],
  );
  const hasItems = byDay.size > 0;
  const filterActive = isAgendaFilterActive(filter);
  const overdueItems = useMemo(
    () => filterAgendaItems(overdue.items, filter),
    [overdue.items, filter],
  );

  // The strip's load dots reflect the same filter as the day sections.
  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const [day, items] of byDay) map.set(day, items.length);
    return map;
  }, [byDay]);

  // Strip pages: from today's week through the loaded horizon's week. `to` is
  // already snapped to a Sunday, so every page's days have a rendered section.
  const weeks = useMemo(() => {
    const first = getWeekStart(today);
    const count = weeksBetween(first, getWeekStart(to));
    const base = parseISO(first + "T12:00:00");
    return Array.from({ length: count + 1 }, (_, i) => format(addDays(base, i * 7), "yyyy-MM-dd"));
  }, [today, to]);

  const monthLabel = useMemo(() => {
    const label = format(parseISO((activeDay ?? from) + "T12:00:00"), "LLLL yyyy", {
      locale: srLocale,
    });
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }, [activeDay, from]);

  // Last day the mini-calendar may jump to - the same 12-month cap the
  // infinite scroll stops at.
  const maxDay = useMemo(
    () => format(addDays(todayDate, MAX_HORIZON_DAYS), "yyyy-MM-dd"),
    [todayDate],
  );

  // Scroll-spy: the active day is the last day section whose top has passed
  // the container's top edge. Walks every rendered day (empty ones included)
  // so the strip marks the day actually at the top of the list. Throttled with
  // rAF; sections are ascending, so the walk breaks at the first one below.
  useEffect(() => {
    const container = getAppScrollEl();
    if (!container || allDays.length === 0) {
      setActiveDay(null);
      return;
    }
    let raf = 0;
    const compute = () => {
      raf = 0;
      // While tweening to a tapped day, keep that day pinned as active.
      if (programmaticScrollRef.current) return;
      // The reading line sits just under the sticky strip (when there is one).
      const line = container.scrollTop + stickyOffset + 12;
      let current = allDays[0];
      for (const day of allDays) {
        const el = document.getElementById(`agenda-day-${day}`);
        if (!el) continue;
        if (offsetTopWithinApp(el) <= line) current = day;
        else break;
      }
      setActiveDay(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [allDays, stickyOffset]);

  const atCap = horizonDays >= MAX_HORIZON_DAYS;
  const growHorizon = () => setHorizonDays((d) => Math.min(d + CHUNK_DAYS, MAX_HORIZON_DAYS));
  // Gate growth on `!isLoading` so each chunk waits for its fetch - this also
  // stops a load-time runaway where the sentinel, parked at the top while data
  // is pending, would pump the horizon to the cap before the first rows render.
  const sentinelRef = useInfiniteScroll(growHorizon, {
    enabled: !atCap && !isLoading,
    resetKey: horizonDays,
  });

  // Tear down the scroll listeners if the list unmounts mid-scroll.
  useEffect(() => {
    return () => scrollCleanupRef.current?.();
  }, []);

  const scrollToDaySection = (day: string) => {
    // Select eagerly - the strip answers before the scroll lands.
    setActiveDay(day);

    const el = document.getElementById(`agenda-day-${day}`);
    if (!el) return;

    const startY = getAppScrollTop();
    // Land the section just under the sticky strip (when there is one), not
    // behind it.
    const targetY = Math.max(0, offsetTopWithinApp(el) - stickyOffsetRef.current - 4);

    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
    if (Math.abs(targetY - startY) < 1) return;

    const container = getAppScrollEl();

    // Three things can leave the jump off target after the scroll itself is
    // over: rows still landing in the days ABOVE the target (`useAgenda` fans
    // out to several queries, and each late row pushes the target further
    // down), the router's scroll restoration writing the previous screen's
    // offset onto this container once the new route has rendered, and a strip
    // that has changed height since we aimed. One correction pass once the
    // scroll has settled covers all three - it re-measures BOTH the section
    // and the strip rather than trusting what we aimed at.
    const settle = () => {
      const settled = document.getElementById(`agenda-day-${day}`);
      if (!settled) return;
      const nextY = Math.max(0, offsetTopWithinApp(settled) - stickyOffsetRef.current - 4);
      if (Math.abs(getAppScrollTop() - nextY) > 8) scrollAppTo({ top: nextY, behavior: "smooth" });
    };

    // A member who starts scrolling themselves owns the scroll from then on -
    // the correction pass would fight them. This is the reliable signal for
    // "this was a person", where a position check is not: a stomped scroll and
    // a flicked one look identical by offset alone.
    let abandoned = false;
    const abandon = () => {
      abandoned = true;
      teardown();
    };

    // `scrollend` is the precise signal; the timeout is the fallback for
    // browsers without it (and for a scroll that never starts moving).
    const onScrollEnd = () => {
      teardown();
      if (!abandoned) settle();
    };
    const timer = window.setTimeout(onScrollEnd, 1500);
    const teardown = () => {
      window.clearTimeout(timer);
      programmaticScrollRef.current = false;
      container?.removeEventListener("scrollend", onScrollEnd);
      for (const type of ABANDON_EVENTS) container?.removeEventListener(type, abandon);
      scrollCleanupRef.current = null;
    };
    container?.addEventListener("scrollend", onScrollEnd, { once: true });
    for (const type of ABANDON_EVENTS) {
      container?.addEventListener(type, abandon, { once: true, passive: true });
    }
    scrollCleanupRef.current = teardown;

    // Native, compositor-driven smooth scroll - NOT a main-thread rAF tween. On
    // iOS a per-frame JS scrollTo lets the list paint over fixed chrome for a
    // frame; the browser's own smooth scroll keeps the layers ordered.
    programmaticScrollRef.current = true;
    scrollAppTo({ top: targetY, behavior: "smooth" });
  };

  // Mini-calendar jump: inside the loaded window it's a plain scroll; beyond
  // it, grow the horizon to cover the day first (same mechanics as the
  // infinite scroll - at most one extra events fetch) and scroll once the
  // section exists.
  const jumpToDay = (day: string) => {
    if (day <= to) {
      scrollToDaySection(day);
      return;
    }
    const needed = differenceInCalendarDays(parseISO(day + "T12:00:00"), todayDate);
    setHorizonDays((d) => Math.max(d, Math.min(Math.max(needed, INITIAL_DAYS), MAX_HORIZON_DAYS)));
    setActiveDay(day);
    setPendingJumpDay(day);
  };

  // Deep-link / hand-off jump: inside the loaded window it's a plain scroll;
  // beyond it, grow the horizon to cover the day first (same mechanics as the
  // infinite scroll - at most one extra events fetch) and scroll once the
  // section exists.
  //
  // Handled ONCE per requested day: growing the horizon moves `to`, and without
  // the guard every infinite-scroll chunk would yank the user back to the
  // deep-linked day.
  const handledDayRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedDay || requestedDay < from) return;
    if (handledDayRef.current === requestedDay) return;
    handledDayRef.current = requestedDay;
    if (requestedDay > to) {
      const needed = differenceInCalendarDays(parseISO(requestedDay + "T12:00:00"), todayDate);
      setHorizonDays((d) =>
        Math.max(d, Math.min(Math.max(needed, INITIAL_DAYS), MAX_HORIZON_DAYS)),
      );
    }
    setPendingJumpDay(requestedDay);
  }, [requestedDay, from, to, todayDate]);

  // A filter that matches nothing shows the reason (not a long run of empty
  // days); first load shows a skeleton; otherwise render every day in the window.
  const showEmptyMsg = filterActive && !hasItems && overdueItems.length === 0;
  const showLoading = !showEmptyMsg && isLoading && !hasItems;

  // Once the window covers the pending day we can scroll to it - one frame
  // later, so layout has settled.
  //
  // `showLoading` is part of the gate, not just noise: arriving from the Danas
  // mini-month or the month grid mounts this list with its data still in
  // flight, and the skeleton stands in for the day sections. Scrolling then
  // found no `#agenda-day-…` element and silently gave up, which is why a
  // deep link used to land at the top of the agenda. Keeping the request
  // pending until the sections exist is what makes the jump land.
  useEffect(() => {
    if (!pendingJumpDay || pendingJumpDay > to || showLoading) return;
    const day = pendingJumpDay;
    // Clearing the request INSIDE the frame, not before it: clearing first
    // changes this effect's own deps, React runs the cleanup on the re-render
    // that follows, and the frame is cancelled before it ever fires. Only an
    // unmount (or a window that moved) cancels it now.
    const raf = requestAnimationFrame(() => {
      setPendingJumpDay(null);
      scrollToDaySection(day);
    });
    return () => cancelAnimationFrame(raf);
    // scrollToDaySection is re-created per render but only reads refs + DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJumpDay, to, showLoading]);

  // Nothing in the whole horizon and no filter - the day skeleton alone reads
  // as broken, so a starter card explains the screen above the (kept) day rows.
  const showStarter =
    !filterActive && !isLoading && !hasItems && overdueItems.length === 0 && !overdue.isLoading;

  return (
    // The var carries the sticky strip's height to every day header below -
    // their `sticky top` reads it, so they park under the strip, not behind it.
    <div
      className="space-y-5"
      style={{ "--agenda-sticky-top": `${stickyOffset}px` } as React.CSSProperties}
    >
      {/* The strip lives in the screen's FIXED header (via the slot portal),
          so it never scrolls away - but its state is the list's: the spy walks
          it, tapping it scrolls the list, swiping it selects across weeks. */}
      {stripSlot
        ? createPortal(
            <WeekStrip
              weeks={weeks}
              today={today}
              from={from}
              activeDay={activeDay ?? today}
              countByDay={countByDay}
              monthLabel={monthLabel}
              maxDay={maxDay}
              onSelectDay={scrollToDaySection}
              onJumpToDay={jumpToDay}
              onReachEnd={growHorizon}
              nowPill={{
                label: "Danas",
                show: (activeDay ?? today) !== today,
                onClick: () => scrollToDaySection(today),
              }}
              showArrows
            />,
            stripSlot,
          )
        : null}
      <OverdueSection items={overdueItems} onSelect={onSelect} />

      {showStarter ? (
        <EmptyState
          icon={CalendarDaysIcon}
          tone="blue"
          title="Uskoro je još prazno"
          description="Dodaj događaj, aktivnost ili plaćanje i ovde ćeš uvek videti šta koga čeka."
          action={{ label: "Dodaj događaj", onClick: onAddEvent }}
        />
      ) : null}

      {showEmptyMsg ? (
        <EmptyState variant="filter" description="Nema stavki za izabrane filtere." />
      ) : showLoading ? (
        <AgendaListSkeleton rows={6} />
      ) : (
        // No gap BETWEEN sections - the day gap is padding INSIDE each one, so
        // the sections touch. A margin here left a strip that belonged to no
        // section: the outgoing day's header had already been pushed out and
        // the next one had not arrived, and rows scrolled through it in plain
        // sight. Touching sections hand the top over from one header to the
        // next with nothing uncovered in between.
        <div>
          {allDays.map((day) => {
            const dayItems = byDay.get(day) ?? [];
            const isEmpty = dayItems.length === 0;
            const isLinked = day === requestedDay;
            return (
              <section
                key={day}
                id={`agenda-day-${day}`}
                className="scroll-mt-2 pb-4"
                aria-current={isLinked ? "date" : undefined}
              >
                {/* Sticky per section: the day you are reading stays named at
                    the top of the list and is pushed out by the next day's
                    header, so a long scroll never loses its date. Opaque
                    background (no backdrop-filter - iOS fails to repaint it)
                    with a small horizontal bleed so rows pass cleanly under. */}
                <AgendaDateHeader
                  day={day}
                  today={today}
                  tomorrow={tomorrow}
                  muted={isEmpty}
                  selected={isLinked}
                  className={cn(
                    "sticky top-(--agenda-sticky-top) z-10 -mx-1.5 bg-background px-1.5 pt-1",
                    isEmpty ? "pb-1" : "pb-2",
                  )}
                />
                {isEmpty ? null : (
                  <ul className="space-y-2.5">
                    {dayItems.map((item) => (
                      <AgendaItemRow
                        key={agendaItemKey(item)}
                        item={item}
                        onClick={() => onSelect(item)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Sentinel - grows the horizon as it scrolls into view. */}
      {!atCap ? <div ref={sentinelRef} aria-hidden="true" className="h-1" /> : null}

      {!showEmptyMsg && !showLoading ? (
        <p className="px-5 py-2 text-center text-[11.5px] font-normal text-muted-foreground">
          {atCap
            ? "To je sve za narednih 12 meseci."
            : "Skroluj za još · učitava se do 12 meseci unapred."}
        </p>
      ) : null}

      {dialogs}
    </div>
  );
}
