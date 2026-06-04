import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { BanknotesIcon, CakeIcon, CalendarIcon } from "@heroicons/react/24/outline";

import { MemberBadges } from "@/components/common/MemberBadges";
import { cn } from "@/lib/cn";
import { type AgendaItem, agendaItemKey } from "@/hooks/useAgenda";
import { fallbackColorForProfile, normalizeTime, timeToMinutes } from "@/utils/activity";
import { getDisplayName } from "@/utils/identity";
import { assignLanes, type Laned } from "@/utils/weekGridLayout";

/**
 * Single-day calendar column for the "Danas" tab — the calendar counterpart of
 * the today list. An "All day / Ceo dan" row on top (payments, birthdays,
 * all-day events), then an hourly grid with timed activities + events
 * absolutely positioned by start/end and laid into side-by-side lanes on
 * overlap (shared `assignLanes`), with a red "now" line. Tapping a block opens
 * the same detail dialog the list rows do.
 *
 * The visible hour range fits the day's timed items (±1h, default 7–21 when
 * empty), mirroring the activities `WeekGrid`.
 */
const SLOT_HEIGHT_PX = 40;
const SLOT_MINUTES = 30;
const DEFAULT_START_MIN = 7 * 60;
const DEFAULT_END_MIN = 21 * 60;
const GRID_TOP_PADDING_PX = 12;
const GRID_BOTTOM_PADDING_PX = 12;
const MIN_BLOCK_HEIGHT_PX = 24;
/** Synthetic duration for a timed event with no end time. */
const DEFAULT_EVENT_MINUTES = 60;
/** blue-500 — matches the event row icon / list accent. */
const EVENT_COLOR = "#3b82f6";

type TimedEntry = { startTime: string; endTime: string; item: AgendaItem };
type PositionedEntry = Laned<TimedEntry> & { topPx: number; heightPx: number };

function isAllDayItem(item: AgendaItem): boolean {
  switch (item.kind) {
    case "activity":
      return false;
    case "event":
      return item.isAllDay;
    case "payment":
    case "birthday":
      return true;
  }
}

function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, min));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Start/end for a timed item, or null if it belongs in the all-day row. */
function timedRange(item: AgendaItem): { startTime: string; endTime: string } | null {
  if (item.kind === "activity") {
    return { startTime: item.block.startTime, endTime: item.block.endTime };
  }
  if (item.kind === "event" && !item.isAllDay && item.event.start_time) {
    const startTime = normalizeTime(item.event.start_time);
    const endTime = item.event.end_time
      ? normalizeTime(item.event.end_time)
      : minutesToTime(timeToMinutes(startTime) + DEFAULT_EVENT_MINUTES);
    return { startTime, endTime };
  }
  return null;
}

function computeRange(entries: ReadonlyArray<TimedEntry>): { startMin: number; endMin: number } {
  if (entries.length === 0) return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };
  let earliest = Infinity;
  let latest = -Infinity;
  for (const e of entries) {
    earliest = Math.min(earliest, timeToMinutes(e.startTime));
    latest = Math.max(latest, timeToMinutes(e.endTime));
  }
  return {
    startMin: Math.floor(Math.max(0, earliest - 60) / SLOT_MINUTES) * SLOT_MINUTES,
    endMin: Math.ceil(Math.min(24 * 60, latest + 60) / SLOT_MINUTES) * SLOT_MINUTES,
  };
}

