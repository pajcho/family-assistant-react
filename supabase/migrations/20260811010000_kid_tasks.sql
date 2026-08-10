-- Chores in the kid shell: three SELECT policies and the second write a child
-- has ever been allowed to make.
--
-- Read the header of 20260808000000_kid_mode.sql first. The short version: a
-- child's auth user is SYNTHETIC and has NO row in `profiles`, so every policy
-- that resolves the caller through `profiles WHERE id = auth.uid()` matches
-- nothing for them. Access is handed back one table at a time, SELECT only,
-- keyed on `public.kid_profile_id()`. A table nobody remembered is invisible to
-- the child rather than leaked.
--
-- Until now kid mode was read-only except for exactly one function,
-- `kid_set_theme()`. Ticking off a chore is the SECOND write, and it is an RPC
-- for the same reason the first one was: PostgreSQL has no column restriction in
-- USING / WITH CHECK, so an UPDATE policy on `tasks` would cover the WHOLE row.
-- A child could then rename the task, move its due date, clear its assignees'
-- work by flipping `completion_mode`, or point `list_id` at a parent's private
-- list. `kid_complete_task()` writes exactly one thing - "this is done" - for
-- exactly one task, and only one the child is actually assigned to.
--
-- So, as before: there is NO kid INSERT, UPDATE or DELETE policy anywhere. Not
-- on `tasks`, not on `task_occurrences`, not on `task_assignees`. The kid shell
-- must call the RPC (`hooks/useKidTasks.ts`), never write to a table.
--
-- On recursion, because this migration is where the risk lives. The policy on
-- `tasks` below reads `task_assignees`, which means EVERY read of `tasks`, by a
-- parent as much as by a child, expands every SELECT policy of `task_assignees`
-- (permissive policies are OR-ed, so all of them are planned). If any of those
-- read `tasks` back, Postgres answers
-- `infinite recursion detected in policy for relation "tasks"` and the table
-- stops working for everybody. That is why `task_assignees` is family-keyed
-- through the SECURITY DEFINER helper `auth_user_family_id()` in
-- 20260811000000_tasks.sql: its predicate names no table at all, so it is a leaf
-- and the loop cannot close. The rule from the kid_mode header applies
-- unchanged - a kid policy may only read a table that is a leaf.

-- ---------------------------------------------------------------------------
-- The three SELECT policies
-- ---------------------------------------------------------------------------
-- A child sees a task only when it is assigned to them. No assignee means
-- family-wide, which for a child means "not mine, do not show it": chores are
-- given to somebody on purpose, and the shopping list is not a child's
-- business.

CREATE POLICY "Kid can view own task_assignees" ON task_assignees FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own tasks" ON tasks FOR SELECT USING (
  family_id = public.kid_family_id()
  AND EXISTS (
    SELECT 1 FROM task_assignees ta
    WHERE ta.task_id = tasks.id AND ta.person_id = public.kid_profile_id()
  )
);

-- Occurrences of those same tasks - what the child ticked off yesterday, and
-- what a parent skipped or moved. Routed through `task_assignees` rather than
-- through `tasks` so this policy also stays one hop from a leaf.
CREATE POLICY "Kid can view own task_occurrences" ON task_occurrences FOR SELECT
  USING (
    family_id = public.kid_family_id()
    AND EXISTS (
      SELECT 1 FROM task_assignees ta
      WHERE ta.task_id = task_occurrences.task_id
        AND ta.person_id = public.kid_profile_id()
    )
  );

-- ---------------------------------------------------------------------------
-- kid_complete_task - the only write
-- ---------------------------------------------------------------------------
-- Modelled on kid_set_theme(): SECURITY DEFINER, an empty search_path with
-- every name fully qualified (so a temporary table cannot shadow `tasks` for a
-- function running with the owner's rights), and its own re-check of who the
-- caller is, because a definer function bypasses the very RLS that would
-- otherwise protect these tables.
--
-- Three things are verified before anything is written: the caller is an active
-- child, the date is within reach, and the task really is assigned to that child
-- in that child's family. The date window is a product rule, not a security
-- one: a child who forgot a whole week should not be able to tidy it up with one
-- tap, and a parent can always fix history from the main app.
--
-- The two completion paths are the same split the rest of the feature follows: a
-- recurring task is resolved by a `task_occurrences` row, a one-off by
-- `tasks.is_completed`. `completion_mode` decides whether the occurrence row is
-- the shared one (person_id NULL) or this child's own copy.

CREATE OR REPLACE FUNCTION public.kid_complete_task(
  p_task_id UUID,
  p_date DATE,
  p_done BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile UUID := public.kid_profile_id();
  v_family UUID := public.kid_family_id();
  v_recurring BOOLEAN;
  v_mode TEXT;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not a kid session';
  END IF;

  -- A child may only resolve today or yesterday, so a forgotten week cannot be
  -- backfilled in one tap.
  IF p_date < CURRENT_DATE - 1 OR p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'date outside the allowed window';
  END IF;

  SELECT
    t.recurrence_period IS NOT NULL AND t.recurrence_period <> 'one-time',
    t.completion_mode
  INTO v_recurring, v_mode
  FROM public.tasks t
  JOIN public.task_assignees ta ON ta.task_id = t.id
  WHERE t.id = p_task_id
    AND t.family_id = v_family
    AND ta.person_id = v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not assigned to this child';
  END IF;

  IF v_recurring THEN
    IF p_done THEN
      INSERT INTO public.task_occurrences (
        task_id, family_id, occurrence_date, person_id, status,
        completed_at, completed_by_person_id
      )
      VALUES (
        p_task_id, v_family, p_date,
        CASE WHEN v_mode = 'per_assignee' THEN v_profile ELSE NULL END,
        'done', NOW(), v_profile
      )
      ON CONFLICT (task_id, occurrence_date, person_id) DO UPDATE
        SET status = 'done',
            completed_at = NOW(),
            completed_by_person_id = v_profile;
    ELSE
      DELETE FROM public.task_occurrences
      WHERE task_id = p_task_id
        AND occurrence_date = p_date
        AND person_id IS NOT DISTINCT FROM
          (CASE WHEN v_mode = 'per_assignee' THEN v_profile ELSE NULL END)
        AND status = 'done';
    END IF;
  ELSE
    UPDATE public.tasks
      SET is_completed = p_done,
          completed_at = CASE WHEN p_done THEN NOW() ELSE NULL END,
          completed_by_person_id = CASE WHEN p_done THEN v_profile ELSE NULL END
      WHERE id = p_task_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.kid_complete_task(UUID, DATE, BOOLEAN) IS
  'Ticks one of the calling child''s own chores off (or back on) for one date. The second and only other write a kid session may perform, after kid_set_theme.';

REVOKE ALL ON FUNCTION public.kid_complete_task(UUID, DATE, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_complete_task(UUID, DATE, BOOLEAN) TO authenticated;
