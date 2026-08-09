import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KidAccessSection } from "@/components/family/KidAccessSection";
import type { KidAccess, KidDevice, Profile } from "@/types/database";

/**
 * The section is mocked at the hook boundary: the real hooks reach
 * `@/lib/supabase`, which throws at import time without env vars (fine
 * locally, fatal on CI).
 */
const h = vi.hoisted(() => ({
  isAdmin: true,
  access: null as KidAccess | null,
  accessLoading: false,
  accessError: false,
  devices: [] as KidDevice[],
  devicesLoading: false,
  devicesError: false,
  invite: null as { token: string; expiresAt: string } | null,
  invitePending: false,
  inviteError: false,
  enable: vi.fn<(input: { profileId: string; pin: string }) => Promise<void>>(),
  setPin: vi.fn<(input: { profileId: string; pin: string }) => Promise<void>>(),
  disable: vi.fn<(profileId: string, opts?: { onSuccess?: () => void }) => void>(),
  revoke: vi.fn<(input: { deviceId: string; profileId: string }) => Promise<void>>(),
  createInvite: vi.fn<(profileId: string) => Promise<{ token: string; expiresAt: string }>>(),
  navigate: vi.fn<(options: unknown) => void>(),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ isAdmin: h.isAdmin, familyId: "fam-1" }),
}));

// The preview entry point navigates out of the settings page; there is no
// router in this render, so the hook is stubbed and the call asserted instead.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
}));

vi.mock("@/hooks/useKidAccess", () => ({
  useKidAccessList: () => ({
    rows: h.access ? [h.access] : [],
    byProfileId: new Map(h.access ? [[h.access.profile_id, h.access]] : []),
    enabledIds: new Set(h.access?.is_enabled ? [h.access.profile_id] : []),
    isLoading: h.accessLoading,
    isError: h.accessError,
  }),
  useKidDevices: () => ({
    devices: h.devices,
    isLoading: h.devicesLoading,
    isError: h.devicesError,
  }),
  useEnableKidAccess: () => ({ mutateAsync: h.enable, isPending: false }),
  useSetKidPin: () => ({ mutateAsync: h.setPin, isPending: false }),
  useDisableKidAccess: () => ({ mutate: h.disable, isPending: false }),
  useRevokeKidDevice: () => ({ mutateAsync: h.revoke, isPending: false }),
  // `mutateAsync`, not `mutate`: the view holds the minted token in component
  // state because a mount-effect mutation loses its result to StrictMode's
  // observer teardown. Mocking `mutate` + `data` hid that bug from these tests.
  useCreateKidInvite: () => ({
    mutateAsync: h.createInvite,
    isPending: h.invitePending,
  }),
}));

const member = {
  id: "kid-1",
  family_id: "fam-1",
  full_name: "Luka",
  first_name: "Luka",
  last_name: null,
  avatar_url: null,
  color: null,
  is_admin: false,
  onboarding_hidden_at: null,
  nav_slots: null,
  accent: null,
  avatar_emoji: null,
  member_avatar_style: null,
  has_login: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} satisfies Profile;

const enabledAccess: KidAccess = {
  profile_id: "kid-1",
  family_id: "fam-1",
  auth_user_id: "auth-1",
  is_enabled: true,
  theme: "ocean",
  locked_until: null,
  last_login_at: "2026-08-06T18:30:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-06T18:30:00.000Z",
};

function device(overrides: Partial<KidDevice> = {}): KidDevice {
  return {
    id: "dev-1",
    profile_id: "kid-1",
    family_id: "fam-1",
    label: "iPhone",
    created_at: "2026-08-02T10:00:00.000Z",
    last_seen_at: null,
    ...overrides,
  };
}

function renderSection(memberOverrides: Partial<Profile> = {}) {
  return render(<KidAccessSection member={{ ...member, ...memberOverrides }} memberName="Luka" />);
}

