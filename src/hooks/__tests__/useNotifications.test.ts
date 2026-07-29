import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A `PushSubscription` belongs to the browser, not to an account, and survives
 * sign-out. Deciding "notifications are on" from that alone told the newly
 * signed-in user they were subscribed while every push still went to the
 * previous one. These tests pin the two-sided rule: browser subscription AND a
 * `push_subscriptions` row that belongs to whoever is signed in now.
 */

const mocks = vi.hoisted(() => ({
  rows: { subscriptions: [] as { endpoint: string }[], isLoading: false },
  refresh: vi.fn<() => Promise<void>>(async () => {}),
  invoke: vi.fn<() => Promise<{ error: Error | null }>>(async () => ({ error: null })),
  deleteEq: vi.fn<() => Promise<{ error: Error | null }>>(async () => ({ error: null })),
}));

vi.mock("@/hooks/usePushSubscriptions", () => ({
  usePushSubscriptionRows: () => ({
    subscriptions: mocks.rows.subscriptions,
    isLoading: mocks.rows.isLoading,
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: () => ({ delete: () => ({ eq: mocks.deleteEq }) }),
  },
}));

vi.mock("@/lib/pwa-config", () => ({
  vapidPublicKeyToUint8Array: () => new Uint8Array([1, 2, 3]),
}));

import { useNotifications } from "@/hooks/useNotifications";

const MINE = "https://push.test/mine";
const THEIRS = "https://push.test/theirs";
const FRESH = "https://push.test/fresh";

type FakeSub = {
  endpoint: string;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
};

function fakeSub(endpoint: string): FakeSub {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn<() => Promise<boolean>>(async () => true),
  };
}

let deviceSub: FakeSub | null = null;
const pushManager = {
  getSubscription: vi.fn<() => Promise<FakeSub | null>>(async () => deviceSub),
  subscribe: vi.fn<() => Promise<FakeSub>>(async () => {
    deviceSub = fakeSub(FRESH);
    return deviceSub;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  deviceSub = null;
  mocks.rows = { subscriptions: [], isLoading: false };
  mocks.invoke.mockResolvedValue({ error: null });

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  // jsdom ships neither, and `isSupported()` gates the whole hook on them.
  Object.defineProperty(globalThis, "PushManager", { configurable: true, value: class {} });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: {
      permission: "granted",
      requestPermission: vi.fn<() => Promise<NotificationPermission>>(async () => "granted"),
    },
  });
});

async function renderSettled() {
  const view = renderHook(() => useNotifications());
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  return view;
}

describe("useNotifications - whose subscription is it", () => {
  it("does not report a subscription left behind by another account", async () => {
    deviceSub = fakeSub(THEIRS);
    mocks.rows.subscriptions = []; // signed-in user owns no rows

    const { result } = await renderSettled();

    expect(result.current.isSubscribed).toBe(false);
    // The device is still identified, so the sessions list can match rows on it.
    expect(result.current.subscription?.endpoint).toBe(THEIRS);
  });

  it("reports a subscription whose server row belongs to the signed-in user", async () => {
    deviceSub = fakeSub(MINE);
    mocks.rows.subscriptions = [{ endpoint: MINE }];

    const { result } = await renderSettled();

    expect(result.current.isSubscribed).toBe(true);
  });

  it("drops back to not-subscribed when the row was revoked from another device", async () => {
    deviceSub = fakeSub(MINE);
    mocks.rows.subscriptions = []; // row deleted elsewhere in the session list

    const { result } = await renderSettled();

    expect(result.current.isSubscribed).toBe(false);
  });

  it("stays in checking until both the browser and the row list have answered", async () => {
    deviceSub = fakeSub(MINE);
    mocks.rows = { subscriptions: [], isLoading: true };

    const { result } = renderHook(() => useNotifications());
    expect(result.current.checking).toBe(true);
    // Still checking once the browser half lands, because the rows are pending.
    await waitFor(() => expect(result.current.subscription?.endpoint).toBe(MINE));
    expect(result.current.checking).toBe(true);
  });
});

describe("useNotifications - subscribe", () => {
  it("recycles another account's endpoint into a fresh one", async () => {
    const theirs = fakeSub(THEIRS);
    deviceSub = theirs;
    mocks.rows.subscriptions = [];

    const { result } = await renderSettled();
    await act(async () => {
      await result.current.subscribe();
    });

    // Re-pointing the existing endpoint is impossible: subscribe-push upserts
    // on `endpoint` and RLS rejects the UPDATE arm against another user's row.
    expect(theirs.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "subscribe-push",
      expect.objectContaining({ body: expect.objectContaining({ endpoint: FRESH }) }),
    );
    expect(result.current.error).toBeNull();
  });

  it("keeps our own endpoint instead of churning it", async () => {
    const mine = fakeSub(MINE);
    deviceSub = mine;
    mocks.rows.subscriptions = [{ endpoint: MINE }];

    const { result } = await renderSettled();
    await act(async () => {
      await result.current.subscribe();
    });

    expect(mine.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "subscribe-push",
      expect.objectContaining({ body: expect.objectContaining({ endpoint: MINE }) }),
    );
  });

  it("refetches the session list so the new device shows up right away", async () => {
    deviceSub = null;
    mocks.rows.subscriptions = [];

    const { result } = await renderSettled();
    await act(async () => {
      await result.current.subscribe();
    });

    // push_subscriptions is user-scoped (no family_id), so it never rides the
    // family broadcast channel - without this the list stays stale.
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("refetches the session list after unsubscribing too", async () => {
    deviceSub = fakeSub(MINE);
    mocks.rows.subscriptions = [{ endpoint: MINE }];

    const { result } = await renderSettled();
    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(mocks.deleteEq).toHaveBeenCalledWith("endpoint", MINE);
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
