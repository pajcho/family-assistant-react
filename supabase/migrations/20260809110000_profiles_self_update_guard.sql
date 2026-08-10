-- ---------------------------------------------------------------------------
-- A self-update on `profiles` may no longer touch privileges
-- ---------------------------------------------------------------------------
-- The old policy read:
--
--   CREATE POLICY "Users can update own profile" ON profiles
--     FOR UPDATE USING (auth.uid() = id);
--
-- No WITH CHECK and no column restriction whatsoever. Because permissive
-- policies combine with OR, the admin policy "Admins can update family
-- profiles" was therefore only guarding OTHER people's rows - every member
-- could overwrite their own row entirely. Two holes followed, both reachable
-- with a plain client call to supabase.from("profiles").update():
--
--   1. Privilege escalation: a member sets is_admin = true on themselves and
--      gets everything an admin may do (a child's PIN and devices, opening and
--      closing logins, changing who is in the family, renaming the family).
--   2. Taking over another family: a member overwrites their own family_id.
--      Since every policy in the schema computes membership through
--      `family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())`,
--      that one column moves the entire data scope the session can see -
--      events, payments, expenses, receipts, income, birthdays.
--
-- Alongside USING, the new policy gains a WITH CHECK that compares the NEW row
-- against the row already in the table: everything may change except
-- `is_admin` and `family_id`. The `id` column cannot change because both USING
-- and WITH CHECK tie it to auth.uid().
--
-- Why a policy and not a BEFORE UPDATE trigger: a trigger would fire for
-- service_role too, and the `manage-family-login` edge function does exactly
-- `UPDATE profiles SET id = <new auth id>` (when opening a login for a member
-- without one) and `UPDATE profiles SET is_admin = false` (when closing one)
-- through the service_role key. RLS policies do not apply to service_role, so
-- that path stays untouched.
--
-- The subquery on `profiles` inside a policy ON `profiles` does not recurse
-- here: that table's SELECT policies are leaves (`auth.uid() = id` and the
-- definer functions `auth_user_family_id()` / `kid_family_id()`), so the
-- expansion ends after one hop. A user always sees their own row through
-- "Users can view own profile", and `is_admin` and `family_id` are NOT NULL,
-- so the subquery never returns NULL to anyone allowed to make the update at
-- all.
--
-- What this does NOT touch: the policy "Admins can update family profiles"
-- stays as it was, so an admin still edits other people's rows, is_admin
-- included. A kid session has no row in `profiles`, so both the old and the new
-- policy are a dead letter for it.
--
-- The rule for tomorrow: every new column on `profiles` is automatically
-- self-writable under this policy. If a new column carries a privilege, it has
-- to go into the WITH CHECK below in the same migration.

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid())
    AND family_id = (SELECT p.family_id FROM public.profiles p WHERE p.id = auth.uid())
  );

COMMENT ON POLICY "Users can update own profile" ON profiles IS
  'A member edits their own row, but not is_admin, family_id or id.';
