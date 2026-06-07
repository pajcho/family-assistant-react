import { useEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

import { cn } from "@/lib/cn";
import { getWeekStart } from "@/utils/activity";

/**
 * Todoist-style week strip for the "Uskoro" tab. A fixed Mon–Sun weekday header
 * over a horizontally-swipeable pager of week rows — one week per page.
 *
 * The pager is a `transform: translateX` carousel, NOT a native scroll container.
 * iOS WebKit ignores `scroll-snap-stop: always` during momentum scrolling
 * (https://bugs.webkit.org/show_bug.cgi?id=243582), so a hard fling on a snap
 * scroller skips several weeks at once. Driving the page index straight from the
 * touch gesture makes one swipe move exactly one week — never a runaway fling.
 *
 * It follows the list: `activeDay` (the day at the top of the scrolled list) is
 * marked with a filled circle, and the pager pages to that day's week, so
 * scrolling the list walks the strip forward/back in step. Tapping a day scrolls
 * the list to it; swiping to an adjacent week carries the selection along (Thu →
 * next/prev Thu); swiping to the last week loads more (`onReachEnd`). Today is
 * marked even when scrolled away; days with items carry a dot.
 */

/** Monday-first two-letter weekday initials. */
const WEEKDAY_INITIALS = ["Po", "Ut", "Sr", "Če", "Pe", "Su", "Ne"] as const;

/** A swipe counts as a page change past this fraction of the strip width… */
const SWIPE_DISTANCE_RATIO = 0.2;
/** …or if it's a quick flick: under this many ms with at least a little travel. */
const FLICK_MS = 250;
const FLICK_MIN_PX = 8;
/** Below this travel we can't yet tell horizontal swipe from vertical scroll. */
const AXIS_LOCK_PX = 6;

export type WeekStripProps = {
  /** Week-start Mondays (yyyy-MM-dd), ascending — one page each. */
  weeks: string[];
  today: string;
  /** First selectable day (today — the Uskoro window now starts at today). */
  from: string;
  /** The day currently at the top of the list (scroll-spy), or null. */
  activeDay: string | null;
  /** day (yyyy-MM-dd) → item count. */
  countByDay: Map<string, number>;
  /** e.g. "Jun 2026". */
  monthLabel: string;
  onSelectDay: (day: string) => void;
  /** Fired when the pager is swiped to its last week — load more. */
  onReachEnd: () => void;
};

export function WeekStrip({
  weeks,
  today,
  from,
  activeDay,
  countByDay,
  monthLabel,
  onSelectDay,
  onReachEnd,
}: WeekStripProps) {
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  const activeWeek = activeDay ? getWeekStart(activeDay) : (weeks[0] ?? today);
  const activeWeekIndex = Math.max(0, weeks.indexOf(activeWeek));

  // Which week page is showing. Driven both by swipes and by the list (below).
  const [pageIndex, setPageIndex] = useState(activeWeekIndex);
  const lastIndex = Math.max(0, weeks.length - 1);
  const page = Math.min(Math.max(pageIndex, 0), lastIndex);

  // Follow the list: when the scrolled-to day crosses into another week, page
  // there. Only fires on a real week change, so a manual swipe-ahead is left be.
  useEffect(() => {
    setPageIndex(activeWeekIndex);
  }, [activeWeekIndex]);

  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const wheelLock = useRef(false);

  const restingTransform = (i: number) => `translateX(${-i * 100}%)`;

  // A user swipe/wheel paged the strip. Carry the selection across: select the
  // same weekday in the week we moved to (Thu → next/prev Thu), clamped to the
  // first selectable day. NOT used by the list-follow effect above, so scrolling
  // the list pages the strip without re-selecting (no feedback loop).
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
    if (!g || g.axis !== "x") return; // a tap or a vertical scroll — nothing to settle

    const dx = e.changedTouches[0].clientX - g.x;
    const width = track?.clientWidth ?? 1;
    const flick = e.timeStamp - g.t < FLICK_MS && Math.abs(dx) > FLICK_MIN_PX;
    const advance = Math.abs(dx) > width * SWIPE_DISTANCE_RATIO || flick;
    const target = advance ? page + (dx < 0 ? 1 : -1) : page;
    const next = Math.min(Math.max(target, 0), lastIndex);

    // Settle imperatively — covers the snap-back case (next === page) where no
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
      <div className="mb-1.5 px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {monthLabel}
      </div>

      {/* Fixed weekday header — every week shares the same Mon–Sun columns. */}
      <div className="grid grid-cols-7 gap-1 px-1">
        {WEEKDAY_INITIALS.map((wd) => (
          <div
            key={wd}
            className="text-center text-[11px] font-medium text-gray-400 dark:text-gray-500"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Swipeable week pager — a clipped viewport over a translateX track. */}
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
              <div key={weekStart} className="grid w-full shrink-0 grid-cols-7 gap-1 px-1">
                {Array.from({ length: 7 }, (_, dow) => {
                  const day = format(addDays(base, dow), "yyyy-MM-dd");
                  const count = countByDay.get(day) ?? 0;
                  const isToday = day === today;
                  const isActive = day === activeDay;
                  const isPast = day < today;
                  // Any day from today on is tappable — the list renders a section
                  // per day (empty ones too), so there's always somewhere to land.
                  // The green dot below the number signals which days have events.
                  const selectable = day >= from;
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={!selectable}
                      aria-label={`${day}${count > 0 ? ` — ${count}` : ""}`}
                      onClick={() => onSelectDay(day)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors",
                        isPast && "opacity-40",
                        !selectable && "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                          isActive
                            ? "bg-blue-600 font-semibold text-white dark:bg-blue-500"
                            : isToday
                              ? "font-semibold text-blue-600 dark:text-blue-400"
                              : selectable
                                ? "font-medium text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700/60"
                                : "text-gray-400 dark:text-gray-500",
                        )}
                      >
                        {Number(day.slice(8, 10))}
                      </span>
                      <span className="flex h-1 items-center justify-center">
                        {count > 0 && !isActive && !isPast ? (
                          <span className="size-1 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                        ) : null}
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
