-- Redesign 2.0: a per-user app colour (the accent).
-- The "plum" design language is the neutrals; the accent is one token the user
-- picks in settings > appearance. NULL = the default blue (the brand colour).
-- The brand outside the app (the PWA icon, the login mark, the splash) stays
-- blue whatever the choice - the accent applies inside the app only.
--
-- It lives on the profile (not per device) so the choice follows the user
-- across every device; the existing RLS policy "Users can update own profile"
-- covers the write. The client validates the value anyway (normalizeAccent),
-- but the CHECK keeps junk out of the database on a direct write.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS accent TEXT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_accent_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_accent_check
  CHECK (accent IS NULL OR accent IN ('blue', 'purple', 'green', 'brown'));
