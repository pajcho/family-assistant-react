-- Schedule the gcal-sync Edge Function to mirror shared Google calendars.
--
-- Runs every 15 minutes. Like send-due-pushes it's deployed with
-- verify_jwt = false and authorises callers via an `X-Cron-Secret` header read
-- from Supabase's vault (`cron_secret`), so no secret appears in this file.
--
-- Webhooks (events.watch) are intentionally deferred — Google notifications
-- aren't 100% reliable and need a safety poll anyway, so polling IS the v1
-- mechanism. The function itself is incremental (syncToken), so each run is
-- cheap once the initial full sync is done.
--
-- Prereq (shared with send-due-pushes; already set up there): the `cron_secret`
-- vault entry + the function's CRON_SECRET, and the pg_cron / pg_net extensions
-- (created by the send-due-pushes schedule migration — NOT re-created here, as
-- re-running `CREATE EXTENSION pg_cron` trips Supabase's after-create grant
-- script with "dependent privileges exist"). This migration only adds the job.

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid FROM cron.job WHERE jobname = 'gcal-sync-every-15-min';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'gcal-sync-every-15-min',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://tiokicffpbzqgrsqrkgt.supabase.co/functions/v1/gcal-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $cron$
);
