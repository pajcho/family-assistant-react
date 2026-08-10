// supabase/functions/kid-auth/index.ts
//
// Kid side of kid mode: turn a one-time parent invite into a linked device
// (`claim`), turn a linked device plus a PIN into a session (`login`), and
// answer whether a linked device is still allowed in at all (`check`).
//
// Security: this is the ONE function in the project with verify_jwt = false,
// because by definition it is called before any session exists (see the
// justification block in supabase/config.toml). Two factors stand in for the
// JWT:
//
//   1. A device token - 32 CSPRNG bytes planted by a parent's one-time QR link
//      and kept in that device's localStorage. Only its SHA-256 is stored, so a
//      database dump does not yield a working credential. There is no username
//      field and no lookup by name, so the login screen cannot be used to
//      enumerate a family's children - an unknown token is flatly
//      `device_unknown`, the same answer a wrong-but-well-formed one gets.
//   2. A PIN, PBKDF2-hashed in kid_access, guarded by a 5-strike lockout. The
//      lockout, not the hash, is what makes a 4-digit secret defensible.
//
// `check` is the one action a caller reaches WITH a session in hand, and it
// changes nothing about that exception: it is answered from the device token
// alone, hands back no data, and needs no PIN (see the note above it).
//
// Minting the session: `auth.admin.generateLink({ type: "magiclink" })` returns
// a single-use `hashed_token`, which the client redeems with
// `verifyOtp({ token_hash, type: "magiclink" })`. Nothing is emailed (the admin
// API only generates) and no password is ever stored or transmitted - the
// synthetic user has none. Verified end to end against the local stack: the
// redeemed session carries the kid app_metadata claims into the JWT and the
// token is rejected on replay.
//
// Everything runs with the service role, so RLS is bypassed here on purpose:
// kid_invites has no policies at all, and a caller with no session could not
// read kid_access or kid_devices either. Every scoping rule this function needs
// is therefore written out in the queries below.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { normalizeInviteCode, randomToken, sha256Hex } from "../_shared/kidCrypto.ts";
// The PIN gate lives in its own file so it can be unit-tested (gate.test.ts);
// the response helpers travel with it because it answers in Responses.
import { type AccessRow, corsHeaders, fail, gateOnPin, json } from "./gate.ts";

/** Mirrors `KidAuthRequest` in src/types/kid.ts - restated because Deno can't
 *  import across the frontend boundary. Keep the two in sync. */
interface Body {
  action?: "claim" | "login" | "check";
  token?: string;
  deviceToken?: string;
  pin?: string;
}

/** The kid_access columns every path below needs. */
const ACCESS_COLUMNS =
  "profile_id, family_id, auth_user_id, login_email, pin_hash, is_enabled, theme, failed_attempts, locked_until";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // SERVICE_KEY override mirrors manage-family-login: local dev's auto-injected
  // SUPABASE_SERVICE_ROLE_KEY can be the legacy HS256 JWT that the new
  // asymmetric-key auth service rejects as an apikey. In prod the injected key
  // is the correct format and is used directly.
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { action, pin } = body;
  if (action !== "claim" && action !== "login" && action !== "check") {
    return json({ error: "invalid_request" }, 400);
  }

  // `check` is the one action that carries no PIN - it asks about the DEVICE,
  // not about the child - so it is answered before the PIN guard below.
  if (action === "check") {
    if (typeof body.deviceToken !== "string" || body.deviceToken === "") {
      return json({ error: "invalid_request" }, 400);
    }
    return await check(admin, body.deviceToken);
  }

  if (typeof pin !== "string" || pin === "") {
    return json({ error: "invalid_request" }, 400);
  }

  const deviceLabel = labelFromUserAgent(req.headers.get("User-Agent"));

  if (action === "claim") {
    if (typeof body.token !== "string" || body.token === "") {
      return json({ error: "invalid_request" }, 400);
    }
    return await claim(admin, body.token, pin, deviceLabel);
  }
  if (typeof body.deviceToken !== "string" || body.deviceToken === "") {
    return json({ error: "invalid_request" }, 400);
  }
  return await login(admin, body.deviceToken, pin);
});

// ---------------------------------------------------------------------------
// claim - one-time invite + PIN -> linked device + session
// ---------------------------------------------------------------------------

