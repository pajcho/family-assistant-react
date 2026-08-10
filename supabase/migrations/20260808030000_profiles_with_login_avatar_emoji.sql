-- Refresh `profiles_with_login` so it sees `avatar_emoji` too.
--
-- The view is defined as `SELECT p.*, ...`, but Postgres freezes the column
-- list at creation time - columns added afterwards do NOT appear on their own.
-- The same step was already needed once, when `is_admin` was added (see
-- 20260602000000_family_admin.sql).
--
-- Without this, `useFamilyMembers` reads the whole roster through the view and
-- gets rows WITHOUT `avatar_emoji`, so a parent's choice would land in the
-- database and be visible nowhere: neither in the badges of the main app nor in
-- the tiles of the kid one.
--
-- DROP + CREATE, not CREATE OR REPLACE: the new columns are inserted BEFORE the
-- trailing `has_login`, which changes the column order, and REPLACE does not
-- allow that.
--
-- `onboarding_hidden_at`, `nav_slots` and `accent` come along for the ride, kept
-- out by the same frozen list. Nothing is exposed by that: the "family
-- profiles" RLS policy already lets a family member read the whole `profiles`
-- row, and the view is `security_invoker = true`, so that same policy applies
-- here as well.
DROP VIEW IF EXISTS public.profiles_with_login;
CREATE VIEW public.profiles_with_login
WITH (security_invoker = true)
AS
SELECT
  p.*,
  public.profile_has_login(p.id) AS has_login
FROM public.profiles p;

GRANT SELECT ON public.profiles_with_login TO authenticated;
