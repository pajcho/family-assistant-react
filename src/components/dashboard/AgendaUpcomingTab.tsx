import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import type { Birthday, Event, Payment } from "@/types/database";
import { addDays, srLocale, startOfToday } from "@/utils/date";

/**
 * "Uskoro" tab — everything from tomorrow onward, grouped by day, with infinite
 * scroll. The visible window starts at `INITIAL_DAYS` and grows `CHUNK_DAYS` at
 * a time as the sentinel scrolls into view, up to a `MAX_HORIZON_DAYS` soft cap.
 *
 * Only the events query is range-scoped, so growing the horizon costs at most
 * one extra fetch; activities/payments/birthdays are expanded client-side from
 * already-loaded data. Empty days are skipped — `useAgenda().days` only lists
 * days that actually have items. Day sections carry an `id` so the Phase 3D
 * week strip can scroll to them.
 */
export type AgendaUpcomingTabProps = {
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

const INITIAL_DAYS = 30;
const CHUNK_DAYS = 30;
const MAX_HORIZON_DAYS = 365;

export function AgendaUpcomingTab({
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingTabProps) {
  const [horizonDays, setHorizonDays] = useState(INITIAL_DAYS);

  // Window = [tomorrow, today + horizonDays]. Derive once per horizon change.
  const { from, to, tomorrow } = useMemo(() => {
    const base = startOfToday();
    const tomorrowStr = format(addDays(base, 1), "yyyy-MM-dd");
    return {
      from: tomorrowStr,
      to: format(addDays(base, horizonDays), "yyyy-MM-dd"),
      tomorrow: tomorrowStr,
    };
  }, [horizonDays]);

  const { byDay, days, isLoading } = useAgenda({ from, to });
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  const atCap = horizonDays >= MAX_HORIZON_DAYS;
  // Gate growth on `!isLoading` so each chunk waits for its fetch to land. This
  // also stops a runaway during the initial load: while data is pending the
  // sentinel sits near the top (no content yet), and without this gate it would
  // re-fire on every re-observe and pump the horizon to the cap before the
  // first rows ever render.
  const sentinelRef = useInfiniteScroll(
    () => setHorizonDays((d) => Math.min(d + CHUNK_DAYS, MAX_HORIZON_DAYS)),
    { enabled: !atCap && !isLoading, resetKey: horizonDays },
  );

  return (
    <div>
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
