import { useSyncExternalStore } from "react";

const THRESHOLD_PX = 150;

const isTextEntry = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    // Skip pure-button inputs (checkbox, radio, button, submit…)
    // which don't open the keyboard.
    const type = (el as HTMLInputElement).type;
    const skip = new Set([
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "range",
      "file",
      "color",
    ]);
    return !skip.has(type);
  }
  return (el as HTMLElement).isContentEditable === true;
};

/**
 * Returns true while a software keyboard (or any equivalent input
 * accessory) is occupying screen real estate. Sole consumer is the
 * mobile sheet in responsive-dialog, which latches this to hold a
 * 60vh floor under the sheet while the keyboard is up (see
 * useKeyboardFloorLatch there). Nothing else should gate rendering
 * on it: the bottom nav used to unmount on this signal, and a stuck
 * reading (stale visualViewport after a PWA resume) left the app
 * with no navigation until a restart.
 *
 * Two parallel signals are OR'd together because each one fails for
 * different reasons on different browsers:
 *
 *   1. `visualViewport.height` < `window.innerHeight` by more than
 *      `THRESHOLD_PX` (150). Fires on iOS Safari, which ignores the
 *      `interactive-widget=resizes-content` viewport flag (measured
 *      on iOS 26, see index.html). Dies wherever the flag IS
 *      honoured (Chromium): there the layout viewport itself
 *      shrinks, so the two heights match with the keyboard open.
 *
 *   2. `document.activeElement` is a text-entry control (input,
 *      textarea, or contenteditable). Always-reliable proxy: the
 *      keyboard is visible when a text field has focus. Overshoots
 *      when a keyboard is dismissed while focus stays (accessory-bar
 *      dismiss) - for the sheet floor that just means the floor
 *      lingers until the next tap.
 */
const readKeyboardOpen = (): boolean => {
  const vv = window.visualViewport;
  const viewportSays = vv ? window.innerHeight - vv.height > THRESHOLD_PX : false;
  const focusSays = isTextEntry(document.activeElement);
  return viewportSays || focusSays;
};

const subscribe = (onStoreChange: () => void): (() => void) => {
  // Safety net for the one case the events below can't cover: a focused
  // input that's REMOVED from the DOM (a closing dialog unmounting its
  // form) fires no focusout in Chromium/WebKit, so signal 2 would keep
  // reporting a keyboard that is long gone. Re-check on a slow tick while
  // the keyboard reads open; the moment it reads closed the interval
  // stops, so this costs nothing at rest.
  let timer: number | undefined;
  const syncTimer = () => {
    const open = readKeyboardOpen();
    if (open && timer === undefined) {
      timer = window.setInterval(check, 400);
    } else if (!open && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
  const check = () => {
    onStoreChange();
    syncTimer();
  };

  syncTimer();
  window.visualViewport?.addEventListener("resize", check);
  window.visualViewport?.addEventListener("scroll", check);
  document.addEventListener("focusin", check);
  document.addEventListener("focusout", check);
  return () => {
    window.visualViewport?.removeEventListener("resize", check);
    window.visualViewport?.removeEventListener("scroll", check);
    document.removeEventListener("focusin", check);
    document.removeEventListener("focusout", check);
    if (timer !== undefined) window.clearInterval(timer);
  };
};

const getServerSnapshot = (): boolean => false;

export function useIsKeyboardOpen(): boolean {
  // useSyncExternalStore re-reads the snapshot right after subscribing, which
  // covers a field autofocused in the same commit that mounted the consumer.
  return useSyncExternalStore(subscribe, readKeyboardOpen, getServerSnapshot);
}
