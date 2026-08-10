import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RESUME_REFRESH_THROTTLE_MS, resetResumeRefresh, resumeRefresh } from "@/lib/resumeRefresh";

/**
 * Two callers share one budget: the `visibilitychange` listener and the
 * realtime rejoin. On iOS a single foreground fires both, so the throttle is
 * the only thing standing between a resume and a doubled request storm.
 *
 * The clock is injected, so nothing here depends on real or fake timers.
 */
function makeClient() {
  const refetchQueries = vi.fn<(filters: unknown) => Promise<void>>(() => Promise.resolve());
  return { refetchQueries } as unknown as QueryClient & {
    refetchQueries: ReturnType<typeof vi.fn>;
  };
}

describe("resumeRefresh", () => {
  beforeEach(() => {
    resetResumeRefresh();
  });

  it("runs on the first call and refetches only the stale, active queries", () => {
    const client = makeClient();

    expect(resumeRefresh(client, 1_000)).toBe(true);
    expect(client.refetchQueries).toHaveBeenCalledTimes(1);
    // `stale: true` is the load-bearing bit: a blanket invalidate would
    // override every deliberate staleTime, including the Infinity one.
    expect(client.refetchQueries).toHaveBeenCalledWith({ type: "active", stale: true });
  });

  it("swallows a second call inside the throttle window", () => {
    const client = makeClient();

    expect(resumeRefresh(client, 1_000)).toBe(true);
    // The rejoin landing right behind the visibility event - one foreground.
    expect(resumeRefresh(client, 1_050)).toBe(false);
    expect(resumeRefresh(client, 1_000 + RESUME_REFRESH_THROTTLE_MS - 1)).toBe(false);
    expect(client.refetchQueries).toHaveBeenCalledTimes(1);
  });

  it("runs again once the window has passed", () => {
    const client = makeClient();

    resumeRefresh(client, 1_000);
    expect(resumeRefresh(client, 1_000 + RESUME_REFRESH_THROTTLE_MS)).toBe(true);
    expect(client.refetchQueries).toHaveBeenCalledTimes(2);
  });

  it("measures the window from the last refresh that actually ran", () => {
    const client = makeClient();

    resumeRefresh(client, 1_000);
    // A throttled call must NOT push the window forward, or a steady drip of
    // foreground/background flaps would starve the refresh forever.
    resumeRefresh(client, 1_000 + RESUME_REFRESH_THROTTLE_MS - 1);
    expect(resumeRefresh(client, 1_000 + RESUME_REFRESH_THROTTLE_MS)).toBe(true);
    expect(client.refetchQueries).toHaveBeenCalledTimes(2);
  });
});
