import * as React from "react";
import { CalendarIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { DashboardCardItem } from "@/components/dashboard/DashboardCardItem";
import type { Event } from "@/types/database";
import { addDays, daysFromToday, formatDate, isDateInRange, startOfToday } from "@/utils/date";
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
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedEvent, setSelectedEvent] = React.useState<Event | null>(null);

  const upcomingEvents = React.useMemo<Event[]>(() => {
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

  const handleEdit = () => {
    if (!selectedEvent) return;
    setDetailOpen(false);
    onEdit(selectedEvent);
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

      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Detalji događaja</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {selectedEvent ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
                  <CalendarIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedEvent.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(selectedEvent.date)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Vreme:</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {formatEventTimeRange(selectedEvent)}
                    </dd>
                  </div>
                  {selectedEvent.description ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                        {selectedEvent.description}
                      </dd>
                    </div>
                  ) : null}
                  {selectedEvent.notes ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500 dark:text-gray-400">Napomene:</dt>
                      <dd className="text-right font-medium text-amber-700 dark:text-amber-400">
                        {selectedEvent.notes}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          ) : null}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Zatvori
            </Button>
            <Button onClick={handleEdit}>Izmeni</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
