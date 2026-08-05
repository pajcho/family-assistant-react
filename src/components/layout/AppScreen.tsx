import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { APP_SCROLL_ID, APP_SCROLL_RESTORATION_ID } from "@/lib/appScroll";

/**
 * Width the scroll container reserves for a classic scrollbar - 0 on every
 * platform with overlay scrollbars. Measured off a throwaway element rather
 * than off the live one, so the header can size itself in the same render the
 * body first appears in, and re-measured on resize because the width changes
 * with zoom (and with the OS "show scroll bars" setting).
 */
function useScrollbarGutter(): number {
  const [gutter, setGutter] = useState(0);

  useEffect(() => {
    const measure = () => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll;scrollbar-gutter:stable";
      document.body.appendChild(probe);
      const width = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      setGutter(width);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return gutter;
}

/**
 * The frame every screen sits in (redizajn 2.0).
 *
 * A screen is two parts: a header that never scrolls (title, filters, week
 * strip, segments) and a body that does. Because the whole app is a fixed
 * 100dvh frame, "doesn't scroll" is literal - the header is a flex sibling of
 * the scroll container, not a `position: sticky` element. That is what retires
 * the app's iOS sticky-chrome problems (blanking header on fast scroll,
 * backdrop-filter not repainting, dropdowns fighting the scroll position).
 *
 * Exactly one screen is mounted at a time (router Outlet), so the body owns
 * the app-wide scroll id and TanStack Router's scroll restoration key.
 *
 * Bottom clearance: the mobile bar is a flex sibling of this whole frame (it
 * takes its own space and owns the home-indicator inset), so the body only
 * reserves a breathing gap - enough that the elevated "+" button never sits on
 * top of the last row.
 */

export interface AppScreenProps {
  /** Fixed top area: title row, filters, segments. Omit for full-bleed screens. */
  header?: ReactNode;
  children: ReactNode;
  /** Extra classes for the scrolling body (e.g. `px-0` for edge-to-edge lists). */
  bodyClassName?: string;
  /** Extra classes for the header block. */
  headerClassName?: string;
  /**
   * Width of the centered content column. Screens that need the full width
   * (week/month calendars, desktop two-column layouts) pass their own.
   */
  contentClassName?: string;
  /**
   * The body is a fixed-height PANE, not a scrolling document: it fills the
   * space left over and whatever is inside owns the scrolling. The weekly
   * calendar needs this - a timetable that scrolls in two directions can only
   * pin its day header and its hour gutter against a scrollport it controls,
   * and the page's own vertical scroll is not one.
   */
  fillBody?: boolean;
}

export function AppScreen({
  header,
  children,
  bodyClassName,
  headerClassName,
  contentClassName = "mx-auto w-full max-w-3xl",
  fillBody = false,
}: AppScreenProps) {
  const gutter = useScrollbarGutter();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header ? (
        <div
          // The body reserves a classic scrollbar's width; the header does not,
          // so their `mx-auto` columns were centred in boxes of different widths
          // and the content sat half a scrollbar left of the title. Giving the
          // header the same reservation lines the two columns up at every width.
          // Zero wherever scrollbars are overlays (touch, macOS default).
          style={gutter ? { marginRight: gutter } : undefined}
          className={cn(
            "flex-none px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2 lg:pt-4",
            headerClassName,
          )}
        >
          <div className={contentClassName}>{header}</div>
        </div>
      ) : null}
      <main
        id={APP_SCROLL_ID}
        data-scroll-restoration-id={APP_SCROLL_RESTORATION_ID}
        className={cn(
          // `scrollbar-gutter: stable` keeps that reservation constant, so a
          // screen does not shift sideways the moment its content outgrows one
          // viewport - and so the header's copy of it stays correct.
          "min-h-0 flex-1 px-4 pb-8 [scrollbar-gutter:stable] lg:pb-10",
          fillBody ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
          bodyClassName,
        )}
      >
        {/* The top gap belongs to the CONTENT, not to the scroll container:
            padding on the container sits above where a `sticky top-0` child
            comes to rest, so rows kept scrolling visibly through that strip
            between the header panel and the stuck day header. With the gap
            inside, a sticky child parks flush against the panel. */}
        <div
          className={cn(
            contentClassName,
            // No header means the screen owns its own top spacing.
            header ? "pt-1" : "pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:pt-4",
            // `h-full` here is what gives the pane a definite height to divide
            // up: <main> is a flex child with `min-h-0`, so it already has one.
            fillBody && "flex h-full min-h-0 flex-col",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * Interim wrapper for screens that still render their own title/filters inline
 * (everything scrolls together, the way it did when the document scrolled).
 *
 * It exists so every route lives inside the new frame from day one of the
 * redesign; each lane deletes its page's `<LegacyScreen>` as it converts to a
 * real header/body split with {@link AppScreen}.
 */
export function LegacyScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <AppScreen
      bodyClassName={cn("sm:px-6 lg:px-8", className)}
      contentClassName="mx-auto w-full max-w-7xl"
    >
      {children}
    </AppScreen>
  );
}

/**
 * Standard screen header row: big title on the left, up to two icon buttons on
 * the right. Screens with a richer header (Danas' greeting + week strip) build
 * their own and pass it to {@link AppScreen}.
 */
export function ScreenHeaderRow({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="min-w-0 flex-1">
        {subtitle ? (
          <div className="font-serif text-[13.5px] text-muted-foreground italic">{subtitle}</div>
        ) : null}
        <h1 className="truncate text-[23px] leading-tight font-bold tracking-tight">{title}</h1>
      </div>
      {actions}
    </div>
  );
}
