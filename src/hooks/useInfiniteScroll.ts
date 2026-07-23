import { useEffect, useRef } from "react";

/**
 * Generic infinite-scroll sentinel. Attach the returned ref to an element at
 * the end of a list; `onReachEnd` fires whenever that element scrolls into view
 * (within `rootMargin`, so it triggers slightly before it's actually visible).
 *
 * `enabled` gates the observer - pass `false` once there's nothing more to load
 * so it stops firing. `resetKey` re-creates the observer when it changes (pass
 * the current page/horizon): a freshly-created observer re-reports the
 * sentinel's intersection, so if the new content still doesn't fill the
 * viewport it keeps loading until it does or `enabled` flips off - no stuck
 * "sentinel parked in view" state.
 */
export function useInfiniteScroll(
  onReachEnd: () => void,
  {
    enabled,
    resetKey,
    rootMargin = "300px",
  }: { enabled: boolean; resetKey?: unknown; rootMargin?: string },
) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest callback without re-subscribing the observer every render.
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReachEndRef.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, resetKey, rootMargin]);

  return sentinelRef;
}
