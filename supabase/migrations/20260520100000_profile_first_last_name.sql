-- Split the existing `full_name` text column into `first_name` + `last_name`
-- so the profile settings UI can edit each field independently and the
-- shared avatar / dropdown can fall back to "first letter of each name"
-- initials (e.g. "NP" for Nikola Pajic).
--
-- We keep `full_name` for now to avoid a coordinated client deploy — the
-- React app reads/writes `first_name`/`last_name` and a Postgres trigger
-- recomputes `full_name = trim(first_name || ' ' || last_name)` on write
-- so anything still reading the old column keeps working.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Backfill: split existing full_name on the first whitespace run.
-- Rows where full_name is NULL stay NULL; the user can fill them in via
-- the new settings page.
UPDATE profiles
SET
  first_name = COALESCE(first_name, NULLIF(split_part(full_name, ' ', 1), '')),
  last_name = COALESCE(
    last_name,
    NULLIF(NULLIF(regexp_replace(full_name, '^\S+\s*', ''), ''), full_name)
  )
WHERE full_name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

-- Keep full_name in sync from now on. INSERT or UPDATE of first/last name
-- recomputes full_name so any legacy reader sees consistent data.
CREATE OR REPLACE FUNCTION sync_profile_full_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
    NEW.full_name = NULLIF(
      trim(both ' ' FROM COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')),
      ''
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_profile_full_name_trigger ON profiles;
CREATE TRIGGER sync_profile_full_name_trigger
  BEFORE INSERT OR UPDATE OF first_name, last_name ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_profile_full_name();
