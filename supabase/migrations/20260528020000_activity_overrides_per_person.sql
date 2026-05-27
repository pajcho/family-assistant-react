-- Per-occurrence overrides become per-person so one kid can be canceled
-- without taking the other out of the same termin. UNIQUE key extends
-- from (schedule_id, date) to (schedule_id, date, person_id).
--
-- Backfill resolves each existing override to the activity's first (and
-- previously only) participant via the junction table populated in the
-- preceding migration. After that we can flip the column to NOT NULL.

ALTER TABLE activity_overrides
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

UPDATE activity_overrides ov
SET person_id = (
  SELECT ap.person_id
  FROM activity_schedule s
  JOIN activity_participants ap ON ap.activity_id = s.activity_id
  WHERE s.id = ov.schedule_id
  LIMIT 1
)
WHERE person_id IS NULL;

ALTER TABLE activity_overrides ALTER COLUMN person_id SET NOT NULL;

-- Swap the UNIQUE constraint. The old composite of (schedule_id, date)
-- can't coexist with the new one — drop first, then add.
ALTER TABLE activity_overrides DROP CONSTRAINT IF EXISTS activity_overrides_schedule_id_date_key;
ALTER TABLE activity_overrides
  ADD CONSTRAINT activity_overrides_schedule_id_date_person_id_key
  UNIQUE (schedule_id, date, person_id);
