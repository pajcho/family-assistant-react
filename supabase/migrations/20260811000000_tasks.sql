-- list_items becomes tasks: one completable entity for the whole app.
--
-- `list_items` was already the only completable row in the schema and it was
-- missing exactly one thing: a date. So this is a RENAME, not a new table -
-- same rows, same ids, same foreign keys, same optimistic-update code on the
-- client. Everything the rename adds is OPTIONAL, and what each new dimension
-- means when it is filled in:
--
--   list_id           in a list, inherits the list's visibility | standalone
--   due_date          shows in Danas, Kalendar and the digests  | someday
--   due_time          sorts into the day timeline at that minute| all-day
--   task_assignees    person filter, badges, kid visibility     | nobody's
--   recurrence_*      projected and ticked per occurrence       | one-off
--   remind_*_before   pushes before it is due                   | silent
--
-- A shopping item is therefore `list_id` only (byte for byte what it is today),
-- a reminder is a `due_date`, and a chore is a `due_date` plus a recurrence plus
-- an assignee.
--
-- Two structural rules are worth reading before touching anything here.
--
-- 1. THE VISIBILITY ANCHOR. RLS on `tasks` is a two-arm predicate rather than a
--    denormalized scope: a row with a `list_id` keeps exactly today's
--    visibility (piggy-backed on the parent list), and a listless row keys off
--    its own `scope` + `owner_id`. `tasks_visibility_anchor` makes sure neither
--    arm can ever meet a row with nothing to key on.
--
-- 2. COMPLETION HAS TWO HOMES. A non-recurring task is finished when
--    `is_completed` is true - the path the shipped lists UI already writes. A
--    recurring task is finished PER OCCURRENCE, in `task_occurrences`, because
--    "took the bins out" is a different fact every Tuesday.
--    `tasks_recurring_not_completed` is the structural half of that split: a
--    repeating task may never carry `is_completed = true` itself, so there is
--    no second, contradictory source of truth. On the client, only
--    `utils/task.ts::isTaskDoneOn` is allowed to know this.
--
-- Timestamps of the three migrations in this feature sort after
-- 20260810000000_english_db_comments.sql: tasks (this), kid_tasks,
-- notify_task_create.

-- ---------------------------------------------------------------------------
-- 1. The rename
-- ---------------------------------------------------------------------------
-- Postgres carries indexes, triggers, policies and constraints across a table
-- rename under their OLD names. They are renamed explicitly below purely so
-- that nobody reading `\d tasks` in a year has to know this table used to be
-- called something else.

ALTER TABLE list_items RENAME TO tasks;

ALTER TABLE tasks RENAME CONSTRAINT list_items_pkey TO tasks_pkey;
ALTER TABLE tasks RENAME CONSTRAINT list_items_list_id_fkey TO tasks_list_id_fkey;
ALTER TABLE tasks RENAME CONSTRAINT list_items_family_id_fkey TO tasks_family_id_fkey;
ALTER TABLE tasks RENAME CONSTRAINT list_items_created_by_id_fkey TO tasks_created_by_id_fkey;
ALTER TABLE tasks RENAME CONSTRAINT list_items_updated_by_id_fkey TO tasks_updated_by_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. list_id becomes optional
-- ---------------------------------------------------------------------------
-- A task with no list is not an orphan, it is the Inbox: "call the dentist"
-- belongs to a day, not to a shelf.

ALTER TABLE tasks ALTER COLUMN list_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. New columns
-- ---------------------------------------------------------------------------

