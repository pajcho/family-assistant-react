import { format } from "date-fns";
import { CalendarIcon, GiftIcon } from "@heroicons/react/24/outline";

import {
  ItemCard,
  ItemMain,
  ItemMeta,
  ItemSide,
  ItemTile,
  ItemTime,
  ItemTitle,
} from "@/components/common/ItemCard";
import { MemberBadges } from "@/components/common/MemberBadges";
import { Pill, type PillTone } from "@/components/common/Pill";
import { cn } from "@/lib/cn";
import type { Event } from "@/types/database";
import { formatDate } from "@/utils/date";
import {
  eventDurationLabel,
  formatEventDateRange,
  formatEventTimeRange,
  isEventEnded,
  isEventOngoing,
  isMultiDayEvent,
} from "@/utils/event";

/**
 * Tappable row in the /events timeline - the shared `.kcard`: type tile, name
 * + state pill, one meta line, and the time (or span length) on the right. No
 * inline actions; the tap opens `EventDetailDialog`, which carries them all.
 * `showDate` prefixes the meta with the date (flat search results span months;
 * grouped rows get the date from their day header).
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
  const isMulti = isMultiDayEvent(event);
  const ongoing = !dimmed && isEventOngoing(event, format(new Date(), "yyyy-MM-dd"));
  const chip: { label: string; tone: PillTone } | null = isCanceled
    ? { label: "Otkazano", tone: "neg" }
    : isEnded
      ? { label: "Završeno", tone: "muted" }
      : ongoing
        ? { label: "U toku", tone: "pos" }
        : null;

  // Multi-day rows swap the right-hand time for the span length ("3 dana"),
  // so the schedule moves into the meta line: the full dated time range when
  // timed (it carries its own short dates), otherwise the date range.
  const timeRange = formatEventTimeRange(event);
  const multiMeta = isMulti
    ? timeRange === "Ceo dan"
      ? formatEventDateRange(event)
      : timeRange
    : null;
  const meta = [
    isMulti ? multiMeta : showDate ? formatDate(event.date) : null,
    event.description?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ItemCard onClick={() => onSelect(event)} dimmed={dimmed}>
      {/* A celebration linked to a birthday reads as a gift, not a generic
          calendar entry - it is the one event kind with its own origin. */}
      <ItemTile
        icon={event.birthday_id ? GiftIcon : CalendarIcon}
        tone={event.birthday_id ? "accent" : "info"}
      />
      <ItemMain>
        <ItemTitle>
          <span className={cn("min-w-0 truncate", isCanceled && "line-through")}>{event.name}</span>
          {chip ? <Pill tone={chip.tone}>{chip.label}</Pill> : null}
        </ItemTitle>
        {meta || personIds.length > 0 ? (
          <ItemMeta>
            {meta ? <span className="min-w-0 truncate">{meta}</span> : null}
            {personIds.length > 0 ? <MemberBadges personIds={personIds} size="xs" /> : null}
          </ItemMeta>
        ) : null}
      </ItemMain>
      <ItemSide>
        <ItemTime>{isMulti ? eventDurationLabel(event) : timeRange}</ItemTime>
      </ItemSide>
    </ItemCard>
  );
}
