-- Some kids (1st and 2nd grade) are *always* in the morning shift — the
-- school doesn't rotate them. The original anchor model assumed weekly
-- alternation, so we add a flag that lets the derivation skip the flip
-- math and just return the anchored shift forever.
--
-- Default `true` preserves the existing behavior for every already-set
-- anchor. New rows from the UI explicitly pass the value.

ALTER TABLE school_shift_anchors
  ADD COLUMN IF NOT EXISTS is_alternating BOOLEAN NOT NULL DEFAULT true;
