// supabase/functions/subscribe-push/index.ts
//
// Stores or refreshes a Web Push subscription for the calling user.
//
// The frontend hands us the four fields the browser produced
// (`endpoint`, `keys.p256dh`, `keys.auth`) plus the `User-Agent` for
// human-readable device names later. We upsert keyed by `endpoint` so
// re-subscribes after a reinstall don't create duplicate rows.
//
// RLS does the access check — the function runs under the caller's JWT,
// so the `INSERT/UPDATE` is rejected if `user_id` doesn't match
// `auth.uid()`. No service-role usage here; that's reserved for the
// future cron job that sends pushes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return json({ error: "missing_subscription_fields" }, 400);
  }

  // Upsert on the unique `endpoint` so that re-subscribing after a
  // reinstall or VAPID rotation cleanly replaces the existing row.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: body.userAgent ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
