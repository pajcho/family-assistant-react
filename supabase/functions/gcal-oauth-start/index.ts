// supabase/functions/gcal-oauth-start/index.ts
//
// Step 1 of connecting a Google account: build the Google OAuth consent URL and
// hand it back to the client, which then redirects the browser to it.
//
// Runs with the default verify_jwt = true, so the platform has already verified
// the caller's session. We pull their user id from the JWT `sub` and bake it
// into a short-lived, HMAC-signed `state`. The callback (which Google hits with
// no Supabase session) trusts that signature to know whose tokens these are.
//
// We request `calendar.readonly` (read-only mirror - never write back) plus
// `openid email` so the callback can read which Google account just connected.
// `access_type=offline` + `prompt=consent` guarantee a refresh_token every time.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_auth_header" }, 401);
  const callerId = decodeJwtSub(authHeader.replace(/^Bearer\s+/i, ""));
  if (!callerId) return json({ error: "unauthorized" }, 401);

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const stateSecret = Deno.env.get("GCAL_STATE_SECRET");
  if (!clientId || !stateSecret) return json({ error: "gcal_not_configured" }, 500);

  // Must EXACTLY match a redirect URI registered in the Google Cloud console.
  // Set GCAL_REDIRECT_URI explicitly so local (localhost:54321) and prod
  // (<ref>.supabase.co) don't fall back to the container-internal SUPABASE_URL.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const redirectUri =
    Deno.env.get("GCAL_REDIRECT_URI") ?? `${supabaseUrl}/functions/v1/gcal-oauth-callback`;

  const state = await signState({ uid: callerId, exp: nowSec() + 600 }, stateSecret);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Pulls `sub` (the user UUID) out of a JWT without verifying the signature.
 * Safe here because the Functions platform verified the JWT before invoking
 * this handler (default verify_jwt = true). Mirrors manage-family-login.
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

// ── HMAC-signed state ──────────────────────────────────────────────────────
// state = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
// The callback recomputes the HMAC to trust `uid`/`exp` without a DB round-trip.

async function signState(payload: object, secret: string): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(body, secret));
  return `${body}.${sig}`;
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
