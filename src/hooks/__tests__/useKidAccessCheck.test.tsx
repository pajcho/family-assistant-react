import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The probe that tells a revoked child what happened.
 *
 * Two properties matter more than the happy path and are tested hardest:
 *
 *   - it signs a child out ONLY on a definitive server verdict. Offline, a 500
 *     or an unreadable body must leave them exactly where they are - a child on
 *     a bad connection thrown out of their own app is worse than the extra
 *     minutes of access the probe exists to remove;
 *   - `device_unknown` forgets this device (its token is dead, the picker
 *     button would only ever fail) while `access_disabled` keeps it, because a
 *     parent can switch that back on and the PIN alone should get them in.
 *
 * `@/lib/supabase` is mocked away: it throws at module scope without the Vite
 * env vars (fine locally, fatal on CI), and nothing here should reach a network.
 */
const h = vi.hoisted(() => ({
  invoke: vi.fn<(name: string, options: { body: unknown }) => Promise<unknown>>(),
  signOut: vi.fn<() => Promise<void>>(async () => {}),
  session: { user: { id: "auth-synthetic" } } as { user: { id: string } } | null,
  kidSession: {
    isKid: true,
    isPreview: false,
    kidProfileId: "kid-1",
    familyId: "fam-1",
    authUserId: "auth-synthetic",
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: h.invoke } },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, signOut: h.signOut }),
}));

vi.mock("@/hooks/useKidSession", () => ({
  useKidSession: () => h.kidSession,
}));

const { useKidAccessCheck } = await import("@/hooks/useKidAccessCheck");
const { readKidDevices, saveKidDevice } = await import("@/hooks/useKidLogin");

const VUK = {
  profileId: "kid-1",
  name: "Vuk",
  deviceToken: "device-token-vuk",
  theme: "ocean" as const,
  color: null,
};

/** The shape supabase-js hands back for a non-2xx Edge Function response. */
function httpError(body: unknown) {
  return { context: { json: async () => body } };
}

beforeEach(() => {
  window.localStorage.clear();
  h.invoke.mockReset();
  h.signOut.mockClear();
  h.session = { user: { id: "auth-synthetic" } };
  h.kidSession = {
    isKid: true,
    isPreview: false,
    kidProfileId: "kid-1",
    familyId: "fam-1",
    authUserId: "auth-synthetic",
  };
  saveKidDevice(VUK);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useKidAccessCheck - when it asks at all", () => {
  it("probes once on mount, with this device's token", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useKidAccessCheck());

    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(h.invoke).toHaveBeenCalledWith("kid-auth", {
      body: { action: "check", deviceToken: "device-token-vuk" },
    });
    expect(result.current.revoked).toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("stays silent in the parent-side preview", async () => {
    h.kidSession = { ...h.kidSession, isKid: false, isPreview: true };
    renderHook(() => useKidAccessCheck());
    await Promise.resolve();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("stays silent before there is a session", async () => {
    h.session = null;
    renderHook(() => useKidAccessCheck());
    await Promise.resolve();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("stays silent when this device has no saved token to ask with", async () => {
    window.localStorage.clear();
    renderHook(() => useKidAccessCheck());
    await Promise.resolve();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("throttles the foreground checks instead of hammering the endpoint", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    renderHook(() => useKidAccessCheck());
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));

    // Straight back to the app: too soon, nothing goes out.
    now.mockReturnValue(start + 5_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await Promise.resolve();
    expect(h.invoke).toHaveBeenCalledTimes(1);

    // A minute later the same event does ask again.
    now.mockReturnValue(start + 61_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  });
});

describe("useKidAccessCheck - a definitive no", () => {
  it("device_unknown signs the child out AND forgets this device", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: "Ovaj uređaj više nije povezan.", code: "device_unknown" }),
    });

    const { result } = renderHook(() => useKidAccessCheck());

    await waitFor(() => expect(result.current.revoked).toBe("device_unknown"));
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(readKidDevices()).toEqual([]);
  });

  it("access_disabled signs the child out but KEEPS this device", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: "Pristup je isključen.", code: "access_disabled" }),
    });

    const { result } = renderHook(() => useKidAccessCheck());

    await waitFor(() => expect(result.current.revoked).toBe("access_disabled"));
    expect(h.signOut).toHaveBeenCalledTimes(1);
    // A parent can switch this back on, and then the PIN alone is enough.
    expect(readKidDevices().map((entry) => entry.deviceToken)).toEqual(["device-token-vuk"]);
  });

  it("hands the screen a way back to normal", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: "Pristup je isključen.", code: "access_disabled" }),
    });
    const { result } = renderHook(() => useKidAccessCheck());
    await waitFor(() => expect(result.current.revoked).toBe("access_disabled"));

    act(() => result.current.dismiss());
    expect(result.current.revoked).toBeNull();
  });
});

describe("useKidAccessCheck - fails open", () => {
  it("keeps the child signed in when the request never lands", async () => {
    h.invoke.mockRejectedValue(new Error("Failed to fetch"));

    const { result } = renderHook(() => useKidAccessCheck());

    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(result.current.revoked).toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(readKidDevices()).toHaveLength(1);
  });

  it("keeps the child signed in on a server error with no verdict in it", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => {
            throw new Error("not json");
          },
        },
      },
    });

    const { result } = renderHook(() => useKidAccessCheck());

    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(result.current.revoked).toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("ignores a code it does not act on, such as a lockout", async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: "Previše pokušaja.", code: "locked" }),
    });

    const { result } = renderHook(() => useKidAccessCheck());

    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(result.current.revoked).toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
