import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `useKidLogin` reaches `@/lib/supabase`, which throws at module scope without
 * the Vite env vars - fine locally, fatal on CI. Mocked away: nothing here
 * exercises the network, only the localStorage bookkeeping behind the "Ko si
 * ti?" picker and the error unwrapping the screens read.
 */
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn<() => never>() },
    auth: { verifyOtp: vi.fn<() => never>(), setSession: vi.fn<() => never>() },
  },
}));

const { readKidAuthError, readKidDevices, removeKidDevice, saveKidDevice, updateKidDeviceTheme } =
  await import("@/hooks/useKidLogin");
const { KID_DEVICES_STORAGE_KEY } = await import("@/types/kid");

const LUKA = {
  profileId: "kid-1",
  name: "Luka",
  deviceToken: "token-luka",
  theme: "ocean" as const,
  color: "#3b82f6",
};
const SOFIJA = {
  profileId: "kid-2",
  name: "Sofija",
  deviceToken: "token-sofija",
  theme: "candy" as const,
  color: null,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("remembered devices", () => {
  it("starts empty - an unlinked device must reveal nothing about the family", () => {
    expect(readKidDevices()).toEqual([]);
  });

  it("keeps several children on one device", () => {
    saveKidDevice(LUKA);
    saveKidDevice(SOFIJA);
    expect(readKidDevices().map((entry) => entry.name)).toEqual(["Luka", "Sofija"]);
  });

  it("replaces an existing child rather than duplicating them", () => {
    saveKidDevice(LUKA);
    saveKidDevice({ ...LUKA, name: "Luka P.", deviceToken: "token-nov" });
    const devices = readKidDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ name: "Luka P.", deviceToken: "token-nov" });
  });

  it("forgets one child without touching the others", () => {
    saveKidDevice(LUKA);
    saveKidDevice(SOFIJA);
    removeKidDevice("kid-1");
    expect(readKidDevices().map((entry) => entry.profileId)).toEqual(["kid-2"]);
  });

  it("caches a theme change so the next login screen is already the right colour", () => {
    saveKidDevice(LUKA);
    updateKidDeviceTheme("kid-1", "space");
    expect(readKidDevices()[0].theme).toBe("space");
    // An unknown child is a no-op rather than an insert.
    updateKidDeviceTheme("kid-999", "sun");
    expect(readKidDevices()).toHaveLength(1);
  });

  it("treats unreadable storage as a brand-new device instead of throwing", () => {
    window.localStorage.setItem(KID_DEVICES_STORAGE_KEY, "{not json");
    expect(readKidDevices()).toEqual([]);
    window.localStorage.setItem(KID_DEVICES_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(readKidDevices()).toEqual([]);
  });

  it("drops malformed entries and normalizes an unknown theme", () => {
    window.localStorage.setItem(
      KID_DEVICES_STORAGE_KEY,
      JSON.stringify([{ profileId: "x" }, { ...LUKA, theme: "neon" }]),
    );
    const devices = readKidDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].theme).toBe("ocean");
  });
});

describe("readKidAuthError", () => {
  function functionsError(body: unknown, status = 401) {
    return { context: new Response(JSON.stringify(body), { status }) };
  }

  it("pulls the code and the attempts left out of the wrapped response", async () => {
    const parsed = await readKidAuthError(
      functionsError({ error: "Pogrešan PIN.", code: "invalid_pin", attemptsLeft: 3 }),
    );
    expect(parsed).toEqual({
      error: "Pogrešan PIN.",
      code: "invalid_pin",
      attemptsLeft: 3,
      retryAfterSeconds: undefined,
    });
  });

  it("carries the lockout countdown through", async () => {
    const parsed = await readKidAuthError(
      functionsError({ error: "Previše pokušaja.", code: "locked", retryAfterSeconds: 900 }),
    );
    expect(parsed?.code).toBe("locked");
    expect(parsed?.retryAfterSeconds).toBe(900);
  });

  it("supplies Serbian wording when the server sent only a code", async () => {
    const parsed = await readKidAuthError(functionsError({ code: "invite_expired" }));
    expect(parsed?.error).toBe("Link je istekao. Zatraži novi od roditelja.");
  });

  it("returns null for anything that is not a kid-auth failure", async () => {
    expect(await readKidAuthError(new Error("boom"))).toBeNull();
    expect(await readKidAuthError(functionsError({ error: "nešto drugo" }))).toBeNull();
    expect(await readKidAuthError({ context: new Response("<html>", { status: 500 }) })).toBeNull();
  });
});
