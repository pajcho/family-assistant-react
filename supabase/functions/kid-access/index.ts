// supabase/functions/kid-access/index.ts
//
// Parent side of kid mode: turn a child's read-only access on or off, change
// their PIN, mint a one-time device-link invite, and revoke a linked device.
// Everything here needs either the auth admin API or a write to a table with no
// write policy at all, so a pure client (anon key) cannot do any of it.
//
// Security: runs with the default verify_jwt = true, so the Functions platform
// verified the caller's JWT before we were invoked. We take the caller's id from
// the JWT `sub`, load their profile with the service role and require `is_admin`
// AND that the target shares the caller's `family_id` - exactly the check
// manage-family-login does. The body can never reach another family.
//
// The synthetic auth user this creates is the whole security model (see
// src/types/kid.ts): a generated `@porodica.local` address nobody ever sees, NO
// password, and crucially NO row in `profiles`. Every pre-existing RLS policy
// resolves the caller through `profiles WHERE id = auth.uid()`, so a kid session
// matches nothing by default; the migration hands access back table by table
// with SELECT-only policies keyed on `public.kid_profile_id()`.
//
// Note the deliberate difference from manage-family-login: that function RE-KEYS
// `profiles.id` onto the new auth user. This one must NOT - `kid_access.
// profile_id` keeps the child's original profile id (so their activities,
// timetable and shifts stay where the family already sees them) and the link to
// the synthetic user lives only in `kid_access.auth_user_id`.
//
// enable:  createUser (no password) -> insert kid_access. If the insert fails we
//          delete the just-created auth user, so we never leave a login with no
//          kid_access row behind it.
// disable: delete the auth user (kid_access cascades off the FK) and drop the
//          child's devices and invites, which hang off `profiles` and would
//          otherwise survive. Idempotent.
//
// Taking access away also has to END WHAT IS ALREADY OPEN, which deleting a row
// does not do: a signed-in child holds a Supabase session that supabase-js keeps
// refreshing on its own, so a `kid_devices` row is only the permission to START
// a new session. Both `disable` and `revoke-device` therefore call
// `endKidSessions` (see the long note on it in ../_shared/kidTeardown.ts)
// before/after their delete.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { hashPin, randomInviteCode, sha256Hex, syntheticEmail } from "../_shared/kidCrypto.ts";
import { endKidSessions, tearDownKidAccess } from "../_shared/kidTeardown.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Mirrors `KidAccessRequest` in src/types/kid.ts - restated because Deno can't
 *  import across the frontend boundary. Keep the two in sync. */
interface Body {
  action?: "enable" | "disable" | "set-pin" | "invite" | "revoke-device";
  profileId?: string;
  deviceId?: string;
  pin?: string;
}

/** Mirrors KID_INVITE_TTL_MINUTES in src/types/kid.ts. */
const INVITE_TTL_MINUTES = 15;

/** A PIN this obvious is the same as no PIN - the device token would be doing
 *  all the work. Mirrors nothing on the client on purpose: the client checks
 *  shape (`isValidKidPin`), the server is the one that gets to say no. */
const WEAK_PINS = new Set(["1234", "123456", "0000", "1111"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_auth_header" }, 401);
  const callerId = decodeJwtSub(authHeader.replace(/^Bearer\s+/i, ""));
  if (!callerId) return json({ error: "unauthorized" }, 401);

  const admin = serviceClient();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { action } = body;
  if (
    action !== "enable" &&
    action !== "disable" &&
    action !== "set-pin" &&
    action !== "invite" &&
    action !== "revoke-device"
  ) {
    return json({ error: "invalid_request" }, 400);
  }

  // ── Authorize: caller must be an admin, in their own family. ──────────────
  const { data: caller } = await admin
    .from("profiles")
    .select("family_id, is_admin")
    .eq("id", callerId)
    .single();
  if (!caller?.is_admin) {
    return json({ error: "Samo administrator može da menja dečiji pristup." }, 403);
  }

  if (action === "revoke-device") {
    return await revokeDevice(admin, body.deviceId, caller.family_id);
  }

  const profileId = body.profileId;
  if (!profileId) return json({ error: "invalid_request" }, 400);

  const { data: target } = await admin
    .from("profiles")
    .select("id, family_id, first_name, last_name")
    .eq("id", profileId)
    .single();
  if (!target || target.family_id !== caller.family_id) {
    return json({ error: "Član nije pronađen u tvojoj porodici." }, 404);
  }

  switch (action) {
    case "enable":
      return await enableAccess(admin, target, body.pin);
    case "disable":
      return await disableAccess(admin, profileId);
    case "set-pin":
      return await setPin(admin, profileId, body.pin);
    case "invite":
      return await createInvite(admin, profileId, target.family_id, callerId);
  }
});

