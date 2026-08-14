-- Who put a task occurrence into the state it is in.
--
-- `task_occurrences` recorded exactly one actor: `completed_by_person_id`, and
-- only for a tick. Skipping and moving - the two writes that make an instance
-- DISAPPEAR from the agenda - left no name at all, so "this repeat is gone and
-- nobody knows who did that" was unanswerable from the data, not just from the
-- UI. See plans/017-recurring-task-clarity.md, section 9.
--
-- Two columns, one trigger, no new policies. What this does NOT do is keep a
-- trail: there is one row per slot and it is upserted, so these columns answer
-- "who has it like this now", never "who skipped it before somebody restored
-- it". A full trail is an append-only table and is deliberately out of scope.

ALTER TABLE task_occurrences
  ADD COLUMN acted_by_person_id UUID
    REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN acted_at TIMESTAMP WITH TIME ZONE;

-- profiles, never auth.users, for the same reason `completed_by_person_id` is:
-- a member without a login is a person here. ON UPDATE CASCADE because
-- promoting such a member to a real account re-points profiles.id (see
-- 20260808010000_person_fk_on_update_cascade.sql).

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
-- Filled here rather than by the client so it cannot be forgotten by one write
-- path or spoofed by another - the client already sends five fields to this
-- table from three different hooks.
--
-- SECURITY DEFINER because it reads `profiles`, which is RLS-protected: as a
-- SECURITY INVOKER function the EXISTS below would silently answer "no" for
-- anyone whose own profile row a policy happened to hide, and the column would
-- go quietly null. The function names no table a policy could be written
-- against in a way that closes a cycle, so this stays a leaf like
-- `auth_user_family_id()`.
--
-- The ELSE arm is not a fallback, it is the kid path. A child's auth user is
-- SYNTHETIC and has NO row in `profiles` (see 20260808000000_kid_mode.sql), so
-- `acted_by_person_id = auth.uid()` would violate the foreign key and take the
-- child's one allowed write - `kid_complete_task()` - down with it.
-- `kid_profile_id()` is the profile that child actually is, and it returns NULL
-- for everybody else, so a context that is neither leaves the column null
-- ("unknown") instead of failing.

CREATE OR REPLACE FUNCTION set_task_occurrence_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
    NEW.acted_by_person_id = auth.uid();
  ELSE
    NEW.acted_by_person_id = public.kid_profile_id();
  END IF;
  NEW.acted_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION set_task_occurrence_actor() FROM PUBLIC;

-- BEFORE INSERT OR UPDATE: an upsert that flips a slot from 'done' to 'skipped'
-- is an UPDATE, and it is exactly the case this column exists for.
DROP TRIGGER IF EXISTS set_task_occurrence_actor ON task_occurrences;
CREATE TRIGGER set_task_occurrence_actor
  BEFORE INSERT OR UPDATE ON task_occurrences
  FOR EACH ROW EXECUTE FUNCTION set_task_occurrence_actor();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN task_occurrences.acted_by_person_id IS
  'Who put this occurrence into its CURRENT state - the one name that also covers skipping and moving. Superseded states are not kept; this is not an audit trail.';
COMMENT ON COLUMN task_occurrences.acted_at IS
  'When the current state was written. Distinct from completed_at, which only ever stamps a tick.';
COMMENT ON FUNCTION set_task_occurrence_actor() IS
  'Stamps acted_by_person_id / acted_at on every write. SECURITY DEFINER to read profiles past RLS; falls back to kid_profile_id() because a child has no profiles row.';
