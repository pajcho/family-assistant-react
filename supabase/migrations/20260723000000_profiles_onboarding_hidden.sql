-- The first-steps onboarding card on the today screen: a per-user dismissal.
-- NULL = the card may be shown (until the steps are complete); it is set to
-- now() when the user taps dismiss. It lives on the profile so it holds on
-- every device (the PWA on a phone + desktop).
-- RLS: the existing policy "Users can update own profile" covers the write.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_hidden_at TIMESTAMPTZ;
