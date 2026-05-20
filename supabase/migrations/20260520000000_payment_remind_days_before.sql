-- Payment reminders need a different unit than events:
-- payments have no `start_time`, only a `due_date`, so "minutes before"
-- doesn't carry useful semantics. Replace `remind_minutes_before` with
-- `remind_days_before`; the cron job fires at the user's `morning_time`
-- on `due_date - remind_days_before` (0 = morning of the due date).
--
-- Safe to drop the old column: it was added in 20260518000000 but no
-- code ever wrote to it (the UI never exposed a control).

ALTER TABLE payments DROP COLUMN IF EXISTS remind_minutes_before;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS remind_days_before INT;
