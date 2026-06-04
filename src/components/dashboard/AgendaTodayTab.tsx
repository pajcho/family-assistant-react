import { useMemo } from "react";
import { format } from "date-fns";

import { AgendaCalendarPlaceholder } from "@/components/dashboard/AgendaCalendarPlaceholder";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { OverdueSection } from "@/components/dashboard/OverdueSection";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import type { AgendaView } from "@/hooks/useAgendaView";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import type { Birthday, Event, Payment } from "@/types/database";
import { type AgendaFilter, filterAgendaItems, isAgendaFilterActive } from "@/utils/agendaFilters";

/**
 * "Danas" tab — past-due payments in a "Prekoračeno" section, then every
 * activity, event, due payment and birthday for today, over
 * `useAgenda({ from: today, to: today })`. Rows open the shared detail dialogs;
 * "Izmeni" flows back to the dashboard's form dialogs through the `onEdit*`
 * props.
 *
 * The shared type+person `filter` (owned by the route) narrows both sections as
 * a pure pass over the agenda items; birthdays ignore the person facet — see
 * `matchesAgendaFilter`.
 */
export type AgendaTodayTabProps = {
  view: AgendaView;
  filter: AgendaFilter;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

export function AgendaTodayTab({
  view,
  filter,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaTodayTabProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const { items: allItems, isLoading } = useAgenda({ from: today, to: today });
  const overdue = useOverduePayments();
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  const items = useMemo(() => filterAgendaItems(allItems, filter), [allItems, filter]);
  const overdueItems = useMemo(
    () => filterAgendaItems(overdue.items, filter),
    [overdue.items, filter],
  );

  // Calendar view lands in PR 4 — placeholder for now.
  if (view === "calendar") {
    return <AgendaCalendarPlaceholder label="Dnevni kalendar" />;
  }

  const loading = isLoading || overdue.isLoading;
  const hasOverdue = overdueItems.length > 0;
  const hasToday = items.length > 0;

  return (
    <div>
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
      ) : hasOverdue || hasToday ? (
        <div className="space-y-6">
          <OverdueSection items={overdueItems} onSelect={onSelect} />
          {hasToday ? (
            <section>
              {hasOverdue ? (
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  Danas
                </h3>
              ) : null}
              <ul className="space-y-1">
                {items.map((item) => (
                  <AgendaItemRow
                    key={agendaItemKey(item)}
                    item={item}
                    onClick={() => onSelect(item)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : isAgendaFilterActive(filter) ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nema stavki za izabrane filtere.</p>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Slobodan dan — nema aktivnosti, događaja, plaćanja ni rođendana.
        </p>
      )}
      {dialogs}
    </div>
  );
}
