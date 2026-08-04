import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { APP_SCROLL_ID, APP_SCROLL_RESTORATION_ID } from "@/lib/appScroll";

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
}

export function AppScreen({
  header,
  children,
  bodyClassName,
  headerClassName,
  contentClassName = "mx-auto w-full max-w-3xl",
}: AppScreenProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header ? (
        <div
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
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 lg:pb-10",
          // No header means the screen owns its own top spacing.
          header ? "pt-1" : "pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:pt-4",
          bodyClassName,
        )}
      >
        <div className={contentClassName}>{children}</div>
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
          <div className="font-serif text-sm text-muted-foreground">{subtitle}</div>
        ) : null}
        <h1 className="truncate text-[23px] leading-tight font-extrabold tracking-tight">
          {title}
        </h1>
      </div>
      {actions}
    </div>
  );
}
