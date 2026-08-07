import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

/**
 * The one week-timetable FRAME - shared by the calendar's NEDELJA view and the
 * /activities week grid, so the column widths, the sticky mechanics and the
 * chrome around a "7 day columns over a time axis" screen live in exactly one
 * place. The owners keep everything data-shaped: which blocks exist, how they
 * lane, what tapping one does - the shell only draws the stage.
 *
 * Structure, outermost in:
 *   - the scroll box: horizontal-only by default (the PAGE scrolls
 *     vertically), or both axes in `pane` mode (desktop Nedelja fills the
 *     body, so its scrollport owns the vertical axis and the day header row
 *     actually pins);
 *   - sticky day-header row (z-20) whose corner cell is ALSO sticky-left
 *     (z-30, opaque): day headers scrolling sideways slide UNDER the corner
 *     and never across the hour gutter;
 *   - optional all-day row (its label cell sticky-left too);
 *   - the time grid: sticky-left hour gutter (z-10) with the hour labels and
 *     the red "now" badge, then 7 relative day columns with hour gridlines,
 *     the owner's blocks, and the "now" line in today's column.
 *
 * Columns are fixed {@link WEEK_GRID_COL_PX} below `sm` (the grid scrolls
 * sideways; wide enough for side-by-side lanes), and share the width from
 * `sm` up. Squeezing all seven onto a phone was tried and reverted: at ~46px
 * every block is an unreadable sliver.
 */

/** Width of the sticky hour gutter - horizontal scroll aims past it. */
export const WEEK_GRID_GUTTER_PX = 56;

/** Fixed day-column width below `sm` - the unit of horizontal scroll math. */
export const WEEK_GRID_COL_PX = 260;

const GRID_COLS = "grid-cols-[56px_repeat(7,260px)] sm:grid-cols-[56px_repeat(7,minmax(0,1fr))]";

export type WeekGridDay = {
  /** yyyy-MM-dd. */
  date: string;
  /** "Pon". */
  label: string;
  /** "3.8.". */
  dayNum: string;
};

export type WeekTimeGridShellProps = {
  /** The 7 rendered days, Monday first. */
  days: ReadonlyArray<WeekGridDay>;
  todayStr: string;
  /** One entry per full hour on the axis, in block coordinates. */
  hourLabels: ReadonlyArray<{ topPx: number; label: string }>;
  /** Time-grid height (axis span + paddings) - the owner's axis math. */
  totalHeightPx: number;
  /** Red "now" line in today's column + minute badge in the gutter. */
  now?: { topPx: number; label: string } | null;
  /**
   * One-line note under a day's number, keyed by date. Today's only use is the
   * raspust label: an empty school column needs a reason, or it reads as a bug.
   */
  notesByDate?: ReadonlyMap<string, string>;
  /** Optional "Ceo dan" row between the day headers and the time grid. */
  allDayRow?: {
    label: string;
    /** Cell CONTENT for one day - the cell box itself is the shell's. */
    renderCell: (day: WeekGridDay, index: number) => ReactNode;
  } | null;
  /** Positioned blocks for one day - the column div (and gridlines) are the shell's. */
  renderColumn: (day: WeekGridDay, index: number) => ReactNode;
  /** The scroll box - owners attach their auto-scroll / scroll-spy here. */
  scrollRef?: Ref<HTMLDivElement>;
  /** Fill the parent and own BOTH scroll axes (desktop Nedelja's fillBody pane). */
  pane?: boolean;
};

