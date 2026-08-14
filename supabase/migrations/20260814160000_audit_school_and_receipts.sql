-- Change history for Škola and Računi (plan 018, follow-up).
--
-- The first two migrations covered the ten tables people edit every day. The
-- school timetable, the school breaks, the bell schedule, the shift anchors and
-- the fiscal receipts were left out, and they are exactly the kind of thing
-- somebody changes once and everybody else notices a week later without knowing
-- who or why.
--
-- Deliberately still out: `receipt_items`. Importing one receipt inserts twenty
-- to thirty of them at once, which would bury every other entry in the family's
-- log, and the fact worth reading - who claimed which line - already shows up as
-- the expense that claim creates.

-- ---------------------------------------------------------------------------
-- 1. entity_id for tables that have no `id`
-- ---------------------------------------------------------------------------
-- `bell_schedules` is keyed by family_id (one per family) and
-- `school_shift_anchors` by person_id (one per student). Neither has an `id`
-- column, so the original `(subject ->> 'id')::UUID` produced NULL against a
-- NOT NULL column - caught by the trigger's own exception guard, which means it
-- would have failed SILENTLY, logging a warning nobody reads and no history.
--
-- The fallback picks the row's real key instead. Order matters: `id` first for
-- the eight tables that have one, then person_id, then family_id, so a table
-- keyed by person does not get filed under its family.

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
  ent      UUID;
  act      TEXT;
BEGIN
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

  ent := COALESCE(
    NULLIF(subject ->> 'id', '')::UUID,
    NULLIF(subject ->> 'person_id', '')::UUID,
    fam);

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
    ent,
    act,
    actor,
    CASE WHEN subject ->> 'scope' = 'personal' THEN 'owner' ELSE 'family' END,
    COALESCE(
      NULLIF(subject ->> 'owner_id', '')::UUID,
      NULLIF(subject ->> 'created_by_id', '')::UUID),
    -- `subject` is the receipt's shop, `merchant` the expense's; a timetable
    -- entry is named by what is taught in it.
    COALESCE(
      subject ->> 'name',
      subject ->> 'subject',
      subject ->> 'store_name',
      subject ->> 'merchant',
      subject ->> 'note'),
    CASE WHEN act = 'update' THEN diff ELSE NULL END
  );

  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'audit_log write failed for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Authorship columns on the new tables
-- ---------------------------------------------------------------------------
-- Same rules as 20260814140000: REFERENCES profiles (a member without a login
-- can be the author), ON UPDATE CASCADE (member promotion rewrites profiles.id),
-- ON DELETE SET NULL (removing a member does not delete their history), and no
-- backfill because nothing records who wrote the existing rows.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'bell_schedules',
    'receipts',
    'school_breaks',
    'school_shift_anchors',
    'school_timetable_entries'
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

      DROP TRIGGER IF EXISTS set_audit_actor ON public.%1$I;
      CREATE TRIGGER set_audit_actor
        BEFORE INSERT ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.set_audit_actor();

      DROP TRIGGER IF EXISTS update_audit_actor ON public.%1$I;
      CREATE TRIGGER update_audit_actor
        BEFORE UPDATE ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.update_audit_actor();

      DROP TRIGGER IF EXISTS log_audit_change ON public.%1$I;
      CREATE TRIGGER log_audit_change
        AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.log_audit_change();
    $sql$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Which of their columns are worth remembering
-- ---------------------------------------------------------------------------
-- Extends the list from 20260814150000 rather than replacing it: the ten
-- original tables are repeated verbatim below because CREATE OR REPLACE takes
-- the whole body. Keep in sync with AUDIT_FIELDS in
-- src/components/common/auditFields.ts, which decides what is SHOWN - a column
-- recorded here and missing there renders as nothing at all.

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
    -- Škola
    WHEN 'school_timetable_entries' THEN ARRAY[
      'subject', 'room', 'day_of_week', 'period_index', 'variant', 'person_id']
    WHEN 'school_breaks' THEN ARRAY[
      'name', 'start_month', 'start_day', 'end_month', 'end_day']
    WHEN 'bell_schedules' THEN ARRAY[
      'period_minutes', 'small_break_minutes', 'big_break_minutes',
      'max_periods', 'morning_start', 'afternoon_start']
    WHEN 'school_shift_anchors' THEN ARRAY[
      'anchor_week_start', 'anchor_shift', 'flip_interval_weeks',
      'is_alternating', 'fixed_time_band']
    -- Računi. `checked_at` is written by the refresh job, not by a person, and
    -- `receipt_url` never changes after import.
    WHEN 'receipts' THEN ARRAY[
      'merchant', 'store_name', 'total_amount', 'issued_on']
    ELSE ARRAY[]::TEXT[]
  END
$$;

COMMENT ON FUNCTION public.audit_columns(TEXT) IS
  'The columns audit_log records per table. A table missing here logs nothing.';
