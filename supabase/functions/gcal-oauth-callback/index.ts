// supabase/functions/gcal-oauth-callback/index.ts
//
// Step 2 of connecting a Google account: Google redirects the user's browser
// here with `?code=...&state=...`. There's no Supabase session on this request
// (it's a top-level navigation from Google), so verify_jwt = false and security
// comes entirely from the HMAC-signed `state` that gcal-oauth-start issued.
//
// We verify the state, exchange the code for tokens, read which Google account
// connected (from the id_token), resolve the member's family with the service
// role, upsert the connection, and bounce the browser back to the app's Settings
// → Kalendar tab with a one-shot ?gcal=connected|error flag for a toast.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl) return new Response("APP_URL not configured", { status: 500 });

  const back = (status: "connected" | "error", reason?: string): Response => {
    const u = new URL(`${appUrl}/settings`);
    u.searchParams.set("tab", "calendar");
    u.searchParams.set("gcal", status);
    if (reason) u.searchParams.set("reason", reason);
    return new Response(null, { status: 302, headers: { Location: u.toString() } });
  };

  const url = new URL(req.url);

  // User declined consent, or Google reported an error.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return back("error", oauthError);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("error", "missing_params");

  const stateSecret = Deno.env.get("GCAL_STATE_SECRET") ?? "";
  const verified = await verifyState(state, stateSecret);
  if (!verified) return back("error", "bad_state");

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const redirectUri =
    Deno.env.get("GCAL_REDIRECT_URI") ?? `${supabaseUrl}/functions/v1/gcal-oauth-callback`;
  if (!clientId || !clientSecret) return back("error", "gcal_not_configured");

  // Exchange the authorization code for tokens.
  let tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
  };
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return back("error", "token_exchange_failed");
    tokens = await tokenRes.json();
  } catch {
    return back("error", "token_exchange_failed");
  }
  if (!tokens.access_token) return back("error", "no_access_token");

  // The id_token carries which Google account this is (email + stable sub).
  const claims = decodeJwtPayload(tokens.id_token ?? "");
  const email = typeof claims?.email === "string" ? claims.email : null;
  const googleUserId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!email) return back("error", "no_email");

  // SERVICE_KEY override mirrors manage-family-login: local dev's auto-injected
  // SUPABASE_SERVICE_ROLE_KEY can be the legacy HS256 JWT the new auth service
  // rejects. In prod the injected key is correct and used directly.
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("family_id")
    .eq("id", verified.uid)
    .single();
  if (!profile?.family_id) return back("error", "no_profile");

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // Google omits refresh_token on re-consent if one already exists; keep the
  // previously stored value so a re-link never drops offline access.
  const { data: existing } = await admin
    .from("google_connections")
    .select("refresh_token")
    .eq("user_id", verified.uid)
    .eq("google_account_email", email)
    .maybeSingle();
  const refreshToken = tokens.refresh_token ?? existing?.refresh_token ?? null;

  const { error: upsertError } = await admin.from("google_connections").upsert(
    {
      user_id: verified.uid,
      family_id: profile.family_id,
      google_account_email: email,
      google_user_id: googleUserId,
      access_token: tokens.access_token,
      refresh_token: refreshToken,
      token_expires_at: expiresAt,
      scopes: tokens.scope ?? null,
      needs_reauth: false,
    },
    { onConflict: "user_id,google_account_email" },
  );
  if (upsertError) return back("error", "save_failed");

  return back("connected");
});

// ── HMAC-signed state verification (mirror of gcal-oauth-start's signer) ─────

async function verifyState(state: string, secret: string): Promise<{ uid: string } | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = b64urlEncode(await hmac(body, secret));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as {
      uid?: string;
      exp?: number;
    };
    if (!payload.uid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

/** Decode a JWT payload without verifying - used only to read the id_token we
 *  just received over TLS straight from Google's token endpoint. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded + "===".slice((padded.length + 3) % 4)));
  } catch {
    return null;
  }
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "===".slice((padded.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
