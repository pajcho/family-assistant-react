import { CalendarIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange } from "@/utils/event";

/**
 * Shared event detail popup used by both `DashboardEventCard` (the 14-day
 * card) and `DashboardTodayCard` (the hero "Danas" widget). Each caller
 * owns its `selectedEvent`/`open` state and routes the "Izmeni" button
 * back to its own form dialog through `onEdit`.
 */
export type EventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null;
  onEdit: (event: Event) => void;
};

export function EventDetailDialog({ open, onOpenChange, event, onEdit }: EventDetailDialogProps) {
  const handleEdit = () => {
    if (!event) return;
    onOpenChange(false);
    onEdit(event);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Detalji događaja</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {event ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
                <CalendarIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {event.name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {formatDate(event.date)}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Vreme:</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {formatEventTimeRange(event)}
                  </dd>
                </div>
                {event.description ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500 dark:text-gray-400">Opis:</dt>
                    <dd className="text-right font-medium text-gray-900 dark:text-gray-100">
                      {event.description}
                    </dd>
                  </div>
                ) : null}
                {event.notes ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500 dark:text-gray-400">Napomene:</dt>
                    <dd className="text-right font-medium text-amber-700 dark:text-amber-400">
                      {event.notes}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        ) : null}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
          <Button onClick={handleEdit}>Izmeni</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
