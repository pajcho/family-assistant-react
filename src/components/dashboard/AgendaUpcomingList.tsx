import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
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

/**
 * "Uskoro" LIST view — an overdue "Prekoračeno" section, then everything from
 * today onward grouped by day, with infinite scroll and a sticky Todoist-style
 * week strip on top that follows the scroll.
 *
 * The visible window starts at `INITIAL_DAYS` and grows `CHUNK_DAYS` at a time
 * as the sentinel scrolls into view (or the week strip is swiped to its end),
 * up to a `MAX_HORIZON_DAYS` soft cap. Only the events query is range-scoped, so
 * growing the horizon costs at most one extra fetch; the rest is expanded
 * client-side. EVERY day in the window is rendered — days with no items show a
 * dimmed header — so the agenda reads as a continuous calendar. Each day section
 * carries an `id` so the strip can scroll to it, and a window scroll-spy feeds
 * the strip the day currently at the top of the list.
 *
 * Split out from `AgendaUpcomingTab` so it and the weekly calendar are never
 * mounted together — two `useAgenda` instances would double-subscribe the shared
 * realtime channels.
 */
export type AgendaUpcomingListProps = {
  filter: AgendaFilter;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const INITIAL_DAYS = 30;
const CHUNK_DAYS = 30;
const MAX_HORIZON_DAYS = 365;

export function AgendaUpcomingList({
  filter,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingListProps) {
  const [horizonDays, setHorizonDays] = useState(INITIAL_DAYS);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // Tap-to-scroll: a flag that pins the scroll-spy to the tapped day while a
  // (native, compositor-driven) smooth scroll runs, plus a teardown for the
  // listeners/timer that release that pin.
  const programmaticScrollRef = useRef(false);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  // Window = [today, end of the week containing today + horizonDays]. Today is
  // the first day group (the Todoist "Upcoming" model), prefixed by the overdue
  // section; it also shows on the Danas tab. The end is snapped out to that
  // week's Sunday so the window covers whole Mon–Sun weeks — every day the strip
  // shows then has a rendered section to scroll to when tapped. Derive per horizon.
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

  // Every day in the window, ascending — one section is rendered per day so the
  // agenda shows empty days too (dimmed), not just days that have items.
  const allDays = useMemo(() => {
    const start = parseISO(from + "T12:00:00");
    const count = differenceInCalendarDays(parseISO(to + "T12:00:00"), start) + 1;
    return Array.from({ length: count }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
  }, [from, to]);

  // Apply the shared filter, then regroup — so the day sections AND the week
  // strip's dots both reflect the active filter.
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

  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const [day, items] of byDay) map.set(day, items.length);
    return map;
  }, [byDay]);

  // Strip pages: from today's week through the loaded horizon's week.
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

  // Scroll-spy: the active day is the last day section whose top has passed
  // below the sticky strip. Walks every rendered day (empty ones included) so
  // the strip marks the day actually at the top of the list. Throttled with rAF.
  useEffect(() => {
    if (allDays.length === 0) {
      setActiveDay(null);
      return;
    }
    let raf = 0;
    const compute = () => {
      raf = 0;
      // While tweening to a tapped day, keep that day pinned as active — don't let
      // the spy re-select each day we pass on the way there.
      if (programmaticScrollRef.current) return;
      const line = (stripRef.current?.getBoundingClientRect().bottom ?? 140) + 12;
      let current = allDays[0];
      for (const day of allDays) {
        const el = document.getElementById(`agenda-day-${day}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = day;
        else break;
      }
      setActiveDay(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [allDays]);

  const atCap = horizonDays >= MAX_HORIZON_DAYS;
  const growHorizon = () => setHorizonDays((d) => Math.min(d + CHUNK_DAYS, MAX_HORIZON_DAYS));
  // Gate growth on `!isLoading` so each chunk waits for its fetch — this also
  // stops a load-time runaway where the sentinel, parked at the top while data
  // is pending, would pump the horizon to the cap before the first rows render.
  const sentinelRef = useInfiniteScroll(growHorizon, {
    enabled: !atCap && !isLoading,
    resetKey: horizonDays,
  });

  // Release the scroll-spy pin and tear down its listeners/timer.
  const releaseScrollPin = () => {
    programmaticScrollRef.current = false;
    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
  };

  // Tear down the pin's listeners if the list unmounts mid-scroll.
  useEffect(() => {
    return () => scrollCleanupRef.current?.();
  }, []);

  const scrollToDay = (day: string) => {
    const el = document.getElementById(`agenda-day-${day}`);
    if (!el) return;
    // Select the tapped day at once (it turns blue immediately) and pin it so the
    // scroll-spy doesn't walk activeDay through every day we pass on the way.
    setActiveDay(day);

    // Land the day's header just below the sticky app header (h-14) + week strip
    // with a small gap, so it isn't tucked under the strip. Derived from the
    // strip's measured height (not a fixed scroll-margin) so it stays correct if
    // the strip's size changes. The 8px gap keeps the header above the scroll-spy
    // line (stripBottom + 12), so the strip still marks this as the active day.
    const STICKY_HEADER_PX = 56; // app header h-14; the strip sticks just below it (top-14)
    const stripHeight = stripRef.current?.offsetHeight ?? 0;
    const startY = window.scrollY;
    const targetY = Math.max(
      0,
      startY + el.getBoundingClientRect().top - (STICKY_HEADER_PX + stripHeight + 8),
    );

    releaseScrollPin();
    if (Math.abs(targetY - startY) < 1) return;

    // Native, compositor-driven smooth scroll — NOT a main-thread rAF tween. On
    // iOS, a per-frame JS scrollTo lets the list paint over the sticky header for a
    // frame while scrolling up (the reported "items over the header"); the browser's
    // own smooth scroll keeps the sticky layers ordered. Pin the spy for the scroll
    // and release it on scrollend (or when a user gesture takes over, or a safety
    // timeout — covers the rare browser without a scrollend event).
    programmaticScrollRef.current = true;
    const release = () => releaseScrollPin();
    window.addEventListener("scrollend", release, { once: true });
    window.addEventListener("wheel", release, { once: true, passive: true });
    window.addEventListener("touchstart", release, { once: true, passive: true });
    const timer = window.setTimeout(release, 1500);
    scrollCleanupRef.current = () => {
      window.removeEventListener("scrollend", release);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      window.clearTimeout(timer);
    };

    window.scrollTo({ top: targetY, behavior: "smooth" });
  };

  // A filter that matches nothing shows the reason (not a long run of empty
  // days); first load shows a spinner; otherwise render every day in the window.
  const showEmptyMsg = filterActive && !hasItems && overdueItems.length === 0;
  const showLoading = !showEmptyMsg && isLoading && !hasItems;

  return (
    <div>
      <div
        ref={stripRef}
        // Opaque (matches the page bg), NOT translucent + backdrop-blur: stacked
        // under the sticky app header, an iOS `backdrop-filter` here flickers/blanks
        // during fast scroll (e.g. tapping a day a few days back). Solid avoids it.
        className="sticky top-14 z-30 -mx-4 mb-4 border-b border-gray-200/70 bg-gray-50 px-4 pt-3 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-gray-700/70 dark:bg-gray-900"
      >
        <WeekStrip
          weeks={weeks}
          today={today}
          from={from}
          activeDay={activeDay}
          countByDay={countByDay}
          monthLabel={monthLabel}
          onSelectDay={scrollToDay}
          onReachEnd={growHorizon}
        />
      </div>

      <div className="space-y-6">
        <OverdueSection items={overdueItems} onSelect={onSelect} />

        {showEmptyMsg ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nema stavki za izabrane filtere.
          </p>
        ) : showLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
        ) : (
          <div className="space-y-6">
            {allDays.map((day) => {
              const dayItems = byDay.get(day) ?? [];
              const isEmpty = dayItems.length === 0;
              return (
                <section key={day} id={`agenda-day-${day}`}>
                  <AgendaDateHeader day={day} today={today} tomorrow={tomorrow} muted={isEmpty} />
                  {isEmpty ? null : (
                    <ul className="mt-2 space-y-1">
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
      </div>

      {/* Sentinel — grows the horizon as it scrolls into view. */}
      {!atCap ? <div ref={sentinelRef} aria-hidden="true" className="h-1" /> : null}

      {atCap && !showEmptyMsg && !showLoading ? (
        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          To je sve za narednih 12 meseci.
        </p>
      ) : null}

      {dialogs}
    </div>
  );
}
