import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { Calendar } from "@/components/ui/calendar";
import { IconButton } from "@/components/common/IconButton";
import { NowPill } from "@/components/common/NowPill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { getWeekStart } from "@/utils/activity";
import { srLocale } from "@/utils/date";
import { stavkeLabel } from "@/utils/plural";

/**
 * The swipeable week strip (redizajn 2.0 "vremenske trake") - a pager of
 * Mon-Sun rows, one week per page, skinned like the Danas strip: weekday
 * initial + day number + up to three load dots per cell.
 *
 * Mounted twice with different wiring: the calendar's AGENDA view (scroll-spy
 * follows the list, tapping a day scrolls to it) and its NEDELJA view (the
 * strip is the week pager and minimap of the timetable). The header line
 * carries the month label (a popover mini-calendar for far jumps), the owner's
 * NowPill back to "now", and - where the owner asks - desktop-only arrows.
 *
 * The pager is a `transform: translateX` carousel, NOT a native scroll
 * container. iOS WebKit ignores `scroll-snap-stop: always` during momentum
 * scrolling (https://bugs.webkit.org/show_bug.cgi?id=243582), so a hard fling
 * on a snap scroller skips several weeks at once. Driving the page index
 * straight from the touch gesture makes one swipe move exactly one week -
 * never a runaway fling.
 *
 * `activeDay` is marked with a filled accent cell and the pager pages to that
 * day's week, so the owner's state walks the strip in step. Tapping a day
 * hands it to `onSelectDay`; swiping to an adjacent week carries the selection
 * along (Thu → next/prev Thu); swiping to the last week calls `onReachEnd`.
 */

/** Monday-first three-letter weekday labels - the app-wide abbreviation. */
const WEEKDAY_INITIALS = ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"] as const;

/** Load dots are capped so a heavy day doesn't grow the row. */
const MAX_DOTS = 3;

/** A swipe counts as a page change past this fraction of the strip width… */
const SWIPE_DISTANCE_RATIO = 0.2;
/** …or if it's a quick flick: under this many ms with at least a little travel. */
const FLICK_MS = 250;
const FLICK_MIN_PX = 8;
/** Below this travel we can't yet tell horizontal swipe from vertical scroll. */
const AXIS_LOCK_PX = 6;

export type WeekStripProps = {
  /** Week-start Mondays (yyyy-MM-dd), ascending - one page each. */
  weeks: string[];
  today: string;
  /** First selectable day - days before it render dimmed and disabled. */
  from: string;
  /** The day the strip marks as selected (scroll-spy / focused column). */
  activeDay: string | null;
  /** day (yyyy-MM-dd) → item count, for the load dots. */
  countByDay: Map<string, number>;
  /** e.g. "Avgust 2026". */
  monthLabel: string;
  /** Last jumpable day - the mini-calendar's far bound. */
  maxDay: string;
  onSelectDay: (day: string) => void;
  /**
   * A day was picked in the month-picker popover. Unlike `onSelectDay`, the
   * target may lie beyond the loaded window - the owner grows the horizon
   * first, then scrolls.
   */
  onJumpToDay: (day: string) => void;
  /** Fired when the pager is swiped to its last week - load more. */
  onReachEnd: () => void;
  /** The "vrati na sada" pill - rendered in the header line while `show`. */
  nowPill?: { label: string; show: boolean; onClick: () => void };
  /** Show prev/next week arrows on pointer-fine devices (Nedelja). */
  showArrows?: boolean;
};

