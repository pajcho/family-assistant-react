-- Who created this, and who last changed it - for every module (plan 018, PR 1).
--
-- `lists` and `tasks` have carried `created_by_id` / `updated_by_id` since
-- 20260520200000_lists_feature.sql, and ListInfoPanel already renders them.
-- Every other entity table records only WHEN something changed, never WHO, so
-- "ko je dodao ovaj trosak" has no answer anywhere in the app. This generalizes
-- the lists pattern to the remaining eight tables.
--
-- Layer 2 (the audit_log table with per-field diffs) is a separate migration.
-- These columns are useful on their own: they cost 32 bytes per row, need no
-- new table, no RLS and no retention, and they arrive with the row itself, so
-- the detail sheets can show an author with no extra query.
--
-- Deliberately NOT covered:
--   * lists / tasks           - already have both columns
--   * external_calendar_events - written by the Google sync, never by a person
--   * *_participants, task_assignees - a participant change is an edit of its
--     parent entity and belongs in the parent's history, not its own

-- ---------------------------------------------------------------------------
-- 1. One answer to "who is acting"
-- ---------------------------------------------------------------------------
-- auth.uid() alone is WRONG for a child. Kid mode signs in as a synthetic auth
-- user that deliberately has no row in `profiles`
-- (20260808000000_kid_mode.sql), so storing the raw uid here would either
-- violate the foreign key below or - had we pointed the FK at auth.users -
-- store an id no profile lookup can ever turn into a name, and every chore a
-- child edited would read "nepoznat korisnik".
--
-- kid_profile_id() maps that synthetic user back to the child's real profile.
-- It returns NULL for everyone else, so an adult falls through to auth.uid(),
-- which IS their profile id.
--
-- NULL is a real result, not a failure: pg_cron jobs, edge functions and
-- anything else on the service role have no uid. Callers must handle it (see
-- the COALESCE in update_audit_actor below).

CREATE OR REPLACE FUNCTION public.audit_actor_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.kid_profile_id(), auth.uid())
$$;

COMMENT ON FUNCTION public.audit_actor_id() IS
  'The profiles.id of whoever is acting: a child via kid_profile_id(), anyone else via auth.uid(). NULL on the service role.';

-- ---------------------------------------------------------------------------
-- 2. The columns
-- ---------------------------------------------------------------------------
-- REFERENCES profiles, never auth.users: a member without a login (a child, or
-- anyone added by name only) has a profiles row and no auth row, and they can
-- be the author here. This is the same rule tasks.completed_by_person_id
-- follows.
--
-- ON UPDATE CASCADE is mandatory, not decorative. Promoting a member to a real
-- account runs `UPDATE profiles SET id = <new auth id>` inside
-- supabase/functions/manage-family-login, and any FK to profiles(id) without
-- CASCADE fails that UPDATE and rolls the promotion back - the bug
-- 20260808010000_person_fk_on_update_cascade.sql had to go back and fix on
-- three tables that missed it.
--
-- ON DELETE SET NULL, so removing a member does not delete their history; the
-- row survives with an unknown author, which the UI already renders as a
-- neutral fallback.
--
-- Existing rows are left NULL on purpose. There is no honest backfill: nothing
-- in the schema records who wrote a row before this migration, and inventing an
-- author (the family admin, say) would be worse than admitting we do not know.

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
    'payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format($sql$
      ALTER TABLE public.%1$I
        ADD COLUMN IF NOT EXISTS created_by_id UUID,
        ADD COLUMN IF NOT EXISTS updated_by_id UUID;

      ALTER TABLE public.%1$I
        DROP CONSTRAINT IF EXISTS %1$I_created_by_id_fkey,
        DROP CONSTRAINT IF EXISTS %1$I_updated_by_id_fkey;

      ALTER TABLE public.%1$I
        ADD CONSTRAINT %1$I_created_by_id_fkey
          FOREIGN KEY (created_by_id) REFERENCES public.profiles(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        ADD CONSTRAINT %1$I_updated_by_id_fkey
          FOREIGN KEY (updated_by_id) REFERENCES public.profiles(id)
          ON DELETE SET NULL ON UPDATE CASCADE;

      COMMENT ON COLUMN public.%1$I.created_by_id IS
        'Who created this row (profiles.id). NULL for rows written before plan 018 or by the service role.';
      COMMENT ON COLUMN public.%1$I.updated_by_id IS
        'Who last changed this row (profiles.id). Equals created_by_id until the first edit.';
    $sql$, t);
  END LOOP;
END $$;

-- No index on either column. Nothing queries "everything Marija created" - both
-- are read only alongside the row they sit on, by primary key.

-- ---------------------------------------------------------------------------
-- 3. Trigger functions
-- ---------------------------------------------------------------------------
-- Deliberately generic and table-agnostic: they touch only the two columns
-- added above, so one pair covers all eight tables. This is the trap
-- 20260811000000_tasks.sql documents - update_list_audit_fields() could not be
-- shared with `tasks` because it reached for NEW.list_id, and the trigger was
-- created happily and then failed the first UPDATE. Nothing here reads a column
-- that is not on every table in the list.

CREATE OR REPLACE FUNCTION public.set_audit_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by_id IS NULL THEN
    NEW.created_by_id = public.audit_actor_id();
  END IF;
  -- Seeded rather than left NULL, so "last changed by" is answerable from the
  -- moment the row exists. The UI tells the two apart by comparing timestamps,
  -- not by testing this for NULL - the rule ListInfoPanel already applies.
  IF NEW.updated_by_id IS NULL THEN
    NEW.updated_by_id = NEW.created_by_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_audit_actor() IS
  'BEFORE INSERT: stamps created_by_id / updated_by_id with the acting profile.';

CREATE OR REPLACE FUNCTION public.update_audit_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The COALESCE chain keeps a known author when the UPDATE comes from a
  -- connection with no uid (pg_cron re-anchoring a recurring payment, an edge
  -- function on the service role). Overwriting a real name with NULL there
  -- would lose information the row already had.
  NEW.updated_by_id = COALESCE(public.audit_actor_id(), OLD.updated_by_id, NEW.updated_by_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_audit_actor() IS
  'BEFORE UPDATE: re-stamps updated_by_id, keeping the previous author when there is no acting user.';

-- created_by_id is intentionally NOT pinned to OLD.created_by_id here, even
-- though that would stop a client from rewriting it. The ON UPDATE CASCADE
-- above works by UPDATEing this very column when a member is promoted to a real
-- account, and that cascade fires this trigger - pinning the old value would
-- silently undo the cascade and re-break the promotion flow. `tasks` leaves it
-- unpinned for the same reason.

-- ---------------------------------------------------------------------------
-- 4. Attach
-- ---------------------------------------------------------------------------
-- Same trigger name on every table, the shape broadcast_family_change uses.
-- BEFORE triggers fire in alphabetical order, so `set_audit_actor` and
-- `update_audit_actor` both run before the existing `update_<table>_updated_at`
-- trigger. Order is irrelevant here (disjoint columns), but worth knowing
-- before adding a third.

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
    'payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format($sql$
      DROP TRIGGER IF EXISTS set_audit_actor ON public.%1$I;
      CREATE TRIGGER set_audit_actor
        BEFORE INSERT ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.set_audit_actor();

      DROP TRIGGER IF EXISTS update_audit_actor ON public.%1$I;
      CREATE TRIGGER update_audit_actor
        BEFORE UPDATE ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.update_audit_actor();
    $sql$, t);
  END LOOP;
END $$;
