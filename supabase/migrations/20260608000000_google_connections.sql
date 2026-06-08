-- Google Calendar integration — Phase A: per-user OAuth connection.
--
-- A logged-in family member connects their OWN Google account so we can later
-- mirror their calendars into the shared family agenda (one-way, read-only).
-- This migration only stores the OAuth connection; calendar selection and the
-- mirrored events arrive in later phases.
--
-- Tokens live ONLY here and never reach the browser. RLS is enabled with NO
-- policy granting the `authenticated` / `anon` roles any access, so the base
-- table is reachable solely by the service role — the Edge Functions that run
-- the OAuth code exchange and (later) the sync. The UI reads connection STATUS
-- through the `google_connections_safe` view below, which exposes every column
-- EXCEPT the tokens. Refresh-token-at-rest encryption is deliberately deferred:
-- a service-role-only table matches how the VAPID private key is already kept.

CREATE TABLE IF NOT EXISTS google_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- The connected Google account. `google_account_email` is shown in the UI
  -- ("Povezan: x@gmail.com"); `google_user_id` is Google's stable `sub` claim.
  google_account_email TEXT NOT NULL,
  google_user_id TEXT,
  -- OAuth tokens. `refresh_token` is nullable because Google only returns it on
  -- first consent unless we force `prompt=consent` (we do) — the callback still
  -- coalesces to the previously stored value defensively.
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  scopes TEXT,
  -- Flipped true when a token refresh fails with invalid_grant — e.g. the 7-day
  -- refresh-token expiry that applies while the OAuth app is in Google "Testing"
  -- mode. The UI surfaces a "Poveži ponovo" prompt while this is true.
  needs_reauth BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- One row per (member, Google account); re-connecting upserts on this.
  UNIQUE (user_id, google_account_email)
);

CREATE INDEX IF NOT EXISTS idx_google_connections_user ON google_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_google_connections_family ON google_connections(family_id);

ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
-- No policies, on purpose: only the service role (Edge Functions) touches this
-- table directly, so authenticated/anon see zero rows and the tokens can't leak
-- even through a stray column grant.

CREATE TRIGGER update_google_connections_updated_at BEFORE UPDATE ON google_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Token-free view for the client. A plain view is SECURITY DEFINER: it runs as
-- its owner and bypasses the base table's RLS, so the explicit
-- `user_id = auth.uid()` filter is what scopes each member to their OWN
-- connections. The token columns are simply never selected, so they never leave
-- the server. (Intentional definer view — the base table is service-role-only.)
CREATE OR REPLACE VIEW public.google_connections_safe AS
SELECT
  id,
  user_id,
  family_id,
  google_account_email,
  scopes,
  needs_reauth,
  created_at,
  updated_at
FROM public.google_connections
WHERE user_id = auth.uid();

GRANT SELECT ON public.google_connections_safe TO authenticated;
