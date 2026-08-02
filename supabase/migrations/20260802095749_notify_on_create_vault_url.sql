-- notify_family_on_entity_create: resolve the functions base URL from vault.
--
-- The original function (20260520250000_notify_on_create.sql) read the GUC
-- `supabase.functions_url`, assuming hosted Supabase sets it. It does not:
-- the setting exists nowhere, so on prod the fallback pointed every trigger
-- call at http://kong:8000 - a docker hostname that only resolves on local
-- dev - and the instant "partner added X" pushes never worked in production
-- (pg_net: "Couldn't resolve host name"; discovered 2026-08-02).
--
-- Persisting the GUC is not an option either: since Postgres 15, ALTER
-- DATABASE / ALTER ROLE ... SET on an arbitrary custom parameter requires
-- superuser ("permission denied to set parameter"), and the hosted
-- `postgres` role is not one. The vault already carries `cron_secret` for
-- exactly this trigger, so the URL rides the same channel.
--
-- One-off setup on prod alongside this migration, mirroring the cron_secret
-- setup described in 20260518100000_schedule_send_due_pushes.sql:
--   SELECT vault.create_secret(
--     'https://tiokicffpbzqgrsqrkgt.supabase.co/functions/v1',
--     'functions_url',
--     'notify_family_on_entity_create -> edge functions base URL'
--   );
--
-- Local dev needs no setup: with no vault row and no GUC the function keeps
-- the kong:8000 fallback.

CREATE OR REPLACE FUNCTION notify_family_on_entity_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  entity_type   TEXT := TG_ARGV[0];
  fn_url        TEXT;
  secret        TEXT;
BEGIN
  -- Vault first (how prod is configured), then the GUC (kept so an
  -- environment that does define it still wins over the hardcoded
  -- fallback), then the standard local-dev endpoint.
  SELECT decrypted_secret INTO fn_url
  FROM vault.decrypted_secrets
  WHERE name = 'functions_url';

  IF fn_url IS NULL OR fn_url = '' THEN
    fn_url := current_setting('supabase.functions_url', true);
  END IF;
  IF fn_url IS NULL OR fn_url = '' THEN
    fn_url := 'http://kong:8000/functions/v1';
  END IF;

  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';

  PERFORM net.http_post(
    url := fn_url || '/notify-on-create',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', COALESCE(secret, '')
    ),
    body := jsonb_build_object(
      'entityType', entity_type,
      'entityId',   NEW.id,
      'familyId',   NEW.family_id,
      'actorId',    auth.uid(),
      'name',       NEW.name
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;
