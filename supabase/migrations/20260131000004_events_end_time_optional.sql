-- Make end_time optional: events can have only start time (e.g. "call at 18:00")
ALTER TABLE events
  ALTER COLUMN end_time DROP NOT NULL;
