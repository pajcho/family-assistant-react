import type { QueryClient } from "@tanstack/react-query";

/**
 * The app's ONE "we just came back" refresh.
 *
 * Two independent things notice a resume and both used to fire an unfiltered
 * `invalidateQueries({ refetchType: "active" })`: the `visibilitychange`
 * listener (`useVisibilityRefetch`) and the realtime channel's rejoin branch
 * (`useFamilyChannel`). On iOS the socket dies during a suspend, so a single
 * foreground reliably triggered BOTH - roughly double the request storm on a
 * screen that already mounts ~18 query keys.
 *
 * Two things fix that, and both live here so the two callers cannot drift:
 *
 *  1. `refetchQueries({ stale: true })` instead of `invalidateQueries`. A
 *     blanket invalidate marks every query stale and refetches it, which
 *     silently overrides each query's own `staleTime` - including the 5-minute
 *     ones and the `Infinity` one. Refetching only what is ALREADY stale
 *     honours those deliberate windows.
 *  2. A throttle. Foreground/background flaps (a notification shade, the app
 *     switcher, a permission prompt) fire `visibilitychange` repeatedly; one
 *     refresh per 30 s is plenty for data that is otherwise pushed live over
 *     the family broadcast channel.
 *
 * Judgment call, not a measurement: 30 s. Realtime still delivers changes
 * while the app is open, so this window only bounds how often a RESUME costs
 * a round trip.
 */

/** Minimum gap between two resume refreshes. */
export const RESUME_REFRESH_THROTTLE_MS = 30_000;

/**
 * Module-level on purpose: the throttle is per app instance, not per hook. The
 * visibility listener and the channel rejoin must share one budget, which is
 * the whole point - a component-scoped ref would give each of them its own.
 */
let lastRefreshAt: number | null = null;

/**
 * Refetch the stale, on-screen queries - at most once per
 * {@link RESUME_REFRESH_THROTTLE_MS}.
 *
 * `now` is injected so the throttle can be tested without timers. Returns
 * whether the refresh actually ran.
 */
export function resumeRefresh(queryClient: QueryClient, now: number = Date.now()): boolean {
  if (lastRefreshAt !== null && now - lastRefreshAt < RESUME_REFRESH_THROTTLE_MS) return false;
  lastRefreshAt = now;
  void queryClient.refetchQueries({ type: "active", stale: true });
  return true;
}

/** Test-only: forget the last refresh so each case starts from a cold module. */
export function resetResumeRefresh(): void {
  lastRefreshAt = null;
}
