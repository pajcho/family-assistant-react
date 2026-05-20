-- Smart-sort toggle for lists. Promoted from a one-shot action to a
-- persistent boolean flag so the UI can show category headers + auto
-- re-sort on every item insert while toggled on. Stored on the list (not
-- the user) because the behaviour should be the same for every family
-- member viewing the same shared list.
--
-- No backfill needed — the default is false (smart-sort off) for existing
-- and new lists. The categoriser still detects shopping lists via name +
-- content for the initial "show the toggle?" decision; the flag only
-- records the user's explicit choice.

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS smart_sort_enabled BOOLEAN NOT NULL DEFAULT false;
