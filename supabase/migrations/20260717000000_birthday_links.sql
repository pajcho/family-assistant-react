-- Birthdays as a third kind of link.
--
--   payments.birthday_id - a gift for someone's birthday: a payment links to a
--   birthday just as it does to an activity/event. `payments_single_link`
--   widens to all three columns (still at most ONE link per payment).
--
--   events.birthday_id - organizing a party from the birthday page creates an
--   event tied to that birthday, so the page can show a party-booked chip. No
--   CHECK constraint - an event has at most that one link.
--
-- ON DELETE SET NULL for the same reason as the existing links: deleting a
-- birthday must not drag payments/events with it - the link is simply
-- detached. No RLS/realtime changes: the columns live on tables already
-- covered.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS birthday_id UUID REFERENCES birthdays(id) ON DELETE SET NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_single_link;
ALTER TABLE payments
  ADD CONSTRAINT payments_single_link CHECK (num_nonnulls(activity_id, event_id, birthday_id) <= 1);

CREATE INDEX IF NOT EXISTS idx_payments_birthday ON payments(birthday_id)
  WHERE birthday_id IS NOT NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS birthday_id UUID REFERENCES birthdays(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_birthday ON events(birthday_id)
  WHERE birthday_id IS NOT NULL;