ALTER TABLE tasks
  -- The creator, and the access guard for a listless personal task. Same
  -- meaning as `lists.owner_id`; for a task inside a list the RLS arm ignores
  -- it, it is just "who added this".
  ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'family'
    CHECK (scope IN ('personal', 'family')),
  ADD COLUMN due_date DATE,
  ADD COLUMN due_time TIME,
  ADD COLUMN recurrence_period TEXT
    CHECK (recurrence_period IN ('one-time', 'daily', 'weekly', 'monthly')),
  ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 52),
  -- Weekly only. 0 = Monday .. 6 = Sunday, the same convention as
  -- activity_schedule.day_of_week. NEVER store a raw JS getDay().
  ADD COLUMN recurrence_weekdays SMALLINT[],
  ADD COLUMN recurrence_until DATE,
  ADD COLUMN completion_mode TEXT NOT NULL DEFAULT 'shared'
    CHECK (completion_mode IN ('shared', 'per_assignee')),
  -- profiles, never auth.users: a child or any member without a login has a
  -- profile row but no auth user, and they are exactly who ticks a chore off.
  -- ON UPDATE CASCADE because promoting such a member to a real account
  -- re-points profiles.id (see 20260808010000_person_fk_on_update_cascade.sql).
  ADD COLUMN completed_by_person_id UUID
    REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN remind_minutes_before INTEGER,
  ADD COLUMN remind_days_before INTEGER;

-- Existing rows all live in a list, and `scope` defaulted to 'family' for every
-- one of them - including the items of a personal list. The two-arm RLS
-- predicate never reads `scope` for a row that has a `list_id`, so nothing was
-- ever exposed by that, but the create-push trigger and the digest do read it,
-- so the invariant "a task's scope equals its list's scope" is backfilled here
-- rather than left to drift.
UPDATE tasks t
  SET scope = l.scope
  FROM lists l
  WHERE t.list_id = l.id
    AND t.scope <> l.scope;

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints
-- ---------------------------------------------------------------------------

-- A listless task carries its own visibility anchor; a task in a list inherits
-- the list's. Enforced so neither arm of the RLS policy can see a row with
-- nothing to key on.
ALTER TABLE tasks ADD CONSTRAINT tasks_visibility_anchor
  CHECK (list_id IS NOT NULL OR owner_id IS NOT NULL);

-- A repeating task is resolved per occurrence in task_occurrences, so its own
-- is_completed must stay false. The structural half of "completion has two
-- homes" from the header.
ALTER TABLE tasks ADD CONSTRAINT tasks_recurring_not_completed
  CHECK (
    recurrence_period IS NULL
    OR recurrence_period = 'one-time'
    OR is_completed = false
  );

