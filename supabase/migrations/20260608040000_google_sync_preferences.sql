-- Google Calendar integration — per-user "what to import" preferences.
--
-- The special Google event types (contact birthdays, Gmail-auto flights/hotels,
-- and the work markers out-of-office / focus-time / working-location) cluster on
-- a member's PRIMARY calendar, so the filter is per-user (one row per connecting
-- member), not per-calendar. `default` events are always imported; these three
-- booleans gate the rest. SKIP-LIST semantics: the sync imports everything except
-- the types turned off here, so a NEW Google event type still shows by default.
--
-- Defaults: Gmail travel ON (useful), contact birthdays + work markers OFF (noise
-- for a family agenda). A member with no row uses these same defaults.
--
-- Read by the client via RLS (own row); written via the gcal-calendars Edge
-- Function (action=set_sync_prefs), which also resets the sync cursor and kicks an
-- immediate re-sync so the change takes effect at once.

CREATE TABLE IF NOT EXISTS google_sync_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  import_from_gmail BOOLEAN NOT NULL DEFAULT true,
  import_birthdays BOOLEAN NOT NULL DEFAULT false,
  import_work_markers BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE google_sync_preferences ENABLE ROW LEVEL SECURITY;

-- A member reads their OWN prefs to render the toggles. Writes go through the
-- service-role function so they apply + re-sync atomically (no client write policy).
CREATE POLICY "Owner reads own sync prefs" ON google_sync_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE TRIGGER update_google_sync_preferences_updated_at
  BEFORE UPDATE ON google_sync_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
