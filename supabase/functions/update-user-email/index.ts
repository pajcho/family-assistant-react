// supabase/functions/update-user-email/index.ts
//
// Updates the caller's auth email WITHOUT the standard confirmation
// link flow. We don't have a real email provider wired up, so the
// default `auth.updateUser({ email })` flow strands the change in
// Supabase's deliverability-poor default sender. This function uses
// the service-role admin API to set the email directly.
//
// Security: we extract the user id from the caller's JWT and pass
// that id into `admin.updateUserById`. The body's `email` is the only
// user-controlled input — there's no way for the caller to update
// another user's row even if they tampered with the request.
//
// Validation (uniqueness, format) is delegated to GoTrue. Its errors
// are relayed verbatim so the client can show them in a toast.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface UpdateEmailBody {
  email?: string;
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

  // Identify the caller from the JWT's `sub` claim. The Supabase
  // Functions platform verifies the JWT signature before invoking
  // this handler (the default `verify_jwt = true`), so by the time
  // we get here we can trust the claims. We do NOT call
  // `auth.getUser(bearer)` here because that would round-trip back
  // to GoTrue with our service-role apikey — and GoTrue on the new
  // asymmetric-key projects rejects the legacy HS256 service-role
  // JWT as an apikey. Decoding the trusted token avoids that
  // entirely.
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  const userId = decodeJwtSub(bearer);
  if (!userId) return json({ error: "unauthorized" }, 401);

  // SERVICE_KEY allows overriding the apikey for local dev where the
  // auto-injected SUPABASE_SERVICE_ROLE_KEY is the legacy HS256 JWT
  // that the new asymmetric-key auth service rejects. In prod the
  // injected SUPABASE_SERVICE_ROLE_KEY is the correct format and is
  // used directly.
  const apiKey =
    Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: UpdateEmailBody;
  try {
    body = (await req.json()) as UpdateEmailBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const email = body.email?.trim();
  if (!email) return json({ error: "missing_email" }, 400);

  // Pre-check uniqueness explicitly. The admin endpoint's catch-all
  // for "email already taken" is the unhelpful "Error updating user"
  // — by checking ourselves we can return a specific, user-readable
  // message. `listUsers` doesn't accept an email filter directly, so
  // paginate until we find a match. With ≤ a few users in a family
  // app this costs one page; the loop is just a safety net.
  let collisionUserId: string | null = null;
  const normalised = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (pageError || !data) break;
    const match = data.users.find((u) => u.email?.toLowerCase() === normalised);
    if (match) {
      collisionUserId = match.id;
      break;
    }
    if (data.users.length < 100) break;
  }
  if (collisionUserId && collisionUserId !== userId) {
    return json({ error: "Email već koristi drugi korisnik." }, 409);
  }

  // `email_confirm: true` marks the new email as already verified —
  // without it GoTrue would leave the row in an unconfirmed state
  // and our auth flow would lock the user out.
  const { error: adminError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (adminError) {
    // GoTrue messages cover both uniqueness ("email address has
    // already been registered") and format ("Invalid email") —
    // relay them so the client can surface them in a toast.
    return json({ error: adminError.message }, 400);
  }

  return json({ ok: true, email });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Pulls `sub` (the user UUID) out of a JWT without verifying the
 * signature. Safe to use here because the Supabase Functions platform
 * already verified the JWT before invoking this handler.
 */
function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "===".slice((padded.length + 3) % 4));
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
