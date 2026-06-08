// supabase/functions/gcal-disconnect/index.ts
//
// Disconnects a Google account: revokes our access at Google (best-effort) and
// deletes the connection row. Later phases cascade-delete the member's mirrored
// calendars + events off this row's FK.
//
// Runs with the default verify_jwt = true. The base `google_connections` table
// is service-role-only (no RLS policy for authenticated), so the delete goes
// through the service role here, gated by an explicit `user_id = caller` check
// so a member can only ever disconnect their OWN account.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_auth_header" }, 401);
  const callerId = decodeJwtSub(authHeader.replace(/^Bearer\s+/i, ""));
  if (!callerId) return json({ error: "unauthorized" }, 401);

  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.id) return json({ error: "invalid_request" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Ownership check: the connection must belong to the caller.
  const { data: conn } = await admin
    .from("google_connections")
    .select("refresh_token, access_token")
    .eq("id", body.id)
    .eq("user_id", callerId)
    .maybeSingle();
  if (!conn) return json({ error: "not_found" }, 404);

  // Best-effort revoke so our app loses Google access immediately; we delete
  // the local row regardless of whether the revoke call succeeds.
  const token = conn.refresh_token ?? conn.access_token;
  if (token) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // ignore — revoke is best-effort
    }
  }

  const { error } = await admin
    .from("google_connections")
    .delete()
    .eq("id", body.id)
    .eq("user_id", callerId);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Pulls `sub` (the user UUID) out of a JWT without verifying the signature.
 * Safe because the Functions platform verified the JWT before invoking this
 * handler (default verify_jwt = true). Mirrors manage-family-login.
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
