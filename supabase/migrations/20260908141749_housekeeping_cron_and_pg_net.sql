-- Housekeeping for the two tables that had grown to 93% of the production
-- database, and less idle churn from the per-minute cron jobs.
--
-- Background (measured on prod on 2026-09-08 while chasing a Supabase "Disk IO
-- budget" warning): `cron.job_run_details` was 139 MB (223k rows, never purged)
-- and `net._http_response` 134 MB for ~750 live rows. Real app data was 4 MB.
-- Autovacuum never reclaims either table because the processes that write
-- them do not report table statistics - the pg_cron launcher never has, and the
-- pg_net worker stopped doing so on 2026-08-05. With every counter stuck at
-- zero no threshold is ever crossed, so both tables only ever grow. The bloated
-- response table also made the pg_net worker's TTL delete walk ~45 MB of
-- buffers every ~20 seconds, which on a 431 MB Nano box became swap traffic:
-- the disk IO Supabase was warning about.
--
-- Three changes:
--   1. A nightly purge of cron run history older than 7 days (the pg_cron
--      README's own recommendation) and a nightly explicit VACUUM of both
--      tables, because autovacuum cannot see them. pg_cron runs every job
--      outside a transaction block, so VACUUM is allowed there.
--   2. One cron job per minute instead of two. `minute_tick()` kicks
--      send-due-pushes and, only when the outbox actually holds pending rows,
--      notify-outbox. Each pg_cron run opens a fresh connection (background
--      workers are off on hosted Supabase) and leaves a run-history row, and
--      each HTTP call leaves a response row; this halves the former and drops
--      ~1,440 of the latter per day.
--   3. The completed-task purge moves from every 10 minutes to hourly. The
--      setting it enforces is expressed in hours.
--
-- The one-off reclaim (DELETE of the old history, then VACUUM FULL of both
-- tables) is deliberately NOT here: VACUUM cannot run inside a migration's
-- transaction. It is run by hand once, one statement at a time.

-- ---------------------------------------------------------------------------
-- 0. Drop every job this migration (re)creates, so re-running it replaces
--    rather than duplicates. `cron.unschedule(bigint)` raises for a missing
--    job, hence the catalog loop instead of unschedule-by-name.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'purge-cron-run-history',
      'vacuum-housekeeping-tables',
      'send-due-pushes-every-minute',
      'flush-notification-outbox-every-minute',
      'minute-tick',
      'purge-expired-completed-tasks'
    )
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Housekeeping jobs
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'purge-cron-run-history',
  '7 3 * * *',
  $cron$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$cron$
);

-- Plain VACUUM, not FULL: it hands freed space back for reuse and clears dead
-- index entries, which is all the steady state needs - the tables then hold
-- a week of history and six hours of responses and stop growing. `postgres`
-- may run it because it holds MAINTAIN on both tables (granted on the cron
-- table by Supabase's pg_cron hook, on the net table to PUBLIC).
SELECT cron.schedule(
  'vacuum-housekeeping-tables',
  '27 3 * * *',
  $cron$VACUUM (ANALYZE) cron.job_run_details, net._http_response$cron$
);

-- ---------------------------------------------------------------------------
-- 2. One tick per minute
-- ---------------------------------------------------------------------------
-- Base URL resolution as notify_family_on_entity_create does it
-- (20260802095749_notify_on_create_vault_url.sql): vault first, then the GUC,
-- then the local-dev kong endpoint. Local dev has no vault rows, so it posts to
-- kong with an empty secret, the function answers 401, and a developer machine
-- never sends anything - exactly as before.
CREATE OR REPLACE FUNCTION edge_functions_base_url()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, vault
AS $$
DECLARE
  fn_url TEXT;
BEGIN
  SELECT decrypted_secret INTO fn_url
  FROM vault.decrypted_secrets
  WHERE name = 'functions_url';

  IF fn_url IS NULL OR fn_url = '' THEN
    fn_url := current_setting('supabase.functions_url', true);
  END IF;
  IF fn_url IS NULL OR fn_url = '' THEN
    fn_url := 'http://kong:8000/functions/v1';
  END IF;
  RETURN fn_url;
END;
$$;

-- Replaces the inline `net.http_post` that the old `send-due-pushes-every-minute`
-- job carried, which hard-coded the production URL - so a local stack used to
-- poke prod once a minute (and get a 401 for it).
CREATE OR REPLACE FUNCTION send_due_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, vault
AS $$
DECLARE
  secret TEXT;
BEGIN
  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';

  PERFORM net.http_post(
    url := edge_functions_base_url() || '/send-due-pushes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', COALESCE(secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
END;
$$;

-- Same contract as before (20260812000000_task_notify_outbox.sql), with one
-- addition: no pending row, no HTTP call. The edge function still decides
-- ripeness (rows must have sat for the grouping window), so during that window
-- it is called with nothing to do - a couple of times per task burst, instead
-- of 1,440 times a day. Its retention sweep of processed rows piggybacks on
-- real flushes, so processed rows now linger until the next one; they are a
-- few dozen bytes each.
--
-- SECURITY INVOKER (was DEFINER): the cron job runs as `postgres`, which owns
-- the table and can read the vault; nothing else is meant to call this.
CREATE OR REPLACE FUNCTION flush_notification_outbox()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, vault
AS $$
DECLARE
  secret TEXT;
BEGIN
  -- Served by idx_notification_outbox_pending, the partial index on the queue.
  IF NOT EXISTS (SELECT 1 FROM notification_outbox WHERE processed_at IS NULL) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';

  PERFORM net.http_post(
    url := edge_functions_base_url() || '/notify-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', COALESCE(secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
END;
$$;

-- The single per-minute job. Each half runs in its own block so that a failure
-- in one (a missing vault row, a pg_net hiccup) never starves the other.
CREATE OR REPLACE FUNCTION minute_tick()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM send_due_pushes();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'minute_tick: send_due_pushes failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM flush_notification_outbox();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'minute_tick: flush_notification_outbox failed: %', SQLERRM;
  END;
END;
$$;

-- None of these belong on the Data API surface. Supabase's default privileges
-- hand EXECUTE on new public functions to anon and authenticated, so revoking
-- from PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION edge_functions_base_url() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION send_due_pushes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION flush_notification_outbox() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION minute_tick() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'minute-tick',
  '* * * * *',
  $cron$SELECT minute_tick()$cron$
);

-- ---------------------------------------------------------------------------
-- 3. Completed-task purge: hourly
-- ---------------------------------------------------------------------------
-- `lists.auto_delete_completed_after_hours` is in hours, so an hourly sweep is
-- proportionate; every 10 minutes was 144 connections a day for a table of a
-- few hundred rows.
SELECT cron.schedule(
  'purge-expired-completed-tasks',
  '17 * * * *',
  $cron$SELECT purge_expired_completed_tasks()$cron$
);
