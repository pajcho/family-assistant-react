-- Snapshot the payment's NAME onto each payment_history row.
--
-- The amount was already frozen at pay-time (payment_history.amount) — this
-- completes the freeze so the history popup shows the name AS IT WAS when the
-- occurrence was paid/canceled. Renaming (and/or re-pricing) the live payment
-- later no longer rewrites the past, which is exactly the "promenili smo i
-- naziv i cenu" confusion we want to avoid.
--
-- Nullable + the UI falls back to the live payment name for pre-existing rows;
-- backfilled below from the current payment name (best effort — the true
-- historical name for old rows is unrecoverable, so "current" is the closest).
-- Going forward, useMarkPaymentPaid / useCancelPaymentOccurrence write the live
-- name into every new row.

ALTER TABLE payment_history ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE payment_history h
SET name = p.name
FROM payments p
WHERE h.payment_id = p.id
  AND h.name IS NULL;
