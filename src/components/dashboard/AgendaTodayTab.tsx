import { useMemo } from "react";
import { format } from "date-fns";
import { SunIcon } from "@heroicons/react/24/outline";

import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaDayCalendar } from "@/components/dashboard/AgendaDayCalendar";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { OverdueSection } from "@/components/dashboard/OverdueSection";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import type { AgendaView } from "@/hooks/useAgendaView";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import { useProfile } from "@/hooks/useProfile";
import type { Birthday, Event, Payment } from "@/types/database";
import { type AgendaFilter, filterAgendaItems, isAgendaFilterActive } from "@/utils/agendaFilters";
import { addDays } from "@/utils/date";

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
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const tomorrow = format(addDays(now, 1), "yyyy-MM-dd");
  const { items: allItems, isLoading } = useAgenda({ from: today, to: today });
  const overdue = useOverduePayments();
  const { profile } = useProfile();
  const firstName = profile?.first_name?.trim() || null;
  const { onSelect, dialogs } = useAgendaDetails({ onEditEvent, onEditPayment, onEditBirthday });

  const items = useMemo(() => filterAgendaItems(allItems, filter), [allItems, filter]);
  const overdueItems = useMemo(
    () => filterAgendaItems(overdue.items, filter),
    [overdue.items, filter],
  );

  // Single-day calendar column. Past-due payments have no place on a single-day
  // timeline (they're from earlier days), so they ride along as the same
  // "Prekoračeno" list pinned above the calendar — otherwise they'd be invisible
  // in calendar view. `OverdueSection` renders nothing when there's none.
  if (view === "calendar") {
    return (
      <div className="space-y-4">
        <OverdueSection items={overdueItems} onSelect={onSelect} />
        <AgendaDayCalendar items={items} onSelect={onSelect} />
        {dialogs}
      </div>
    );
  }

  const loading = isLoading || overdue.isLoading;
  const hasOverdue = overdueItems.length > 0;
  const hasToday = items.length > 0;
  const filterActive = isAgendaFilterActive(filter);

  // Overdue (if any) sits above the always-visible "today" divider, which keeps
  // the current date on screen in every state — list of items, all-clear, or
  // filtered-empty (mirrors how Todoist anchors the day).
  return (
    <div className="space-y-6">
      <OverdueSection items={overdueItems} onSelect={onSelect} />
      <section>
        <AgendaDateHeader day={today} today={today} tomorrow={tomorrow} />
        {loading ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Učitavanje…</p>
        ) : hasToday ? (
          <ul className="mt-2 space-y-1">
            {items.map((item) => (
              <AgendaItemRow key={agendaItemKey(item)} item={item} onClick={() => onSelect(item)} />
            ))}
          </ul>
        ) : filterActive ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            Nema stavki za izabrane filtere.
          </p>
        ) : hasOverdue ? (
          // Today itself is clear, but there's overdue above — stay matter-of-fact
          // rather than celebratory.
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            Za danas nemaš zakazanih obaveza.
          </p>
        ) : (
          <TodayEmptyState firstName={firstName} />
        )}
      </section>
      {dialogs}
    </div>
  );
}

/** Nothing scheduled and nothing overdue — a warm, personalized all-clear. */
function TodayEmptyState({ firstName }: { firstName: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
        <SunIcon className="size-7 text-amber-500 dark:text-amber-400" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-gray-900 dark:text-white">
          Uživaj u danu{firstName ? `, ${firstName}` : ""}.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nemaš ništa zakazano za danas, slobodno predahni.
        </p>
      </div>
    </div>
  );
}
