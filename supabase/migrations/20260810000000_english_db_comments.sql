-- Re-issue every database comment that was written in Serbian, in English.
--
-- The repository now holds one language rule: everything that is not text a
-- user reads on screen is English - code comments, identifiers, URLs, commits,
-- and the comments stored in the database itself (see AGENTS.md). The migration
-- FILES that carried those comments have been translated in place, which is
-- enough for a fresh `supabase db reset`, but not for an environment where they
-- have already been applied: `COMMENT ON` writes the text into the catalog at
-- apply time, so production is still holding the Serbian strings.
--
-- Hence this migration. It has no schema effect at all - every statement below
-- rewrites `pg_description` for an object that already exists, with exactly the
-- text now written in the migration that created it. Applying it to a database
-- built from the translated files is a no-op that writes the same string twice.
--
-- Comments already written in English (`broadcast_family_change`, and every
-- table and column commented before 2026-07) are not repeated here.

-- ---------------------------------------------------------------------------
-- 20260807090000_school_breaks.sql
-- ---------------------------------------------------------------------------
COMMENT ON TABLE school_breaks IS
  'Periods with no classes. Only month+day is stored, so a break applies every year; an end before the start means the range wraps over New Year.';

-- ---------------------------------------------------------------------------
-- 20260808000000_kid_mode.sql
-- ---------------------------------------------------------------------------
COMMENT ON TABLE kid_access IS
  'Kid access: the link between a child profile and a synthetic, profile-less auth user. The row existing is the feature switch; deleting the auth user cascades the row away.';

COMMENT ON TABLE kid_devices IS
  'A child''s linked devices. Only the sha256 of the token is stored; revoking access = deleting the row.';

COMMENT ON TABLE kid_invites IS
  'Single-use device-link invites (15 minutes). Service role only: it carries no RLS policy at all.';

COMMENT ON TABLE birthday_visibility IS
  'Opt-in birthday visibility for children, with a per-child note. Without a row here no child sees the birthday.';

COMMENT ON FUNCTION public.kid_profile_id() IS
  'The child profile id for the current session, or NULL when the caller is not an active child.';

COMMENT ON FUNCTION public.kid_family_id() IS
  'The child family id for the current session, or NULL when the caller is not an active child.';

-- ---------------------------------------------------------------------------
-- 20260808020000_member_avatar_emoji.sql
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN profiles.avatar_emoji IS
  'The emoji that stands for this member. NULL = not chosen, falls back to the deterministic animal derived from the id.';

COMMENT ON COLUMN profiles.member_avatar_style IS
  'How THIS user sees members in the main app. NULL = initials. The kid app ignores this.';

-- ---------------------------------------------------------------------------
-- 20260809100000_kid_themes_watermelon_lavender_pearl.sql
-- (the same object as in 20260808000000_kid_mode.sql, last writer wins)
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.kid_set_theme(TEXT) IS
  'Changes the calling child''s theme. The only write a kid session may perform.';

-- ---------------------------------------------------------------------------
-- 20260809110000_profiles_self_update_guard.sql
-- ---------------------------------------------------------------------------
COMMENT ON POLICY "Users can update own profile" ON profiles IS
  'A member edits their own row, but not is_admin, family_id or id.';

-- ---------------------------------------------------------------------------
-- 20260809120000_kid_pin_attempt_rpc.sql
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT) IS
  'Records one missed PIN atomically and returns the state after the write. Called only by the kid-auth edge function with the service role.';

-- ---------------------------------------------------------------------------
-- 20260809130000_broadcast_missing_tables.sql
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.broadcast_families_change() IS
  'AFTER trigger for families: the same message as broadcast_family_change, only the family id is read from the id column.';

-- ---------------------------------------------------------------------------
-- 20260809150000_payments_due_anchor_day.sql
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN payments.due_anchor_day IS
  'The day of the month (1-31) the series is anchored to. Every monthly step derives the day from here, so the 31st does not permanently become the 28th after February.';
