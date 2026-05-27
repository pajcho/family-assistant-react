-- Open `profiles` up to include household members who don't have their own
-- login (children, partners without an account). Until now, every profile
-- row had to correspond to an `auth.users` row because `profiles.id` was a
-- FK to it. That made sense when "profile" meant "logged-in user", but the
-- activities feature wants to attribute trainings / music school / etc. to
-- people who never sign in — so the constraint has to go.
--
-- We:
--   1. Drop the FK so `profiles.id` is just a UUID PK with no auth coupling.
--   2. Give the PK a default (`gen_random_uuid()`) so client INSERTs can
--      omit it. Existing rows keep the id they had (which still equals an
--      auth.uid() for adults, by historical coincidence).
--   3. Add INSERT and DELETE policies scoped to the family, so a parent can
--      add a child profile or remove one. UPDATE was already broadened in
--      the activities migration.
--
-- A user can still NEVER delete or insert their own auth row through these
-- policies — those operations require Supabase auth APIs.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE POLICY "Users can insert family members" ON profiles FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- DELETE is family-scoped but additionally blocked from removing your own
-- profile row — that would leave the user with a valid auth session but no
-- profile, which the UI doesn't handle. Account deletion is a separate
-- (admin / auth API) flow.
CREATE POLICY "Users can delete family members" ON profiles FOR DELETE
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    AND id <> auth.uid()
  );
