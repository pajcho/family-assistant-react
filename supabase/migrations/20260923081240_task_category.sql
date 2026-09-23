-- Shop department of a task, decided by Jev in the categorize-tasks edge
-- function and stored on the row.
--
-- Replaces the 351-stem keyword dictionary in src/lib/groceryCategorize.ts,
-- which ran on the client at render time, stored nothing, and needed a human to
-- add every new product by hand.
--
--   category             English key ('dairy', 'pantry', ..., 'other'). NULL
--                        means "not decided yet": never asked, the model was
--                        unreachable, or the name changed since. The client
--                        renders NULL under "Ostalo" and asks again on a later
--                        visit, so a failed call never blocks anybody and heals
--                        itself once the model is back.
--   category_confidence  The model's confidence behind `category`, 0..1. Kept
--                        so the cut-off can be re-tuned against real rows
--                        without asking the model again.
--
-- No CHECK on the key set, on purpose. The set is owned by the edge function's
-- prompt and the client's labels, which
-- supabase/functions/_shared/shopCategories.parity.test.ts keeps equal. A copy
-- here would be a third place to edit for every new department, and the client
-- already reads an unknown key as 'other'.

ALTER TABLE tasks
  ADD COLUMN category TEXT,
  ADD COLUMN category_confidence REAL;

COMMENT ON COLUMN tasks.category IS
  'Shop department key decided by categorize-tasks. NULL = not decided yet, shown under Ostalo.';
COMMENT ON COLUMN tasks.category_confidence IS
  'Model confidence (0..1) behind tasks.category.';

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: update_task_audit_fields(), otherwise unchanged from
-- 20260811000000_tasks.sql. Two additions:
--
-- 1. A write that changes ONLY the category is the edge function filing the
--    item, not an edit anybody made. categorize-tasks runs with the session of
--    whoever opened the list, so stamping here would credit that person with
--    editing every item they merely looked at, and move "Poslednja izmena" on
--    rows nobody touched. Such a write returns before the stamp.
--
--    The guard also requires the category to have actually changed, so a
--    genuine no-op UPDATE still stamps exactly as it did before.
--
-- 2. A rename invalidates the category ("Mleko" filed as dairy says nothing
--    about what it was renamed to). Clearing it here instead of in the client
--    covers every write path; the next visit files the item again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_task_audit_fields()
RETURNS TRIGGER AS $$
DECLARE
  parent_scope TEXT;
BEGIN
  IF (NEW.category IS DISTINCT FROM OLD.category
      OR NEW.category_confidence IS DISTINCT FROM OLD.category_confidence)
     AND (to_jsonb(NEW) - 'category' - 'category_confidence')
       = (to_jsonb(OLD) - 'category' - 'category_confidence') THEN
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  NEW.updated_by_id = COALESCE(auth.uid(), OLD.updated_by_id, NEW.updated_by_id);

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    NEW.category = NULL;
    NEW.category_confidence = NULL;
  END IF;

  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    IF NEW.list_id IS NOT NULL THEN
      SELECT l.scope INTO parent_scope FROM lists l WHERE l.id = NEW.list_id;
      IF parent_scope IS NOT NULL THEN
        NEW.scope = parent_scope;
      END IF;
    ELSIF NEW.owner_id IS NULL THEN
      NEW.owner_id = COALESCE(auth.uid(), OLD.created_by_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE: bump_parent_list_on_item_change(), otherwise
-- unchanged from 20260811000000_tasks.sql. It reads any task write as
-- "somebody used this list" and promotes the list in the recents order. Filing
-- an item is not use, so a category-only write skips the bump, with the same
-- guard as above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_parent_list_on_item_change()
RETURNS TRIGGER AS $$
DECLARE
  old_list_id UUID;
  new_list_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.category IS DISTINCT FROM OLD.category
          OR NEW.category_confidence IS DISTINCT FROM OLD.category_confidence)
     AND (to_jsonb(NEW) - 'category' - 'category_confidence')
       = (to_jsonb(OLD) - 'category' - 'category_confidence') THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    old_list_id := OLD.list_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_list_id := NEW.list_id;
  END IF;

  -- A listless task has no parent to promote.
  IF old_list_id IS NULL AND new_list_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE lists
    SET updated_at = NOW(),
        updated_by_id = COALESCE(auth.uid(), updated_by_id)
    WHERE (old_list_id IS NOT NULL AND id = old_list_id)
       OR (new_list_id IS NOT NULL AND id = new_list_id);
  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;