export function WeekStrip({
  weeks,
  today,
  from,
  activeDay,
  countByDay,
  monthLabel,
  maxDay,
  onSelectDay,
  onJumpToDay,
  onReachEnd,
  nowPill,
  showArrows = false,
}: WeekStripProps) {
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  const activeWeek = activeDay ? getWeekStart(activeDay) : (weeks[0] ?? today);
  const activeWeekIndex = Math.max(0, weeks.indexOf(activeWeek));

  // Which week page is showing. Driven both by swipes and by the owner (below).
  const [pageIndex, setPageIndex] = useState(activeWeekIndex);
  const lastIndex = Math.max(0, weeks.length - 1);
  const page = Math.min(Math.max(pageIndex, 0), lastIndex);

  // Follow the owner: when `activeDay` crosses into another week (list scroll,
  // week change), page there. Only fires on a real week change, so a manual
  // swipe-ahead is left be.
  useEffect(() => {
    setPageIndex(activeWeekIndex);
  }, [activeWeekIndex]);

  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const wheelLock = useRef(false);

  // Month-picker popover state + bounds. Selecting a day closes the popover
  // and hands off to the owner's jump mechanics.
  const [pickerOpen, setPickerOpen] = useState(false);
  const fromDate = useMemo(() => parseISO(from + "T12:00:00"), [from]);
  const maxDate = useMemo(() => parseISO(maxDay + "T12:00:00"), [maxDay]);
  const activeDate = activeDay ? parseISO(activeDay + "T12:00:00") : undefined;

  const restingTransform = (i: number) => `translateX(${-i * 100}%)`;

  // A user swipe/wheel/arrow paged the strip. Carry the selection across:
  // select the same weekday in the week we moved to (Thu → next/prev Thu),
  // clamped to the first selectable day. NOT used by the follow effect above,
  // so the owner's own updates page the strip without re-selecting (no
  // feedback loop).
  const goToPage = (target: number) => {
    const next = Math.min(Math.max(target, 0), lastIndex);
    if (next === page) return;
    setPageIndex(next);
    const monday = weeks[next];
    if (monday) {
      const refDay = activeDay ?? today;
      const dow = differenceInCalendarDays(
        parseISO(refDay + "T12:00:00"),
        parseISO(getWeekStart(refDay) + "T12:00:00"),
      );
      const sameWeekday = format(addDays(parseISO(monday + "T12:00:00"), dow), "yyyy-MM-dd");
      onSelectDay(sameWeekday < from ? from : sameWeekday);
    }
    if (next === lastIndex) onReachEndRef.current();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    gesture.current = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null };
    // Drop the settle transition so the track tracks the finger 1:1.
    if (trackRef.current) trackRef.current.style.transition = "none";
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    const track = trackRef.current;
    if (!g || !track) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (g.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (g.axis !== "x") return; // vertical gesture → leave the page to scroll
    track.style.transform = `translateX(calc(${-page * 100}% + ${dx}px))`;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    const track = trackRef.current;
    gesture.current = null;
    if (track) track.style.transition = ""; // re-enable the settle animation
    if (!g || g.axis !== "x") return; // a tap or a vertical scroll - nothing to settle

    const dx = e.changedTouches[0].clientX - g.x;
    const width = track?.clientWidth ?? 1;
    const flick = e.timeStamp - g.t < FLICK_MS && Math.abs(dx) > FLICK_MIN_PX;
    const advance = Math.abs(dx) > width * SWIPE_DISTANCE_RATIO || flick;
    const target = advance ? page + (dx < 0 ? 1 : -1) : page;
    const next = Math.min(Math.max(target, 0), lastIndex);

    // Settle imperatively - covers the snap-back case (next === page) where no
    // re-render happens to reset the inline transform left over from the drag.
    if (track) track.style.transform = restingTransform(next);
    goToPage(next);
  };

  const onTouchCancel = () => {
    gesture.current = null;
    const track = trackRef.current;
    if (track) {
      track.style.transition = "";
      track.style.transform = restingTransform(page);
    }
  };

  // Desktop trackpad: a horizontal two-finger swipe pages one week, debounced so
  // the inertia tail can't run several weeks ahead. `overscroll-x-contain` keeps
  // it from triggering browser back-navigation.
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical intent → page scroll
    if (wheelLock.current || Math.abs(e.deltaX) < 24) return;
    wheelLock.current = true;
    goToPage(page + (e.deltaX > 0 ? 1 : -1));
    window.setTimeout(() => {
      wheelLock.current = false;
    }, 450);
  };

  return (
    <div>
      {/* Header line: month label (jump-to-a-day popover), the way back to
          "now", and - where asked - desktop week arrows. `min-h` matches the
          sm IconButton, so the line sits at the same height with or without
          arrows - switching calendar views must not shift the label. */}
      <div className="mb-1 flex min-h-[34px] items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${monthLabel} - izaberi dan`}
              className="-ml-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[13.5px] font-semibold transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="truncate">{monthLabel}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              locale={srLocale}
              selected={activeDate}
              defaultMonth={activeDate ?? fromDate}
              startMonth={fromDate}
              endMonth={maxDate}
              disabled={{ before: fromDate, after: maxDate }}
              onSelect={(date) => {
                if (!date) return;
                setPickerOpen(false);
                onJumpToDay(format(date, "yyyy-MM-dd"));
              }}
            />
          </PopoverContent>
        </Popover>
        <span className="min-w-1 flex-1" />
        {nowPill?.show ? <NowPill label={nowPill.label} onClick={nowPill.onClick} /> : null}
        {showArrows ? (
          <span className="hidden gap-1.5 pointer-fine:flex">
            <IconButton
              icon={ChevronLeftIcon}
              size="sm"
              aria-label="Prethodna nedelja"
              onClick={() => goToPage(page - 1)}
            />
            <IconButton
              icon={ChevronRightIcon}
              size="sm"
              aria-label="Sledeća nedelja"
              onClick={() => goToPage(page + 1)}
            />
          </span>
        ) : null}
      </div>

      {/* Swipeable week pager - a clipped viewport over a translateX track. */}
      <div
        className="overflow-hidden overscroll-x-contain touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onWheel={onWheel}
      >
        <div
          ref={trackRef}
          className="flex transition-transform duration-200 ease-out [will-change:transform]"
          style={{ transform: restingTransform(page) }}
        >
          {weeks.map((weekStart) => {
            const base = parseISO(weekStart + "T12:00:00");
            return (
              <div key={weekStart} className="grid w-full shrink-0 grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, dow) => {
                  const date = addDays(base, dow);
                  const day = format(date, "yyyy-MM-dd");
                  const count = countByDay.get(day) ?? 0;
                  const dots = Math.min(count, MAX_DOTS);
                  const isToday = day === today;
                  const isActive = day === activeDay;
                  const selectable = day >= from;
                  // Humanized for screen readers: "ponedeljak, 20. jul - 6 stavki".
                  const spokenDay = format(date, "EEEE, d. MMMM", { locale: srLocale });
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={!selectable}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={
                        count > 0 ? `${spokenDay} - ${count} ${stavkeLabel(count)}` : spokenDay
                      }
                      onClick={() => onSelectDay(day)}
                      className={cn(
                        "min-w-0 rounded-md border border-transparent py-1 text-center transition-colors",
                        !selectable && "cursor-default opacity-40",
                        isActive
                          ? "border-accent bg-accent text-accent-foreground"
                          : isToday
                            ? "border-accent/40 bg-accent-soft text-accent-deep"
                            : selectable
                              ? "text-muted-foreground hover:bg-muted/60"
                              : "text-muted-foreground",
                      )}
                    >
                      <span className="block text-[9px] font-bold tracking-wide uppercase opacity-85">
                        {WEEKDAY_INITIALS[dow]}
                      </span>
                      <span className="mt-px block text-sm font-bold tabular-nums">
                        {Number(day.slice(8, 10))}
                      </span>
                      <span className="mt-0.5 flex h-1 items-center justify-center gap-px">
                        {Array.from({ length: dots }, (_, i) => (
                          <span
                            key={i}
                            className={cn(
                              "size-1 rounded-full",
                              isActive
                                ? "bg-accent-foreground opacity-90"
                                : isToday
                                  ? "bg-accent-deep opacity-90"
                                  : "bg-muted-foreground opacity-40",
                            )}
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