-- A time without a date is meaningless.
ALTER TABLE tasks ADD CONSTRAINT tasks_time_needs_date
  CHECK (due_time IS NULL OR due_date IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------

ALTER INDEX idx_list_items_list_id RENAME TO idx_tasks_list_id;
ALTER INDEX idx_list_items_family_id RENAME TO idx_tasks_family_id;
ALTER INDEX idx_list_items_list_sort RENAME TO idx_tasks_list_sort;

-- The agenda's own access path: every dated task of one family, by day.
CREATE INDEX IF NOT EXISTS idx_tasks_family_due ON tasks(family_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);

-- ---------------------------------------------------------------------------
-- 6. Trigger functions
-- ---------------------------------------------------------------------------

-- BEFORE INSERT on tasks. Renaming the function rather than creating a new one
-- keeps the existing trigger pointing at it (a trigger holds the function's
-- oid, not its name), so the trigger is only renamed for readability.
ALTER FUNCTION set_list_item_defaults() RENAME TO set_task_defaults;
ALTER TRIGGER set_list_item_defaults_trigger ON tasks
  RENAME TO set_task_defaults_trigger;

-- The client still only has to send `list_id` + `name` for a list item, or
-- `name` + `due_date` for a standalone reminder; everything else falls out of
-- the request context.
--
-- The one FORCED value is `scope` for a task inside a list. It is not a default
-- but an overwrite, because a family list must never be able to hold a personal
-- task: the RLS arm for a listed row does not look at `scope` at all, so a
-- 'personal' value planted there would be invisible to RLS while still muting
-- the create-push and hiding the row from the family digest.
CREATE OR REPLACE FUNCTION set_task_defaults()
RETURNS TRIGGER AS $$
DECLARE
  parent_family UUID;
  parent_scope TEXT;
BEGIN
  IF NEW.list_id IS NOT NULL THEN
    SELECT l.family_id, l.scope INTO parent_family, parent_scope
    FROM lists l WHERE l.id = NEW.list_id;
    -- Only overwrite when the parent really exists; otherwise leave the row
    -- alone so the failure surfaces as the foreign-key error it is, not as a
    -- confusing "family_id must not be null".
    IF parent_family IS NOT NULL THEN
      NEW.family_id = parent_family;
      NEW.scope = parent_scope;
    END IF;
  ELSIF NEW.family_id IS NULL THEN
    NEW.family_id = auth_user_family_id();
  END IF;
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id = auth.uid();
  END IF;
  IF NEW.created_by_id IS NULL THEN
    NEW.created_by_id = auth.uid();
  END IF;
  IF NEW.updated_by_id IS NULL THEN
    NEW.updated_by_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE UPDATE on tasks. `update_list_audit_fields()` cannot simply be
-- extended, because `lists` shares it and `NEW.list_id` does not exist there:
-- the trigger would be created happily and then fail the first UPDATE of a list
-- with `record "new" has no field "list_id"`. The same trap as
-- broadcast_families_change in 20260809130000_broadcast_missing_tables.sql, so
-- tasks get their own function and `lists` keeps the shared one untouched.
--
-- Moving a task into, out of or between lists re-derives the visibility anchor,
-- which is the mirror image of what set_task_defaults() does on INSERT. Filling
-- `owner_id` on the way out matters: without it, dragging a task to the Inbox
-- with a bare `list_id = NULL` would trip tasks_visibility_anchor.
CREATE OR REPLACE FUNCTION update_task_audit_fields()
RETURNS TRIGGER AS $$
DECLARE
  parent_scope TEXT;
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by_id = COALESCE(auth.uid(), OLD.updated_by_id, NEW.updated_by_id);

  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    IF NEW.list_id IS NOT NULL THEN
      SELECT l.scope INTO parent_scope FROM lists l WHERE l.id = NEW.list_id;
      IF parent_scope IS NOT NULL THEN
        NEW.scope = parent_scope;
      END IF;
    ELSIF NEW.owner_id IS NULL THEN
      NEW.owner_id = COALESCE(auth.uid(), OLD.created_by_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_list_items_audit ON tasks;
CREATE TRIGGER update_tasks_audit
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_task_audit_fields();

-- AFTER UPDATE OF scope ON lists: making a family list personal (or the other
-- way round) has to travel to the tasks inside it, or set_task_defaults()'s
-- invariant would hold only for rows inserted after the change.
--
-- This does not recurse, twice over. The UPDATE below fires
-- bump_parent_list_on_item_change, which updates the same list's updated_at and
-- updated_by_id - but that statement does not name `scope`, so `AFTER UPDATE OF
-- scope` does not match it, and the WHEN clause would reject it anyway.
CREATE OR REPLACE FUNCTION cascade_list_scope_to_tasks()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tasks
    SET scope = NEW.scope
    WHERE list_id = NEW.id
      AND scope IS DISTINCT FROM NEW.scope;
  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_list_scope_to_tasks ON lists;
CREATE TRIGGER cascade_list_scope_to_tasks
  AFTER UPDATE OF scope ON lists
  FOR EACH ROW
  WHEN (NEW.scope IS DISTINCT FROM OLD.scope)
  EXECUTE FUNCTION cascade_list_scope_to_tasks();

-- AFTER INSERT/UPDATE/DELETE on tasks: bubble the change up so "sort lists by
-- recently used" promotes a list when somebody adds an item to it. Now that a
-- task may have no list at all, both ends have to be guarded - and an UPDATE
-- that MOVES a task touches two lists, so both get bumped.
CREATE OR REPLACE FUNCTION bump_parent_list_on_item_change()
RETURNS TRIGGER AS $$
DECLARE
  old_list_id UUID;
  new_list_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_list_id := OLD.list_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_list_id := NEW.list_id;
  END IF;

  -- A listless task has no parent to promote.
  IF old_list_id IS NULL AND new_list_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE lists
    SET updated_at = NOW(),
        updated_by_id = COALESCE(auth.uid(), updated_by_id)
    WHERE (old_list_id IS NOT NULL AND id = old_list_id)
       OR (new_list_id IS NOT NULL AND id = new_list_id);
  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

-- BEFORE INSERT on both child tables: family_id is denormalized there for the
-- same reason it is on tasks (the realtime message and the RLS predicate should
-- not need a join), so it is filled from the parent task and the client never
-- sends it. RLS applies to the SELECT below - this is a SECURITY INVOKER
-- function - which is fine: the insert is only allowed for a task the caller
-- can see anyway.
CREATE OR REPLACE FUNCTION set_family_id_from_task()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.family_id IS NULL THEN
    SELECT family_id INTO NEW.family_id FROM tasks WHERE id = NEW.task_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 7. task_assignees - who a task belongs to
-- ---------------------------------------------------------------------------
-- The same join-table shape as event_participants / payment_participants: a
-- composite primary key, a denormalized family_id, and ON UPDATE CASCADE on the
-- person so promoting a member to a real login does not fail on this FK.
--
-- No rows here means "family-wide, nobody's in particular" - not "unassigned
-- and therefore invisible". Assignees drive the person filter, the member
-- badges and, above all, what a child can see (see the kid migration).

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id UUID NOT NULL
    REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (task_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_person ON task_assignees(person_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_family ON task_assignees(family_id);

DROP TRIGGER IF EXISTS set_task_assignee_family_id ON task_assignees;
CREATE TRIGGER set_task_assignee_family_id
  BEFORE INSERT ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION set_family_id_from_task();

-- ---------------------------------------------------------------------------
-- 8. task_occurrences - the sparse per-occurrence override table
-- ---------------------------------------------------------------------------
-- Modelled on payment_overrides and activity_overrides: NO row is the normal
-- state, one row is an exception to the series. Unlike those two it is not only
-- a display layer - for a recurring task it IS the completion record, because
-- `tasks.is_completed` is structurally forbidden from carrying it (see the
-- header).
--
--   'done'    - this occurrence is finished. `completed_by_person_id` says who.
--   'skipped' - not needed this time; dropped from the agenda, restorable.
--   'moved'   - shows on `moved_to_date` instead of `occurrence_date`.
--
-- Keyed by the ORIGINAL projected date of the occurrence, the same convention
-- as payment_overrides, so a moved occurrence can still be found by the date
-- the series says it belongs to.
--
-- `person_id` is what makes completion_mode 'per_assignee' work: NULL is the
-- occurrence as a whole, a value is one assignee's own copy of it. Which is why
-- the unique key is NULLS NOT DISTINCT (Postgres 15+): without it, two "the
-- whole occurrence is done" rows for the same date would both be accepted,
-- since a plain UNIQUE treats NULLs as distinct.

CREATE TABLE IF NOT EXISTS task_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  person_id UUID REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('done', 'skipped', 'moved')),
  moved_to_date DATE,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by_person_id UUID
    REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT task_occurrences_moved_needs_date
    CHECK (status <> 'moved' OR moved_to_date IS NOT NULL),
  CONSTRAINT task_occurrences_unique_slot
    UNIQUE NULLS NOT DISTINCT (task_id, occurrence_date, person_id)
);

CREATE INDEX IF NOT EXISTS idx_task_occurrences_task ON task_occurrences(task_id);
CREATE INDEX IF NOT EXISTS idx_task_occurrences_family_date
  ON task_occurrences(family_id, occurrence_date);

DROP TRIGGER IF EXISTS set_task_occurrence_family_id ON task_occurrences;
CREATE TRIGGER set_task_occurrence_family_id
  BEFORE INSERT ON task_occurrences
  FOR EACH ROW EXECUTE FUNCTION set_family_id_from_task();

DROP TRIGGER IF EXISTS update_task_occurrences_updated_at ON task_occurrences;
CREATE TRIGGER update_task_occurrences_updated_at
  BEFORE UPDATE ON task_occurrences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_occurrences ENABLE ROW LEVEL SECURITY;

-- The four policies inherited from list_items only knew about the parent list,
-- so a listless task would have been invisible to everyone including its
-- author. They are dropped by their original names - the rename carried them
-- across unchanged.
DROP POLICY IF EXISTS "Users view items in accessible lists" ON tasks;
DROP POLICY IF EXISTS "Users insert items in accessible lists" ON tasks;
DROP POLICY IF EXISTS "Users update items in accessible lists" ON tasks;
DROP POLICY IF EXISTS "Users delete items in accessible lists" ON tasks;

-- Two arms, deliberately, rather than one denormalized scope:
--
--   list_id IS NOT NULL - visibility is the parent list's, exactly as it has
--     been since 20260520200000. The EXISTS piggy-backs on the lists policies,
--     so if RLS hides the list it hides the task.
--   list_id IS NULL - the row answers for itself: a family task is the
--     family's, a personal one is its owner's.
--
-- `auth_user_family_id()` rather than a subquery on profiles because it is
-- SECURITY DEFINER: the predicate then mentions no table the caller could have
-- a policy on, which keeps this side of the graph acyclic (see the kid
-- migration for why that matters).
CREATE POLICY "Users view accessible tasks" ON tasks FOR SELECT USING (
  (list_id IS NOT NULL AND EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id))
  OR (list_id IS NULL AND (
        (scope = 'family' AND family_id = auth_user_family_id())
        OR (scope = 'personal' AND owner_id = auth.uid())
     ))
);
-- INSERT is the one command whose listless arm also demands
-- `family_id = auth_user_family_id()` for a PERSONAL task, not just
-- `owner_id = auth.uid()`. Without it a kid session qualifies: a child's
-- synthetic auth user can satisfy `owner_id = auth.uid()` on a row it is
-- inserting itself, and while such a task would be visible to nobody but that
-- child, kid mode is SELECT-only by design and its two RPCs are the only writes
-- (see 20260811010000_kid_tasks.sql). A child has no `profiles` row, so
-- `auth_user_family_id()` is NULL for them and the arm closes.
CREATE POLICY "Users insert accessible tasks" ON tasks FOR INSERT WITH CHECK (
  (list_id IS NOT NULL AND EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id))
  OR (list_id IS NULL AND family_id = auth_user_family_id() AND (
        scope = 'family'
        OR (scope = 'personal' AND owner_id = auth.uid())
     ))
);
CREATE POLICY "Users update accessible tasks" ON tasks FOR UPDATE USING (
  (list_id IS NOT NULL AND EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id))
  OR (list_id IS NULL AND (
        (scope = 'family' AND family_id = auth_user_family_id())
        OR (scope = 'personal' AND owner_id = auth.uid())
     ))
);
CREATE POLICY "Users delete accessible tasks" ON tasks FOR DELETE USING (
  (list_id IS NOT NULL AND EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id))
  OR (list_id IS NULL AND (
        (scope = 'family' AND family_id = auth_user_family_id())
        OR (scope = 'personal' AND owner_id = auth.uid())
     ))
);

