-- A personalized bottom navigation: today is always the first slot, and the
-- user picks up to 3 sections for the remaining places (the menu sheet > edit
-- the bar). NULL = the default layout (upcoming/payments/lists); an empty array
-- is a legitimate choice (today + menu only). The values are section keys from
-- the frontend - the client validates them through normalizeNavSlots, so an
-- unknown key in the database never reaches the UI.
-- It lives on the profile (not per device) so it holds on every device; the
-- existing RLS policy "Users can update own profile" covers the write.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nav_slots TEXT[];