/** The columns of `profiles` this function reads off the target member. */
interface TargetProfile {
  id: string;
  family_id: string;
  first_name: string | null;
  last_name: string | null;
}

// ---------------------------------------------------------------------------
// enable
// ---------------------------------------------------------------------------

async function enableAccess(
  admin: SupabaseClient,
  target: TargetProfile,
  rawPin: unknown,
): Promise<Response> {
  const checked = checkPin(rawPin);
  if ("error" in checked) return json({ error: checked.error }, 400);

  // A member with a real login signs in normally - kid mode is for the
  // login-less ones. A login-less profile id never exists in auth.users, so a
  // hit here means they already have an account (this also covers an admin
  // pointing the action at themselves).
  const existing = await admin.auth.admin.getUserById(target.id);
  if (existing.data?.user) {
    return json({ error: "Član već ima nalog za prijavu." }, 409);
  }

  const { data: alreadyKid } = await admin
    .from("kid_access")
    .select("profile_id")
    .eq("profile_id", target.id)
    .maybeSingle();
  if (alreadyKid) {
    return json({ error: "Dečiji pristup je već uključen." }, 409);
  }

  const loginEmail = syntheticEmail(target.first_name, target.last_name);
  // `email_confirm: true` marks the address verified without mailing anything -
  // GoTrue's admin API never sends on createUser, and `.local` is undeliverable
  // by design anyway. The kid claims ride in app_metadata (which only the
  // service role can write), so the client can route a kid session with zero
  // round trips - see readKidClaims in src/types/kid.ts.
  const created = await admin.auth.admin.createUser({
    email: loginEmail,
    email_confirm: true,
    app_metadata: { kid: true, kid_profile_id: target.id, family_id: target.family_id },
  });
  if (created.error || !created.data.user) {
    return json({ error: created.error?.message ?? "Greška pri kreiranju pristupa." }, 400);
  }
  const authUserId = created.data.user.id;

  const { error: insertError } = await admin.from("kid_access").insert({
    profile_id: target.id,
    family_id: target.family_id,
    auth_user_id: authUserId,
    login_email: loginEmail,
    pin_hash: await hashPin(checked.pin),
  });
  if (insertError) {
    // Roll back so we never leave a synthetic login with no kid_access row -
    // it would be a session that RLS grants nothing to and nobody can clean up
    // through the UI.
    await admin.auth.admin.deleteUser(authUserId);
    return json({ error: insertError.message }, 500);
  }

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// disable
// ---------------------------------------------------------------------------

async function disableAccess(admin: SupabaseClient, profileId: string): Promise<Response> {
  // The teardown itself lives in ../_shared/kidTeardown.ts because
  // manage-family-login's "Ugasi nalog" has to do exactly the same thing - see
  // the note there. This action is nothing but its HTTP wrapper.
  const result = await tearDownKidAccess(admin, profileId);
  if (!result.ok) return json({ error: result.error }, 500);

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// set-pin
// ---------------------------------------------------------------------------

async function setPin(
  admin: SupabaseClient,
  profileId: string,
  rawPin: unknown,
): Promise<Response> {
  const checked = checkPin(rawPin);
  if ("error" in checked) return json({ error: checked.error }, 400);

  // A new PIN also clears a lockout - a parent resetting the PIN is exactly the
  // remedy for "the kid locked themselves out", so making them wait 15 more
  // minutes would be perverse.
  const { data, error } = await admin
    .from("kid_access")
    .update({ pin_hash: await hashPin(checked.pin), failed_attempts: 0, locked_until: null })
    .eq("profile_id", profileId)
    .select("profile_id");
  if (error) return json({ error: error.message }, 500);
  if (!data || data.length === 0) {
    return json({ error: "Dečiji pristup nije uključen za ovog člana." }, 404);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// invite
// ---------------------------------------------------------------------------

async function createInvite(
  admin: SupabaseClient,
  profileId: string,
  familyId: string,
  callerId: string,
): Promise<Response> {
  const { data: access } = await admin
    .from("kid_access")
    .select("is_enabled")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!access) {
    return json({ error: "Dečiji pristup nije uključen za ovog člana." }, 404);
  }
  if (!access.is_enabled) {
    return json({ error: "Dečiji pristup je isključen." }, 409);
  }

  // Only one live invite per child: a parent who tapped link-a-device twice
  // should not leave a spare QR code valid on a screen somewhere.
  await admin.from("kid_invites").delete().eq("profile_id", profileId).is("used_at", null);

  // Short and typeable, not a 32-byte token: the same string is both the QR
  // payload and the code a child types when they cannot scan (see
  // `randomInviteCode`). Already in normalized form by construction, so the
  // hash stored here is the one `kid-auth` computes from what the child sends.
  const token = randomInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MINUTES * 60_000).toISOString();
  const { error } = await admin.from("kid_invites").insert({
    profile_id: profileId,
    family_id: familyId,
    token_hash: await sha256Hex(token),
    expires_at: expiresAt,
    created_by: callerId,
  });
  if (error) return json({ error: error.message }, 500);

  // The only time the raw token exists outside the parent's screen. Only its
  // SHA-256 was stored, so this response cannot be reconstructed from the DB.
  return json({ token, expiresAt });
}

// ---------------------------------------------------------------------------
// revoke-device
// ---------------------------------------------------------------------------

async function revokeDevice(
  admin: SupabaseClient,
  deviceId: string | undefined,
  callerFamilyId: string,
): Promise<Response> {
  if (!deviceId) return json({ error: "invalid_request" }, 400);

  // Both reads are scoped by family, and so is the DELETE below - a device id
  // from another family matches zero rows in every one of them, no matter what
  // happens between the queries.
  const { data: device } = await admin
    .from("kid_devices")
    .select("id, profile_id")
    .eq("id", deviceId)
    .eq("family_id", callerFamilyId)
    .maybeSingle();
  if (!device) {
    return json({ error: "Uređaj nije pronađen." }, 404);
  }

  const { data: access } = await admin
    .from("kid_access")
    .select("auth_user_id, login_email")
    .eq("profile_id", device.profile_id)
    .maybeSingle();

  // Sessions BEFORE the row, and that order is the whole point. Deleting the
  // row only withdraws permission to start a NEW session; the child's open one
  // refreshes itself and would outlive the revoke indefinitely. If the sign-out
  // fails we stop here with the device still linked, so the parent can simply
  // press again - the reverse order would leave the dangerous half done (no way
  // back in, but still signed in) with nothing left to retry.
  if (access?.auth_user_id) {
    const signedOut = await endKidSessions(admin, access.auth_user_id, access.login_email);
    if (!signedOut) {
      return json({ error: "Uređaj nije uklonjen - odjava nije uspela. Pokušaj ponovo." }, 500);
    }
  }

  const { data, error } = await admin
    .from("kid_devices")
    .delete()
    .eq("id", deviceId)
    .eq("family_id", callerFamilyId)
    .select("id");
  if (error) return json({ error: error.message }, 500);
  if (!data || data.length === 0) {
    return json({ error: "Uređaj nije pronađen." }, 404);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A service-role client. SERVICE_KEY override mirrors manage-family-login:
 * local dev's auto-injected SUPABASE_SERVICE_ROLE_KEY can be the legacy HS256
 * JWT that the new asymmetric-key auth service rejects as an apikey. In prod
 * the injected key is the correct format and is used directly.
 */
function serviceClient(): SupabaseClient {
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type PinCheck = { pin: string } | { error: string };

/**
 * Server-side PIN rules. The client checks the same shape (`isValidKidPin`),
 * but the client is not a security boundary and the weak-PIN list only lives
 * here - a parent who insists gets told no by the server.
 */
function checkPin(raw: unknown): PinCheck {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return { error: "PIN mora imati samo cifre." };
  }
  if (raw.length !== 4 && raw.length !== 6) {
    return { error: "PIN mora imati 4 ili 6 cifara." };
  }
  if (WEAK_PINS.has(raw) || /^(\d)\1*$/.test(raw)) {
    return { error: "Ovaj PIN je previše jednostavan. Izaberi drugi." };
  }
  return { pin: raw };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Pulls `sub` (the user UUID) out of a JWT without verifying the signature.
 * Safe here because the Functions platform verified the JWT before invoking
 * this handler (default verify_jwt = true).
 */
function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "===".slice((padded.length + 3) % 4));
    const claims = JSON.parse(decoded) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