-- task_assignees is family-keyed on ALL FOUR commands, the event_participants /
-- activity_participants shape, and NOT the "piggy-back on the parent through
-- EXISTS" shape that task_occurrences uses below. That is not a stylistic
-- choice, it is the only shape that works:
--
--   the kid policy on `tasks` reads task_assignees (a child sees a task only
--   when it is assigned to them), so EVERY read of `tasks` expands every SELECT
--   policy of task_assignees. If one of those read `tasks` back, Postgres
--   reports `infinite recursion detected in policy for relation "tasks"` and
--   the whole table stops answering - for parents too, because permissive
--   policies are OR-ed together and all of them get expanded. Verified against
--   a copy of this schema, 2026-08-10.
--
-- `auth_user_family_id()` keeps the predicate a true leaf: it names no table at
-- all, so nothing downstream can ever close the loop. The information a member
-- can therefore read for a task they cannot see is "some task id in my family
-- is assigned to this person", with no name, date or content attached.
CREATE POLICY "Users view own family task_assignees" ON task_assignees FOR SELECT
  USING (family_id = auth_user_family_id());
CREATE POLICY "Users insert own family task_assignees" ON task_assignees FOR INSERT
  WITH CHECK (family_id = auth_user_family_id());
CREATE POLICY "Users update own family task_assignees" ON task_assignees FOR UPDATE
  USING (family_id = auth_user_family_id());
