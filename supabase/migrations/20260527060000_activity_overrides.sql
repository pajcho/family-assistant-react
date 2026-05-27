-- Per-occurrence overrides on activity_schedule rules. Two action shapes:
--
--   'cancel'     — this specific date doesn't happen. The grid keeps a
--                  ghost row so the user can see "this was supposed to
--                  be here but isn't" rather than silently dropping it.
--   'reschedule' — same date but moved to a different time window. The
--                  resolver swaps in `override_start_time` / `override_end_time`.
--
-- Semantic for shift / A-B interactions: overrides are looked up *after*
-- the rule decides whether it fires that day. If the underlying rule
-- stops firing (because the kid's shift flipped, the activity was paused,
-- the season ended), the override is silently ignored — but stays in the
-- database, so the original state is restored if circumstances reverse.
--
-- One override per (schedule_id, date) is enforced by the UNIQUE constraint:
-- the UI only ever offers one outcome per occurrence.

CREATE TABLE IF NOT EXISTS activity_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES activity_schedule(id) ON DELETE CASCADE,
  -- Denormalized so RLS can match without joining through activity_schedule
  -- and the week-resolver can pull all overrides for a family in one query.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'reschedule')),
  -- NULL for cancels; required (and end > start) for reschedules. We don't
  -- enforce the "required for reschedule" part at the DB level to keep the
  -- constraint simple — the client always sends them together.
  override_start_time TIME,
  override_end_time TIME,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (schedule_id, date),
  CHECK (override_end_time IS NULL OR override_start_time IS NULL OR override_end_time > override_start_time)
);

CREATE INDEX IF NOT EXISTS idx_activity_overrides_family ON activity_overrides(family_id);
CREATE INDEX IF NOT EXISTS idx_activity_overrides_schedule ON activity_overrides(schedule_id);

ALTER TABLE activity_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family overrides" ON activity_overrides FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family overrides" ON activity_overrides FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family overrides" ON activity_overrides FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family overrides" ON activity_overrides FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE TRIGGER update_activity_overrides_updated_at BEFORE UPDATE ON activity_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
