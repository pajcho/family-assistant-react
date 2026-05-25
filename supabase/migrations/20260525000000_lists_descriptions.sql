-- Optional free-text description on lists and on every list item.
--
-- Motivation: the bare `name` field forces users to cram context into the
-- title. A short note like "samo bio mleko" on an item, or "stvari za
-- vikend kod babe" on a whole list, lives better as a separate field.
-- We accept Markdown — the UI renders it in the item / list popups while
-- the row stays terse with a one-line preview + ellipsis.
--
-- NULL means "no description" (which is the default for every existing
-- row). The UI also treats whitespace-only strings as empty so users
-- don't end up with an "empty" preview row.

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE list_items
  ADD COLUMN IF NOT EXISTS description TEXT;
