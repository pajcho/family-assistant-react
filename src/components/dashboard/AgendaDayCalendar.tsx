import { useMemo } from "react";
import { format } from "date-fns";

import {
  AllDayChip,
  buildHourLabels,
  computeRange,
  GRID_TOP_PADDING_PX,
  gridHeightPx,
  positionEntries,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  splitAgendaItems,
  TimedBlock,
  useMinuteTick,
} from "@/components/dashboard/agendaCalendarShared";
import { type AgendaItem, agendaItemKey } from "@/hooks/useAgenda";

/**
 * Single-day calendar column for the "Danas" tab — the calendar counterpart of
 * the today list. An "All day / Ceo dan" row on top (payments, birthdays,
 * all-day events), then an hourly grid with timed activities + events laid into
 * side-by-side lanes on overlap and a red "now" line. Tapping a block opens the
 * same detail dialog the list rows do. Layout math is shared with the weekly
 * calendar via `agendaCalendarShared`.
 */
export function AgendaDayCalendar({
  items,
  onSelect,
}: {
  items: AgendaItem[];
  onSelect: (item: AgendaItem) => void;
}) {
  const now = useMinuteTick();

  const { allDayItems, timedEntries } = useMemo(() => splitAgendaItems(items), [items]);
  const { startMin, endMin } = useMemo(() => computeRange(timedEntries), [timedEntries]);
  const positioned = useMemo(
    () => positionEntries(timedEntries, startMin),
    [timedEntries, startMin],
  );

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowInViewport = nowMin >= startMin && nowMin <= endMin;
  const nowTopPx = GRID_TOP_PADDING_PX + ((nowMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const hourLabels = buildHourLabels(startMin, endMin);
  const todayStr = format(now, "yyyy-MM-dd");

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {allDayItems.length > 0 ? (
        <div className="grid grid-cols-[56px_1fr] border-b border-gray-200 dark:border-gray-700">
          <div className="px-2 py-2 text-[10px] tracking-wide text-muted-foreground uppercase">
            Ceo dan
          </div>
          <div className="flex flex-wrap gap-1.5 border-l border-gray-200 p-2 dark:border-gray-700">
            {allDayItems.map((item) => (
              <AllDayChip key={agendaItemKey(item)} item={item} onClick={() => onSelect(item)} />
            ))}
          </div>
        </div>
      ) : null}

      <div
        className="grid grid-cols-[56px_1fr]"
        style={{ height: `${gridHeightPx(startMin, endMin)}px` }}
      >
        {/* Time gutter — hour labels + the "now" timestamp. */}
        <div className="relative">
          {hourLabels.map((hl) => (
            <div
              key={hl.label}
              style={{ top: `${hl.topPx}px` }}
              className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
            >
              {hl.label}
            </div>
          ))}
          {nowInViewport ? (
            <div
              style={{ top: `${nowTopPx}px` }}
              className="absolute right-1 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white"
            >
              {format(now, "HH:mm")}
            </div>
          ) : null}
        </div>

        {/* Day column — gridlines, positioned blocks, now line. */}
        <div className="relative border-l border-gray-200 dark:border-gray-700">
          {hourLabels.map((hl) => (
            <div
              key={hl.label}
              style={{ top: `${hl.topPx}px` }}
              className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-700/60"
            />
          ))}
          {positioned.map((block) => (
            <TimedBlock
              key={agendaItemKey(block.item)}
              block={block}
              todayStr={todayStr}
              nowMin={nowMin}
              onClick={() => onSelect(block.item)}
            />
          ))}
          {nowInViewport ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
              style={{ top: `${nowTopPx}px` }}
            >
              <span className="absolute top-0 left-0 size-2.5 -translate-y-1/2 rounded-full bg-red-500" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
