-- Per-activity push reminder. NULL = no reminder (the default). When set
-- to N, every participant gets a push N minutes before each occurrence's
-- start time, in their own timezone. Mirrors `events.remind_minutes_before`
-- in shape and the cron path that consumes it.
--
-- Kept at the activity level (not per schedule rule) for the same reason
-- events use a single column: most users want one "remind me before any
-- training" knob, not separate reminders per day-of-week. Per-rule
-- granularity can come later if real usage asks for it.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS remind_minutes_before INTEGER;
