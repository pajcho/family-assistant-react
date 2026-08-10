-- The day of the month the payment was originally set to. Without it the
-- monthly due date is lost for good: addMonth(2026-01-31) returns 2026-02-28,
-- so the next step counts from the 28th and the series stays on the 28th
-- forever.
--
-- With the anchor, every step derives the day from due_anchor_day rather than
-- from the previous (already clamped) result: 31 -> 28 (February) -> 31
-- (March) -> 30 (April).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS due_anchor_day SMALLINT;

-- Backfilling existing rows: we take the day from the current due_date.
-- An honest note: for series that have ALREADY drifted this records the drifted
-- day (28), not the original (31). The original cannot be reconstructed
-- reliably, and guessing it from payment_history could inflate the anchor if
-- the user legitimately moved the date. So: the drift stops here, but the drift
-- that has already happened is not undone retroactively.
UPDATE payments SET due_anchor_day = EXTRACT(DAY FROM due_date)::SMALLINT
  WHERE due_anchor_day IS NULL;

ALTER TABLE payments ADD CONSTRAINT payments_due_anchor_day_range
  CHECK (due_anchor_day IS NULL OR (due_anchor_day >= 1 AND due_anchor_day <= 31));

COMMENT ON COLUMN payments.due_anchor_day IS
  'The day of the month (1-31) the series is anchored to. Every monthly step derives the day from here, so the 31st does not permanently become the 28th after February.';
