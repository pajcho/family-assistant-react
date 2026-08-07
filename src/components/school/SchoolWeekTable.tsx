import { Fragment } from "react";
import { addDays, format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import { DAY_LABELS_SHORT } from "@/utils/activity";
import { periodState } from "@/utils/schoolOverview";
import type { BellSlot, ResolvedSchoolBlock } from "@/utils/schoolTimetable";

/**
 * The week at a glance, indexed BY CLASS rather than by the clock.
 *
 * A proportional day grid (the one Aktivnosti and Kalendar draw) is the right
 * shape for things that start at arbitrary times. School is the opposite: it is
 * a fixed ladder of equal slots, so a row per slot puts Monday's third period
 * next to Friday's and the whole week reads in one pass. The times still show,
 * once, in the left gutter - they come from the child's bell schedule for this
 * week's band, so the same table shifts from 08:00 to 14:00 when their smena
 * flips without a single cell changing.
 */

export type SchoolWeekTableProps = {
  weekStart: string;
  /** How many day columns to draw (>= 5; extended if a class lands on a weekend). */
  dayCount: number;
  /** Bell slots for this child's band, already trimmed to the rows in use. */
  slots: ReadonlyArray<BellSlot>;
  blocks: ReadonlyArray<ResolvedSchoolBlock>;
  /** The child's colour - the faint fill and the left accent on every class. */
  color: string;
  /** 0-6 index of today inside this week, or null when the week is not current. */
  todayIndex: number | null;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  /** Clicking a cell opens the timetable editor on that day. */
  onEditDay: (day: number) => void;
  /** date (YYYY-MM-DD) → raspust label, for the day headers. */
  breakDays: ReadonlyMap<string, string>;
  /** Minutes since midnight, or null when the week is not current. */
  nowMinutes: number | null;
};

export function SchoolWeekTable({
  weekStart,
  dayCount,
  slots,
  blocks,
  color,
  todayIndex,
  selectedDay,
  onSelectDay,
  onEditDay,
  breakDays,
  nowMinutes,
}: SchoolWeekTableProps) {
  const monday = parseISO(weekStart + "T12:00:00");
  const days = Array.from({ length: dayCount }, (_, i) => i);
  const byCell = new Map(blocks.map((b) => [`${b.dayOfWeek}:${b.periodIndex}`, b]));

  // One grid template for the header and every row, so the columns line up
  // without the two halves knowing each other's widths.
  const columns = `5.25rem repeat(${dayCount}, minmax(0, 1fr))`;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <div
            className="grid border-b border-border"
            style={{ gridTemplateColumns: columns }}
            role="row"
          >
            <div className="px-2.5 py-2 text-[11px] font-normal text-muted-foreground">
              čas · vreme
            </div>
            {days.map((day) => {
              const dateISO = format(addDays(monday, day), "yyyy-MM-dd");
              const isToday = day === todayIndex;
              const breakLabel = breakDays.get(dateISO);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={day === selectedDay}
                  className={cn(
                    "border-l border-border px-2.5 py-2 text-left transition-colors",
                    day === selectedDay ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "block text-xs font-bold",
                      isToday ? "text-accent-deep" : "text-foreground",
                    )}
                  >
                    {DAY_LABELS_SHORT[day]}
                  </span>
                  <span className="block text-[10.5px] font-normal text-muted-foreground tabular-nums">
                    {format(addDays(monday, day), "dd.MM.")}
                  </span>
                  {breakLabel ? (
                    <span className="mt-1 block truncate rounded-full bg-warn-soft px-1.5 py-px text-[9.5px] font-semibold text-warn">
                      {breakLabel}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {slots.map((slot) => (
            <Fragment key={slot.periodIndex}>
              <div
                className="grid border-b border-border last:border-b-0"
                style={{ gridTemplateColumns: columns }}
                role="row"
              >
                <div className="px-2.5 py-2">
                  <span className="block text-xs font-semibold tabular-nums">
                    {slot.periodIndex}. čas
                  </span>
                  <span className="block text-[10.5px] font-normal text-muted-foreground tabular-nums">
                    {slot.startTime} - {slot.endTime}
                  </span>
                </div>
                {days.map((day) => {
                  const block = byCell.get(`${day}:${slot.periodIndex}`);
                  const isNow =
                    day === todayIndex && !!block && periodState(block, nowMinutes) === "now";
                  const isPast =
                    day === todayIndex && !!block && periodState(block, nowMinutes) === "past";
                  return (
                    <div
                      key={day}
                      className={cn(
                        "flex border-l border-border p-1.5",
                        day === selectedDay && "bg-muted/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onEditDay(day)}
                        style={
                          block
                            ? {
                                backgroundColor: `color-mix(in srgb, ${color} 10%, var(--card))`,
                                borderLeftColor: color,
                              }
                            : undefined
                        }
                        className={cn(
                          "min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-[filter,background-color]",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          block
                            ? "border border-l-2 border-border hover:brightness-105"
                            : "text-transparent hover:bg-muted",
                          isPast && "opacity-60",
                          isNow && "ring-2 ring-accent",
                        )}
                        aria-label={
                          block
                            ? `${block.subject}, ${DAY_LABELS_SHORT[day]} ${slot.startTime}`
                            : `Dodaj ${slot.periodIndex}. čas, ${DAY_LABELS_SHORT[day]}`
                        }
                        title={
                          block
                            ? `${block.subject}${block.room ? ` · ${block.room}` : ""} · ${slot.startTime}-${slot.endTime}`
                            : undefined
                        }
                      >
                        {block ? (
                          <>
                            <span className="line-clamp-2 text-[11.5px] leading-tight font-semibold text-foreground">
                              {block.subject}
                            </span>
                            {block.room ? (
                              <span className="block truncate text-[10px] font-normal text-muted-foreground">
                                {block.room}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[11px]" aria-hidden="true">
                            ·
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              {slot.bigBreakAfter && slot.periodIndex < slots.length ? (
                <div className="border-b border-border bg-background px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                  veliki odmor
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
