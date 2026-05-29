import * as React from "react";

/**
 * Returns true while a software keyboard (or any equivalent input
 * accessory) is occupying screen real estate.
 *
 * Two parallel signals are OR'd together because each one fails for
 * different reasons on different browsers:
 *
 *   1. `visualViewport.height` < `window.innerHeight` by more than
 *      `THRESHOLD_PX` (150). Works on iOS Safari, but iOS 17+ with
 *      `interactive-widget=resizes-content` (set in index.html) makes
 *      the two heights match — at which point this signal returns
 *      false even though the keyboard is open.
 *
 *   2. `document.activeElement` is a text-entry control (input,
 *      textarea, or contenteditable). Always-reliable proxy: the
 *      keyboard is visible when a text field has focus. Falls back
 *      gracefully when the user dismisses the keyboard via the
 *      accessory bar while still focused (the page hasn't told us
 *      either way, so the nav stays hidden a beat longer — better
 *      than flickering back on top of the keyboard).
 *
 * The two-signal approach means the nav slides out even on iOS 17+
 * (where signal 1 stops firing because the layout viewport itself
 * resizes) AND on Android Chrome (where signal 2 might lag while
 * focus shifts).
 */
export function useIsKeyboardOpen(): boolean {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
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

    const compute = () => {
      const vv = window.visualViewport;
      const viewportSays = vv ? window.innerHeight - vv.height > THRESHOLD_PX : false;
      const focusSays = isTextEntry(document.activeElement);
      setOpen(viewportSays || focusSays);
    };

    compute();
    window.visualViewport?.addEventListener("resize", compute);
    window.visualViewport?.addEventListener("scroll", compute);
    document.addEventListener("focusin", compute);
    document.addEventListener("focusout", compute);
    return () => {
      window.visualViewport?.removeEventListener("resize", compute);
      window.visualViewport?.removeEventListener("scroll", compute);
      document.removeEventListener("focusin", compute);
      document.removeEventListener("focusout", compute);
    };
  }, []);

  return open;
}
