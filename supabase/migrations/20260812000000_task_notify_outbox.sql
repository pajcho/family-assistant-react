-- "Somebody added tasks" pushes: queue them, then send one summary per person.
--
-- Two problems, one mechanism.
--
-- 1. SPAM. The trigger this replaces posted to `notify-on-create` per row, so
--    adding ten dated tasks in a row buzzed everybody's phone ten times, each
--    with its own notification tag. Somebody planning a week should cost one
--    notification, not one per line typed.
--
-- 2. WHO IT IS FOR. A task's assignees live in `task_assignees`, which the app
--    writes in a SECOND request after the task row lands. An AFTER INSERT
--    trigger therefore runs while every task still looks unassigned - so
--    "notify only the people it was assigned to" was not implementable at all
--    at trigger time. It is implementable a couple of minutes later.
--
-- So the trigger stops sending and starts QUEUING, and a per-minute cron flushes
-- rows that have sat for the grouping window (2 minutes, enforced in the edge
-- function). By then the assignees are in place, several tasks from one sitting
-- have accumulated, and each recipient gets a single push covering the lot.
--
-- The window is why this is not simply a rate limit: a plain "at most one push
-- per two minutes" drops tasks 2..N on the floor and nothing ever mentions them.
-- Queuing keeps them, and the flush counts them.
--
-- Reminders are NOT affected. A task's due-date push is `send-due-pushes`, a
-- separate path on its own schedule; this only governs the "just added" one.

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- Only 'task' today. The column is here because the same queue is the answer
  -- for any other kind that turns out to arrive in bursts.
  entity_type TEXT NOT NULL,
  -- No FK: a task deleted inside the window should not take its queue row with
  -- it silently. The flush reads the row and skips what is gone, which is the
  -- behaviour we want - nobody is told about a task that no longer exists.
  entity_id UUID NOT NULL,
  /* auth uid of whoever inserted it; NULL for a service-role insert. */
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /* Set by the flush. NULL = still waiting. */
  processed_at TIMESTAMPTZ
);

-- The flush's only query shape: the pending rows, oldest first. Partial, so the
-- index stays the size of the backlog rather than of all history.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON notification_outbox (created_at)
  WHERE processed_at IS NULL;

-- Service role only. Nothing in the client ever reads this, and a queue row
-- names an entity the reader may not be allowed to see, so there are no
-- policies at all: RLS on with none granted is a closed door.
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The trigger: enqueue instead of send
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_entity_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notification_outbox (family_id, entity_type, entity_id, actor_id)
  VALUES (NEW.family_id, TG_ARGV[0], NEW.id, auth.uid());
  RETURN NEW;
END;
$$;

-- Same WHEN as before (20260811020000_notify_task_create.sql): a personal task
-- must never announce itself to the family, and an undated one is a shopping
-- line or a parked thought that nobody needs waking for. Both conditions stay
-- in WHEN so a row that fails them does not even reach the queue.
DROP TRIGGER IF EXISTS notify_on_task_create ON tasks;

CREATE TRIGGER notify_on_task_create
  AFTER INSERT ON tasks
  FOR EACH ROW
  WHEN (NEW.scope = 'family' AND NEW.due_date IS NOT NULL)
  EXECUTE FUNCTION enqueue_entity_notification('task');

-- ---------------------------------------------------------------------------
-- The flush: one call a minute, the edge function decides if anything is ripe
-- ---------------------------------------------------------------------------
-- URL and secret come from the vault exactly as `notify_family_on_entity_create`
-- reads them (see 20260802095749_notify_on_create_vault_url.sql for why the GUC
-- route does not work on hosted Supabase). Local dev needs no setup - with no
-- vault rows it falls through to the kong endpoint and an empty secret, which
-- the function rejects, so a developer machine simply never flushes.
CREATE OR REPLACE FUNCTION flush_notification_outbox()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  fn_url TEXT;
  secret TEXT;
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

  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';

  PERFORM net.http_post(
    url := fn_url || '/notify-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', COALESCE(secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
END;
$$;

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'flush-notification-outbox-every-minute';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'flush-notification-outbox-every-minute',
  '* * * * *',
  $cron$ SELECT flush_notification_outbox(); $cron$
);
