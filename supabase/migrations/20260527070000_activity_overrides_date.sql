-- Allow reschedule overrides to move a termin to a different DATE, not
-- just a different TIME on the original day. The (schedule_id, date)
-- UNIQUE constraint stays — `date` continues to mean "the day the rule
-- WOULD HAVE fired"; `override_date` is the day it actually happens.
--
-- NULL = same-day reschedule (existing behavior). Non-NULL = moved to
-- that date.

ALTER TABLE activity_overrides
  ADD COLUMN IF NOT EXISTS override_date DATE;
