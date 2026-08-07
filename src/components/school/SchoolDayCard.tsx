import { Fragment } from "react";
import { addDays, format, parseISO } from "date-fns";
import { PencilSquareIcon } from "@heroicons/react/24/outline";

import { IconButton } from "@/components/common/IconButton";
import { Pill } from "@/components/common/Pill";
import { cn } from "@/lib/cn";
import { DAY_LABELS_FULL, DAY_LABELS_SHORT } from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { periodState, schoolDaySummary } from "@/utils/schoolOverview";
import type { ResolvedSchoolBlock } from "@/utils/schoolTimetable";

/**
 * One day's classes, with the day picker on top.
 *
 * This is the whole timetable on a phone (where a five-column table cannot
 * breathe) and the "what is happening right now" card in the desktop rail. It
 * opens on today, so the first thing on screen is the answer to the question
 * that gets asked every morning; the chips are there for the other four days.
 */

export type SchoolDayCardProps = {
  weekStart: string;
  dayCount: number;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  /** Every block of the week - the card picks its own day out. */
  blocks: ReadonlyArray<ResolvedSchoolBlock>;
  /** 1-based slot the big break follows, from the child's bell schedule. */
  bigBreakAfter: number;
  /** 0-6 index of today inside this week, or null when the week is not current. */
  todayIndex: number | null;
  /** Minutes since midnight, or null when the week is not current. */
  nowMinutes: number | null;
  /** Raspust label for the selected day, when there is one. */
  breakLabel?: string;
  onEdit: () => void;
};

export function SchoolDayCard({
  weekStart,
  dayCount,
  selectedDay,
  onSelectDay,
  blocks,
  bigBreakAfter,
  todayIndex,
  nowMinutes,
  breakLabel,
  onEdit,
}: SchoolDayCardProps) {
  const monday = parseISO(weekStart + "T12:00:00");
  const days = Array.from({ length: dayCount }, (_, i) => i);
  const dayBlocks = blocks.filter((b) => b.dayOfWeek === selectedDay);
  const isToday = selectedDay === todayIndex;
  const dayNow = isToday ? nowMinutes : null;

  const summary = schoolDaySummary(dayBlocks, dayNow);
  const dateLabel = format(addDays(monday, selectedDay), "d. MMMM", { locale: srLocale });
  // A raspust is the reason there are no classes, so it replaces the summary
  // rather than sitting next to a bare "nema časova" that explains nothing.
  const subtitle = breakLabel ? `${dateLabel} · ${breakLabel}` : `${dateLabel} · ${summary.label}`;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-start gap-2 px-[13px] pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">
            {isToday ? "Danas" : DAY_LABELS_FULL[selectedDay]}
          </h2>
          <p className="mt-px truncate text-[11.5px] font-normal text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <IconButton
          icon={PencilSquareIcon}
          size="sm"
          aria-label="Uredi raspored za ovaj dan"
          onClick={onEdit}
        />
      </div>

      <div className="flex gap-1 px-[13px] pt-2.5 pb-1">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => onSelectDay(day)}
            aria-pressed={day === selectedDay}
            className={cn(
              "flex-1 rounded-md border px-1 py-1.5 text-center text-xs font-semibold transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              day === selectedDay
                ? "border-accent bg-accent-soft text-accent-deep"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="block">{DAY_LABELS_SHORT[day]}</span>
            <span className="block text-[9.5px] font-normal tabular-nums">
              {format(addDays(monday, day), "dd.")}
            </span>
          </button>
        ))}
      </div>

      {dayBlocks.length === 0 ? (
        <p className="px-[13px] pt-2 pb-3.5 text-[13px] font-normal text-muted-foreground">
          {breakLabel ? "Raspust - nema časova." : "Za ovaj dan nema upisanih časova."}
        </p>
      ) : (
        <ol className="pt-1.5 pb-1">
          {dayBlocks.map((block, index) => {
            const state = periodState(block, dayNow);
            return (
              <Fragment key={block.entryId}>
                <li
                  className={cn(
                    "flex items-center gap-2.5 px-[13px] py-2",
                    state === "past" && "opacity-55",
                    state === "now" && "bg-accent-soft",
                  )}
                >
                  <span className="w-4 shrink-0 text-right text-[11.5px] font-semibold text-muted-foreground tabular-nums">
                    {block.periodIndex}.
                  </span>
                  <span className="w-[5.75rem] shrink-0 text-[11.5px] font-normal text-muted-foreground tabular-nums">
                    {block.startTime} - {block.endTime}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13.5px] font-semibold",
                      state === "now" ? "text-accent-deep" : "text-foreground",
                    )}
                  >
                    {block.subject}
                  </span>
                  {block.room ? (
                    <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                      {block.room}
                    </span>
                  ) : null}
                  {state === "now" ? <Pill>u toku</Pill> : null}
                </li>
                {block.periodIndex === bigBreakAfter && index < dayBlocks.length - 1 ? (
                  <li
                    aria-hidden="true"
                    className="flex items-center gap-2 px-[13px] py-1 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    <span className="h-px flex-1 bg-border" />
                    veliki odmor
                    <span className="h-px flex-1 bg-border" />
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}
