import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { CalendarDaysIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { OverdueSection } from "@/components/dashboard/OverdueSection";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import { useToday } from "@/hooks/useToday";
import type { Birthday, Event, Payment } from "@/types/database";
import { getWeekStart } from "@/utils/activity";
import {
  type AgendaFilter,
  filterAgendaItems,
  groupAgendaByDay,
  isAgendaFilterActive,
} from "@/utils/agendaFilters";
import { addDays } from "@/utils/date";
import { getAppScrollTop, offsetTopWithinApp, scrollAppTo } from "@/lib/appScroll";

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
  /** Opens the add-event dialog - the starter empty state's CTA. */
  onAddEvent: () => void;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const INITIAL_DAYS = 30;
const CHUNK_DAYS = 30;
const MAX_HORIZON_DAYS = 365;

export function AgendaUpcomingList({
  filter,
  scrollToDay: requestedDay,
  onAddEvent,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingListProps) {
  const [horizonDays, setHorizonDays] = useState(INITIAL_DAYS);
  // Jump target beyond the loaded window - scrolled to once the horizon has
  // grown enough for its day section to exist.
  const [pendingJumpDay, setPendingJumpDay] = useState<string | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

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
    const el = document.getElementById(`agenda-day-${day}`);
    if (!el) return;

    const startY = getAppScrollTop();
    const targetY = Math.max(0, offsetTopWithinApp(el) - 4);

    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
    if (Math.abs(targetY - startY) < 1) return;

    // Native, compositor-driven smooth scroll - NOT a main-thread rAF tween. On
    // iOS a per-frame JS scrollTo lets the list paint over fixed chrome for a
    // frame; the browser's own smooth scroll keeps the layers ordered. The
    // teardown only exists so an unmount mid-scroll leaves nothing behind.
    const timer = window.setTimeout(() => {
      scrollCleanupRef.current = null;
    }, 1500);
    scrollCleanupRef.current = () => window.clearTimeout(timer);

    scrollAppTo({ top: targetY, behavior: "smooth" });
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

  // Day sections render for EVERY day in [from, to] (they don't wait for data),
  // so as soon as the window covers the pending day we can scroll to it - one
  // frame later, so layout has settled.
  useEffect(() => {
    if (!pendingJumpDay || pendingJumpDay > to) return;
    const day = pendingJumpDay;
    setPendingJumpDay(null);
    const raf = requestAnimationFrame(() => scrollToDaySection(day));
    return () => cancelAnimationFrame(raf);
    // scrollToDaySection is re-created per render but only reads refs + DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJumpDay, to]);

  // A filter that matches nothing shows the reason (not a long run of empty
  // days); first load shows a skeleton; otherwise render every day in the window.
  const showEmptyMsg = filterActive && !hasItems && overdueItems.length === 0;
  const showLoading = !showEmptyMsg && isLoading && !hasItems;
  // Nothing in the whole horizon and no filter - the day skeleton alone reads
  // as broken, so a starter card explains the screen above the (kept) day rows.
  const showStarter =
    !filterActive && !isLoading && !hasItems && overdueItems.length === 0 && !overdue.isLoading;

  return (
    <div className="space-y-5">
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
        <div className="space-y-4">
          {allDays.map((day) => {
            const dayItems = byDay.get(day) ?? [];
            const isEmpty = dayItems.length === 0;
            return (
              <section key={day} id={`agenda-day-${day}`} className="scroll-mt-2">
                <AgendaDateHeader
                  day={day}
                  today={today}
                  tomorrow={tomorrow}
                  muted={isEmpty}
                  className={isEmpty ? undefined : "mb-2"}
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
        <p className="px-5 py-2 text-center text-[11.5px] font-semibold text-muted-foreground">
          {atCap
            ? "To je sve za narednih 12 meseci."
            : "Skroluj za još · učitava se do 12 meseci unapred."}
        </p>
      ) : null}

      {dialogs}
    </div>
  );
}
