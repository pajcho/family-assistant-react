// supabase/functions/_shared/google.ts
//
// Shared Google OAuth + Calendar API helpers for the gcal-* Edge Functions.
// Keeping these in one place so the calendar-list sync (Phase B) and the event
// sync worker (Phase C) refresh tokens and call Google the same way.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Admin = ReturnType<typeof createClient>;

export interface Connection {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

/**
 * Thrown when a connection can no longer be refreshed (refresh token revoked or
 * expired — e.g. the 7-day Testing-mode expiry). The connection is flagged
 * `needs_reauth` before throwing so the UI can prompt a reconnect; callers
 * should catch this and skip that connection rather than fail the whole request.
 */
export class ReauthRequiredError extends Error {
  connectionId: string;
  constructor(connectionId: string) {
    super("needs_reauth");
    this.name = "ReauthRequiredError";
    this.connectionId = connectionId;
  }
}

/**
 * Returns a valid access token for `conn`, refreshing + persisting a new one
 * when the stored token is missing or within 60s of expiry.
 */
export async function getFreshAccessToken(admin: Admin, conn: Connection): Promise<string> {
  const expMs = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (conn.access_token && expMs - Date.now() > 60_000) {
    return conn.access_token;
  }

  if (!conn.refresh_token) {
    await flagReauth(admin, conn.id);
    throw new ReauthRequiredError(conn.id);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
    }),
  });
  if (!res.ok) {
    // invalid_grant (revoked / expired) => the refresh token is dead.
    await flagReauth(admin, conn.id);
    throw new ReauthRequiredError(conn.id);
  }
  const tok = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!tok.access_token) {
    await flagReauth(admin, conn.id);
    throw new ReauthRequiredError(conn.id);
  }
  const expiresAt = tok.expires_in
    ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
    : null;
  await admin
    .from("google_connections")
    .update({
      access_token: tok.access_token,
      token_expires_at: expiresAt,
      needs_reauth: false,
    })
    .eq("id", conn.id);
  return tok.access_token;
}

async function flagReauth(admin: Admin, connectionId: string): Promise<void> {
  await admin.from("google_connections").update({ needs_reauth: true }).eq("id", connectionId);
}

/**
 * A non-2xx response from the Google API. `status` lets callers branch — most
 * importantly on 410 GONE, which means a `syncToken` expired and the caller must
 * wipe + full-resync that calendar.
 */
export class GoogleApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`google_api_${status}: ${body.slice(0, 200)}`);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

/** GETs a Google API URL with the bearer token; returns parsed JSON or throws. */
export async function googleGet<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new GoogleApiError(res.status, await res.text());
  }
  return (await res.json()) as T;
}
