-- Google Calendar — split multi-day events into one row per day.
--
-- We have no multi-day event model locally, so the gcal sync now expands a
-- Google event that spans several calendar days into one external_calendar_events
-- row per day, each bucketed on its own `local_date` (matching how the agenda
-- buckets everything). That breaks the old (calendar_id, google_event_id)
-- uniqueness — a single Google event now owns several rows — so the upsert
-- conflict key must include `local_date`.
--
-- Existing single-row multi-day events stay as-is until their calendar re-syncs;
-- clearing google_calendars.sync_token forces a full re-pull that re-expands them.

ALTER TABLE external_calendar_events
  DROP CONSTRAINT IF EXISTS external_calendar_events_calendar_id_google_event_id_key;

ALTER TABLE external_calendar_events
  ADD CONSTRAINT external_calendar_events_cal_event_day_key
  UNIQUE (calendar_id, google_event_id, local_date);
