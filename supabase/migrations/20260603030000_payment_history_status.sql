-- Let payment_history record CANCELED occurrences, not just paid ones — so a
-- skipped recurring payment is visible in history and the series advances to
-- the next occurrence (the "next becomes active" behavior). A 'canceled' entry
-- has no paid_date; `note` holds the optional reason. Existing rows = 'paid'.

ALTER TABLE payment_history
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'canceled'));

ALTER TABLE payment_history ADD COLUMN IF NOT EXISTS note TEXT;

-- Canceled entries have no paid_date.
ALTER TABLE payment_history ALTER COLUMN paid_date DROP NOT NULL;
