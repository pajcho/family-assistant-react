import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import { formatEventTimeRange, isEventEnded } from "@/utils/event";

/**
 * Compact tappable row in the /events timeline - the PaymentTimelineRow
 * shape: name + time on the first line, meta + state chip on the second. No
 * inline actions; the tap opens `EventDetailDialog`, which carries them all.
 * `showDate` prefixes the meta with the date (flat search results span
 * months; grouped rows get the date from their day header).
 */
export function EventTimelineRow({
  event,
  personIds,
  showDate = false,
  onSelect,
}: {
  event: Event;
  personIds: string[];
  showDate?: boolean;
  onSelect: (event: Event) => void;
}) {
  const isCanceled = !!event.canceled_at;
  const isEnded = !isCanceled && isEventEnded(event);
  const dimmed = isCanceled || isEnded;
  const chip = isCanceled
    ? {
        label: "Otkazano",
        className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      }
    : isEnded
      ? {
          label: "Završeno",
          className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
        }
      : null;

  const meta = [showDate ? formatDate(event.date) : null, event.description?.trim() || null]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn(
        "block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/70",
        dimmed && "opacity-60",
      )}
    >
      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-gray-100",
            isCanceled && "text-gray-500 line-through dark:text-gray-500",
          )}
        >
          {event.name}
        </span>
        <span className="shrink-0 text-sm tabular-nums text-gray-500 dark:text-gray-400">
          {formatEventTimeRange(event)}
        </span>
      </span>
      {meta || personIds.length > 0 || chip ? (
        <span className="mt-0.5 flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {meta ? <span className="truncate">{meta}</span> : null}
            {personIds.length > 0 ? (
              <span className="shrink-0">
                <MemberBadges personIds={personIds} size="xs" />
              </span>
            ) : null}
          </span>
          {chip ? (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                chip.className,
              )}
            >
              {chip.label}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
