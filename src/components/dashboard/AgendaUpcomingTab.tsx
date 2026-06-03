import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { WeekStrip } from "@/components/dashboard/WeekStrip";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import type { Birthday, Event, Payment } from "@/types/database";
import { addDays, srLocale, startOfToday } from "@/utils/date";

/**
 * "Uskoro" tab — everything from tomorrow onward, grouped by day, with infinite
 * scroll and a Todoist-style week strip on top.
 *
 * The visible window starts at `INITIAL_DAYS` and grows `CHUNK_DAYS` at a time
 * as the sentinel scrolls into view (or as the week strip expands), up to a
 * `MAX_HORIZON_DAYS` soft cap. Only the events query is range-scoped, so growing
 * the horizon costs at most one extra fetch; activities/payments/birthdays are
 * expanded client-side. Empty days are skipped — `useAgenda().days` only lists
 * days that actually have items. Day sections carry an `id` so the week strip
 * can scroll to them.
 */
export type AgendaUpcomingTabProps = {
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const INITIAL_DAYS = 30;
const CHUNK_DAYS = 30;
const MAX_HORIZON_DAYS = 365;
const INITIAL_WEEKS = 2;
const MAX_WEEKS = Math.ceil(MAX_HORIZON_DAYS / 7);

export function AgendaUpcomingTab({
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingTabProps) {
  const [horizonDays, setHorizonDays] = useState(INITIAL_DAYS);
  const [weeksShown, setWeeksShown] = useState(INITIAL_WEEKS);

  // Window = [tomorrow, today + horizonDays]. Derive once per horizon change.
  const { from, to, today, tomorrow } = useMemo(() => {
    const base = startOfToday();
    return {
      from: format(addDays(base, 1), "yyyy-MM-dd"),
      to: format(addDays(base, horizonDays), "yyyy-MM-dd"),
      today: format(base, "yyyy-MM-dd"),
      tomorrow: format(addDays(base, 1), "yyyy-MM-dd"),
    };
  }, [horizonDays]);

  const { byDay, days, isLoading } = useAgenda({ from, to });
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  // Keep the loaded horizon at least as wide as the strip is showing, so an
  // expanded week always has its day counts populated.
  useEffect(() => {
    setHorizonDays((d) => Math.min(Math.max(d, weeksShown * 7), MAX_HORIZON_DAYS));
  }, [weeksShown]);

  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const [day, items] of byDay) map.set(day, items.length);
    return map;
  }, [byDay]);

  const atCap = horizonDays >= MAX_HORIZON_DAYS;
  // Gate growth on `!isLoading` so each chunk waits for its fetch. This also
  // stops a runaway during the initial load: while data is pending the sentinel
  // sits near the top (no content yet), and without this gate it would re-fire
  // on every re-observe and pump the horizon to the cap before the first rows
  // render.
  const sentinelRef = useInfiniteScroll(
    () => setHorizonDays((d) => Math.min(d + CHUNK_DAYS, MAX_HORIZON_DAYS)),
    { enabled: !atCap && !isLoading, resetKey: horizonDays },
  );

  const scrollToDay = (day: string) => {
    document.getElementById(`agenda-day-${day}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div>
      <WeekStrip
        from={from}
        today={today}
        weeksShown={weeksShown}
        countByDay={countByDay}
        onSelectDay={scrollToDay}
        onExpand={() => setWeeksShown((w) => Math.min(w + 2, MAX_WEEKS))}
        onCollapse={() => setWeeksShown(INITIAL_WEEKS)}
        canExpand={weeksShown < MAX_WEEKS}
      />

      {days.length > 0 ? (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day} id={`agenda-day-${day}`} className="scroll-mt-4">
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                {dayHeader(day, tomorrow)}
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
      ) : atCap ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nema obaveza u narednih 12 meseci.
        </p>
      ) : null}

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
 * "Sutra, 4. jun" for tomorrow, otherwise "Petak, 5. jun" (weekday capitalized;
 * date-fns srLatn yields lowercase weekdays).
 */
function dayHeader(day: string, tomorrow: string): string {
  const date = parseISO(day + "T12:00:00");
  const datePart = format(date, "d. MMMM", { locale: srLocale });
  if (day === tomorrow) return `Sutra, ${datePart}`;
  const weekday = format(date, "EEEE", { locale: srLocale });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${datePart}`;
}
