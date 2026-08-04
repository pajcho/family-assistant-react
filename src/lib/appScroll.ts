/**
 * The app is a fixed 100dvh frame (see routes/_app.tsx): the document itself
 * never scrolls, one container per screen does. Anything that used to read or
 * drive `window.scrollY` / `window.scrollTo` goes through here instead.
 *
 * Why the whole frame is fixed: window-scroll + `position: sticky` chrome is
 * the app's long-standing iOS pain point (header and week strip blanking
 * during fast scroll, `backdrop-filter` failing to repaint, the keyboard
 * lifting `position: fixed` bars). With an inner scroll container the header
 * and the bottom bar are plain flex siblings that never move, so none of
 * those failure modes exist.
 */

/** `id` of the scroll container in the authenticated layout. */
export const APP_SCROLL_ID = "app-scroll";

/**
 * Also used as TanStack Router's `data-scroll-restoration-id`, so back/forward
 * restores the container's offset the way it used to restore the window's.
 */
export const APP_SCROLL_RESTORATION_ID = APP_SCROLL_ID;

/** The live scroll container, or null before the layout mounts. */
export function getAppScrollEl(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(APP_SCROLL_ID);
}

/** Current vertical offset - the drop-in replacement for `window.scrollY`. */
export function getAppScrollTop(): number {
  return getAppScrollEl()?.scrollTop ?? 0;
}

/** Scroll the app container - the drop-in replacement for `window.scrollTo`. */
export function scrollAppTo(options: ScrollToOptions): void {
  getAppScrollEl()?.scrollTo(options);
}

/**
 * Distance from the container's top to an element's top, in the container's
 * scroll coordinates. Replaces `el.getBoundingClientRect().top + window.scrollY`.
 */
export function offsetTopWithinApp(el: HTMLElement): number {
  const container = getAppScrollEl();
  if (!container) return el.getBoundingClientRect().top;
  return (
    el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
  );
}
