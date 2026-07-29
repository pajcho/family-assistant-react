-- One realtime broadcast topic per family (RP-2 in SCALING_PLAN.md).
--
-- Before: 20 hooks each opened their own `postgres_changes` channel, and the
-- agenda alone mounted 14 of them, so a single app open cost 14 channel joins.
-- Postgres changes are also RLS-checked per subscriber, which Supabase itself
-- flags as the thing that stops scaling; broadcast is their recommendation.
--
-- After: every family-scoped table fires an AFTER trigger that sends a tiny
-- message to the `family:<family_id>` topic. The client keeps ONE private
-- channel open (see src/hooks/useFamilyChannel.ts) and maps the table name in
-- the payload onto the query keys to invalidate.
--
-- The payload deliberately carries only the table name and the operation, not
-- the row. Two reasons: the client only ever needs to know "something in table
-- X changed" to invalidate, and a personal list (lists.scope = 'personal') must
-- not be readable by the rest of the family, which shipping the row would do.
--
-- Note this does NOT touch the `supabase_realtime` publication. Postgres
-- changes keep working for anything still subscribed to them; removing tables
-- from the publication is a separate, later cleanup.

-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because realtime.send() inserts into realtime.messages,
-- which `authenticated` cannot write to. Errors inside realtime.send are
-- already downgraded to a WARNING there, so a realtime hiccup can never fail
-- the user's INSERT/UPDATE/DELETE.

CREATE OR REPLACE FUNCTION public.broadcast_family_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fam UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    fam := OLD.family_id;
  ELSE
    fam := NEW.family_id;
  END IF;

  IF fam IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
      'change',
      'family:' || fam::TEXT,
      true
    );
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.broadcast_family_change() IS
  'AFTER trigger: notifies the family:<family_id> broadcast topic that a table changed.';

-- ---------------------------------------------------------------------------
-- Attach to every family-scoped table the client subscribes to
-- ---------------------------------------------------------------------------
-- Keep this list in sync with TABLE_INVALIDATIONS in
-- src/hooks/useFamilyChannel.ts - a table with a trigger but no mapping is a
-- wasted message, a mapping with no trigger is a screen that never refreshes.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'activities',
    'activity_overrides',
    'activity_participants',
    'activity_schedule',
    'bell_schedules',
    'birthdays',
    'event_participants',
    'events',
    'expense_categories',
    'expenses',
    'external_calendar_events',
    'external_event_local',
    'income_entries',
    'incomes',
    'list_items',
    'lists',
    'payment_history',
    'payment_overrides',
    'payment_participants',
    'payments',
    'school_shift_anchors',
    'school_timetable_entries'
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
-- RLS on realtime.messages
-- ---------------------------------------------------------------------------
-- Joining a private channel is a read of realtime.messages, so this policy is
-- what keeps family A out of family B's topic. Without it the join is refused
-- outright (deny by default), and with a wrong one every family would see
-- everyone else's invalidations.

DROP POLICY IF EXISTS "Family members read their family topic" ON realtime.messages;

CREATE POLICY "Family members read their family topic"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() = 'family:' || (
      SELECT p.family_id::TEXT FROM public.profiles p WHERE p.id = auth.uid()
    )
  );
