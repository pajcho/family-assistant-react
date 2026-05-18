import { EllipsisVerticalIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange, isEventEnded } from "@/utils/event";

export type EventListItemProps = {
  event: Event;
  onEdit: (event: Event) => void;
  onDelete: (event: Event) => void;
};

/**
 * Direct port of `components/events/EventListItem.vue`.
 *
 * Layout:
 *   • Left: name + ("Završeno" pill if ended) + "date · time" + optional
 *     description + optional notes (amber for emphasis).
 *   • Right (responsive actions): kebab dropdown on mobile, inline
 *     "Izmeni" / "Obriši" buttons on `sm:` and up — matches the
 *     visual-pattern split from MIGRATION_PLAN.md §1.a.
 *
 * Card-style framing (rounded border + ended-state opacity) lives on the
 * parent `<li>` so the list page can dim the whole row; this component
 * just renders the row's contents.
 */
export function EventListItem({ event, onEdit, onDelete }: EventListItemProps) {
  const isEnded = isEventEnded(event);

  return (
    <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-gray-900 dark:text-gray-100">{event.name}</p>
          {isEnded ? (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-600 dark:text-gray-400">
              Završeno
            </span>
          ) : null}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {formatDate(event.date)} · {formatEventTimeRange(event)}
        </p>
        {event.description ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{event.description}</p>
        ) : null}
        {event.notes ? (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{event.notes}</p>
        ) : null}
      </div>

      {/* Mobile: single kebab dropdown */}
      <div className="flex shrink-0 sm:hidden">
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
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(event)}>
              <TrashIcon className="h-4 w-4" />
              Obriši
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop (sm+): inline buttons */}
      <div className="hidden shrink-0 gap-2 sm:flex">
        <Button variant="outline" size="sm" onClick={() => onEdit(event)}>
          <PencilIcon className="mr-1 h-4 w-4" />
          Izmeni
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(event)}>
          <TrashIcon className="mr-1 h-4 w-4" />
          Obriši
        </Button>
      </div>
    </div>
  );
}
