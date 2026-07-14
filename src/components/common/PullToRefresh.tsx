import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * Pull-to-refresh for the INSTALLED PWA (standalone display mode only — in a
 * regular browser tab the native gesture already exists and ours would
 * double-trigger). A top-overscroll pull past the threshold invalidates the
 * query cache and refetches the active queries.
 *
 * Deliberately conservative around this app's iOS constraints (native window
 * scroll + sticky header/week-strip):
 *   - listeners are PASSIVE and never call preventDefault — scrolling is
 *     never hijacked, no rAF scroll loops;
 *   - nothing in the page layout moves: the indicator is a fixed overlay, so
 *     the sticky elements are never transformed or covered by new layout;
 *   - the gesture only starts with the window at scrollY 0 and is dropped the
 *     moment the page actually scrolls or a modal locks the body
 *     (react-remove-scroll stamps `data-scroll-locked` on <body>).
 */

/** Raw finger travel (px) that triggers a refresh on release. */
const TRIGGER_PX = 110;
/** The indicator moves slower than the finger — damped by this factor. */
const DAMPING = 2.5;
/** Cap for the damped indicator travel. */
const MAX_PULL_PX = 72;
/** Below this travel we can't yet tell a pull from a horizontal swipe. */
const AXIS_LOCK_PX = 8;
/** Keep the spinner visible at least this long so a fast refetch reads as one. */
const MIN_SPIN_MS = 500;

/** Same detection as IosInstallHint: iOS `navigator.standalone` or the media query. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (navStandalone) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function PullToRefresh() {
  const queryClient = useQueryClient();
  // Evaluated once — installing/uninstalling mid-session isn't a live concern.
  const [enabled] = useState(isStandalone);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gesture = useRef<{ x: number; y: number; axis: "pull" | "other" | null } | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      gesture.current = null;
      setPull(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      // A dialog/drawer locks body scroll — a pull inside it must not refresh.
      if (document.body.hasAttribute("data-scroll-locked")) return;
      const t = e.touches[0];
      gesture.current = { x: t.clientX, y: t.clientY, axis: null };
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g || refreshingRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (g.axis === null) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        g.axis = dy > Math.abs(dx) ? "pull" : "other";
      }
      if (g.axis !== "pull") return;
      if (window.scrollY > 0) {
        // The page took the gesture as a real scroll — stand down.
        reset();
        return;
      }
      setPull(dy <= 0 ? 0 : Math.min(dy / DAMPING, MAX_PULL_PX));
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.axis !== "pull" || refreshingRef.current) {
        setPull(0);
        return;
      }
      const dy = e.changedTouches[0].clientY - g.y;
      if (dy < TRIGGER_PX || window.scrollY > 0) {
        setPull(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      const startedAt = Date.now();
      void queryClient.invalidateQueries({ refetchType: "active" }).finally(() => {
        const remaining = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
        window.setTimeout(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          setPull(0);
        }, remaining);
      });
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [enabled, queryClient]);

  if (!enabled) return null;

  const armed = pull >= TRIGGER_PX / DAMPING;
  const visible = refreshing || pull > 8;

  return (
    // Fixed overlay below the sticky app header (h-14) — never shifts layout.
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
      <div
        role="status"
        aria-busy={refreshing}
        className={cn(
          "flex size-9 items-center justify-center rounded-full border border-gray-200 bg-white shadow-md transition-opacity duration-150 dark:border-gray-700 dark:bg-gray-800",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        {refreshing ? <span className="sr-only">Osvežavanje</span> : null}
        <ArrowPathIcon
          className={cn(
            "size-5",
            armed || refreshing
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-400 dark:text-gray-500",
            refreshing && "animate-spin",
          )}
          // Progress feedback while pulling: the arrow winds up toward the
          // trigger point, then spins once released.
          style={refreshing ? undefined : { transform: `rotate(${Math.round(pull * 4)}deg)` }}
        />
      </div>
    </div>
  );
}
