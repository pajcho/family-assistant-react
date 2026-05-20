-- Instant family notifications on entity creation.
--
-- When anyone in the family adds a list, event, payment, or birthday,
-- every *other* family member who's opted in gets an immediate push.
-- This complements the existing scheduled digests + per-item reminders
-- in send-due-pushes — those answer "what's coming up?" while this
-- answers "what did my partner just add?".
--
-- Architecture
-- ------------
-- AFTER INSERT trigger on each of the four tables → `pg_net.http_post`
-- to a new `notify-on-create` Edge Function. The function reads each
-- recipient's per-kind opt-in (new columns below) and fans out via
-- web-push. Fire-and-forget on the trigger side; the Edge Function
-- inserts into `notification_log` (kind = `<entity>_create`,
-- ref_id = entity uuid) for idempotency if the call is retried.
--
-- pg_net + the vault-stored CRON_SECRET were already set up by the
-- earlier `schedule_send_due_pushes` migration; we just reuse them
-- here. The same secret is checked by the new function's auth.

-- ---------------------------------------------------------------------------
-- Per-user opt-ins
-- ---------------------------------------------------------------------------
-- Default true so the feature works out of the box for everyone who
-- already enabled notifications. Users opt OUT per kind via the
-- "Obaveštenja porodice" card on the settings page.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_on_list_create     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_event_create    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_payment_create  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_birthday_create BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------
-- Parameterised on entity type via TG_ARGV so all four tables share one
-- function. `auth.uid()` is the actor — captured here while the
-- request's role context is still active. NULL when the row was
-- inserted from a service-role connection (seed scripts etc.); the
-- Edge Function treats null as "no actor" and notifies everyone in
-- the family.
--
-- pg_net.http_post is async — it returns a request id, the body is
-- never seen. We rely on the Edge Function to do its own logging.

CREATE OR REPLACE FUNCTION notify_family_on_entity_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  entity_type   TEXT := TG_ARGV[0];
  fn_url        TEXT := current_setting('supabase.functions_url', true);
  secret        TEXT;
BEGIN
  -- `supabase.functions_url` is set on hosted Supabase to the project's
  -- functions base URL. On local dev it might be NULL — fall back to
  -- the standard local endpoint so the trigger doesn't blow up.
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

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS notify_on_list_create     ON lists;
DROP TRIGGER IF EXISTS notify_on_event_create    ON events;
DROP TRIGGER IF EXISTS notify_on_payment_create  ON payments;
DROP TRIGGER IF EXISTS notify_on_birthday_create ON birthdays;

CREATE TRIGGER notify_on_list_create
  AFTER INSERT ON lists
  FOR EACH ROW EXECUTE FUNCTION notify_family_on_entity_create('list');

CREATE TRIGGER notify_on_event_create
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION notify_family_on_entity_create('event');

CREATE TRIGGER notify_on_payment_create
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION notify_family_on_entity_create('payment');

CREATE TRIGGER notify_on_birthday_create
  AFTER INSERT ON birthdays
  FOR EACH ROW EXECUTE FUNCTION notify_family_on_entity_create('birthday');
