// supabase/functions/kid-auth/gate.ts
//
// The lockout + PIN gate, split out of index.ts so it can be tested. The
// response helpers come along because the gate answers in Responses, and
// leaving them behind would mean index.ts and this file importing each other.
//
// Why this half is worth testing on its own: the file header in index.ts says
// the lockout - not the hash - is what makes a 4-digit secret defensible, so
// the branching below IS the control. `verifyPin` is the real PBKDF2 from
// _shared/kidCrypto.ts (Deno-free), and the only thing a test has to stand in
// for is the Supabase client.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { verifyPin } from "../_shared/kidCrypto.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Mirrors KID_MAX_PIN_ATTEMPTS in src/types/kid.ts. */
export const MAX_PIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export interface AccessRow {
  profile_id: string;
  family_id: string;
  auth_user_id: string | null;
  login_email: string;
  pin_hash: string;
  is_enabled: boolean;
  theme: string;
  failed_attempts: number;
  locked_until: string | null;
}

/** What `kid_register_pin_failure` hands back - the row AFTER the write. */
interface PinFailureRow {
  failed_attempts: number;
  locked_until: string | null;
}

/**
 * Lockout + PIN check in one gate. Returns a Response to send back when the
 * caller must be stopped, or null when the PIN was correct (in which case the
 * failure counter and any lockout have already been cleared).
 *
 * Wrong PIN increments `failed_attempts`; the 5th sets `locked_until` and
 * resets the counter, so the next window starts clean rather than locking on
 * every further attempt. Both of those happen inside
 * `kid_register_pin_failure` - one statement, so a batch of simultaneous
 * guesses costs one strike EACH. Doing the arithmetic here instead meant every
 * request in the batch read the same counter and wrote the same result, which
 * is one strike for the whole batch.
 */
export async function gateOnPin(
  admin: SupabaseClient,
  access: AccessRow,
  pin: string,
): Promise<Response | null> {
  const lockedFor = remainingLockSeconds(access.locked_until);
  if (lockedFor > 0) {
    return fail(lockedMessage(lockedFor), "locked", 429, { retryAfterSeconds: lockedFor });
  }

  if (await verifyPin(pin, access.pin_hash)) {
    // Only write when there is something to clear - the happy path is by far
    // the most common one and usually has nothing to reset.
    if (access.failed_attempts !== 0 || access.locked_until) {
      await admin
        .from("kid_access")
        .update({ failed_attempts: 0, locked_until: null })
        .eq("profile_id", access.profile_id);
    }
    return null;
  }

  const lockSeconds = LOCKOUT_MINUTES * 60;
  const { data, error } = await admin.rpc("kid_register_pin_failure", {
    p_profile_id: access.profile_id,
    p_max_attempts: MAX_PIN_ATTEMPTS,
    p_lock_seconds: lockSeconds,
  });
  // A set-returning function comes back as an array through PostgREST; accept
  // the bare object too so the shape is not what breaks the lockout.
  const row = (Array.isArray(data) ? data[0] : data) as PinFailureRow | undefined | null;

  if (error || !row) {
    // Nothing was recorded, so there is no fresh count to answer with. Fall
    // back to the numbers this request already has - the same answer the
    // caller got before the RPC existed, no better and no worse - and make the
    // failure loud, because a gate that cannot count strikes is the one thing
    // here worth paging about.
    console.error("kid-auth: kid_register_pin_failure failed:", error?.message ?? "no row");
    const attempts = (access.failed_attempts ?? 0) + 1;
    if (attempts >= MAX_PIN_ATTEMPTS) {
      return fail(lockedMessage(lockSeconds), "locked", 429, { retryAfterSeconds: lockSeconds });
    }
    return invalidPin(MAX_PIN_ATTEMPTS - attempts);
  }

  // The lockout leg resets the counter to 0, so `locked_until` - not the count
  // - is what says the door just closed.
  if (remainingLockSeconds(row.locked_until) > 0) {
    return fail(lockedMessage(lockSeconds), "locked", 429, { retryAfterSeconds: lockSeconds });
  }
  return invalidPin(MAX_PIN_ATTEMPTS - row.failed_attempts);
}

/** Seconds left on a lockout, or 0 when there is none (or it has passed). */
export function remainingLockSeconds(lockedUntil: string | null): number {
  if (!lockedUntil) return 0;
  const left = Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

export function lockedMessage(seconds: number): string {
  // Rounded up, so "za 1 minut" never means "actually 50 more seconds".
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Previše pokušaja. Probaj ponovo za ${minutes} ${minutes === 1 ? "minut" : "minuta"}.`;
}

export function attemptsLeftPhrase(left: number): string {
  return left === 1 ? "Imaš još 1 pokušaj." : `Imaš još ${left} pokušaja.`;
}

function invalidPin(left: number): Response {
  return fail(`Pogrešan PIN. ${attemptsLeftPhrase(left)}`, "invalid_pin", 401, {
    attemptsLeft: left,
  });
}

/** Error body shaped like `KidAuthErrorBody` in src/types/kid.ts. */
export function fail(
  error: string,
  code: string,
  status = 404,
  extra: Record<string, number> = {},
): Response {
  return json({ error, code, ...extra }, status);
}

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
