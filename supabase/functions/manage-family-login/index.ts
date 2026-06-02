// supabase/functions/manage-family-login/index.ts
//
// Create or disable a Supabase login for a family member, on behalf of a
// family admin. A pure client (anon key) can't reach the auth admin API, so
// this function holds the service role and does the privileged work after
// re-verifying the caller.
//
// Security: the caller is identified from their JWT `sub` (the Functions
// platform verifies the signature first — default verify_jwt = true). We then
// load the caller's profile with the service role and require `is_admin` AND
// that the target member shares the caller's `family_id`. The body can't be
// used to act on another family or to self-elevate.
//
// create:  admin.createUser → then RE-KEY the member's `profiles.id` to the
//          new auth user's id so all their history (activities / timetable /
//          shifts) carries over. The four `person_id` FKs have ON UPDATE
//          CASCADE (family_admin migration), so the single UPDATE cascades. If
//          the re-key fails we delete the just-created auth user to avoid an
//          orphaned login with no profile.
// disable: re-home the member's lists to the admin (lists.owner_id cascades on
//          auth-user delete, which would otherwise drop their lists) → delete
//          the auth user. The profile row survives (its FK to auth.users was
//          dropped long ago) and becomes a login-less member again.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  action?: "create" | "disable";
  profileId?: string;
  email?: string;
  password?: string;
}

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

  // SERVICE_KEY override mirrors update-user-email: local dev's auto-injected
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
  const { action, profileId } = body;
  if (!profileId || (action !== "create" && action !== "disable")) {
    return json({ error: "invalid_request" }, 400);
  }

  // ── Authorize: caller must be an admin in the target member's family. ──
  const { data: caller } = await admin
    .from("profiles")
    .select("family_id, is_admin")
    .eq("id", callerId)
    .single();
  if (!caller?.is_admin) {
    return json({ error: "Samo administrator može da menja naloge." }, 403);
  }
  const { data: target } = await admin
    .from("profiles")
    .select("family_id, is_admin")
    .eq("id", profileId)
    .single();
  if (!target || target.family_id !== caller.family_id) {
    return json({ error: "Član nije pronađen u tvojoj porodici." }, 404);
  }

  if (action === "create") {
    return await createLogin(admin, profileId, body);
  }
  return await disableLogin(admin, profileId, callerId, caller.family_id, target.is_admin);
});

async function createLogin(
  admin: ReturnType<typeof createClient>,
  profileId: string,
  body: Body,
): Promise<Response> {
  const email = body.email?.trim();
  const password = body.password ?? "";
  if (!email) return json({ error: "Email je obavezan." }, 400);
  if (password.length < 6) return json({ error: "Lozinka mora imati bar 6 karaktera." }, 400);

  // Already has a login? The login-less profile id won't exist in auth.users;
  // if it does, this member already has an account.
  const existing = await admin.auth.admin.getUserById(profileId);
  if (existing.data?.user) return json({ error: "Član već ima nalog." }, 409);

  // GoTrue validates email format + uniqueness and returns readable messages,
  // which we relay verbatim (e.g. "A user with this email address has already
  // been registered").
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    return json({ error: created.error?.message ?? "Greška pri kreiranju naloga." }, 400);
  }
  const newId = created.data.user.id;

  // Re-key the profile to the new auth id; the person_id FKs cascade.
  const { error: rekeyError } = await admin
    .from("profiles")
    .update({ id: newId })
    .eq("id", profileId);
  if (rekeyError) {
    // Roll back so we never leave a login pointing at no profile.
    await admin.auth.admin.deleteUser(newId);
    return json({ error: rekeyError.message }, 500);
  }
  return json({ ok: true, id: newId });
}

async function disableLogin(
  admin: ReturnType<typeof createClient>,
  profileId: string,
  callerId: string,
  familyId: string,
  targetIsAdmin: boolean,
): Promise<Response> {
  if (profileId === callerId) {
    return json({ error: "Ne možeš ugasiti sopstveni nalog." }, 400);
  }
  const existing = await admin.auth.admin.getUserById(profileId);
  if (!existing.data?.user) return json({ error: "Član nema nalog." }, 409);

  // Never strip the family's last admin — that would lock everyone out of
  // roster management.
  if (targetIsAdmin) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("family_id", familyId)
      .eq("is_admin", true);
    if ((count ?? 0) <= 1) {
      return json({ error: "Ne možeš ugasiti poslednjeg administratora." }, 400);
    }
  }

  // Preserve lists: re-home ownership to the admin before deleting the auth
  // user (lists.owner_id ON DELETE CASCADE would otherwise drop them).
  await admin.from("lists").update({ owner_id: callerId }).eq("owner_id", profileId);

  const del = await admin.auth.admin.deleteUser(profileId);
  if (del.error) return json({ error: del.error.message }, 500);

  // A login-less member can't administer anything — drop the admin flag so the
  // role can never linger on an account that can't sign in.
  await admin.from("profiles").update({ is_admin: false }).eq("id", profileId);

  return json({ ok: true });
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
