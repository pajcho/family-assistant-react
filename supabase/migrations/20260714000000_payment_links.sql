-- Faza 2 (linking) — connect a payment to the thing it pays for. Jira-style
-- issue links, but with fixed cardinality: an activity or event can have MANY
-- linked payments, while a payment links to AT MOST ONE thing (one activity OR
-- one event) — enforced by the `payments_single_link` CHECK below.
--
-- ON DELETE SET NULL (not CASCADE): deleting an activity/event must never take
-- the payment's money trail with it — the link simply detaches.
--
-- No RLS changes: the columns live on `payments`, whose existing policies are
-- already family-scoped, and both referenced tables carry the same guard.
-- No realtime publication changes: `payments` is already published.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD CONSTRAINT payments_single_link CHECK (num_nonnulls(activity_id, event_id) <= 1);

-- Partial indexes: linked payments are the minority, and the lookups are
-- always "payments FOR this activity/event" — never "payments without a link".
CREATE INDEX IF NOT EXISTS idx_payments_activity ON payments(activity_id)
  WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_event ON payments(event_id)
  WHERE event_id IS NOT NULL;
