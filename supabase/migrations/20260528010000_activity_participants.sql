-- Promote `activities.person_id` (single owner) to a `(activity, person)`
-- junction so siblings can share the same activity — English class for
-- two kids, family chess club, anything where the same termin applies to
-- multiple people. Previously the user had to duplicate the activity
-- per person, and edits stayed out of sync.
--
-- Migration is destructive on the column (DROP COLUMN), but the data is
-- preserved via the backfill INSERT: every existing activity gets exactly
-- one row in `activity_participants` pointing at its current `person_id`.

CREATE TABLE IF NOT EXISTS activity_participants (
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalized for RLS speed (matches the pattern on activity_schedule,
  -- activity_overrides, etc.) and so the week resolver can pull all
  -- participants for a family in one query.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (activity_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_participants_family ON activity_participants(family_id);
CREATE INDEX IF NOT EXISTS idx_activity_participants_person ON activity_participants(person_id);

-- Backfill from the soon-to-be-dropped column.
INSERT INTO activity_participants (activity_id, person_id, family_id)
SELECT id, person_id, family_id FROM activities
ON CONFLICT (activity_id, person_id) DO NOTHING;

ALTER TABLE activity_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family activity_participants" ON activity_participants FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family activity_participants" ON activity_participants FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family activity_participants" ON activity_participants FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- Person assignment now lives in the junction table.
ALTER TABLE activities DROP COLUMN IF EXISTS person_id;
