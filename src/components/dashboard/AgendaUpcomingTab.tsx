import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";

import { AgendaCalendarPlaceholder } from "@/components/dashboard/AgendaCalendarPlaceholder";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { OverdueSection } from "@/components/dashboard/OverdueSection";
import { WeekStrip } from "@/components/dashboard/WeekStrip";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import type { AgendaView } from "@/hooks/useAgendaView";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import type { Birthday, Event, Payment } from "@/types/database";
import { getWeekStart, weeksBetween } from "@/utils/activity";
import {
  type AgendaFilter,
  filterAgendaItems,
  groupAgendaByDay,
  isAgendaFilterActive,
} from "@/utils/agendaFilters";
import { addDays, srLocale, startOfToday } from "@/utils/date";

/**
 * "Uskoro" tab — everything from tomorrow onward, grouped by day, with infinite
 * scroll and a sticky Todoist-style week strip on top that follows the scroll.
 *
 * The visible window starts at `INITIAL_DAYS` and grows `CHUNK_DAYS` at a time
 * as the sentinel scrolls into view (or the week strip is swiped to its end),
 * up to a `MAX_HORIZON_DAYS` soft cap. Only the events query is range-scoped, so
 * growing the horizon costs at most one extra fetch; the rest is expanded
 * client-side. Empty days are skipped — `useAgenda().days` lists only days with
 * items. Each day section carries an `id` so the strip can scroll to it, and a
 * window scroll-spy feeds the strip the day currently at the top of the list.
 */
export type AgendaUpcomingTabProps = {
  view: AgendaView;
  filter: AgendaFilter;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const INITIAL_DAYS = 30;
const CHUNK_DAYS = 30;
const MAX_HORIZON_DAYS = 365;

export function AgendaUpcomingTab({
  view,
  filter,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingTabProps) {
  const [horizonDays, setHorizonDays] = useState(INITIAL_DAYS);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Window = [today, today + horizonDays]. Today is the first day group (the
  // Todoist "Upcoming" model), prefixed by the overdue section; it also shows on
  // the Danas tab. Derive once per horizon change.
  const { from, to, today, tomorrow } = useMemo(() => {
    const base = startOfToday();
    return {
      from: format(base, "yyyy-MM-dd"),
      to: format(addDays(base, horizonDays), "yyyy-MM-dd"),
      today: format(base, "yyyy-MM-dd"),
      tomorrow: format(addDays(base, 1), "yyyy-MM-dd"),
    };
  }, [horizonDays]);

  const { items: allItems, isLoading } = useAgenda({ from, to });
  const overdue = useOverduePayments();
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  // Apply the shared filter, then regroup — so the day sections AND the week
  // strip's dots both reflect the active filter.
  const { byDay, days } = useMemo(
    () => groupAgendaByDay(filterAgendaItems(allItems, filter)),
    [allItems, filter],
  );
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
  // below the sticky strip. Throttled with rAF.
  useEffect(() => {
    if (view === "calendar" || days.length === 0) {
      setActiveDay(null);
      return;
    }
    let raf = 0;
    const compute = () => {
      raf = 0;
      const line = (stripRef.current?.getBoundingClientRect().bottom ?? 140) + 12;
      let current = days[0];
      for (const day of days) {
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
  }, [days, view]);

  const atCap = horizonDays >= MAX_HORIZON_DAYS;
  const growHorizon = () => setHorizonDays((d) => Math.min(d + CHUNK_DAYS, MAX_HORIZON_DAYS));
  // Gate growth on `!isLoading` so each chunk waits for its fetch — this also
  // stops a load-time runaway where the sentinel, parked at the top while data
  // is pending, would pump the horizon to the cap before the first rows render.
  const sentinelRef = useInfiniteScroll(growHorizon, {
    enabled: view === "list" && !atCap && !isLoading,
    resetKey: horizonDays,
  });

  const scrollToDay = (day: string) => {
    document.getElementById(`agenda-day-${day}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // Weekly timetable calendar lands in PR 5 — placeholder for now.
  if (view === "calendar") {
    return <AgendaCalendarPlaceholder label="Nedeljni kalendar" />;
  }

  return (
    <div>
      <div
        ref={stripRef}
        className="sticky top-14 z-30 -mx-4 mb-4 border-b border-gray-200/70 bg-gray-50/90 px-4 pt-3 pb-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-gray-700/70 dark:bg-gray-900/90"
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

        {days.length > 0 ? (
          <div className="space-y-6">
            {days.map((day) => (
              <section key={day} id={`agenda-day-${day}`} className="scroll-mt-40">
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  {dayHeader(day, today, tomorrow)}
                </h3>
                <ul className="space-y-1">
                  {(byDay.get(day) ?? []).map((item) => (
                    <AgendaItemRow
                      key={agendaItemKey(item)}
                      item={item}
                      onClick={() => onSelect(item)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
        ) : overdueItems.length > 0 ? null : isAgendaFilterActive(filter) ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nema stavki za izabrane filtere.
          </p>
        ) : atCap ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nema obaveza u narednih 12 meseci.
          </p>
        ) : null}
      </div>

      {/* Sentinel — grows the horizon as it scrolls into view. */}
      {!atCap ? <div ref={sentinelRef} aria-hidden="true" className="h-1" /> : null}

      {atCap && days.length > 0 ? (
        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          To je sve za narednih 12 meseci.
        </p>
      ) : null}

      {dialogs}
    </div>
  );
}

/**
 * "Danas, 4. jun" / "Sutra, 5. jun" for today / tomorrow, otherwise
 * "Petak, 6. jun" (weekday capitalized; date-fns srLatn yields lowercase
 * weekdays).
 */
function dayHeader(day: string, today: string, tomorrow: string): string {
  const date = parseISO(day + "T12:00:00");
  const datePart = format(date, "d. MMMM", { locale: srLocale });
  if (day === today) return `Danas, ${datePart}`;
  if (day === tomorrow) return `Sutra, ${datePart}`;
  const weekday = format(date, "EEEE", { locale: srLocale });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${datePart}`;
}
