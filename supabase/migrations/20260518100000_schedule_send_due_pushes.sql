-- Schedule the send-due-pushes Edge Function to run every minute.
--
-- The function (deployed separately, with verify_jwt = false) authorises
-- callers by checking an `X-Cron-Secret` header against the matching
-- function secret. We store the same value in Supabase's vault and read
-- it from the cron job's SQL — the secret never appears in this file,
-- and never gets committed to git.
--
-- One-off setup BEFORE applying this migration (done manually via psql,
-- not via a migration, so the plaintext secret stays out of the repo):
--   SELECT vault.create_secret('<secret>', 'cron_secret', 'pg_cron → send-due-pushes');
--
-- To rotate: regenerate the secret, update both the function secret
-- (`supabase secrets set CRON_SECRET=…`) and the vault entry
-- (`UPDATE vault.secrets SET secret = … WHERE name = 'cron_secret'`).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Make sure the postgres role can manage cron jobs (Supabase wires this
-- up by default but re-granting is idempotent and protects against a
-- fresh project missing the grants).
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Drop the prior schedule (if any) so re-running the migration replaces
-- rather than duplicates it. `cron.unschedule` raises if the job
-- doesn't exist, so we wrap it in a guarded delete from the catalog.
DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'send-due-pushes-every-minute';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'send-due-pushes-every-minute',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://tiokicffpbzqgrsqrkgt.supabase.co/functions/v1/send-due-pushes',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 8000
    );
  $cron$
);
