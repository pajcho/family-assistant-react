-- What changed, from what, by whom (plan 018, PR 2).
--
-- 20260814140000 answered "who made this" and "who touched it last". It cannot
-- answer "who changed the amount from 3.500 to 4.200", because a row only ever
-- holds its current value - and it cannot answer "who deleted it" at all, since
-- the row is gone and took its two columns with it. That is what this table is
-- for.
--
-- No UI ships with this migration on purpose. The table starts filling now so
-- that by the time the history sub-view exists there is a history to show.
--
-- Cost, measured rather than guessed (Postgres 17.6, 100k rows, indexes
-- included): ~365 bytes per row, so ~6.7 MB per family per year at 50 writes a
-- day, held flat by the 12-month retention job at the bottom.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
-- `id` is BIGINT, not UUID: nothing references an audit row and the table is
-- always read newest-first, so a monotonic key is both smaller and better
-- clustered than a random one.
--
-- `entity_type` stores the TABLE NAME, not a singular alias. It is the same key
-- broadcast_family_change already puts on the wire, so there is one vocabulary
-- for "which table changed" instead of two that can drift apart.

CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id    UUID        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL,
  entity_id    UUID        NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor_id     UUID        REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- Copied from the subject at write time, never derived at read time. See 2.
  visibility   TEXT        NOT NULL DEFAULT 'family'
                 CHECK (visibility IN ('family', 'owner')),
  owner_id     UUID,
  -- The subject's name AS IT WAS. The only reason a deleted row stays readable.
  label        TEXT,
  -- {"column": [old, new]} for an update; NULL for a create or a delete.
  changes      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_log IS
  'Per-field change history for user-editable entities. Written only by log_audit_change(); never by a client.';
COMMENT ON COLUMN audit_log.entity_type IS
  'The subject table name, matching what broadcast_family_change() sends.';
COMMENT ON COLUMN audit_log.visibility IS
  'family = anyone in the family may read this entry; owner = only owner_id may. Frozen at write time.';
COMMENT ON COLUMN audit_log.label IS
  'The subject name at the time of the change, so a deleted entity is still nameable.';

