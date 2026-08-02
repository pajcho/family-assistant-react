-- Multi-day events: an optional inclusive last day on `events`.
--
-- NULL = single-day event (everything created so far). When set it must be
-- strictly AFTER `date`, so a one-day span has exactly one representation
-- (end_date NULL) and the UI never has to disambiguate `end_date = date`.
--
-- Times keep one meaning across the span, mirroring how the gcal sync expands
-- Google multi-day events (supabase/functions/_shared/expandEvent.ts):
-- `start_time` is when the FIRST day starts, `end_time` when the LAST day
-- ends; both NULL = whole days. Unlike the mirrored `external_calendar_events`
-- (one row per day), a native event stays ONE row - participants, reminders
-- and edits keep a single anchor - and the per-day expansion happens
-- client-side in `useAgenda`.

ALTER TABLE events ADD COLUMN end_date DATE;

ALTER TABLE events
  ADD CONSTRAINT events_end_date_after_date
  CHECK (end_date IS NULL OR end_date > date);
