import { describe, expect, it } from "vitest";

import {
  formatKidInviteCode,
  isKidInviteCode,
  isKidShellPath,
  kidInviteTokenFromScan,
  normalizeKidInviteCode,
} from "@/types/kid";

/**
 * The `/kid/pregled` exclusion is the whole reason this predicate exists, and
 * it is invisible from the call sites: a parent previewing their child's app is
 * still a parent, so nothing addressed to a child may reach that screen.
 *
 * `src/lib/__tests__/kidInstallIdentity.test.ts` pins the same rule for the
 * copy of it that gets stringified into `index.html`. The two are tested apart
 * on purpose - if they ever disagree, both suites should say so.
 */
describe("isKidShellPath", () => {
  it("is true across the kid shell", () => {
    expect(isKidShellPath("/kid")).toBe(true);
    expect(isKidShellPath("/kid/")).toBe(true);
    expect(isKidShellPath("/kid/login")).toBe(true);
    expect(isKidShellPath("/kid/veza")).toBe(true);
    expect(isKidShellPath("/kid/raspored")).toBe(true);
  });

  it("is false on the parent's preview of it", () => {
    expect(isKidShellPath("/kid/pregled")).toBe(false);
  });

  it("is false everywhere in the grown-up app", () => {
    expect(isKidShellPath("/")).toBe(false);
    expect(isKidShellPath("/novac")).toBe(false);
    expect(isKidShellPath("/login")).toBe(false);
  });

  it("does not match a route that merely starts with the same letters", () => {
    expect(isKidShellPath("/kidney")).toBe(false);
    expect(isKidShellPath("/kid-mode")).toBe(false);
  });
});

/**
 * The invite code is one secret with two readers: a camera and a child at a
 * keyboard. What follows is the client's half of it.
 *
 * The half that matters most is tested next door, in
 * `supabase/functions/_shared/kidCrypto.test.ts`: that this normalization is
 * character-for-character the edge function's. A client that folds differently
 * hashes a different string, and every typed code becomes "pogrešan kod" with
 * nothing on either screen to explain why. It has to live over there because
 * the Deno half is outside every tsconfig project and cannot be imported from
 * `src`.
 */
describe("normalizeKidInviteCode", () => {
  it("forgives how a code is typed", () => {
    expect(normalizeKidInviteCode("a7k2-9qxm")).toBe("A7K29QXM");
    expect(normalizeKidInviteCode(" A7K2 9QXM ")).toBe("A7K29QXM");
  });

  it("folds the characters that are read two ways", () => {
    expect(normalizeKidInviteCode("OIL")).toBe("011");
    expect(normalizeKidInviteCode("oil")).toBe("011");
  });

  it("drops what could never be in a code", () => {
    expect(normalizeKidInviteCode("žčć-A7K2")).toBe("A7K2");
    expect(normalizeKidInviteCode("---")).toBe("");
  });
});

describe("isKidInviteCode", () => {
  it("wants a complete, already-normalized code", () => {
    expect(isKidInviteCode("A7K29QXM")).toBe(true);
    expect(isKidInviteCode("A7K29QX")).toBe(false); // too short
    expect(isKidInviteCode("A7K29QXMM")).toBe(false); // too long
    expect(isKidInviteCode("a7k29qxm")).toBe(false); // not normalized
    expect(isKidInviteCode("A7K2-9QXM")).toBe(false); // the displayed form
    expect(isKidInviteCode("")).toBe(false);
  });
});

describe("formatKidInviteCode", () => {
  it("groups a full code in fours", () => {
    expect(formatKidInviteCode("A7K29QXM")).toBe("A7K2-9QXM");
  });

  it("only adds the dash once there is something after it", () => {
    expect(formatKidInviteCode("A7K")).toBe("A7K");
    expect(formatKidInviteCode("A7K2")).toBe("A7K2");
    expect(formatKidInviteCode("A7K29")).toBe("A7K2-9");
  });

  it("normalizes what it is given, so a field can round-trip its own value", () => {
    expect(formatKidInviteCode("a7k2-9qxm")).toBe("A7K2-9QXM");
    expect(formatKidInviteCode(formatKidInviteCode("A7K29QXM"))).toBe("A7K2-9QXM");
  });
});

describe("kidInviteTokenFromScan", () => {
  it("takes the token out of a device-link URL", () => {
    expect(kidInviteTokenFromScan("https://example.com/kid/veza#A7K29QXM")).toBe("A7K29QXM");
    // On Pages the app lives under a base path.
    expect(kidInviteTokenFromScan("https://example.com/family-assistant/kid/veza#A7K29QXM")).toBe(
      "A7K29QXM",
    );
  });

  it("passes a URL token through unchanged, however long", () => {
    // An older parent app minting 32-byte tokens: not our call to reject, the
    // server still knows those hashes.
    const legacy = "hR3-_qZ9".repeat(5);
    expect(kidInviteTokenFromScan(`https://example.com/kid/veza#${legacy}`)).toBe(legacy);
  });

  it("accepts a bare code, in whatever case it was written", () => {
    expect(kidInviteTokenFromScan("A7K29QXM")).toBe("A7K29QXM");
    expect(kidInviteTokenFromScan("a7k2-9qxm")).toBe("A7K29QXM");
  });

  it("refuses everything that is not a device link", () => {
    // The QR codes a child's camera will actually meet first.
    expect(kidInviteTokenFromScan("https://suf.purs.gov.rs/v/?vl=A5NKa")).toBe(null);
    expect(kidInviteTokenFromScan("WIFI:S:Kucni;T:WPA;P:tajna;;")).toBe(null);
    expect(kidInviteTokenFromScan("https://example.com/kid/veza")).toBe(null); // no fragment
    expect(kidInviteTokenFromScan("https://example.com/kid/login#A7K29QXM")).toBe(null);
    expect(kidInviteTokenFromScan("not a url at all")).toBe(null);
    expect(kidInviteTokenFromScan("   ")).toBe(null);
  });
});
