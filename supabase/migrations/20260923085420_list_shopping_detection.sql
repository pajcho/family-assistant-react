-- Whether a list is a shopping list, judged by Jev in the detect-shopping-list
-- edge function, so "Po rafovima" can be offered (and suggested) for any list
-- that is one, whatever it is called.
--
-- Replaces the list-name regex in src/lib/shopCategories.ts, which knew
-- "Shopping" but not "za kupiti", and could not tell a meal diary full of food
-- from a list of things to buy.
--
--   shopping_likelihood         Jev's probability that this is a list of things
--                               to buy, 0..1. NULL = never judged.
--   shopping_checked_items      How many items the list had when it was last
--                               judged. The next check waits until the list has
--                               doubled, so an early "no" on a two-item list can
--                               still turn into a "yes" as it grows, at most
--                               log2(n) calls per list.
--   aisle_suggestion_dismissed  The family has answered the suggestion: closed
--                               it, or turned aisle sorting on or off by hand.
--                               Either way it is not offered again.

ALTER TABLE lists
  ADD COLUMN shopping_likelihood REAL,
  ADD COLUMN shopping_checked_items INTEGER,
  ADD COLUMN aisle_suggestion_dismissed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN lists.shopping_likelihood IS
  'Probability (0..1) that this is a shopping list, judged by detect-shopping-list. NULL = never judged.';
COMMENT ON COLUMN lists.shopping_checked_items IS
  'Item count at the last shopping-list judgement; the next one waits until the list has doubled.';
COMMENT ON COLUMN lists.aisle_suggestion_dismissed IS
  'The "Po rafovima" suggestion was answered (closed, or smart sort toggled by hand) and stays hidden.';

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: update_list_audit_fields(), otherwise unchanged from
-- 20260520200000_lists_feature.sql. Only `lists` uses it since list_items
-- became tasks, but the guard still reads the row through to_jsonb so it can
-- never trip "record new has no field".
--
-- Judging a list and closing the suggestion are not edits to the list. The
-- judgement runs on the session of whoever added the item, so stamping would
-- credit them with changing the list, and a moved `updated_at` would reorder
-- the recents. A write that touches ONLY these columns skips the stamp. A write
-- that also changes something real (turning smart sort on together with
-- closing the suggestion, say) stamps as before, and the guard requires one of
-- these columns to have actually changed, so a genuine no-op still stamps too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_list_audit_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) -> 'shopping_likelihood') IS DISTINCT FROM (to_jsonb(OLD) -> 'shopping_likelihood')
     OR (to_jsonb(NEW) -> 'shopping_checked_items') IS DISTINCT FROM (to_jsonb(OLD) -> 'shopping_checked_items')
     OR (to_jsonb(NEW) -> 'aisle_suggestion_dismissed') IS DISTINCT FROM (to_jsonb(OLD) -> 'aisle_suggestion_dismissed') THEN
    IF (to_jsonb(NEW) - 'shopping_likelihood' - 'shopping_checked_items' - 'aisle_suggestion_dismissed')
       = (to_jsonb(OLD) - 'shopping_likelihood' - 'shopping_checked_items' - 'aisle_suggestion_dismissed') THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.updated_at = NOW();
  NEW.updated_by_id = COALESCE(auth.uid(), OLD.updated_by_id, NEW.updated_by_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
