import {
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange, isEventEnded } from "@/utils/event";

export type EventListItemProps = {
  event: Event;
  /** Assignees of this event (from the participants query). */
  personIds: string[];
  /** Drop the date from the subtitle — the timeline day header already says it. */
  hideDate?: boolean;
  onEdit: (event: Event) => void;
  /** Quick date-only move. */
  onReschedule: (event: Event) => void;
  /** Toggle the soft-cancel state (otkaži ↔ vrati). */
  onToggleCancel: (event: Event) => void;
  onDelete: (event: Event) => void;
};

/**
 * One event row on the /events management page.
 *
 * Shows name + status (Otkazano / Završeno) + "date · time" + optional
 * description / notes / assignee badges. All actions live in a single kebab
 * — with four of them (Izmeni, Pomeri, Otkaži/Vrati, Obriši) an inline row
 * would crowd the layout. Canceled events still render here (dimmed) so they
 * can be restored; they're filtered out of the dashboard instead.
 */
export function EventListItem({
  event,
  personIds,
  hideDate = false,
  onEdit,
  onReschedule,
  onToggleCancel,
  onDelete,
}: EventListItemProps) {
  const isCanceled = !!event.canceled_at;
  const isEnded = !isCanceled && isEventEnded(event);

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "font-medium text-gray-900 dark:text-gray-100",
              isCanceled && "text-gray-500 line-through dark:text-gray-500",
            )}
          >
            {event.name}
          </p>
          {isCanceled ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">
              Otkazano
            </span>
          ) : isEnded ? (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-600 dark:text-gray-400">
              Završeno
            </span>
          ) : null}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {hideDate
            ? formatEventTimeRange(event)
            : `${formatDate(event.date)} · ${formatEventTimeRange(event)}`}
        </p>
        {event.description ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{event.description}</p>
        ) : null}
        {event.notes ? (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{event.notes}</p>
        ) : null}
        {isCanceled && event.cancel_reason ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className="text-gray-400 dark:text-gray-500">Razlog otkazivanja:</span>{" "}
            {event.cancel_reason}
          </p>
        ) : null}
        {event.reschedule_reason ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <span className="text-gray-400 dark:text-gray-500">Razlog pomeranja:</span>{" "}
            {event.reschedule_reason}
          </p>
        ) : null}
        {personIds.length > 0 ? <MemberBadges personIds={personIds} className="mt-2" /> : null}
      </div>

      <div className="flex shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Akcije">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(event)}>
              <PencilIcon className="h-4 w-4" />
              Izmeni
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onReschedule(event)}>
              <CalendarDaysIcon className="h-4 w-4" />
              Pomeri
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleCancel(event)}>
              {isCanceled ? (
                <>
                  <ArrowUturnLeftIcon className="h-4 w-4" />
                  Vrati
                </>
              ) : (
                <>
                  <XCircleIcon className="h-4 w-4" />
                  Otkaži
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(event)}>
              <TrashIcon className="h-4 w-4" />
              Obriši
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
