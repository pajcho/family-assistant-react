-- Auto-delete completed items after a per-list retention window.
--
-- Motivation: shopping lists are long-lived (the user doesn't want to
-- recreate "Kupovina" each week), so without housekeeping the completed
-- pile grows unbounded. The opt-in retention window lets each list
-- declare "throw out my checked items after N hours" and a cron job
-- handles the actual deletion server-side, so it works even when no
-- client is open.
--
-- Schema
--   • lists.auto_delete_completed_after_hours INTEGER
--       NULL  → never auto-delete (default, matches today's behaviour)
--       N > 0 → delete is_completed items whose completed_at is older
--               than N hours
--
-- We keep the unit as hours (not days) so we can offer "1 sat" and
-- "6 sati" alongside "1 dan" / "1 nedelja" in the UI without schema
-- changes; days simply use 24/72/168.

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS auto_delete_completed_after_hours INTEGER
  CHECK (auto_delete_completed_after_hours IS NULL OR auto_delete_completed_after_hours > 0);

-- Index the column so the purge query can skip lists that opted out
-- without scanning every row. Tiny table today, but lists with retention
-- enabled will be a minority — partial index keeps the storage cost flat.
CREATE INDEX IF NOT EXISTS idx_lists_auto_delete_enabled
  ON lists(id)
  WHERE auto_delete_completed_after_hours IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Purge function
-- ---------------------------------------------------------------------------
-- Runs as SECURITY DEFINER so the cron-fired call (executes as `postgres`)
-- can DELETE rows that the calling user normally couldn't reach through
-- RLS. The function intentionally takes no arguments — the per-list
-- retention is read from the row itself.
--
-- The JOIN-to-lists pattern avoids a per-row subquery; Postgres rewrites
-- this into a hash-anti-join over the partial index above.

CREATE OR REPLACE FUNCTION purge_expired_completed_list_items()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purged_count INTEGER;
BEGIN
  WITH del AS (
    DELETE FROM list_items li
    USING lists l
    WHERE li.list_id = l.id
      AND l.auto_delete_completed_after_hours IS NOT NULL
      AND li.is_completed = true
      AND li.completed_at IS NOT NULL
      AND li.completed_at < NOW() - (l.auto_delete_completed_after_hours || ' hours')::INTERVAL
    RETURNING li.id
  )
  SELECT COUNT(*) INTO purged_count FROM del;
  RETURN purged_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_completed_list_items() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Cron schedule
-- ---------------------------------------------------------------------------
-- Run every 10 minutes. Cheaper than every minute (the purge query is
-- O(expired-rows) and most checks find nothing) and still tight enough
-- that "1 hour" retention feels accurate within a quarter of an hour.
--
-- pg_cron is already installed by the earlier `schedule_send_due_pushes`
-- migration; re-running CREATE EXTENSION here would trip a "dependent
-- privileges exist" error on existing databases. We rely on the previous
-- migration as a prerequisite.

DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'purge-expired-completed-list-items';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'purge-expired-completed-list-items',
  '*/10 * * * *',
  $cron$SELECT purge_expired_completed_list_items()$cron$
);
