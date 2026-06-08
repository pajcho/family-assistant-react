-- Google Calendar integration — local enrichment of mirrored events.
--
-- Mirrored events (external_calendar_events) are read-only and get rewritten on
-- every sync, so app-local metadata must live separately, keyed by a STABLE id.
-- We key on `ical_uid` (stable across calendars AND re-syncs); for recurring
-- events all instances share it, so assigning/reminding a series applies to all
-- its occurrences — the sensible default for a family agenda.
--
-- Per family (one row per family + ical_uid). Lets a member assign a Google event
-- to a family member (→ shows their badge + enters the person filter) and set a
-- family push reminder. Nothing here is written back to Google.

CREATE TABLE IF NOT EXISTS external_event_local (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  ical_uid TEXT NOT NULL,
  -- ON UPDATE CASCADE: a login-less member can be assigned, and promoting them
  -- re-keys profiles.id — the assignment must follow (see family_admin migration).
  assigned_person_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  remind_minutes_before INT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (family_id, ical_uid)
);

CREATE INDEX IF NOT EXISTS idx_external_event_local_family ON external_event_local(family_id);
CREATE INDEX IF NOT EXISTS idx_external_event_local_person
  ON external_event_local(assigned_person_id);

ALTER TABLE external_event_local ENABLE ROW LEVEL SECURITY;

-- Family members manage local metadata for their family (client writes via RLS).
CREATE POLICY "View family external event local" ON external_event_local FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Insert family external event local" ON external_event_local FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Update family external event local" ON external_event_local FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Delete family external event local" ON external_event_local FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE TRIGGER update_external_event_local_updated_at BEFORE UPDATE ON external_event_local
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Publish to realtime so an assignment/reminder change refreshes other members'
-- open agendas (local is not FOR ALL TABLES; Cloud auto-adds).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'external_event_local'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE external_event_local;
  END IF;
END $$;
