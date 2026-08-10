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
// user-controlled input - there's no way for the caller to update
// another user's row even if they tampered with the request.
//
// A live session is NOT enough to get here, and that is the point of
// most of the code below. Moving an account to a new verified address
// is an account takeover in one step (the thief then just asks for a
// password reset), so the caller must also prove they know the
// current password - see ../_shared/authProof.ts for the rule and why
// it is shaped the way it is. Kid sessions are turned away outright,
// one step earlier.
//
// Validation (uniqueness, format) is delegated to GoTrue. Its errors
// are relayed verbatim so the client can show them in a toast.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { checkPasswordProof, decodeAccessTokenClaims, isKidToken } from "../_shared/authProof.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface UpdateEmailBody {
  email?: string;
  /** Access token from a just-completed password sign-in. See authProof.ts. */
  proofToken?: string;
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
  // to GoTrue with our service-role apikey - and GoTrue on the new
  // asymmetric-key projects rejects the legacy HS256 service-role
  // JWT as an apikey. Decoding the trusted token avoids that
  // entirely.
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  const caller = decodeAccessTokenClaims(bearer);
  const userId = caller?.sub;
  if (!userId) return json({ error: "unauthorized" }, 401);

  // A kid mode session is a real session with a real `sub`, so without this
  // it would sail through everything below. The address it would rewrite is the
  // one `kid_access.login_email` points at, and both kid-auth and kid-access
  // find the child's synthetic user through that address and refuse to act when
  // the ids disagree - so a child changing it would permanently break the
  // parent's device removal and their own sign-ins. Nothing in the kid shell
  // offers this, which is exactly why the check belongs on the server.
  if (isKidToken(caller)) {
    return json({ error: "Dečiji nalog ne može da menja e-mail." }, 403);
  }

  // SERVICE_KEY allows overriding the apikey for local dev where the
  // auto-injected SUPABASE_SERVICE_ROLE_KEY is the legacy HS256 JWT
  // that the new asymmetric-key auth service rejects. In prod the
  // injected SUPABASE_SERVICE_ROLE_KEY is the correct format and is
  // used directly.
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

  // ── Reauthentication ────────────────────────────────────────────────────
  // The client re-verifies the password on a sessionless client and sends the
  // access token that sign-in handed back. Two things have to be true of it and
  // they are checked in this order on purpose:
  //
  //   1. the CLAIMS satisfy the rule (same user, different session, fresh) -
  //      cheap, and it rules out the caller passing their own session token,
  //   2. the TOKEN IS GENUINE - which only GoTrue can say.
  //
  // Step 2 is `admin.signOut(proof, "local")`: it is authenticated as the proof
  // token's own user, so GoTrue verifies the signature and 401s on anything
  // forged, and its side effect is exactly the one we want - the proof session
  // is spent, so a token intercepted on its way here cannot be replayed. The
  // scope is "local", and step 1 has already established that this is not the
  // caller's live session, so signing it out cannot log the caller out.
  //
  // The same call shape (a user's access token in Authorization, the service
  // key as apikey) is what kid-access uses to end a child's sessions, so it is
  // known to work on this project's GoTrue.
  const proofToken = body.proofToken?.trim();
  if (!proofToken) return json({ error: "Potrebna je potvrda lozinkom." }, 403);

  const verdict = checkPasswordProof(
    caller,
    decodeAccessTokenClaims(proofToken),
    Math.floor(Date.now() / 1000),
  );
  if (!verdict.ok) {
    return json({ error: reauthMessage(verdict.reason) }, 403);
  }

  const { error: proofError } = await supabaseAdmin.auth.admin.signOut(proofToken, "local");
  if (proofError) {
    return json({ error: reauthMessage("malformed") }, 403);
  }

  // Pre-check uniqueness explicitly. The admin endpoint's catch-all
  // for "email already taken" is the unhelpful "Error updating user"
  // - by checking ourselves we can return a specific, user-readable
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

  // `email_confirm: true` marks the new email as already verified -
  // without it GoTrue would leave the row in an unconfirmed state
  // and our auth flow would lock the user out.
  //
  // FOLLOW-UP: the PREVIOUS address is never told that the account moved. With
  // no mail provider wired up there is nothing to send it with; once there is
  // one, that notification is the cheapest remaining hardening here (it turns a
  // silent takeover into one the owner hears about).
  const { error: adminError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (adminError) {
    // GoTrue messages cover both uniqueness ("email address has
    // already been registered") and format ("Invalid email") -
    // relay them so the client can surface them in a toast.
    return json({ error: adminError.message }, 400);
  }

  return json({ ok: true, email });
});

/**
 * Serbian for a failed reauthentication. "Stale" is worth saying out loud -
 * it is the one failure a legitimate user hits (they sat on the form) and the
 * fix is different. The rest collapse into one message: only the account owner
 * can produce a valid proof at all, so there is nothing to learn from the
 * distinction and nothing to gain by spelling it out.
 */
function reauthMessage(reason: "malformed" | "wrong_user" | "same_session" | "stale"): string {
  return reason === "stale"
    ? "Potvrda lozinkom je istekla. Pokušaj ponovo."
    : "Potvrda lozinkom nije važeća. Pokušaj ponovo.";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
