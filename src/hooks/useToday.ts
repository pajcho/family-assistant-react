import { useSyncExternalStore } from "react";
import { format, startOfDay } from "date-fns";

/**
 * A shared "today" that stays correct across iOS PWA suspends.
 *
 * The home-screen install keeps its JS context alive for days — a component
 * that reads `new Date()` once (in a `useMemo`, in state init, in a frozen
 * query range) keeps yesterday's date after the phone sits overnight, because
 * nothing remounts on resume. This holds today in a module-level store and
 * re-evaluates it on the natural wake signals:
 *   - `visibilitychange` → visible  (returning from the background)
 *   - `window` focus
 *   - a timer scheduled for the next local midnight (rollover while open)
 *
 * Consumers get a referentially-stable snapshot, so they re-render only when the
 * calendar DAY actually changes — not on every focus. Reading it through
 * `useSyncExternalStore` means one set of listeners and one timer is shared by
 * every caller, however many mount.
 */
export interface Today {
  /** Today as `yyyy-MM-dd` (local). */
  str: string;
  /** Today at local start-of-day — a stable `Date` for arithmetic. */
  date: Date;
}

function compute(): Today {
  const date = startOfDay(new Date());
  return { str: format(date, "yyyy-MM-dd"), date };
}

// Module-level singleton: one snapshot, one listener set, one midnight timer
// shared by all `useToday()` callers. The snapshot reference only changes when
// the day rolls over — that's what keeps `useSyncExternalStore` stable.
let snapshot = compute();
const listeners = new Set<() => void>();
let midnightTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleMidnight(): void {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0); // 00:00 tomorrow, local
  // +1s cushion so we fire just after the boundary, never a hair before it.
  midnightTimer = setTimeout(refresh, nextMidnight.getTime() - now.getTime() + 1000);
}

function refresh(): void {
  const next = compute();
  if (next.str !== snapshot.str) {
    snapshot = next;
    for (const notify of listeners) notify();
  }
  // Always reschedule: a focus/visibility refresh after a long suspend also
  // re-arms the (by then drifted) midnight timer.
  scheduleMidnight();
}

function onVisible(): void {
  if (document.visibilityState === "visible") refresh();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    // Catch up silently if the module loaded a while before this first mount —
    // React reads `getSnapshot` right after subscribing, so no notify is needed.
    snapshot = compute();
    scheduleMidnight();
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      if (midnightTimer) {
        clearTimeout(midnightTimer);
        midnightTimer = undefined;
      }
    }
  };
}

function getSnapshot(): Today {
  return snapshot;
}

/** Today (local), kept correct across iOS PWA suspends — see module doc. */
export function useToday(): Today {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