async function claim(
  admin: SupabaseClient,
  token: string,
  pin: string,
  deviceLabel: string,
): Promise<Response> {
  // Two hashes, one query. `normalizeInviteCode` is what a TYPED code has to go
  // through (case, the `-` separator, `O` for zero), and it is a no-op on a code
  // that came straight out of a QR fragment. The raw form is tried alongside it
  // so a QR minted by the previous version - a 32-byte token, which normalizing
  // would mangle - still links while both deploys have not landed.
  const code = normalizeInviteCode(token);
  const hashes = [...new Set([await sha256Hex(code), await sha256Hex(token)])];
  const { data: invite } = await admin
    .from("kid_invites")
    .select("id, profile_id, family_id, expires_at, used_at")
    .in("token_hash", hashes)
    .maybeSingle();

  if (!invite) {
    return fail("Link nije ispravan. Zatraži novi od roditelja.", "invite_invalid", 404);
  }
  if (invite.used_at) {
    return fail("Link je već iskorišćen. Zatraži novi od roditelja.", "invite_used", 409);
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return fail("Link je istekao. Zatraži novi od roditelja.", "invite_expired", 410);
  }

  const access = await loadAccess(admin, invite.profile_id);
  if (!access) {
    return fail("Pristup je isključen. Pitaj roditelja.", "access_disabled", 403);
  }

  const gate = await gateOnPin(admin, access, pin);
  if (gate) return gate;

  // The PIN is checked BEFORE the invite is burned, so a mistyped PIN costs an
  // attempt but not the QR code the parent is still holding up.
  //
  // `.is("used_at", null)` inside the UPDATE is the race guard: two devices
  // scanning the same code at once both pass the read above, and exactly one
  // of them gets rows back here.
  const { data: burned } = await admin
    .from("kid_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id");
  if (!burned || burned.length === 0) {
    return fail("Link je već iskorišćen. Zatraži novi od roditelja.", "invite_used", 409);
  }

  const deviceToken = randomToken();
  const { data: device, error: deviceError } = await admin
    .from("kid_devices")
    .insert({
      profile_id: invite.profile_id,
      family_id: invite.family_id,
      token_hash: await sha256Hex(deviceToken),
      label: deviceLabel,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (deviceError || !device) {
    await unburn(admin, invite.id);
    return json({ error: "Neočekivana greška pri povezivanju." }, 500);
  }

  const sessionToken = await mintSessionToken(admin, access);
  if (!sessionToken) {
    // Minting is the only step that leans on another service, so it is the one
    // that can fail for reasons unrelated to this request. Roll both writes
    // back (the manage-family-login idiom): the child never received the
    // device token, so a linked device and a spent invite would strand them
    // behind a QR code the parent has already put away.
    await admin.from("kid_devices").delete().eq("id", device.id);
    await unburn(admin, invite.id);
    return json({ error: "Prijava trenutno ne radi. Pokušaj ponovo." }, 500);
  }

  return await sessionResponse(admin, access, sessionToken, { deviceToken });
}

/** Puts a burned invite back in play after a failed claim. */
async function unburn(admin: SupabaseClient, inviteId: string): Promise<void> {
  await admin.from("kid_invites").update({ used_at: null }).eq("id", inviteId);
}

// ---------------------------------------------------------------------------
// login - linked device + PIN -> session
// ---------------------------------------------------------------------------

async function login(admin: SupabaseClient, deviceToken: string, pin: string): Promise<Response> {
  const { data: device } = await admin
    .from("kid_devices")
    .select("id, profile_id")
    .eq("token_hash", await sha256Hex(deviceToken))
    .maybeSingle();

  // A revoked or never-issued device gets one flat answer. Anything more
  // specific would turn this endpoint into an oracle.
  if (!device) {
    return fail("Ovaj uređaj više nije povezan. Pitaj roditelja za novi link.", "device_unknown");
  }

  const access = await loadAccess(admin, device.profile_id);
  if (!access) {
    return fail("Pristup je isključen. Pitaj roditelja.", "access_disabled", 403);
  }

  const gate = await gateOnPin(admin, access, pin);
  if (gate) return gate;

  const sessionToken = await mintSessionToken(admin, access);
  if (!sessionToken) {
    return json({ error: "Prijava trenutno ne radi. Pokušaj ponovo." }, 500);
  }

  await admin
    .from("kid_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  return await sessionResponse(admin, access, sessionToken, {});
}

// ---------------------------------------------------------------------------
// check - is this device still allowed in?
// ---------------------------------------------------------------------------

/**
 * A validity probe for a device that is ALREADY signed in, so the child's app
 * can tell them what happened instead of silently going stale.
 *
 * It exists because a revoke cannot reach into a live session: `kid-access`
 * ends every session server-side, but a GoTrue access token is stateless and
 * keeps opening doors until it expires (up to an hour). The kid shell calls
 * this on mount and when the app comes back to the foreground, and turns a
 * definitive answer into an explanation screen.
 *
 * Three properties this must have, all of them load-bearing:
 *
 *   - It leaks NOTHING beyond the two codes below. No name, no family, no
 *     "this token was valid yesterday" - the same flat `device_unknown` an
 *     invented token gets, exactly like `login`.
 *   - It costs no PIN attempt. It carries no PIN, so counting it against the
 *     5-strike lockout would let a phone in someone's pocket lock a child out
 *     of their own app.
 *   - It writes nothing. Not even `last_seen_at`: the parent's device list
 *     labels that "poslednja prijava", and a background probe is not a
 *     sign-in.
 *
 * Unrated on purpose: it takes a 32-byte device token to get an answer at all,
 * and the only thing hammering it can achieve is the caller's own slowdown.
 */
async function check(admin: SupabaseClient, deviceToken: string): Promise<Response> {
  const { data: device } = await admin
    .from("kid_devices")
    .select("profile_id")
    .eq("token_hash", await sha256Hex(deviceToken))
    .maybeSingle();

  if (!device) {
    return fail("Ovaj uređaj više nije povezan. Pitaj roditelja za novi link.", "device_unknown");
  }

  const access = await loadAccess(admin, device.profile_id);
  if (!access) {
    return fail("Pristup je isključen. Pitaj roditelja.", "access_disabled", 403);
  }

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// shared steps
// ---------------------------------------------------------------------------

/** The child's kid_access row, or null when access is off (the caller turns
 *  both "no row" and "disabled" into the same `access_disabled` answer). */
async function loadAccess(admin: SupabaseClient, profileId: string): Promise<AccessRow | null> {
  const { data } = await admin
    .from("kid_access")
    .select(ACCESS_COLUMNS)
    .eq("profile_id", profileId)
    .maybeSingle();
  const access = data as AccessRow | null;
  if (!access || !access.is_enabled) return null;
  return access;
}

/**
 * The single-use `hashed_token` the client redeems with
 * `verifyOtp({ token_hash, type: "magiclink" })`, or null if GoTrue would not
 * issue one for the expected user.
 *
 * This sends no mail: the admin API only generates the link, and the synthetic
 * `@porodica.local` address is undeliverable by design. The synthetic user has
 * no password, so nothing sign-in-shaped is ever stored or transmitted.
 *
 * The identity re-check is not paranoia. `generateLink` with type "magiclink"
 * SIGNS UP an unknown address rather than failing (verified against GoTrue), so
 * a kid_access row whose `login_email` had drifted from its `auth_user_id`
 * would otherwise hand back a working session for a brand-new account - one
 * with no kid claims, which `kid_profile_id()` resolves to NULL. That already
 * fails closed, but returning a session for an account nobody meant to create
 * is not something to leave to the next layer.
 *
 * GoTrue creates that account before it answers us, so the guard cannot prevent
 * the row, only refuse its token. Nothing reaches the drifted state today:
 * `login_email` is written once by kid-access/enable, and deleting the auth
 * user cascades the whole kid_access row away.
 */
async function mintSessionToken(admin: SupabaseClient, access: AccessRow): Promise<string | null> {
  if (!access.auth_user_id) return null;
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: access.login_email,
  });
  if (link.error) return null;
  if (link.data?.user?.id !== access.auth_user_id) return null;
  return link.data?.properties?.hashed_token ?? null;
}

/** Records the sign-in and builds the success body. */
async function sessionResponse(
  admin: SupabaseClient,
  access: AccessRow,
  sessionToken: string,
  extra: { deviceToken?: string },
): Promise<Response> {
  await admin
    .from("kid_access")
    .update({ last_login_at: new Date().toISOString() })
    .eq("profile_id", access.profile_id);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, first_name, color, avatar_emoji")
    .eq("id", access.profile_id)
    .maybeSingle();

  return json({
    sessionToken,
    ...extra,
    profile: {
      id: access.profile_id,
      name: profile?.first_name ?? "",
      theme: access.theme,
      color: profile?.color ?? null,
      emoji: profile?.avatar_emoji ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A hint a child recognises on the parent's device list ("iPhone", "Tablet"),
 * not device fingerprinting - it is never used for any decision. Falls back to
 * a generic word rather than storing a raw User-Agent string.
 */
function labelFromUserAgent(ua: string | null): string {
  if (!ua) return "Uređaj";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android telefon" : "Android tablet";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Uređaj";
}
