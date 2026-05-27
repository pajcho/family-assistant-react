-- Add a fourth recurrence option ("weekly") and a `recurrence_interval`
-- knob that lets the user pick "every N weeks" / "every N months". Existing
-- monthly/limited rows behave the same because the default interval is 1.
--
-- The CHECK constraint was inlined in the original schema with no name,
-- so we drop it by its auto-generated name and recreate with the wider
-- alternation. `recurrence_interval` is NOT NULL with a default of 1 —
-- every existing row is back-filled by the default.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_recurrence_period_check;
ALTER TABLE payments ADD CONSTRAINT payments_recurrence_period_check
  CHECK (recurrence_period IN ('monthly', 'weekly', 'limited', 'one-time'));

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1
  CHECK (recurrence_interval >= 1);
