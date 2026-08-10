import { describe, expect, it } from "vitest";

import {
  checkPasswordProof,
  decodeAccessTokenClaims,
  isKidToken,
  REAUTH_MAX_AGE_SECONDS,
} from "./authProof.ts";

// authProof is deliberately Deno-free, so this suite runs the exact code the
// edge function runs rather than a stand-in. Everything else in
// update-user-email needs a live GoTrue, which is precisely why the rules that
// decide "is this caller allowed to move the account's email" were lifted here.

const NOW = 1_800_000_000;

/** A JWT-shaped string: only the payload segment is ever read. */
function token(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

const CALLER = { sub: "user-1", session_id: "session-a", iat: NOW - 3000 };

describe("decodeAccessTokenClaims", () => {
  it("reads the claims a gate needs", () => {
    const claims = decodeAccessTokenClaims(
      token({ sub: "user-1", session_id: "session-a", iat: NOW, app_metadata: { kid: true } }),
    );
    expect(claims?.sub).toBe("user-1");
    expect(claims?.session_id).toBe("session-a");
    expect(claims?.iat).toBe(NOW);
    expect(claims?.app_metadata).toEqual({ kid: true });
  });

  it("returns null for anything that is not a token", () => {
    expect(decodeAccessTokenClaims("")).toBeNull();
    expect(decodeAccessTokenClaims("not-a-jwt")).toBeNull();
    expect(decodeAccessTokenClaims("header..signature")).toBeNull();
    expect(decodeAccessTokenClaims("header.###.signature")).toBeNull();
  });
});

describe("isKidToken", () => {
  it("spots a dečiji režim session by its app_metadata claim", () => {
    expect(isKidToken({ app_metadata: { kid: true, kid_profile_id: "p1" } })).toBe(true);
  });

  it("lets every other session through", () => {
    expect(isKidToken({ app_metadata: {} })).toBe(false);
    expect(isKidToken({})).toBe(false);
    expect(isKidToken(null)).toBe(false);
    // Only the literal boolean counts - a string is not a kid claim.
    expect(isKidToken({ app_metadata: { kid: "true" } })).toBe(false);
  });
});

describe("checkPasswordProof", () => {
  it("accepts a fresh sign-in from a different session", () => {
    const proof = { sub: "user-1", session_id: "session-b", iat: NOW - 5 };
    expect(checkPasswordProof(CALLER, proof, NOW)).toEqual({ ok: true });
  });

  it("refuses a token from the caller's own session", () => {
    // The bypass this check exists for: a stolen session can call
    // refreshSession forever, and every refreshed token has a brand new `iat`
    // while keeping the session id it was minted under.
    const refreshed = { sub: "user-1", session_id: "session-a", iat: NOW };
    expect(checkPasswordProof(CALLER, refreshed, NOW)).toEqual({
      ok: false,
      reason: "same_session",
    });
  });

  it("refuses a proof minted for someone else", () => {
    const proof = { sub: "user-2", session_id: "session-b", iat: NOW };
    expect(checkPasswordProof(CALLER, proof, NOW)).toEqual({ ok: false, reason: "wrong_user" });
  });

  it("expires after REAUTH_MAX_AGE_SECONDS", () => {
    const edge = { sub: "user-1", session_id: "session-b", iat: NOW - REAUTH_MAX_AGE_SECONDS };
    expect(checkPasswordProof(CALLER, edge, NOW)).toEqual({ ok: true });

    const stale = { sub: "user-1", session_id: "session-b", iat: NOW - REAUTH_MAX_AGE_SECONDS - 1 };
    expect(checkPasswordProof(CALLER, stale, NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("tolerates a client clock a minute ahead, but not an invented future", () => {
    const ahead = { sub: "user-1", session_id: "session-b", iat: NOW + 45 };
    expect(checkPasswordProof(CALLER, ahead, NOW)).toEqual({ ok: true });

    const invented = { sub: "user-1", session_id: "session-b", iat: NOW + 3600 };
    expect(checkPasswordProof(CALLER, invented, NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses anything missing a claim the rule is built on", () => {
    const complete = { sub: "user-1", session_id: "session-b", iat: NOW };
    expect(checkPasswordProof(CALLER, null, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(checkPasswordProof(CALLER, { ...complete, session_id: undefined }, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(checkPasswordProof(CALLER, { ...complete, iat: undefined }, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    // A caller token without a session id cannot be compared against, so the
    // gate closes rather than waving the proof through.
    expect(checkPasswordProof({ sub: "user-1" }, complete, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(checkPasswordProof(null, complete, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});