-- Reading one entity's history, newest first - the only query the sub-view runs.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log (entity_type, entity_id, created_at DESC);
-- Reading a whole family's recent activity, for the per-module view and for the
-- retention delete below.
CREATE INDEX IF NOT EXISTS idx_audit_log_family
  ON audit_log (family_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. RLS: personal lists must not leak through their history
-- ---------------------------------------------------------------------------
-- `lists.scope = 'personal'` is invisible to the rest of the family, and a task
-- inside such a list inherits that. A policy of "same family" here would hand
-- everyone the names and edits of every private list in the household.
--
-- The visibility therefore has to be COPIED ONTO the audit row when it is
-- written. It cannot be resolved at read time by joining back to the subject,
-- because for a delete the subject no longer exists - and that is precisely the
-- entry that matters most.
--
-- The owner arm compares against `audit_actor_id()` rather than `auth.uid()` so
-- it reads the same way the writer does; for an adult the two are identical.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own family audit log" ON audit_log;
CREATE POLICY "Users view own family audit log" ON audit_log FOR SELECT USING (
  (visibility = 'family' AND family_id = auth_user_family_id())
  OR (visibility = 'owner' AND owner_id IS NOT NULL AND owner_id = public.audit_actor_id())
);

-- No INSERT, UPDATE or DELETE policy, deliberately. The table is written only
-- by the SECURITY DEFINER trigger below and pruned only by the cron job; a
-- client that could write here could forge or erase history, which is the one
-- thing a history must not allow.
--
-- Note what this also means: a kid session reads nothing. A child has no
-- `profiles` row, so `auth_user_family_id()` is NULL and the family arm closes,
-- and they own no personal list so the owner arm closes too. That is the safe
-- default, but it IS a decision - showing children "mama je dodala ovo" would
-- need a third arm written on purpose.

-- ---------------------------------------------------------------------------
-- 3. Which columns are worth remembering
-- ---------------------------------------------------------------------------
-- Deliberately short lists. Auditing every column would bury "iznos 3.500 ->
-- 4.200" under `updated_at`, `sort_order` and a dozen derived values nobody
-- edits, and would triple the row size for the privilege.
--
-- Kept out on purpose:
--   * derived money columns (`original_amount`, `exchange_rate`) - they follow
--     `amount` and `currency`, so they would double every price change
--   * `paid_date`, `due_anchor_day`, `scope` - all written BY the app in
--     response to something else that is already logged
--   * `tasks.is_completed` - ticking is the highest-frequency write in the app,
--     `completed_by_person_id` already names who did it, and repeats have their
--     own screen in TaskHistoryPanel. Logging it would roughly triple the table
--     to re-answer a question that is already answered twice.

CREATE OR REPLACE FUNCTION public.audit_columns(subject TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE subject
    WHEN 'payments' THEN ARRAY[
      'name', 'description', 'amount', 'currency', 'due_date', 'category_id',
      'is_paid', 'is_paused', 'is_recurring', 'recurrence_period',
      'recurrence_interval', 'remind_days_before']
    WHEN 'events' THEN ARRAY[
      'name', 'description', 'notes', 'date', 'end_date', 'start_time',
      'end_time', 'canceled_at', 'cancel_reason', 'remind_minutes_before']
    WHEN 'expenses' THEN ARRAY[
      'amount', 'currency', 'spent_on', 'category_id', 'person_id', 'note',
      'merchant']
    WHEN 'activities' THEN ARRAY[
      'name', 'description', 'notes', 'active_from', 'active_to', 'is_paused',
      'remind_minutes_before']
    WHEN 'birthdays' THEN ARRAY['name', 'description', 'birth_date']
    WHEN 'incomes' THEN ARRAY[
      'name', 'amount', 'person_id', 'day_of_month', 'is_recurring', 'active']
    WHEN 'income_entries' THEN ARRAY[
      'name', 'amount', 'month', 'received_on', 'person_id', 'note',
      'is_one_time']
    WHEN 'tasks' THEN ARRAY[
      'name', 'description', 'due_date', 'due_time', 'list_id',
      'recurrence_period', 'recurrence_interval', 'recurrence_until',
      'completion_mode', 'remind_minutes_before', 'remind_days_before']
    WHEN 'lists' THEN ARRAY[
      'name', 'description', 'scope', 'smart_sort_enabled',
      'auto_delete_completed_after_hours']
    WHEN 'expense_categories' THEN ARRAY['name', 'color', 'icon', 'monthly_limit']
    ELSE ARRAY[]::TEXT[]
  END
$$;

COMMENT ON FUNCTION public.audit_columns(TEXT) IS
  'The columns audit_log records per table. A table missing here logs nothing.';

-- ---------------------------------------------------------------------------
-- 4. The trigger
-- ---------------------------------------------------------------------------
-- Everything is read out of `to_jsonb(row)` rather than off the record
-- directly, which is what lets ONE function serve ten tables with different
-- shapes: `rec ->> 'scope'` is NULL on a table without that column instead of
-- raising `record "new" has no field "scope"`. That failure mode is exactly the
-- one 20260811000000_tasks.sql documents - a shared trigger function that
-- creates happily and then breaks the first UPDATE of the other table.
--
-- SECURITY DEFINER to write past the missing INSERT policy in 2.

CREATE OR REPLACE FUNCTION public.log_audit_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor    UUID;
  old_json JSONB;
  new_json JSONB;
  subject  JSONB;
  diff     JSONB := '{}'::JSONB;
  col      TEXT;
  fam      UUID;
  act      TEXT;
BEGIN
  -- Rule 1: no acting user, no entry. pg_cron re-anchoring a recurring payment,
  -- the Google sync writing calendar rows and every edge function on the
  -- service role land here with a NULL uid, and "Sistem je promenio nesto" is
  -- not history anybody asked for.
  actor := public.audit_actor_id();
  IF actor IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    act := 'delete';
  ELSIF TG_OP = 'INSERT' THEN
    new_json := to_jsonb(NEW);
    act := 'create';
  ELSE
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
    act := 'update';
  END IF;

  subject := COALESCE(new_json, old_json);
  fam := NULLIF(subject ->> 'family_id', '')::UUID;
  IF fam IS NULL THEN
    RETURN NULL;
  END IF;

  -- Rule 2: an UPDATE that changed nothing anyone would want to read is not an
  -- entry. This is mandatory, not an optimization:
  -- bump_parent_list_on_item_change() UPDATEs the parent list's `updated_at` on
  -- EVERY task change, so without this every shopping-list tick would append a
  -- contentless row against the list.
  IF act = 'update' THEN
    FOREACH col IN ARRAY public.audit_columns(TG_TABLE_NAME) LOOP
      IF (old_json -> col) IS DISTINCT FROM (new_json -> col) THEN
        diff := diff || jsonb_build_object(
          col, jsonb_build_array(old_json -> col, new_json -> col));
      END IF;
    END LOOP;
    IF diff = '{}'::JSONB THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO audit_log (
    family_id, entity_type, entity_id, action, actor_id,
    visibility, owner_id, label, changes
  )
  VALUES (
    fam,
    TG_TABLE_NAME,
    (subject ->> 'id')::UUID,
    act,
    actor,
    -- Only `lists` and `tasks` have a scope at all; everything else is the
    -- family's by construction and takes the DEFAULT.
    CASE WHEN subject ->> 'scope' = 'personal' THEN 'owner' ELSE 'family' END,
    -- Whose privacy this is. `owner_id` is the anchor the tasks/lists policies
    -- use; falling back to the creator keeps a personal row from becoming
    -- readable by the whole family when the anchor is somehow missing, since
    -- the owner arm then simply matches nobody.
    COALESCE(
      NULLIF(subject ->> 'owner_id', '')::UUID,
      NULLIF(subject ->> 'created_by_id', '')::UUID),
    -- `expenses` has no name; its merchant or note is what a person would call
    -- it, and a row with neither is nameable only by its amount elsewhere.
    COALESCE(subject ->> 'name', subject ->> 'merchant', subject ->> 'note'),
    CASE WHEN act = 'update' THEN diff ELSE NULL END
  );

  RETURN NULL;  -- AFTER trigger; return value ignored
EXCEPTION
  WHEN OTHERS THEN
    -- Bookkeeping must never be able to fail the thing it is bookkeeping. A
    -- broken audit write costs one missing history line; letting it propagate
    -- would cost the user their edit. This mirrors what
    -- broadcast_family_change() gets for free, since realtime.send() already
    -- downgrades its own errors to a WARNING.
    RAISE WARNING 'audit_log write failed for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.log_audit_change() IS
  'AFTER trigger: records a create/update/delete in audit_log. Skips service-role writes and no-op updates.';

-- ---------------------------------------------------------------------------
-- 5. Attach
-- ---------------------------------------------------------------------------
-- Keep this list in sync with audit_columns() above: a table with a trigger but
-- no column list writes a create and a delete and never an update, which reads
-- as "nobody ever edited this" rather than as a missing configuration.
--
-- Two tables are missing from it on purpose:
--   external_calendar_events - rewritten wholesale on every sync poll. It would
--     out-produce every other table combined, and it has no human author anyway
--     (rule 1 above would drop the rows, so the trigger would be pure cost).
--   task_occurrences - what happened to a repeat already has a screen of its
--     own in TaskHistoryPanel, and two answers to one question is worse than
--     one.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'activities',
    'birthdays',
    'events',
    'expense_categories',
    'expenses',
    'income_entries',
    'incomes',
    'lists',
    'payments',
    'tasks'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format($sql$
      DROP TRIGGER IF EXISTS log_audit_change ON public.%1$I;
      CREATE TRIGGER log_audit_change
        AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.log_audit_change();
    $sql$, t);
  END LOOP;
END $$;

-- No broadcast trigger on audit_log, and that is not an oversight. Every write
-- already sends one message for its own table; adding a second for the audit
-- row would double realtime traffic to refresh a panel that is almost never
-- open. The client invalidates the history query off the SUBJECT's message
-- instead (see TABLE_INVALIDATIONS in src/hooks/useFamilyChannel.ts).

-- ---------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------
-- 12 months: long enough to answer "what did we pay for this last August",
-- short enough that the table stops growing instead of accumulating forever.
--
-- Guarded unschedule-then-schedule, the shape
-- 20260518100000_schedule_send_due_pushes.sql established - cron.unschedule
-- raises when the job is missing, so it is looked up first and the migration
-- stays re-runnable.

DO $$
DECLARE
  existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO existing_jobid FROM cron.job WHERE jobname = 'purge-audit-log';
  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;
END $$;

-- 03:43 UTC: clear of every plausible morning-digest minute, and clear of
-- purge-notification-log at 03:17, so the two deletes never overlap.
SELECT cron.schedule(
  'purge-audit-log',
  '43 3 * * *',
  $cron$
    DELETE FROM public.audit_log
    WHERE created_at < NOW() - INTERVAL '12 months';
  $cron$
);
