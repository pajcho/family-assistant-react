import { useEffect, useState } from "react";

/**
 * How many CSS pixels of the layout viewport the software keyboard is covering.
 * 0 when it is down.
 *
 * This exists because Safari does NOT implement
 * `interactive-widget=resizes-content`. That viewport-meta value is a Chromium
 * addition: on Android the keyboard shrinks the LAYOUT viewport, so a
 * bottom-pinned bar rides up on its own and nothing else has to know. On iOS the
 * layout viewport keeps its full height, only the VISUAL viewport shrinks, and
 * Safari's own answer is to pan the page until the focused field is visible.
 * Panning is why the composer appears at all on iOS - and why everything below it
 * ends up in the band the keyboard covers, with the rest of the page left blank
 * above the fold.
 *
 * So the inset has to be measured and applied by hand:
 *
 *     layout height - (visual height + how far the visual viewport was panned)
 *
 * The `offsetTop` term is what makes this survive the pan: Safari reports the
 * shrunken visual viewport AND how far down the layout it currently sits, and
 * only the two together say where the keyboard's top edge is in layout
 * coordinates.
 *
 * Values under a threshold are reported as 0. A visual viewport can be a few
 * pixels shorter than the layout for reasons that are not a keyboard (the
 * collapsing Safari toolbar, a pinch), and a bar that shifted by 8px on scroll
 * would be worse than one that never moved.
 */
const MIN_INSET_PX = 120;

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const measure = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop);
      setInset(covered > MIN_INSET_PX ? Math.round(covered) : 0);
    };

    measure();
    // `scroll` matters as much as `resize`: iOS pans the visual viewport while
    // the keyboard animates in, and each pan changes offsetTop without changing
    // height, so a resize-only listener settles on the wrong number.
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);

  return inset;
}
