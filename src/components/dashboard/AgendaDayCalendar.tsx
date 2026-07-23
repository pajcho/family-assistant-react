import { useMemo } from "react";
import { format } from "date-fns";

import {
  AllDayChip,
  buildHourLabels,
  computeRange,
  expandRangeToNow,
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
 * Single-day calendar column for the "Danas" tab - the calendar counterpart of
 * the today list. An "All day / Ceo dan" row on top (payments, birthdays,
 * all-day events), then an hourly grid with timed activities + events laid into
 * side-by-side lanes on overlap and a red "now" line. Grows to its full height -
 * the page scrolls, the calendar never does (matching the weekly calendar). The
 * axis always includes "now", so the red line sits near the top and is visible
 * on open without scrolling. Tapping a block opens the same detail dialog the
 * list rows do. Layout math is shared via `agendaCalendarShared`.
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
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Fit the axis to today's items, then keep "now" inside it. With no timed items
  // (a common "today"), anchor a compact window at "now" instead of the 07-21
  // default so the red line sits near the top on open - the page never has to be
  // scrolled to find the current time, and the overdue list above stays in view.
  const { startMin, endMin } = useMemo(() => {
    const base =
      timedEntries.length > 0
        ? computeRange(timedEntries)
        : { startMin: nowMin - 60, endMin: nowMin + 8 * 60 };
    return expandRangeToNow(base, nowMin);
  }, [timedEntries, nowMin]);
  const positioned = useMemo(
    () => positionEntries(timedEntries, startMin),
    [timedEntries, startMin],
  );

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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1.5 border-l border-gray-200 p-2 dark:border-gray-700">
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
        {/* Time gutter - hour labels + the "now" timestamp. */}
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
          <div
            style={{ top: `${nowTopPx}px` }}
            className="absolute right-1 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white"
          >
            {format(now, "HH:mm")}
          </div>
        </div>

        {/* Day column - gridlines, positioned blocks, now line. */}
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
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
            style={{ top: `${nowTopPx}px` }}
          >
            <span className="absolute top-0 left-0 size-2.5 -translate-y-1/2 rounded-full bg-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
