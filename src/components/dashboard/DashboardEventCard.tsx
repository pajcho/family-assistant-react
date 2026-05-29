import { useMemo, useState } from "react";
import { CalendarIcon } from "@heroicons/react/24/outline";

import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import { EventDetailDialog } from "@/components/dashboard/EventDetailDialog";
import type { Event } from "@/types/database";
import { addDays, daysFromToday, isDateInRange, startOfToday } from "@/utils/date";
import { formatEventTimeRange, isEventEnded } from "@/utils/event";

/**
 * "Događaji (14 dana)" dashboard card. Direct port of
 * `components/dashboard/DashboardEventCard.vue`.
 *
 * Filters the incoming list to events whose `date` falls within the next
 * 14 days, sorts by date then start_time, and renders each as a
 * `DashboardCardItem`. Clicking a row opens the per-event detail dialog;
 * the "Izmeni" footer button closes the popup and delegates to the parent's
 * `onEdit` so the page can open its shared `EventFormDialog`.
 */
export type DashboardEventCardProps = {
  events: Event[];
  onAdd: () => void;
  onEdit: (event: Event) => void;
};

function eventDateLabel(dateStr: string): string {
  const diff = daysFromToday(dateStr);
  if (diff === 0) return "danas";
  if (diff === 1) return "sutra";
  return `za ${diff} dana`;
}

export function DashboardEventCard({ events, onAdd, onEdit }: DashboardEventCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const upcomingEvents = useMemo<Event[]>(() => {
    const today = startOfToday();
    const in14 = addDays(today, 14);
    return events
      .filter((e) => isDateInRange(e.date, today, in14))
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""),
      );
  }, [events]);

  const openDetail = (eventItem: Event) => {
    setSelectedEvent(eventItem);
    setDetailOpen(true);
  };

  return (
    <>
      <DashboardCard
        icon={CalendarIcon}
        title="Događaji (14 dana)"
        emptyMessage="Nema nadolazećih događaja"
        addLabel="Dodaj događaj"
        viewAllLink="/events"
        hasItems={upcomingEvents.length > 0}
        accent="blue"
        onAdd={onAdd}
      >
        {upcomingEvents.map((eventItem) => (
          <DashboardCardItem
            key={eventItem.id}
            label={eventItem.name}
            value={eventDateLabel(eventItem.date)}
            accent="blue"
            completed={isEventEnded(eventItem)}
            description={formatEventTimeRange(eventItem)}
            onClick={() => openDetail(eventItem)}
          />
        ))}
      </DashboardCard>

      <EventDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        event={selectedEvent}
        onEdit={onEdit}
      />
    </>
  );
}