export function AgendaDayCalendar({
  items,
  onSelect,
}: {
  items: AgendaItem[];
  onSelect: (item: AgendaItem) => void;
}) {
  // Tick every minute so the "now" line tracks the clock; first tick aligned to
  // the minute boundary (same approach as the activities WeekGrid).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(
      () => {
        setNow(new Date());
        intervalId = setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const { allDayItems, timedEntries } = useMemo(() => {
    const allDay: AgendaItem[] = [];
    const timed: TimedEntry[] = [];
    for (const item of items) {
      if (isAllDayItem(item)) {
        allDay.push(item);
        continue;
      }
      const range = timedRange(item);
      if (range) timed.push({ ...range, item });
      else allDay.push(item);
    }
    return { allDayItems: allDay, timedEntries: timed };
  }, [items]);

  const { startMin, endMin } = useMemo(() => computeRange(timedEntries), [timedEntries]);
  const slotCount = (endMin - startMin) / SLOT_MINUTES;
  const totalHeightPx = slotCount * SLOT_HEIGHT_PX + GRID_TOP_PADDING_PX + GRID_BOTTOM_PADDING_PX;

  const positioned = useMemo<PositionedEntry[]>(
    () =>
      assignLanes(timedEntries).map((p) => ({
        ...p,
        topPx:
          GRID_TOP_PADDING_PX +
          ((timeToMinutes(p.startTime) - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
        heightPx: Math.max(
          ((timeToMinutes(p.endTime) - timeToMinutes(p.startTime)) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
          MIN_BLOCK_HEIGHT_PX,
        ),
      })),
    [timedEntries, startMin],
  );

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowInViewport = nowMin >= startMin && nowMin <= endMin;
  const nowTopPx = GRID_TOP_PADDING_PX + ((nowMin - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX;

  const hourLabels: { topPx: number; label: string }[] = [];
  for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) {
    hourLabels.push({
      topPx: GRID_TOP_PADDING_PX + ((h * 60 - startMin) / SLOT_MINUTES) * SLOT_HEIGHT_PX,
      label: `${String(h).padStart(2, "0")}:00`,
    });
  }

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

      <div className="grid grid-cols-[56px_1fr]" style={{ height: `${totalHeightPx}px` }}>
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

function TimedBlock({
  block,
  nowMin,
  onClick,
}: {
  block: PositionedEntry;
  nowMin: number;
  onClick: () => void;
}) {
  const { item } = block;
  const widthPct = (block.laneSpan / block.totalLanes) * 100;
  const leftPct = ((block.lane - 1) / block.totalLanes) * 100;
  const isPast = timeToMinutes(block.endTime) <= nowMin;

  let color: string;
  let label: string;
  if (item.kind === "activity") {
    color = item.person?.color ?? fallbackColorForProfile(item.block.personId);
    const personName = item.person
      ? getDisplayName({
          firstName: item.person.first_name,
          lastName: item.person.last_name,
          email: null,
        }) || "Bez imena"
      : "—";
    label = `${personName} · ${item.activity?.name ?? "Aktivnost"}`;
  } else {
    // Timed event.
    color = EVENT_COLOR;
    label = item.kind === "event" ? item.event.name : "";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        top: `${block.topPx}px`,
        height: `${block.heightPx}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: `${color}1F`,
        borderLeftColor: color,
      }}
      className={cn(
        "absolute overflow-hidden rounded-md border border-l-4 border-transparent px-1.5 py-0.5 text-left",
        "hover:brightness-110 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
        "transition-[filter]",
        isPast && "opacity-60",
      )}
    >
      <div className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
        {block.startTime}–{block.endTime}
      </div>
      <div className="truncate text-[11px] font-medium text-gray-900 dark:text-gray-100">
        {label}
      </div>
    </button>
  );
}

function AllDayChip({ item, onClick }: { item: AgendaItem; onClick: () => void }) {
  const base =
    "inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60";

  if (item.kind === "payment") {
    const amount = new Intl.NumberFormat("sr-Latn", { maximumFractionDigits: 0 }).format(
      item.payment.amount,
    );
    return (
      <button type="button" onClick={onClick} className={base}>
        <BanknotesIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
        <span className="truncate font-medium text-gray-900 dark:text-gray-100">
          {item.payment.name}
        </span>
        <span className="shrink-0 text-gray-500 dark:text-gray-400">{amount} RSD</span>
        {item.personIds.length > 0 ? <MemberBadges personIds={item.personIds} size="xs" /> : null}
      </button>
    );
  }

  if (item.kind === "birthday") {
    return (
      <button type="button" onClick={onClick} className={base}>
        <CakeIcon className="size-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
        <span className="truncate font-medium text-gray-900 dark:text-gray-100">
          {item.birthday.name}
        </span>
      </button>
    );
  }

  // All-day event.
  return (
    <button type="button" onClick={onClick} className={base}>
      <CalendarIcon className="size-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
      <span className="truncate font-medium text-gray-900 dark:text-gray-100">
        {item.kind === "event" ? item.event.name : ""}
      </span>
      {item.kind === "event" && item.personIds.length > 0 ? (
        <MemberBadges personIds={item.personIds} size="xs" />
      ) : null}
    </button>
  );
}
