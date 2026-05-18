-- Make start_time optional: all-day events have no start/end, or user can enter only end time
ALTER TABLE events
  ALTER COLUMN start_time DROP NOT NULL;
