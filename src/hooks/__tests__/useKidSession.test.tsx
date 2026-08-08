import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  KidPreviewProvider,
  kidPreviewExit,
  type KidPreviewValue,
  type KidTabPath,
} from "@/hooks/useKidPreview";
import { useKidSession } from "@/hooks/useKidSession";

/**
 * `useKidSession` answers two different questions and must never conflate them:
 * whose app is being drawn, and whose session is drawing it.
 *
 * Conflating them is the one way the preview could do damage - a parent's
 * session reported as `isKid` would arm the theme write (`kid_set_theme`, which
 * a grown-up may not call and which has no row to write to before access
 * exists) and would let the kid layout treat a grown-up as a signed-in child.
 *
 * `@/hooks/useAuth` is mocked because the real one reaches `@/lib/supabase`,
 * which throws at import time without env vars (fine locally, fatal on CI).
 */
const h = vi.hoisted(() => ({
  user: null as { id: string; app_metadata: Record<string, unknown> } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user }),
}));

const KID_CLAIMS = {
  id: "auth-synthetic",
  app_metadata: { kid: true, kid_profile_id: "kid-1", family_id: "fam-1" },
};

function previewValue(overrides: Partial<KidPreviewValue> = {}): KidPreviewValue {
  return {
    previewProfileId: "kid-2",
    previewName: "Ana",
    familyId: "fam-1",
    exitTo: kidPreviewExit("kid-2"),
    exit: vi.fn<() => void>(),
    tab: "/kid",
    setTab: vi.fn<(tab: KidTabPath) => void>(),
    ...overrides,
  };
}

function withPreview(value: KidPreviewValue) {
  return ({ children }: { children: ReactNode }) => (
    <KidPreviewProvider value={value}>{children}</KidPreviewProvider>
  );
}

beforeEach(() => {
  h.user = null;
});

describe("useKidSession - a real child", () => {
  it("reads the child straight off the JWT claims", () => {
    h.user = KID_CLAIMS;
    const { result } = renderHook(() => useKidSession());
    expect(result.current).toEqual({
      isKid: true,
      isPreview: false,
      kidProfileId: "kid-1",
      familyId: "fam-1",
      authUserId: "auth-synthetic",
    });
  });

  it("reports nothing for a grown-up outside the preview", () => {
    h.user = { id: "auth-parent", app_metadata: {} };
    const { result } = renderHook(() => useKidSession());
    expect(result.current.isKid).toBe(false);
    expect(result.current.isPreview).toBe(false);
    expect(result.current.kidProfileId).toBeNull();
  });
});

describe("useKidSession - a parent previewing", () => {
  it("renders as the previewed child without claiming to be one", () => {
    h.user = { id: "auth-parent", app_metadata: {} };
    const { result } = renderHook(() => useKidSession(), {
      wrapper: withPreview(previewValue()),
    });
    expect(result.current).toEqual({
      isKid: false,
      isPreview: true,
      kidProfileId: "kid-2",
      familyId: "fam-1",
      authUserId: null,
    });
  });

  it("never hands out an auth user id, so the kid_access row is unreachable", () => {
    // `useKidTheme` gates its query on `isKid && authUserId` and its mutation
    // is only ever wired up outside preview - both stay shut here.
    h.user = { id: "auth-parent", app_metadata: {} };
    const { result } = renderHook(() => useKidSession(), {
      wrapper: withPreview(previewValue()),
    });
    expect(result.current.authUserId).toBeNull();
    expect(result.current.isKid).toBe(false);
  });

  it("lets the preview win over stale kid claims rather than mixing the two", () => {
    h.user = KID_CLAIMS;
    const { result } = renderHook(() => useKidSession(), {
      wrapper: withPreview(previewValue({ previewProfileId: "kid-9", previewName: "Vuk" })),
    });
    expect(result.current.kidProfileId).toBe("kid-9");
    expect(result.current.isKid).toBe(false);
    expect(result.current.authUserId).toBeNull();
  });
});
