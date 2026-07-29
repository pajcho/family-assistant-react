import { AgendaUpcomingList } from "@/components/dashboard/AgendaUpcomingList";
import { AgendaWeekCalendar } from "@/components/dashboard/AgendaWeekCalendar";
import type { AgendaView } from "@/hooks/useAgendaView";
import type { Birthday, Event, Payment } from "@/types/database";
import type { AgendaFilter } from "@/utils/agendaFilters";

/**
 * "Uskoro" tab - a thin switch between the day-grouped LIST and the weekly
 * Mon-Sun CALENDAR, driven by the per-page view toggle. Rendering exactly one of
 * them (never both) keeps a single `useAgenda` mounted. Two used to double-
 * subscribe the shared realtime channels and crash; since RP-2 moved realtime
 * to one family-wide channel it is merely a duplicated fan-out of queries, but
 * there is still no reason to mount both.
 */
export type AgendaUpcomingTabProps = {
  view: AgendaView;
  filter: AgendaFilter;
  /** Opens the add-event dialog - the list's starter empty state CTA. */
  onAddEvent: () => void;
  onEditEvent: (event: Event) => void;
  onEditPayment: (payment: Payment) => void;
  onEditBirthday: (birthday: Birthday) => void;
};

export function AgendaUpcomingTab({
  view,
  filter,
  onAddEvent,
  onEditEvent,
  onEditPayment,
  onEditBirthday,
}: AgendaUpcomingTabProps) {
  if (view === "calendar") {
    return (
      <AgendaWeekCalendar
        filter={filter}
        onEditEvent={onEditEvent}
        onEditPayment={onEditPayment}
        onEditBirthday={onEditBirthday}
      />
    );
  }
  return (
    <AgendaUpcomingList
      filter={filter}
      onAddEvent={onAddEvent}
      onEditEvent={onEditEvent}
      onEditPayment={onEditPayment}
      onEditBirthday={onEditBirthday}
    />
  );
}
