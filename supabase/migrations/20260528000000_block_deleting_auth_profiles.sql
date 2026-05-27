-- A family member with their own Supabase login (you, your partner) must
-- never be deletable through the household-management UI. The previous
-- DELETE policy only blocked self-delete — Sonja could still remove
-- Nikola's profile row, leaving an orphaned auth.users row whose owner
-- could log back in but would land in a broken app (no profile → no
-- familyId → most queries no-op).
--
-- We derive "has login?" from `auth.users` at query time instead of
-- denormalizing onto profiles. A SECURITY DEFINER function does the
-- existence check (the `authenticated` role doesn't have SELECT on
-- auth.users directly). A `security_invoker = true` view exposes the
-- computed `has_login` boolean to the client so the popover can hide its
-- trash icon for accounts that can't be deleted.

CREATE OR REPLACE FUNCTION public.profile_has_login(profile_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path guards against search_path attacks; references are
-- fully qualified (auth.users).
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = profile_id);
$$;

GRANT EXECUTE ON FUNCTION public.profile_has_login(uuid) TO authenticated;

-- Replace the DELETE policy. We keep the family_id guard so a user can
-- only ever delete inside their own family; on top of that we now
-- require the target row to have no auth.users entry. The previous
-- `id <> auth.uid()` self-check becomes redundant (auth users always
-- have logins) but is harmless if we wanted belt-and-suspenders later.
DROP POLICY IF EXISTS "Users can delete family members" ON profiles;
CREATE POLICY "Users can delete family members" ON profiles FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    AND NOT public.profile_has_login(id)
  );

-- View that exposes `has_login` alongside the regular profile columns.
-- `security_invoker = true` (Postgres 15+) makes the view run with the
-- caller's permissions so the existing RLS policies on `profiles` still
-- apply (a user can only see profiles in their family). Only the
-- function call inside the SELECT is privileged, and it only returns a
-- boolean — no PII leaks.
CREATE OR REPLACE VIEW public.profiles_with_login
WITH (security_invoker = true)
AS
SELECT
  p.*,
  public.profile_has_login(p.id) AS has_login
FROM public.profiles p;

GRANT SELECT ON public.profiles_with_login TO authenticated;
