-- Denormalize the source calendar's color onto each mirrored event so the agenda
-- can tint Google events by their calendar (e.g. holidays green, personal blue),
-- the way activities are tinted by person. Filled in by the sync worker; existing
-- rows pick it up on their next sync.

ALTER TABLE external_calendar_events ADD COLUMN IF NOT EXISTS color TEXT;