CREATE POLICY "Users delete own family task_assignees" ON task_assignees FOR DELETE
  USING (family_id = auth_user_family_id());

-- task_occurrences DOES piggy-back on tasks, because a row here carries real
-- content - who finished a chore, a note, a new date - and a personal task's
-- occurrences have no business being family-readable. No cycle: nothing in the
-- tasks policies reads task_occurrences.
--
-- The `family_id = auth_user_family_id()` term is not redundant, it is what
-- keeps a kid session out. "You may write an occurrence for any task you can
-- SELECT" sounds like a grown-up rule, but a child CAN select the tasks assigned
-- to them, so the bare EXISTS let a child insert, move, skip and un-skip
-- occurrences straight from the table - bypassing kid_complete_task() and every
-- guard in it (verified against a copy of this schema, 2026-08-10). A child has
-- no `profiles` row, so `auth_user_family_id()` is NULL for them and all four
-- policies close. Kid reads come from the separate kid policy in
-- 20260811010000_kid_tasks.sql; kid writes come from the RPC or not at all.
CREATE POLICY "Users view occurrences of accessible tasks" ON task_occurrences FOR SELECT
  USING (
    family_id = auth_user_family_id()
    AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_occurrences.task_id)
  );
CREATE POLICY "Users insert occurrences of accessible tasks" ON task_occurrences FOR INSERT
  WITH CHECK (
    family_id = auth_user_family_id()
    AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_occurrences.task_id)
  );
