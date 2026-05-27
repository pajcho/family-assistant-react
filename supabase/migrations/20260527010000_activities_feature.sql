-- Activities feature: weekly recurring schedule per family member.
--
-- Three new tables plus a `color` column on profiles:
--
--   activities             — the definition (name, category, who it belongs to)
--   activity_schedule      — when it happens (day-of-week + time, optional A/B
--                            week pattern tied to the person's school shift)
--   school_shift_anchors   — per-child anchor for the alternating school
--                            shift (morning ⇄ afternoon). Everything else
--                            is derived from this single row + the current
--                            week's offset.
--
-- Day-of-week is 0=Mon … 6=Sun (UI is Monday-first). JS `Date.getDay()`
-- returns 0=Sun..6=Sat, so the client remaps on read/write.
--
-- A/B week semantics: `week_pattern='A'` means "weeks when this person is in
-- the morning shift", `'B'` means "weeks when they're in the afternoon
-- shift". The binding is implicit — the activity's person → that person's
-- shift anchor → the current week's resolved shift. `'every'` is the default
-- and ignores shifts.

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('training','school','music','english','other')),
  -- Optional season window. NULL on either end means open-ended in that
  -- direction. Used to hide rows whose season hasn't started yet or has
  -- already ended without forcing the user to delete them.
  active_from DATE,
  active_to DATE,
  -- Temporary pause without losing the definition (e.g., holiday break).
  is_paused BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_family_id ON activities(family_id);
CREATE INDEX IF NOT EXISTS idx_activities_person_id ON activities(person_id);
CREATE INDEX IF NOT EXISTS idx_activities_family_paused ON activities(family_id, is_paused);

CREATE TABLE IF NOT EXISTS activity_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  -- Denormalized for RLS speed and so the week query doesn't need a join
  -- back to activities just to filter by family.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  week_pattern TEXT NOT NULL DEFAULT 'every'
    CHECK (week_pattern IN ('every','A','B')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_activity_schedule_activity ON activity_schedule(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_schedule_family ON activity_schedule(family_id);

CREATE TABLE IF NOT EXISTS school_shift_anchors (
  -- One row per person — the anchor uniquely defines the alternation
  -- forever after, so we PK on person_id rather than carrying a separate id.
  person_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- The Monday of the anchor week (DB enforces nothing about day-of-week;
  -- the client always normalizes to Monday before insert).
  anchor_week_start DATE NOT NULL,
  anchor_shift TEXT NOT NULL CHECK (anchor_shift IN ('morning','afternoon')),
  -- "Every N weeks the shift flips". Default 1 means a true week-by-week
  -- alternation; bumping to 2 would model a fortnightly flip if a school
  -- ever does that.
  flip_interval_weeks INTEGER NOT NULL DEFAULT 1
    CHECK (flip_interval_weeks >= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_shift_anchors_family ON school_shift_anchors(family_id);

-- Per-profile color used to render that person's activities (and any other
-- per-person UI later). Stored as hex string to stay flexible; the UI picks
-- from a curated palette and writes the canonical value.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS color TEXT;

-- A parent needs to be able to assign colors / names to child profiles that
-- don't have their own login. The original "Users can update own profile"
-- policy stays in place — Postgres OR's policies, so this is purely
-- additive.
CREATE POLICY "Users can update own family profiles" ON profiles FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- RLS — same pattern as events / payments: a row is visible iff its family
-- matches the authenticated user's profile row.

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_shift_anchors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family activities" ON activities FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family activities" ON activities FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family activities" ON activities FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family activities" ON activities FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view own family activity_schedule" ON activity_schedule FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family activity_schedule" ON activity_schedule FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family activity_schedule" ON activity_schedule FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family activity_schedule" ON activity_schedule FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view own family shift_anchors" ON school_shift_anchors FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family shift_anchors" ON school_shift_anchors FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family shift_anchors" ON school_shift_anchors FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family shift_anchors" ON school_shift_anchors FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- updated_at triggers (reuse the project-wide helper from the initial schema)
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_activity_schedule_updated_at BEFORE UPDATE ON activity_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_school_shift_anchors_updated_at BEFORE UPDATE ON school_shift_anchors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
