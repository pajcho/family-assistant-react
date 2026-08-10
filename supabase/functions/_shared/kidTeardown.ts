// supabase/functions/_shared/kidTeardown.ts
//
// Taking a child's kid mode credentials away, in one place.
//
// WHY IT IS SHARED. Kid mode and a real login are mutually exclusive: a member
// with an account signs in normally, and `kid-access`'s `enable` refuses to
// turn kid mode on for anyone who has one. The other direction was missing -
// `manage-family-login`'s "Ugasi nalog" deleted the member's auth user and left
// their kid_access row, devices and invites untouched, so a member who had both
// kept signing in with device token + PIN after their login was supposedly
// gone. Both sides now call the same routine, so the invariant cannot be
// enforced in one direction only again.
//
// The ORDER below is load-bearing and is the order `kid-access` has always
// used: invites and devices (the permission to START a session) first, then the
// live sessions, then the synthetic auth user, then the row. See the note on
// `endKidSessions` for why deleting rows is not enough on its own.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type KidTeardownResult = { ok: true } | { ok: false; error: string };

/**
 * Removes every way a child could get in: invites, devices, live sessions, the
 * synthetic auth user and finally the `kid_access` row. Idempotent - a profile
 * with no kid access at all is a no-op that reports success.
 */
export async function tearDownKidAccess(
  admin: SupabaseClient,
  profileId: string,
): Promise<KidTeardownResult> {
  const { data: access } = await admin
    .from("kid_access")
    .select("auth_user_id, login_email")
    .eq("profile_id", profileId)
    .maybeSingle();

  // Devices and invites hang off `profiles`, not off auth.users, so deleting
  // the auth user does not take them with it. Credentials go first on purpose:
  // if a later step fails the account is already unreachable, which is the safe
  // direction to fail in.
  await admin.from("kid_invites").delete().eq("profile_id", profileId);
  await admin.from("kid_devices").delete().eq("profile_id", profileId);

  if (access?.auth_user_id) {
    // Belt and braces. Deleting the auth user is the authoritative step - it
    // cascades `auth.sessions` and `auth.refresh_tokens` away, so nothing can
    // be refreshed afterwards - but it is also the step that can fail (a
    // future FK pointing at auth.users is exactly how it would), and a failed
    // delete that left live sessions behind would be a parent believing they
    // had cut access off while the child kept browsing. Signing out first
    // means the worst case is "access still enabled, everyone logged out".
    // Best effort on purpose: the delete below is what the answer depends on.
    await endKidSessions(admin, access.auth_user_id, access.login_email);

    const del = await admin.auth.admin.deleteUser(access.auth_user_id);
    if (del.error) return { ok: false, error: del.error.message };
  }
  // `auth_user_id` is nullable, so a row that never got a synthetic user (a
  // rolled-back enable) has nothing to cascade off - drop it explicitly. Also
  // makes the whole action idempotent when it is called twice.
  await admin.from("kid_access").delete().eq("profile_id", profileId);

  return { ok: true };
}

/**
 * Ends EVERY live session of a child's synthetic auth user: their access token
 * can no longer be refreshed and every stored refresh token is gone.
 *
 * WHY THIS EXISTS. Deleting a `kid_devices` row withdraws the right to START a
 * session; it does nothing to one that is already open. supabase-js refreshes
 * that session by itself, forever, without ever touching the device token
 * again - so before this helper, removing a device stopped only future sign-ins
 * and the child kept full access indefinitely.
 *
 * THE TRADE-OFF, stated plainly: all of a child's devices share ONE synthetic
 * auth user, so there is nothing per-device at the auth layer to revoke. This
 * signs the child out EVERYWHERE. Their other devices still hold valid device
 * tokens, so a PIN puts them straight back in - which is the behaviour we want
 * ("this phone is gone, my tablet still works"), just with one extra sign-in.
 * The parent-facing copy says so.
 *
 * HOW, and why it looks roundabout. GoTrue has no admin "log this user out"
 * route: `POST /admin/users/{id}/logout` is a 404 (checked against v2.189.0),
 * and supabase-js's `auth.admin.signOut(jwt, scope)` wants that user's OWN
 * access token, which the server does not have. So we mint one for them the
 * same way `kid-auth` mints a sign-in (`generateLink` -> `verifyOtp`) and spend
 * it on a GLOBAL logout, which drops every session of that user including the
 * one we just made. Net effect: zero sessions.
 *
 * Deliberately NOT done by writing a password onto the synthetic user (GoTrue
 * does log every session out on an admin password change): that is a side
 * effect of an unrelated write, on an account whose whole point is that no
 * password is ever set or known.
 *
 * A child who is mid-sign-in at this exact moment can lose the race: GoTrue
 * keeps ONE outstanding magic-link token per user, so our mint invalidates
 * theirs and their `kid-auth` call fails. They retry and are refused (revoke)
 * or let in (disable is already gone by then) - either way the outcome is the
 * one the parent asked for.
 *
 * Returns false if any step failed, in which case the caller must assume the
 * child is STILL signed in somewhere.
 */
export async function endKidSessions(
  admin: SupabaseClient,
  authUserId: string,
  loginEmail: string,
): Promise<boolean> {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: loginEmail });
  if (link.error) return false;
  // Same identity guard as kid-auth's mintSessionToken: `generateLink` SIGNS UP
  // an unknown address rather than failing, so a drifted `login_email` would
  // otherwise hand us a token for a brand-new account and we would cheerfully
  // "log out" a user who was never the child.
  if (link.data?.user?.id !== authUserId) return false;
  const tokenHash = link.data?.properties?.hashed_token;
  if (!tokenHash) return false;

  // A SEPARATE client on purpose: `verifyOtp` stores the redeemed session on
  // the instance it is called on, and `admin` would then send the CHILD's token
  // instead of the service key on every later query in this request.
  const redeemer = serviceClient();
  const verified = await redeemer.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  const jwt = verified.data?.session?.access_token;
  if (verified.error || !jwt) return false;

  const { error } = await admin.auth.admin.signOut(jwt, "global");
  if (error) {
    // The global logout is what fails here, so the session we just minted is
    // still live. Take at least that one back, or a failed revoke would have
    // handed the child a fresh hour.
    await admin.auth.admin.signOut(jwt, "local");
    return false;
  }
  return true;
}

/**
 * A service-role client for the one-off `redeemer` above. Restated rather than
 * imported from a caller: each edge function builds its own the same way, and
 * this module has to work no matter which one is calling. SERVICE_KEY override
 * included, because local dev's auto-injected SUPABASE_SERVICE_ROLE_KEY can be
 * the legacy HS256 JWT that the new asymmetric-key auth service rejects as an
 * apikey. In prod the injected key is the correct format and is used directly.
 */
function serviceClient(): SupabaseClient {
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