beforeEach(() => {
  h.isAdmin = true;
  h.access = null;
  h.accessLoading = false;
  h.accessError = false;
  h.devices = [];
  h.devicesLoading = false;
  h.devicesError = false;
  h.invite = null;
  h.invitePending = false;
  h.inviteError = false;
  h.enable.mockResolvedValue(undefined);
  h.setPin.mockResolvedValue(undefined);
  h.revoke.mockResolvedValue(undefined);

  // The view awaits the mutation and keeps the token itself, so the three
  // `h.invite*` switches drive the PROMISE rather than a `data` field:
  // pending = never settles, error = rejects, otherwise resolve the token.
  h.createInvite.mockReset();
  h.createInvite.mockImplementation(() => {
    if (h.invitePending) return new Promise(() => {});
    if (h.inviteError) return Promise.reject(new Error("invite failed"));
    return Promise.resolve(
      h.invite ?? { token: "tok-abc", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() },
    );
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("KidAccessSection - gating", () => {
  it("renders nothing for a non-admin", () => {
    h.isAdmin = false;
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a member who already has a real login", () => {
    const { container } = renderSection({ has_login: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("says it is checking rather than claiming the feature is off", () => {
    h.accessLoading = true;
    renderSection();
    expect(screen.getByText(/Provera dečijeg pristupa/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uključi pristup" })).toBeNull();
  });

  it("owns up when the status could not be loaded", () => {
    h.accessError = true;
    renderSection();
    expect(screen.getByText(/nije učitan/)).toBeInTheDocument();
  });
});

describe("KidAccessSection - turning it on", () => {
  it("explains what the child will and will not see", () => {
    renderSection();
    expect(screen.getByText(/bez email adrese i lozinke/)).toBeInTheDocument();
    expect(
      screen.getByText(/novac, liste, podsetnike i tuđe obaveze ne vidi nikada/),
    ).toBeInTheDocument();
  });

  it("collects the PIN twice and hands it to the mutation", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Uključi pristup" }));

    expect(
      await screen.findByRole("heading", { name: "Uključi dečiji pristup" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "2580" } });
    fireEvent.change(screen.getByLabelText("Ponovi PIN"), { target: { value: "2580" } });
    fireEvent.click(screen.getByRole("button", { name: "Uključi pristup" }));

    expect(h.enable).toHaveBeenCalledWith({ profileId: "kid-1", pin: "2580" });
  });

  it("goes straight on to linking a device, since access alone is inert", async () => {
    h.invite = { token: "tok-abc", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Uključi pristup" }));
    fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "2580" } });
    fireEvent.change(screen.getByLabelText("Ponovi PIN"), { target: { value: "2580" } });
    fireEvent.click(screen.getByRole("button", { name: "Uključi pristup" }));

    expect(await screen.findByRole("heading", { name: "Poveži uređaj" })).toBeInTheDocument();
    // The heading is there the moment the sheet opens, but the QR, the
    // countdown and the link all wait on the invite mutation - so these have to
    // be awaited too. Asserting them synchronously passed only because the
    // promise usually settled first, and lost that race about once in a
    // hundred runs.
    expect(await screen.findByRole("img", { name: /QR kod/ })).toBeInTheDocument();
    expect(await screen.findByText(/Važi još/)).toBeInTheDocument();
    expect(await screen.findByText(/kid\/veza#tok-abc/)).toBeInTheDocument();
  });
});

describe("KidAccessSection - once it is on", () => {
  it("summarises the state and warns while no device is linked", () => {
    h.access = enabledAccess;
    renderSection();

    expect(screen.getByText("Aktivan")).toBeInTheDocument();
    expect(screen.getByText("Poslednja prijava")).toBeInTheDocument();
    expect(screen.getByText("Nijedan")).toBeInTheDocument();
    expect(screen.getByText(/ne može da se prijavi/)).toBeInTheDocument();
  });

  it("counts the linked devices", () => {
    h.access = enabledAccess;
    h.devices = [device(), device({ id: "dev-2", label: "iPad" })];
    renderSection();
    expect(screen.getByText("2 uređaja")).toBeInTheDocument();
  });

  it("explains a lockout instead of just showing a badge", () => {
    h.access = { ...enabledAccess, locked_until: new Date(Date.now() + 10 * 60_000).toISOString() };
    renderSection();
    expect(screen.getByText("Zaključan")).toBeInTheDocument();
    expect(screen.getByText(/Previše pogrešnih PIN-ova/)).toBeInTheDocument();
  });

  it("orders the actions primary-first, destructive-last", () => {
    h.access = enabledAccess;
    renderSection();

    const rows = [
      /^Poveži uređaj/,
      /^Pogledaj dečiju aplikaciju/,
      /^Nova PIN šifra/,
      /^Uređaji/,
      /^Isključi pristup/,
    ].map((name) => screen.getByRole("button", { name }));
    for (let i = 1; i < rows.length; i++) {
      expect(
        rows[i - 1].compareDocumentPosition(rows[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

/**
 * The preview has to be reachable in BOTH states, and the disabled one is the
 * one that matters: that is the moment a parent is deciding whether to turn kid
 * access on, with nothing yet to look at.
 */
describe("KidAccessSection - previewing the child's app", () => {
  it("offers the preview right next to the decision, before access exists", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Pogledaj dečiju aplikaciju/ }));
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/kid/pregled",
      search: { dete: "kid-1" },
    });
  });

  it("offers it again once access is on, without stealing the primary action", () => {
    h.access = enabledAccess;
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Pogledaj dečiju aplikaciju/ }));
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/kid/pregled",
      search: { dete: "kid-1" },
    });
  });
});

describe("KidAccessSection - linking a device", () => {
  it("never shows a stale QR while a fresh link is being made", async () => {
    h.access = enabledAccess;
    h.invite = { token: "stari", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    h.invitePending = true;
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Poveži uređaj/ }));
    expect(await screen.findByText(/Pravim link za povezivanje/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR kod/ })).toBeNull();
  });

  it("shows the code to type as well as the QR, since a child cannot always scan", async () => {
    h.access = enabledAccess;
    h.invite = { token: "A7K29QXM", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Poveži uređaj/ }));
    // Grouped for reading aloud, and next to the QR rather than hidden away:
    // on iOS an installed kid app cannot be handed a scanned URL at all.
    expect(await screen.findByText("A7K2-9QXM")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR kod/ })).toBeInTheDocument();
    expect(screen.getByText(/prvo doda/)).toBeInTheDocument();
  });

  it("shows no code when the function still mints long tokens", async () => {
    h.access = enabledAccess;
    // The window between deploys: the QR and the link still work, and there is
    // simply nothing worth reading out loud, so the box stays away.
    h.invite = { token: "x".repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Poveži uređaj/ }));
    expect(await screen.findByRole("img", { name: /QR kod/ })).toBeInTheDocument();
    expect(screen.queryByText(/Ili neka dete ukuca/)).toBeNull();
  });

  it("offers a retry when the link could not be made", async () => {
    h.access = enabledAccess;
    h.inviteError = true;
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Poveži uređaj/ }));
    expect(await screen.findByText(/Link nije napravljen/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pokušaj ponovo" }));
    // Once when the view mounted, once for the retry.
    expect(h.createInvite).toHaveBeenCalledTimes(2);
    expect(h.createInvite).toHaveBeenLastCalledWith("kid-1");
  });
});

