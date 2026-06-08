// supabase/functions/gcal-calendars/index.ts
//
// Lists + syncs the caller's Google calendars (CalendarList) into
// google_calendars, and updates the per-calendar `sharing` choice
// (none | private | family) that controls what gets mirrored into the family
// agenda. Read-only against Google.
//
// verify_jwt = true. The caller id comes from the JWT; all DB work runs through
// the service role (the gcal tables are service-role-only) gated by explicit
// owner checks so a member only ever touches their OWN calendars.
//
// POST body:
//   { action: "list" }                              -> refresh from Google, return rows
//   { action: "set_sharing", calendarId, sharing }  -> update one calendar's sharing

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getFreshAccessToken, googleGet, ReauthRequiredError } from "../_shared/google.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SHARING = ["none", "private", "family"] as const;
type Sharing = (typeof SHARING)[number];

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  deleted?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

interface Body {
  action?: "list" | "set_sharing";
  calendarId?: string;
  sharing?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_auth_header" }, 401);
  const callerId = decodeJwtSub(authHeader.replace(/^Bearer\s+/i, ""));
  if (!callerId) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const apiKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (body.action === "set_sharing") {
    return await setSharing(admin, callerId, body);
  }
  if (body.action === "list") {
    return await listCalendars(admin, callerId);
  }
  return json({ error: "invalid_request" }, 400);
});

async function setSharing(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  body: Body,
): Promise<Response> {
  const sharing = body.sharing as Sharing;
  if (!body.calendarId || !SHARING.includes(sharing)) {
    return json({ error: "invalid_request" }, 400);
  }
  // Owner check is in the WHERE: a member can only set sharing on their own row.
  const { data, error } = await admin
    .from("google_calendars")
    .update({ sharing })
    .eq("id", body.calendarId)
    .eq("owner_user_id", callerId)
    .select("id")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

async function listCalendars(
  admin: ReturnType<typeof createClient>,
  callerId: string,
): Promise<Response> {
  const { data: connections } = await admin
    .from("google_connections")
    .select("id, family_id, access_token, refresh_token, token_expires_at")
    .eq("user_id", callerId);

  for (const conn of connections ?? []) {
    let accessToken: string;
    try {
      accessToken = await getFreshAccessToken(admin, conn);
    } catch (e) {
      // Reauth needed (token dead) — skip this connection, keep going. The
      // connection is already flagged needs_reauth by the helper.
      if (e instanceof ReauthRequiredError) continue;
      throw e;
    }

    let list: { items?: CalendarListEntry[] };
    try {
      list = await googleGet(
        accessToken,
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&minAccessRole=reader",
      );
    } catch {
      continue; // transient Google error — don't fail the whole request
    }

    for (const cal of list.items ?? []) {
      if (cal.deleted) continue;
      // Omit `sharing` from the payload so an existing choice is preserved on
      // conflict, and new rows fall back to the column default ('none').
      await admin.from("google_calendars").upsert(
        {
          connection_id: conn.id,
          family_id: conn.family_id,
          owner_user_id: callerId,
          google_calendar_id: cal.id,
          summary: cal.summaryOverride ?? cal.summary ?? cal.id,
          color: cal.backgroundColor ?? null,
          access_role: cal.accessRole ?? null,
          is_primary: cal.primary ?? false,
        },
        { onConflict: "connection_id,google_calendar_id" },
      );
    }
  }

  // Return the caller's calendars (primary first, then by name) for the picker.
  const { data: calendars, error } = await admin
    .from("google_calendars")
    .select(
      "id, connection_id, google_calendar_id, summary, color, access_role, is_primary, sharing",
    )
    .eq("owner_user_id", callerId)
    .order("is_primary", { ascending: false })
    .order("summary", { ascending: true });
  if (error) return json({ error: error.message }, 500);
  return json({ calendars: calendars ?? [] });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Pulls `sub` (the user UUID) out of a JWT without verifying the signature.
 * Safe because the Functions platform verified the JWT first (verify_jwt = true).
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
