-- The four tables that were left out of the family broadcast channel.
--
-- 20260729010000_family_broadcast_channel.sql attached triggers to 22 tables
-- and asked, in a comment, that the list be kept in step with
-- TABLE_INVALIDATIONS in src/hooks/useFamilyChannel.ts. Four were left out
-- anyway:
--
--   receipts, receipt_items - added later
--     (20260803000000_receipt_entities.sql), and at the time it was decided
--     they needed no broadcast, because "every change that matters to other
--     screens touches `expenses` too". Receipt splitting
--     (20260803120000_receipt_split_rpcs.sql) changed that: claiming a line is
--     an UPDATE on `receipt_items` with no write to `expenses` at all, so
--     member B looks at stale line ownership and then runs into a PT409 claim
--     collision that never had to happen.
--   profiles - renaming a member, the emoji, the colour. Rarely changed, but
--     visible on every screen that draws participants.
--   families - renaming the family and the list of enabled currencies.
--
-- kid_access, kid_devices and kid_invites still DELIBERATELY have no broadcast
-- (see the end of 20260808000000_kid_mode.sql), and neither does
-- expense_items, which is frozen.

-- ---------------------------------------------------------------------------
-- 1. Tables that carry `family_id` - the shared function works unchanged
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'profiles',
    'receipt_items',
    'receipts'
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
-- 2. families - the one table the shared function cannot serve
-- ---------------------------------------------------------------------------
-- `broadcast_family_change` reads `NEW.family_id`; a family keeps its key in
-- `id`. Attaching the shared function to `families` does not fail when the
-- trigger is created but on the first write, and in a way that FAILS the whole
-- UPDATE:
--   ERROR: record "new" has no field "family_id"
--   CONTEXT: PL/pgSQL assignment "fam := NEW.family_id"
-- (verified against a copy of the schema, 2026-08-09). Hence a second function
-- with the same body and one changed line, rather than extending the shared
-- function with a branch on TG_TABLE_NAME - that one runs on every change in
-- 25 tables and has no reason to pay for a check that concerns one.

CREATE OR REPLACE FUNCTION public.broadcast_families_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fam UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    fam := OLD.id;
  ELSE
    fam := NEW.id;
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

COMMENT ON FUNCTION public.broadcast_families_change() IS
  'AFTER trigger for families: the same message as broadcast_family_change, only the family id is read from the id column.';

DROP TRIGGER IF EXISTS broadcast_family_change ON public.families;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_families_change();
