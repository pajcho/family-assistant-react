-- Phase 1 of the "events like activities" upgrade:
--   1. Assign an event to one or more family members (OPTIONAL) via a
--      junction table, mirroring `activity_participants`. Unlike activities,
--      an event may have ZERO participants — a family-wide event needs no
--      assignee, so the "at least one" rule from activities does not apply.
--   2. Soft-cancel an event without deleting it. A canceled event drops off
--      the dashboard / upcoming list but is preserved so it can still render
--      (struck-through) in the calendar that lands in a later phase.
--
-- Rescheduling an event is just an UPDATE of `events.date` — no history is
-- kept (per product decision), so no extra columns are needed for that.

-- 1. Member assignment ------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_participants (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalized for RLS speed + single-query family fetches, matching the
  -- pattern on activity_participants / activity_schedule.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (event_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_event_participants_family ON event_participants(family_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_person ON event_participants(person_id);

ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family event_participants" ON event_participants FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family event_participants" ON event_participants FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family event_participants" ON event_participants FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- Supabase Cloud auto-adds new tables to `supabase_realtime`, but being
-- explicit keeps local `supabase start` in sync so the events hook's
-- postgres_changes subscription fires for participant edits too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_participants;
  END IF;
END $$;

-- 2. Soft cancel ------------------------------------------------------------

-- NULL = active. A timestamp = canceled (and when). UPDATE is already
-- allowed by the existing "Users can update own family data" policy on events.
ALTER TABLE events ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP WITH TIME ZONE;

-- Optional free-text reason captured at cancel time (will surface in the
-- calendar later). Cleared when an event is restored. The same shape will be
-- added to payments in Phase 2.
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
