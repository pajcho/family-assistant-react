-- Google Calendar integration — Phase C: the mirrored events.
--
-- Read-only copies of Google events, kept fresh by the gcal-sync worker. Stored
-- separately from `events` on purpose: sync churns rows constantly and these
-- must NOT fire the notify-on-create push trigger, must never be edited, and
-- carry Google-shaped fields the native table doesn't have.
--
-- `visibility` is denormalized from the source calendar's `sharing` at sync time
-- so RLS can be a simple per-row check (and so changing sharing flips visibility
-- without a join). `local_date` / `start_time` / `end_time` are the event in the
-- family's wall-clock timezone, matching how `events` are bucketed in the agenda;
-- `start_at` / `end_at` keep the absolute instants for precise ordering.

CREATE TABLE IF NOT EXISTS external_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
  -- Denormalized from the calendar for fast RLS (family-shared vs private).
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('family', 'private')),
  -- Google identifiers. `ical_uid` is stable across calendars (used later by
  -- local enrichment); `recurring_event_id` links an expanded instance to its
  -- series master.
  google_event_id TEXT NOT NULL,
  ical_uid TEXT,
  recurring_event_id TEXT,
  title TEXT,
  description TEXT,
  location TEXT,
  -- Absolute instants (null for all-day).
  start_at TIMESTAMP WITH TIME ZONE,
  end_at TIMESTAMP WITH TIME ZONE,
  -- Wall-clock projection in the family timezone, for agenda bucketing.
  local_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  -- default | fromGmail | birthday | outOfOffice | focusTime | workingLocation
  event_type TEXT,
  status TEXT,
  html_link TEXT,
  -- For fromGmail events: deep link back to the originating Gmail/source item.
  source_url TEXT,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (calendar_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_ext_events_family_date
  ON external_calendar_events(family_id, local_date);
CREATE INDEX IF NOT EXISTS idx_ext_events_owner ON external_calendar_events(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_ext_events_calendar ON external_calendar_events(calendar_id);

ALTER TABLE external_calendar_events ENABLE ROW LEVEL SECURITY;

-- Read: family-shared events to the whole family; private events only to the
-- connecting member. Writes are service-role only (the gcal-sync worker), so no
-- INSERT/UPDATE/DELETE policy.
CREATE POLICY "Read mirrored calendar events" ON external_calendar_events FOR SELECT
  USING (
    (visibility = 'family' AND family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()))
    OR (visibility = 'private' AND owner_user_id = auth.uid())
  );

CREATE TRIGGER update_external_calendar_events_updated_at
  BEFORE UPDATE ON external_calendar_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Publish to realtime so an open agenda refreshes when a sync lands. Cloud
-- auto-adds new tables, but local `supabase_realtime` is not FOR ALL TABLES, so
-- add it explicitly (guarded) to keep local in sync.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'external_calendar_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE external_calendar_events;
  END IF;
END $$;
