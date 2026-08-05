import { useCallback, useEffect, useRef } from "react";

/**
 * Marks a horizontal scroller with which of its ends currently has content
 * hidden past it, as `data-fade-start` / `data-fade-end`. The `.fade-scroll-x`
 * utility keys its mask off those, so the fade is only ever drawn on a side you
 * can actually scroll toward.
 *
 * Why it has to be measured rather than always-on: a row that fits needs no
 * fade at all (an unconditional one just dims the first chip for no reason),
 * and a row scrolled hard against one end has nothing left to hint at on that
 * side. Both were visible as a permanently greyed "Svi" chip on Danas.
 *
 * Returns a CALLBACK ref, not an object one: rows that render nothing until
 * their data arrives (`PersonFilterRow` bails out while the members query is in
 * flight) attach their element on a later render, which a `useEffect([])` would
 * have already run past.
 *
 * Re-measured on scroll, on resize of the scroller, and on content changes -
 * chips fill in when a query resolves, which changes the overflow without
 * either of the other two firing.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);

  // Detach on unmount; the callback below handles every other transition.
  useEffect(() => () => cleanupRef.current?.(), []);

  return useCallback((el: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;

    const update = () => {
      // Sub-pixel layout means the scrolled-to-the-end position is rarely an
      // exact match - a 1px slack keeps the fade from flickering back on.
      const max = el.scrollWidth - el.clientWidth;
      el.dataset.fadeStart = el.scrollLeft > 1 ? "true" : "false";
      el.dataset.fadeEnd = el.scrollLeft < max - 1 ? "true" : "false";
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutate = new MutationObserver(update);
    mutate.observe(el, { childList: true, subtree: true, characterData: true });

    cleanupRef.current = () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutate.disconnect();
    };
  }, []);
}