export function WeekTimeGridShell({
  days,
  todayStr,
  hourLabels,
  totalHeightPx,
  now = null,
  notesByDate,
  allDayRow = null,
  renderColumn,
  scrollRef,
  pane = false,
}: WeekTimeGridShellProps) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        "rounded-lg border border-border bg-card shadow-card",
        // Horizontal-only mode contains ONLY the x axis: a plain
        // `overscroll-contain` swallows vertical drags too, and the page
        // could not be scrolled by dragging over the grid.
        pane ? "h-full overflow-auto overscroll-contain" : "overflow-x-auto overscroll-x-contain",
      )}
    >
      {/* `min-w-max` sizes this wrapper to its content instead of to the
          scrollport. Without it the inner grid overflows a wrapper that is
          only viewport-wide, and sticky-left breaks: the sticky element's
          containing block would end short of the scroll edges.

          It has to STOP at `sm`, where the columns become `1fr`: inside a
          max-content wrapper a fraction resolves to the column's own
          max-content width, so the grid grew past the viewport and the
          desktop week scrolled sideways for no reason. */}
      <div className="min-w-max sm:min-w-0">
        {/* Day headers - sticky on top (pins only when this box scrolls
            vertically, i.e. in pane mode). */}
        <div className={cn("sticky top-0 z-20 grid border-b border-border bg-card", GRID_COLS)}>
          {/* The top-left corner outranks both (z-30): it is over the gutter
              AND over the day columns sliding under the header. */}
          <div className="sticky left-0 z-30 bg-card" />
          {days.map((day, i) => (
            <div
              key={day.date}
              data-day-index={i}
              className={cn(
                "border-l border-border px-2 py-1.5 text-center",
                day.date === todayStr && "bg-accent-soft",
              )}
            >
              <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                {day.label}
              </div>
              <div
                className={cn(
                  "text-[12.5px] font-bold tabular-nums",
                  day.date === todayStr ? "text-accent-deep" : "text-foreground",
                )}
              >
                {day.dayNum}
              </div>
              {notesByDate?.get(day.date) ? (
                <div
                  title={notesByDate.get(day.date)}
                  className="mx-auto mt-0.5 max-w-full truncate rounded-full bg-muted px-1.5 text-[9.5px] font-normal text-muted-foreground"
                >
                  {notesByDate.get(day.date)}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* All-day row - one cell per day; only rendered when asked for. */}
        {allDayRow ? (
          <div className={cn("grid border-b border-border", GRID_COLS)}>
            <div className="sticky left-0 z-10 bg-card px-1.5 py-1.5 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
              {allDayRow.label}
            </div>
            {days.map((day, i) => (
              <div
                key={day.date}
                className={cn(
                  "flex min-w-0 flex-col gap-1 overflow-hidden border-l border-border p-1",
                  day.date === todayStr && "bg-accent-soft/50",
                )}
              >
                {allDayRow.renderCell(day, i)}
              </div>
            ))}
          </div>
        ) : null}

        {/* Time grid. */}
        <div className={cn("grid", GRID_COLS)} style={{ height: `${totalHeightPx}px` }}>
          {/* Sticky-left hour gutter. `sticky` is also the positioning context
              for the absolute labels - no extra `relative` needed. */}
          <div className="sticky left-0 z-10 bg-card">
            {hourLabels.map((hl) => (
              <div
                key={hl.label}
                style={{ top: `${hl.topPx}px` }}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-muted-foreground"
              >
                {hl.label}
              </div>
            ))}
            {now ? (
              <div
                style={{ top: `${now.topPx}px` }}
                className="absolute right-1 -translate-y-1/2 rounded-full bg-neg px-1 text-[9.5px] font-bold tabular-nums text-white"
              >
                {now.label}
              </div>
            ) : null}
          </div>

          {/* 7 day columns. */}
          {days.map((day, i) => (
            <div
              key={day.date}
              className={cn(
                "relative border-l border-border",
                day.date === todayStr && "bg-accent-soft/50",
              )}
            >
              {hourLabels.map((hl) => (
                <div
                  key={hl.label}
                  style={{ top: `${hl.topPx}px` }}
                  className="absolute inset-x-0 border-t border-border/60"
                />
              ))}
              {renderColumn(day, i)}
              {/* After the blocks in DOM so it paints on top; no z-index (stays
                  under the sticky chrome), pointer-events pass through. */}
              {day.date === todayStr && now ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 border-t-2 border-neg"
                  style={{ top: `${now.topPx}px` }}
                >
                  <span className="absolute top-0 left-0 size-2.5 -translate-y-1/2 rounded-full bg-neg" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
