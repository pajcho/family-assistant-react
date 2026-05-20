import * as React from "react";

/**
 * Returns true while a software keyboard (or any equivalent input
 * accessory) is occupying screen real estate.
 *
 * Implementation
 * --------------
 * iOS Safari keeps `position: fixed` elements visible above the keyboard
 * by adjusting their bottom inset — which means our `MobileBottomNav`
 * stays drawn between the form and the keyboard, eating valuable
 * vertical space exactly when the user can least afford it.
 *
 * The cleanest signal we have is `window.visualViewport`: when the
 * keyboard slides up, `visualViewport.height` shrinks below
 * `window.innerHeight` by ~keyboard-height. We treat a gap above
 * `THRESHOLD_PX` as "keyboard is open" — small accessory bars (find-
 * in-page, etc.) take ~50px which we want to ignore, so 150 is a
 * comfortable floor that still captures every real soft keyboard.
 *
 * Listens to both `resize` (orientation change, keyboard open/close)
 * and `scroll` on the visual viewport because iOS sometimes only
 * fires one or the other depending on user interaction.
 *
 * Returns `false` on SSR and on browsers without `visualViewport`
 * (older Safari, some embedded webviews). That's the safe default —
 * keep the nav visible if we can't tell.
 */
export function useIsKeyboardOpen(): boolean {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const THRESHOLD_PX = 150;

    const update = () => {
      const heightDiff = window.innerHeight - vv.height;
      setOpen(heightDiff > THRESHOLD_PX);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return open;
}