describe("KidAccessSection - devices", () => {
  it("offers a way out of the empty list instead of a dead end", async () => {
    h.access = enabledAccess;
    h.invite = { token: "tok-abc", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Uređaji/ }));
    expect(await screen.findByText(/Nijedan uređaj još nije povezan/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Poveži uređaj" }));
    expect(await screen.findByRole("heading", { name: "Poveži uređaj" })).toBeInTheDocument();
  });

  it("confirms a revoke, spelling out that it is the last device", async () => {
    h.access = enabledAccess;
    h.devices = [device({ label: "iPhone" })];
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Uređaji/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ukloni uređaj iPhone" }));

    expect(await screen.findByText(/jedini povezani uređaj/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ukloni uređaj" }));

    expect(h.revoke).toHaveBeenCalledWith({ deviceId: "dev-1", profileId: "kid-1" });
  });
});

describe("KidAccessSection - turning it off", () => {
  it("says what actually happens before disabling", async () => {
    h.access = enabledAccess;
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /^Isključi pristup/ }));
    expect(await screen.findByText(/odjavljuje sa svih uređaja/)).toBeInTheDocument();
    expect(screen.getByText(/ostaju netaknuti/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Isključi pristup" }));
    expect(h.disable).toHaveBeenCalledWith("kid-1", expect.anything());
  });
});
