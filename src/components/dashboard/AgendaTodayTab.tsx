import { useMemo } from "react";
import { format } from "date-fns";

import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import type { Birthday, Event, Payment } from "@/types/database";
import { type AgendaFilter, filterAgendaItems, isAgendaFilterActive } from "@/utils/agendaFilters";

/**
 * "Danas" tab — every activity, event, due payment and birthday for today in
 * one chronological list, over `useAgenda({ from: today, to: today })`. This is
 * the old `DashboardTodayCard` generalized, now including birthdays. Rows open
 * the shared detail dialogs; "Izmeni" flows back to the dashboard's form
 * dialogs through the `onEdit*` props.
 *
 * The shared type+person `filter` (owned by the route, applied here as a pure
 * pass over the agenda items) narrows what shows; birthdays ignore the person
 * facet — see `matchesAgendaFilter`.
 */
export type AgendaTodayTabProps = {
  filter: AgendaFilter;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

export function AgendaTodayTab({
  filter,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaTodayTabProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const { items: allItems, isLoading } = useAgenda({ from: today, to: today });
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  const items = useMemo(() => filterAgendaItems(allItems, filter), [allItems, filter]);

  return (
    <div>
      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
      ) : items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <AgendaItemRow key={agendaItemKey(item)} item={item} onClick={() => onSelect(item)} />
          ))}
        </ul>
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
