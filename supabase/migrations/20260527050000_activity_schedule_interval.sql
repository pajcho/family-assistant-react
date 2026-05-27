-- Allow a schedule rule to repeat every N weeks instead of strictly weekly.
-- The default `1` keeps every existing row firing the same way it did
-- before (each week).
--
-- The "every N weeks" anchor is `activities.created_at` normalized to that
-- week's Monday — kept implicit so the form stays a single field. A/B
-- patterns ignore this (they're inherently bi-weekly tied to the person's
-- shift), so the resolver only multiplies the gap when `week_pattern =
-- 'every'`.

ALTER TABLE activity_schedule
  ADD COLUMN IF NOT EXISTS recurrence_interval_weeks INTEGER NOT NULL DEFAULT 1
  CHECK (recurrence_interval_weeks >= 1);
