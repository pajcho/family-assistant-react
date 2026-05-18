import * as React from "react";
import PullToRefreshJS from "pulltorefreshjs";

/**
 * React wrapper around `pulltorefreshjs`. Direct port of the Nuxt
 * `components/PullToRefresh.vue` — keeps the original Serbian copy
 * ("Povuci za osvežavanje" / "Otpusti" / "Osvežavanje…") and the
 * "only init on touch-capable devices" guard.
 *
 * The original Vue version called `window.location.reload()`. The React
 * rewrite swaps that for a caller-provided `onRefresh` callback so the
 * dashboard can invalidate every list query without throwing away the
 * SPA's in-memory state. If `onRefresh` returns a promise we await it
 * before resolving so the spinner stays visible until data has been
 * refetched.
 */
export type PullToRefreshProps = {
  /**
   * Fired when the user releases the pull gesture past the threshold.
   * The spinner stays up until the returned promise (if any) resolves.
   */
  onRefresh?: () => void | Promise<void>;
  children: React.ReactNode;
};

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  // Stash the callback in a ref so the effect can stay [-deps] empty —
  // re-initializing the pulltorefreshjs handler every render would tear
  // down the DOM listeners on each parent state change.
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const hasTouch = "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
    if (!hasTouch) return;

    const instance = PullToRefreshJS.init({
      mainElement: "body",
      triggerElement: "body",
      instructionsPullToRefresh: "Povuci za osvežavanje",
      instructionsReleaseToRefresh: "Otpusti",
      instructionsRefreshing: "Osvežavanje…",
      onRefresh: () => {
        // pulltorefreshjs supports a promise return — it waits to clear the
        // spinner. If no handler is wired we fall back to a hard reload to
        // match the Vue version's original behaviour.
        const handler = onRefreshRef.current;
        if (!handler) {
          window.location.reload();
          return;
        }
        return handler();
      },
    });

    return () => {
      if (instance && typeof instance.destroy === "function") {
        instance.destroy();
      } else {
        PullToRefreshJS.destroyAll();
      }
    };
  }, []);

  return <>{children}</>;
}
