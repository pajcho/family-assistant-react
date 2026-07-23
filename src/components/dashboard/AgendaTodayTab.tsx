import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { SunIcon } from "@heroicons/react/24/outline";

import { EmptyState } from "@/components/common/EmptyState";
import { AgendaDateHeader } from "@/components/dashboard/AgendaDateHeader";
import { AgendaDayCalendar } from "@/components/dashboard/AgendaDayCalendar";
import { AgendaItemRow } from "@/components/dashboard/AgendaItemRow";
import { AgendaListSkeleton } from "@/components/dashboard/AgendaListSkeleton";
import { useAgendaDetails } from "@/components/dashboard/AgendaDetailDialogs";
import { OverdueSection } from "@/components/dashboard/OverdueSection";
import { agendaItemKey, useAgenda } from "@/hooks/useAgenda";
import type { AgendaView } from "@/hooks/useAgendaView";
import { useOverduePayments } from "@/hooks/useOverduePayments";
import { useProfile } from "@/hooks/useProfile";
import { useToday } from "@/hooks/useToday";
import type { Birthday, Event, Payment } from "@/types/database";
import { type AgendaFilter, filterAgendaItems, isAgendaFilterActive } from "@/utils/agendaFilters";
import { addDays } from "@/utils/date";

/**
 * "Danas" tab - past-due payments in a "Prekoračeno" section, then every
 * activity, event, due payment and birthday for today, over
 * `useAgenda({ from: today, to: today })`. Rows open the shared detail dialogs;
 * "Izmeni" flows back to the dashboard's form dialogs through the `onEdit*`
 * props.
 *
 * The shared type+person `filter` (owned by the route) narrows both sections as
 * a pure pass over the agenda items; birthdays ignore the person facet - see
 * `matchesAgendaFilter`.
 */
export type AgendaTodayTabProps = {
  view: AgendaView;
  filter: AgendaFilter;
  /**
   * The "Prvi koraci" card is showing above - the all-clear empty state then
   * drops the "slobodno predahni" tone (a brand-new family has nothing to
   * rest FROM; the honest read is "add something or enjoy the quiet").
   */
  onboardingActive?: boolean;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

export function AgendaTodayTab({
  view,
  filter,
  onboardingActive = false,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaTodayTabProps) {
  const { str: today, date: todayDate } = useToday();
  const tomorrow = format(addDays(todayDate, 1), "yyyy-MM-dd");
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

  const loading = isLoading || overdue.isLoading;
  const hasOverdue = overdueItems.length > 0;
  const hasToday = items.length > 0;
  const filterActive = isAgendaFilterActive(filter);

  // Single-day calendar column. Past-due payments have no place on a single-day
  // timeline (they're from earlier days), so they ride along as the same
  // "Prekoračeno" list pinned above the calendar - otherwise they'd be invisible
  // in calendar view. `OverdueSection` renders nothing when there's none.
  // An empty grid gets the same all-clear the list view shows, floated over the
  // hours - a bare grid with only the red "now" line reads as broken.
  if (view === "calendar") {
    const emptyOverlay =
      !loading && !hasToday ? (
        filterActive ? (
          <EmptyState variant="overlay" description="Nema stavki za izabrane filtere." />
        ) : (
          <EmptyState
            variant="overlay"
            icon={SunIcon}
            tone="amber"
            title={`Uživaj u danu${firstName ? `, ${firstName}` : ""}.`}
            description="Nemaš ništa zakazano za danas - sve što dodaš pojaviće se ovde."
          >
            <div className="mt-3">
              <UskoroCta />
            </div>
          </EmptyState>
        )
      ) : undefined;

    return (
      <div className="space-y-4">
        <OverdueSection items={overdueItems} onSelect={onSelect} />
        <AgendaDayCalendar items={items} onSelect={onSelect} emptyOverlay={emptyOverlay} />
        {dialogs}
      </div>
    );
  }

  // Overdue (if any) sits above the always-visible "today" divider, which keeps
  // the current date on screen in every state - list of items, all-clear, or
  // filtered-empty (mirrors how Todoist anchors the day).
  return (
    <div className="space-y-6">
      <OverdueSection items={overdueItems} onSelect={onSelect} />
      <section>
        <AgendaDateHeader day={today} today={today} tomorrow={tomorrow} />
        {loading ? (
          <AgendaListSkeleton rows={4} />
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
          // Today itself is clear, but there's overdue above - stay matter-of-fact
          // rather than celebratory.
          <div className="mt-3 space-y-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Za danas nemaš zakazanih obaveza.
            </p>
            <UskoroCta />
          </div>
        ) : (
          <TodayEmptyState firstName={firstName} onboardingActive={onboardingActive} />
        )}
      </section>
      {dialogs}
    </div>
  );
}

/**
 * "See what's next" link shown when today is clear. The Danas scope only loads
 * today (`from === to === today`), so tomorrow's count isn't available without
 * a second `useAgenda` - which must never be mounted twice (double realtime
 * subscription) - hence a plain CTA without the count.
 */
function UskoroCta() {
  return (
    <Link
      to="/uskoro"
      className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
    >
      Pogledaj Uskoro →
    </Link>
  );
}

/**
 * Nothing scheduled and nothing overdue - a warm, personalized all-clear.
 * While the "Prvi koraci" card is up, the copy stays matter-of-fact: telling
 * a brand-new family to "predahni" from a calendar they haven't filled yet
 * reads as tone-deaf; the warm version returns once they're set up.
 */
function TodayEmptyState({
  firstName,
  onboardingActive,
}: {
  firstName: string | null;
  onboardingActive: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
        <SunIcon className="size-7 text-amber-500 dark:text-amber-400" />
      </div>
      <div className="space-y-1">
        {onboardingActive ? (
          <>
            <p className="text-base font-semibold text-gray-900 dark:text-white">
              Za danas nema ničega.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Dodaj nešto preko „Prvih koraka" iznad - ili predahni.
            </p>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-gray-900 dark:text-white">
              Uživaj u danu{firstName ? `, ${firstName}` : ""}.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nemaš ništa zakazano za danas, slobodno predahni.
            </p>
          </>
        )}
      </div>
      <UskoroCta />
    </div>
  );
}