CREATE POLICY "Users update occurrences of accessible tasks" ON task_occurrences FOR UPDATE
  USING (
    family_id = auth_user_family_id()
    AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_occurrences.task_id)
  );
CREATE POLICY "Users delete occurrences of accessible tasks" ON task_occurrences FOR DELETE
  USING (
    family_id = auth_user_family_id()
    AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_occurrences.task_id)
  );

-- ---------------------------------------------------------------------------
-- 10. Auto-delete of completed items
-- ---------------------------------------------------------------------------
-- Retention (20260520240000_lists_auto_delete_completed.sql) exists so a
-- long-lived shopping list does not grow an unbounded pile of ticked items. It
-- must NOT start eating the new dimensions: a dated task is a record of when
-- something was due, and an occurrence row is history. So the predicate keeps
-- its per-list retention and gains two guards - no due_date, and no occurrence
-- row anywhere.
--
-- The function is renamed with the table (and the cron job with it) rather than
-- left describing a table that no longer exists.

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

DROP FUNCTION IF EXISTS purge_expired_completed_list_items();

CREATE OR REPLACE FUNCTION purge_expired_completed_tasks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  purged_count INTEGER;
BEGIN
  WITH del AS (
    DELETE FROM tasks t
    USING lists l
    WHERE t.list_id = l.id
      AND l.auto_delete_completed_after_hours IS NOT NULL
      AND t.is_completed = true
      AND t.completed_at IS NOT NULL
      AND t.completed_at < NOW() - (l.auto_delete_completed_after_hours || ' hours')::INTERVAL
      AND t.due_date IS NULL
      AND NOT EXISTS (SELECT 1 FROM task_occurrences o WHERE o.task_id = t.id)
    RETURNING t.id
  )
  SELECT COUNT(*) INTO purged_count FROM del;
  RETURN purged_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_completed_tasks() FROM PUBLIC;

SELECT cron.schedule(
  'purge-expired-completed-tasks',
  '*/10 * * * *',
  $cron$SELECT purge_expired_completed_tasks()$cron$
);

