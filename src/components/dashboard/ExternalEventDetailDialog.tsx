import { GlobeAltIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { ExternalCalendarEvent } from "@/types/database";
import { normalizeTime } from "@/utils/activity";
import { formatDate } from "@/utils/date";

/**
 * Read-only detail popup for a mirrored Google event, opened from the agenda
 * (via `useAgendaDetails`). Mirrored events are never editable in the app — the
 * only action is "Otvori u Google" (the event's `htmlLink`). Matches the visual
 * frame of EventDetailDialog but with the sky "Google" accent and no edit/cancel.
 */
export type ExternalEventDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ExternalCalendarEvent | null;
};

function timeRangeLabel(event: ExternalCalendarEvent): string {
  if (event.is_all_day || !event.start_time) return "Ceo dan";
  const start = normalizeTime(event.start_time);
  const end = event.end_time ? normalizeTime(event.end_time) : null;
  return end ? `${start}–${end}` : start;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-right font-medium text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

export function ExternalEventDetailDialog({
  open,
  onOpenChange,
  event,
}: ExternalEventDetailDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Google događaj</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {event ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50">
                <GlobeAltIcon className="h-6 w-6 text-sky-600 dark:text-sky-400" />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {event.title ?? "(bez naslova)"}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {formatDate(event.local_date)}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
              <dl className="space-y-2 text-sm">
                <DetailRow label="Vreme:" value={timeRangeLabel(event)} />
                {event.location ? <DetailRow label="Lokacija:" value={event.location} /> : null}
                {event.description ? <DetailRow label="Opis:" value={event.description} /> : null}
                {event.event_type === "fromGmail" ? (
                  <DetailRow label="Izvor:" value="Automatski iz Gmaila" />
                ) : null}
              </dl>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Događaj iz tvog Google kalendara — samo za prikaz. Izmene radi u Google-u.
            </p>
          </div>
        ) : null}

        <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          {event?.html_link ? (
            <Button variant="outline" asChild>
              <a href={event.html_link} target="_blank" rel="noopener noreferrer">
                Otvori u Google
              </a>
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Zatvori</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
