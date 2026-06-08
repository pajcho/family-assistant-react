-- Google Calendar integration — Phase B: the calendars under each connection,
-- plus the per-calendar sharing choice that drives what gets mirrored.
--
-- One row per calendar in a connected account's CalendarList. `sharing` is the
-- privacy gate the user picked for THIS family app:
--   'none'    — don't mirror this calendar at all (default; opt-in model)
--   'private' — mirror, but only the connecting member sees the events
--   'family'  — mirror and share with the whole family agenda
-- `sync_token` / `last_synced_at` / `locked_at` are sync internals filled in by
-- the Phase C sync worker (a per-calendar lock prevents concurrent syncs from
-- racing on the same syncToken).
--
-- RLS: a member manages only their OWN calendars (owner_user_id = auth.uid()),
-- read-only from the client — all writes (CalendarList upserts, sharing changes)
-- go through the service-role `gcal-calendars` Edge Function. Nothing secret
-- lives here (a syncToken is just a cursor), so no token-free view is needed.

CREATE TABLE IF NOT EXISTS google_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Google's calendar id (the primary calendar's id equals the account email).
  google_calendar_id TEXT NOT NULL,
  summary TEXT,
  -- Hex pair from CalendarList (mirror Google's calendar color in our UI).
  color TEXT,
  -- owner | writer | reader | freeBusyReader — informational for now.
  access_role TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  sharing TEXT NOT NULL DEFAULT 'none' CHECK (sharing IN ('none', 'private', 'family')),
  -- Phase C sync internals.
  sync_token TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  locked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (connection_id, google_calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendars_owner ON google_calendars(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendars_connection ON google_calendars(connection_id);
CREATE INDEX IF NOT EXISTS idx_google_calendars_family_sharing
  ON google_calendars(family_id, sharing);

ALTER TABLE google_calendars ENABLE ROW LEVEL SECURITY;

-- Members read their OWN calendars (for the picker). Writes are service-role
-- only (the gcal-calendars Edge Function), so no INSERT/UPDATE/DELETE policy.
CREATE POLICY "Owner reads own google calendars" ON google_calendars FOR SELECT
  USING (owner_user_id = auth.uid());

CREATE TRIGGER update_google_calendars_updated_at BEFORE UPDATE ON google_calendars
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
