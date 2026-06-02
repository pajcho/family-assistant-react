-- Family management: a real admin role + the plumbing the "Porodica" settings
-- tab needs to create/disable logins and promote login-less members.
--
-- Until now every family member had identical RLS power (anyone could add or
-- remove members). This migration introduces `profiles.is_admin` and gates the
-- privileged roster actions (insert / delete / edit-other-members, family
-- rename) behind it. Everyone keeps full control over THEIR OWN profile row.
--
-- It also makes "promote a login-less member to a real user" possible without
-- losing history. The app keys logged-in users by `profiles.id == auth.users.id`.
-- `auth.admin.createUser` mints its own UUID, so promotion re-keys
-- `profiles.id` from the old random UUID to the new auth id. That UPDATE only
-- succeeds if every FK that could reference a login-less member cascades the
-- change — so we add ON UPDATE CASCADE to those four FKs. A login-less member
-- can ONLY ever have rows in these four tables; everything else
-- (lists/events/notifications/...) FKs to auth.users, which they have no rows
-- in until they get a login. If a future feature adds a new `profiles(id)` FK
-- reachable by a login-less member, it MUST also get ON UPDATE CASCADE here.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The admin flag.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Backfill: everyone who currently has a login becomes an admin. Login-less
-- members (children) stay non-admin. `profile_has_login` is the SECURITY
-- DEFINER existence check against auth.users added in the block-delete migration.
UPDATE profiles SET is_admin = true WHERE public.profile_has_login(id);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. ON UPDATE CASCADE on the four FKs a login-less member can populate, so the
--    promote re-key (UPDATE profiles SET id = <new auth id>) cascades cleanly.
--    Each keeps its existing ON DELETE CASCADE.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE activity_participants
  DROP CONSTRAINT IF EXISTS activity_participants_person_id_fkey,
  ADD CONSTRAINT activity_participants_person_id_fkey
    FOREIGN KEY (person_id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE school_shift_anchors
  DROP CONSTRAINT IF EXISTS school_shift_anchors_person_id_fkey,
  ADD CONSTRAINT school_shift_anchors_person_id_fkey
    FOREIGN KEY (person_id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE school_timetable_entries
  DROP CONSTRAINT IF EXISTS school_timetable_entries_person_id_fkey,
  ADD CONSTRAINT school_timetable_entries_person_id_fkey
    FOREIGN KEY (person_id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE activity_overrides
  DROP CONSTRAINT IF EXISTS activity_overrides_person_id_fkey,
  ADD CONSTRAINT activity_overrides_person_id_fkey
    FOREIGN KEY (person_id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. is_family_admin(family) — "is the caller an admin of this family?".
--    SECURITY DEFINER so the lookup bypasses RLS on profiles (avoids the policy
--    recursing into itself). Empty search_path + fully-qualified refs guard
--    against search_path attacks. Mirrors the existing `profile_has_login`.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_family_admin(target_family uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND family_id = target_family
      AND is_admin
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_family_admin(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Tighten the family-scoped profile policies to admin-only. The "own
--    profile" SELECT/UPDATE policies (id = auth.uid()) stay untouched, so every
--    member can still read and edit their own row. The "view family profiles"
--    SELECT policy also stays — non-admins still SEE the roster (read-only).
-- ───────────────────────────────────────────────────────────────────────────

-- INSERT new members → admins only.
DROP POLICY IF EXISTS "Users can insert family members" ON profiles;
CREATE POLICY "Admins can insert family members" ON profiles FOR INSERT
  WITH CHECK (public.is_family_admin(family_id));

-- DELETE members → admins only, and still only login-less rows (a member with a
-- login is removed by disabling the login first, via the Edge Function).
DROP POLICY IF EXISTS "Users can delete family members" ON profiles;
CREATE POLICY "Admins can delete family members" ON profiles FOR DELETE
  USING (public.is_family_admin(family_id) AND NOT public.profile_has_login(id));

-- UPDATE *other* members (colors, names, is_admin) → admins only. With no
-- separate WITH CHECK, the USING expression also guards the new row, so an
-- admin can't move a profile into a family they don't administer.
DROP POLICY IF EXISTS "Users can update own family profiles" ON profiles;
CREATE POLICY "Admins can update family profiles" ON profiles FOR UPDATE
  USING (public.is_family_admin(family_id));

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Family rename. `families` only had a SELECT policy — add an admin-only
--    UPDATE so the "Porodica" tab can rename the household.
-- ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can update own family" ON families;
CREATE POLICY "Admins can update own family" ON families FOR UPDATE
  USING (public.is_family_admin(id));

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Refresh `profiles_with_login`. The view is defined as `SELECT p.*, …`,
--    but Postgres froze the column list when the view was created — the new
--    `is_admin` column won't appear until we recreate it. DROP + CREATE (rather
--    than CREATE OR REPLACE) because inserting is_admin before the trailing
--    has_login column changes column ordering, which REPLACE forbids.
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.profiles_with_login;
CREATE VIEW public.profiles_with_login
WITH (security_invoker = true)
AS
SELECT
  p.*,
  public.profile_has_login(p.id) AS has_login
FROM public.profiles p;

GRANT SELECT ON public.profiles_with_login TO authenticated;