-- ---------------------------------------------------------------------------
-- 11. Family broadcast channel
-- ---------------------------------------------------------------------------
-- `tasks` already carries the trigger, inherited from list_items through the
-- rename; it is re-created here so all three tables are declared in one place.
-- Keep this list in step with TABLE_INVALIDATIONS in
-- src/hooks/useFamilyChannel.ts - a trigger with no mapping is a wasted
-- message, a mapping with no trigger is a screen that never refreshes. The
-- `list_items` entry there becomes `tasks` and the two new tables are added.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'task_assignees',
    'task_occurrences',
    'tasks'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE WARNING 'broadcast_family_change: table public.% not found, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS broadcast_family_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER broadcast_family_change
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change()',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 12. Realtime publication
-- ---------------------------------------------------------------------------
-- Supabase Cloud auto-adds new tables to `supabase_realtime`, but being
-- explicit keeps local CLI and self-hosted deploys consistent. The handler is
-- per table, INSIDE the loop, on purpose: `tasks` is already a member (it
-- joined as list_items and the rename kept the membership), and a single
-- EXCEPTION block around all three would abandon the other two the moment
-- `tasks` raised duplicate_object.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'tasks',
    'task_assignees',
    'task_occurrences'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 13. Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE tasks IS
  'Every completable thing in the app: a list item, a dated reminder and a recurring chore are the same row with more or fewer dimensions filled in. Renamed from list_items.';

COMMENT ON COLUMN tasks.list_id IS
  'NULL = a standalone task; it lands in the Inbox smart list instead of a list.';
COMMENT ON COLUMN tasks.owner_id IS
  'Creator, and the access guard for a listless personal task. For a task inside a list the RLS arm ignores it.';
COMMENT ON COLUMN tasks.scope IS
  'Only consulted for a listless task. A task inside a list always carries its list''s scope, forced by set_task_defaults().';
COMMENT ON COLUMN tasks.due_date IS
  'NULL = someday, list only. Set = shows in Danas, Kalendar and the digests. For a recurring task this is also the series anchor.';
COMMENT ON COLUMN tasks.due_time IS
  'NULL = all-day bucket for its date. Set = sorts into the day timeline at that minute.';
COMMENT ON COLUMN tasks.recurrence_weekdays IS
  'Weekly recurrence only. 0 = Monday .. 6 = Sunday, matching activity_schedule.day_of_week. Never a raw JS getDay().';
COMMENT ON COLUMN tasks.completion_mode IS
  'shared = one tick finishes the occurrence for everybody; per_assignee = every assignee ticks their own copy (a task_occurrences row per person).';
COMMENT ON COLUMN tasks.is_completed IS
  'The truth for NON-recurring tasks only. A recurring task is resolved per occurrence in task_occurrences and is forbidden from setting this.';
COMMENT ON COLUMN tasks.completed_by_person_id IS
  'References profiles, never auth.users: a member without a login (a child) is exactly who ticks a chore off.';
COMMENT ON COLUMN tasks.remind_minutes_before IS
  'Push this many minutes before due_time. For timed tasks, like events and payments.';
COMMENT ON COLUMN tasks.remind_days_before IS
  'Push this many days before due_date. For all-day tasks, like events and payments.';

COMMENT ON TABLE task_assignees IS
  'Who a task belongs to. No rows means family-wide and nobody''s in particular, not hidden. Drives the person filter, the member badges and what a child can see.';
COMMENT ON COLUMN task_assignees.family_id IS
  'Denormalized from the parent task so the RLS predicate needs no join and stays a leaf. Filled by set_family_id_from_task().';

COMMENT ON TABLE task_occurrences IS
  'Sparse per-occurrence rows for a recurring task: no row is the normal state. For a recurring task this IS the completion record, because tasks.is_completed is structurally forbidden from carrying it.';
COMMENT ON COLUMN task_occurrences.occurrence_date IS
  'The ORIGINAL projected date from the series, even when the row moves it. Same convention as payment_overrides.';
COMMENT ON COLUMN task_occurrences.person_id IS
  'NULL = the occurrence as a whole (completion_mode shared); set = this person''s own copy (completion_mode per_assignee).';
COMMENT ON COLUMN task_occurrences.status IS
  'done = finished; skipped = not needed this time, dropped from the agenda; moved = shows on moved_to_date instead.';
COMMENT ON COLUMN task_occurrences.moved_to_date IS
  'Where a moved occurrence actually shows. Required for status moved, NULL otherwise.';
COMMENT ON COLUMN task_occurrences.family_id IS
  'Denormalized from the parent task so the agenda can fetch a whole family for a date range in one query. Filled by set_family_id_from_task().';
