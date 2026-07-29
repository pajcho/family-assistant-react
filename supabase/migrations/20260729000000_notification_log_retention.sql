-- Retention for notification_log (RP-3 in SCALING_PLAN.md).
--
-- The table exists only to make send-due-pushes idempotent: UNIQUE(user_id,
-- kind, ref_id) is what stops a cron retry from double-firing a push. Once an
-- occurrence is a few days in the past nothing can claim it again, so the row
-- is dead weight. It grows ~700 rows per family per year and was never cleaned.
--
-- 7 days is deliberately far longer than the longest idempotency window (a
-- digest ref_id is a local date, a payment ref_id its due date, both settled
-- within a day of the fire time even at UTC+14). Do not drop this below 2 days:
-- two members of one family can be in timezones almost a full day apart.
--
-- Deleting by sent_at is cheap - idx_notification_log_sent_at already exists
-- (20260518000000_notification_system.sql).

-- Drop the prior schedule (if any) so re-running the migration replaces rather
-- than duplicates it. Same guarded pattern as
-- 20260518100000_schedule_send_due_pushes.sql: cron.unschedule raises when the
-- job is missing, so we look it up first.
DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'purge-notification-log';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

-- 03:17 UTC: outside every plausible morning-digest minute, so the delete never
-- competes with a tick that is mid-claim.
SELECT cron.schedule(
  'purge-notification-log',
  '17 3 * * *',
  $cron$
    DELETE FROM public.notification_log
    WHERE sent_at < NOW() - INTERVAL '7 days';
  $cron$
);
