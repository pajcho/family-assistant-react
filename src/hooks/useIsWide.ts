import { useEffect, useState } from "react";

/** Tailwind's `lg` breakpoint — where the lists view flips to the desktop master-detail split. */
const WIDE_MEDIA_QUERY = "(min-width: 1024px)";

function readMatch(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(WIDE_MEDIA_QUERY).matches;
}

/**
 * True at >= 1024px (Tailwind `lg`).
 *
 * Unlike `useIsDesktop` (640px, which intentionally defaults to `false` until
 * mount because the Drawer-vs-Dialog choice must start as a Drawer), this
 * initialises *synchronously* from `window.matchMedia`. The app is a
 * client-only SPA — there's no SSR to guard against — so an honest first value
 * avoids a one-frame flash between the mobile (single-column) and desktop
 * (split) lists layouts on every load of `/lists`. The `typeof window` guard is
 * kept only so jsdom/Vitest renders where `matchMedia` is absent don't throw.
 */
export function useIsWide(): boolean {
  const [isWide, setIsWide] = useState<boolean>(readMatch);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(WIDE_MEDIA_QUERY);
    const update = () => {
      setIsWide(mql.matches);
    };
    update();
    mql.addEventListener("change", update);
    return () => {
      mql.removeEventListener("change", update);
    };
  }, []);

  return isWide;
}
