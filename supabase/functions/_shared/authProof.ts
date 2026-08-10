// supabase/functions/_shared/authProof.ts
//
// Who is calling, and did they just prove they know the password?
//
// Two jobs, both pure: read the claims off a Supabase access token, and judge a
// "password proof" token against the caller's own token. No imports at all and
// no Deno APIs, which is what lets `authProof.test.ts` next to it exercise the
// REAL implementation under vitest - the edge functions themselves sit outside
// every tsconfig and are neither typechecked nor unit-tested from this repo, so
// whatever can live here instead of in an index.ts should.
//
// THE THREAT. `update-user-email` moves an account to a new address and marks
// it verified on the spot. A live session must not be enough on its own: a
// borrowed unlocked phone or a lifted token could otherwise move the account to
// an address the thief controls and then take it over through the ordinary
// password-reset flow. So the caller has to hand over proof that the password
// was entered moments ago - the same bar the password change already sets
// (src/components/settings/PasswordCard.tsx).
//
// WHAT COUNTS AS PROOF. The client signs in again on a sessionless client and
// sends the access token that sign-in returned. To pass, that token must be:
//
//   1. for the same `sub` as the caller - the caller's own account,
//   2. from a DIFFERENT `session_id` than the caller's token, and
//   3. freshly issued (`iat` within REAUTH_MAX_AGE_SECONDS).
//
// (2) is the load-bearing check. A stolen session can mint fresh tokens forever
// through `refreshSession`, so `iat` on its own proves nothing - but a refresh
// keeps the SAME `session_id`, and the only way to open a NEW session for an
// account is to present credentials. `session_id` is a required claim on every
// Supabase access token (`RequiredClaims` in @supabase/auth-js), so a token
// without one is not one of ours and is refused.
//
// Neither token is trusted on the strength of its contents: the caller's token
// is verified by the Functions platform (verify_jwt = true) and the proof token
// is handed to GoTrue by `update-user-email` before anything is written. This
// module only decides whether a pair of already-verified tokens satisfies the
// rule above.

/** How recently the password must have been entered, in seconds. */
export const REAUTH_MAX_AGE_SECONDS = 5 * 60;

/** Tolerance for a client whose clock runs ahead of ours, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

/** The claims this module reads off a Supabase access token. */
export interface AccessTokenClaims {
  sub?: string;
  iat?: number;
  session_id?: string;
  app_metadata?: Record<string, unknown>;
}

/**
 * Pulls the claims out of a JWT WITHOUT verifying its signature. Every caller
 * has to have established genuineness some other way first - see the note at
 * the top of this file.
 */
export function decodeAccessTokenClaims(token: string): AccessTokenClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "===".slice((padded.length + 3) % 4));
    const claims = JSON.parse(decoded) as AccessTokenClaims;
    if (!claims || typeof claims !== "object") return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Is this a kid mode session? The claims are written into the synthetic
 * auth user's `app_metadata` at provision time (see kid-access's `enable`), so
 * they ride along in the JWT and cost no round trip. Mirrors `readKidClaims`
 * in src/types/kid.ts, restated because Deno cannot import across the frontend
 * boundary.
 */
export function isKidToken(claims: AccessTokenClaims | null): boolean {
  return claims?.app_metadata?.kid === true;
}

export type ProofVerdict =
  | { ok: true }
  | { ok: false; reason: "malformed" | "wrong_user" | "same_session" | "stale" };

/**
 * Does `proof` show that whoever holds `caller` entered the account password
 * within the last few minutes? `nowSeconds` is a unix timestamp so the rule can
 * be tested without mocking the clock.
 */
export function checkPasswordProof(
  caller: AccessTokenClaims | null,
  proof: AccessTokenClaims | null,
  nowSeconds: number,
): ProofVerdict {
  if (typeof caller?.sub !== "string" || typeof caller.session_id !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (typeof proof?.sub !== "string" || typeof proof.session_id !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (typeof proof.iat !== "number" || !Number.isFinite(proof.iat)) {
    return { ok: false, reason: "malformed" };
  }
  if (proof.sub !== caller.sub) return { ok: false, reason: "wrong_user" };
  // The whole point: same session means a refresh, not a new sign-in.
  if (proof.session_id === caller.session_id) return { ok: false, reason: "same_session" };

  const age = nowSeconds - proof.iat;
  if (age > REAUTH_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };
  // A token from the future by more than the skew allowance is not a clock
  // difference, it is someone picking numbers.
  if (age < -CLOCK_SKEW_SECONDS) return { ok: false, reason: "stale" };

  return { ok: true };
}
