-- Lists feature: a flexible to-do model that replaces the old
-- "planned expenses" page.
--
-- Each list has a scope ('personal' = owner-only, 'family' = visible to
-- the whole family) and any number of checklist items. Audit columns
-- (`owner_id` for creator on lists; `created_by_id` + `updated_by_id` on
-- list_items; `updated_by_id` on lists) feed the info-panel UI and the
-- "most recently used at the top" sort order.
--
-- The previous expenses table is dropped — its single-amount-per-row
-- shape doesn't map onto the new generic checklist shape, and no
-- production data depends on a migration path.
--
-- This migration is the consolidated source of truth for the feature.
-- It supersedes the three intermediate migrations from local development
-- (lists_feature + lists_audit_fields + profile_family_policy_fix);
-- production should only ever see this single file.

DROP TABLE IF EXISTS expenses CASCADE;

-- ---------------------------------------------------------------------------
-- Helper: caller's family_id, RLS-bypassing
-- ---------------------------------------------------------------------------
-- Used by the family-wide profile SELECT policy below. Defined first
-- because the policy at the bottom of the migration depends on it.
--
-- `SECURITY DEFINER` is the important bit: a naive policy of
--   `family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())`
-- triggers RLS on the inner SELECT, which re-evaluates the same policy
-- and recurses infinitely. Wrapping the lookup in a definer function
-- bypasses RLS for the subquery while still keying off `auth.uid()`, so
-- the result is identical for an authorised caller without the loop.
--
-- `STABLE` lets Postgres inline the call once per query; `search_path`
-- is pinned to `public` so a hostile schema can't shadow `profiles`.

CREATE OR REPLACE FUNCTION auth_user_family_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION auth_user_family_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_user_family_id() TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- Creator of the list. Also the access guard for personal-scope lists.
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Last person to modify the list (metadata or items inside it). NULL on
  -- initial INSERT; populated by the BEFORE UPDATE trigger and the AFTER
  -- trigger on list_items.
  updated_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'family' CHECK (scope IN ('personal', 'family')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lists_family_id ON lists(family_id);
CREATE INDEX IF NOT EXISTS idx_lists_owner_id ON lists(owner_id);
CREATE INDEX IF NOT EXISTS idx_lists_family_sort ON lists(family_id, sort_order);
-- "Most recently updated first" — drives the order on the dashboard card
-- and the overview page. DESC index matches the query direction.
CREATE INDEX IF NOT EXISTS idx_lists_updated_at ON lists(updated_at DESC);

CREATE TABLE IF NOT EXISTS list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  -- Denormalised so the realtime channel can filter by family_id directly
  -- (matches every other table that goes through realtime). Auto-filled
  -- from the parent list by the BEFORE INSERT trigger.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Audit columns: who added this item, who last touched it.
  created_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_list_items_list_id ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_family_id ON list_items(family_id);
CREATE INDEX IF NOT EXISTS idx_list_items_list_sort ON list_items(list_id, sort_order);

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

-- BEFORE INSERT on list_items: fill in family_id from the parent list, and
-- stamp the calling user as both creator and (initial) updater. This means
-- the client only has to send `list_id` + `name` — everything else falls
-- out from the request context.
CREATE OR REPLACE FUNCTION set_list_item_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.family_id IS NULL THEN
    SELECT family_id INTO NEW.family_id FROM lists WHERE id = NEW.list_id;
  END IF;
  IF NEW.created_by_id IS NULL THEN
    NEW.created_by_id = auth.uid();
  END IF;
  IF NEW.updated_by_id IS NULL THEN
    NEW.updated_by_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE UPDATE on lists / list_items: bump updated_at and re-stamp
-- updated_by_id. COALESCE chain handles the case where this fires from a
-- service-role connection (auth.uid() returns NULL) — we fall back to the
-- previous author so we don't blow away a known value.
CREATE OR REPLACE FUNCTION update_list_audit_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by_id = COALESCE(auth.uid(), OLD.updated_by_id, NEW.updated_by_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- AFTER INSERT/UPDATE/DELETE on list_items: bubble the change up so the
-- parent list's updated_at + updated_by_id reflect the activity. Without
-- this, "sort by recently used" wouldn't promote a list when a member
-- added an item to it — only when they renamed the list itself.
CREATE OR REPLACE FUNCTION bump_parent_list_on_item_change()
RETURNS TRIGGER AS $$
DECLARE
  target_list_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_list_id := OLD.list_id;
  ELSE
    target_list_id := NEW.list_id;
  END IF;
  UPDATE lists
    SET updated_at = NOW(),
        updated_by_id = COALESCE(auth.uid(), updated_by_id)
    WHERE id = target_list_id;
  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER set_list_item_defaults_trigger
  BEFORE INSERT ON list_items
  FOR EACH ROW EXECUTE FUNCTION set_list_item_defaults();

CREATE TRIGGER update_lists_audit
  BEFORE UPDATE ON lists
  FOR EACH ROW EXECUTE FUNCTION update_list_audit_fields();

CREATE TRIGGER update_list_items_audit
  BEFORE UPDATE ON list_items
  FOR EACH ROW EXECUTE FUNCTION update_list_audit_fields();

CREATE TRIGGER bump_parent_list_on_item_change
  AFTER INSERT OR UPDATE OR DELETE ON list_items
  FOR EACH ROW EXECUTE FUNCTION bump_parent_list_on_item_change();

-- ---------------------------------------------------------------------------
-- RLS — lists + list_items
-- ---------------------------------------------------------------------------

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;

-- Lists: family-scope lists are visible to every profile in that family;
-- personal-scope lists are owner-only.
CREATE POLICY "Users view accessible lists" ON lists FOR SELECT USING (
  (scope = 'family' AND family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()))
  OR (scope = 'personal' AND owner_id = auth.uid())
);
CREATE POLICY "Users create lists in own family" ON lists FOR INSERT WITH CHECK (
  family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
  AND owner_id = auth.uid()
);
CREATE POLICY "Users update accessible lists" ON lists FOR UPDATE USING (
  (scope = 'family' AND family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()))
  OR (scope = 'personal' AND owner_id = auth.uid())
);
CREATE POLICY "Users delete accessible lists" ON lists FOR DELETE USING (
  (scope = 'family' AND family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()))
  OR (scope = 'personal' AND owner_id = auth.uid())
);

-- List items: visibility mirrors the parent list. We piggy-back on the
-- lists RLS via an EXISTS subquery — if RLS hides the parent list, the
-- subquery is empty and the item is hidden / write rejected too.
CREATE POLICY "Users view items in accessible lists" ON list_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM lists WHERE lists.id = list_items.list_id)
);
CREATE POLICY "Users insert items in accessible lists" ON list_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM lists WHERE lists.id = list_items.list_id)
);
CREATE POLICY "Users update items in accessible lists" ON list_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM lists WHERE lists.id = list_items.list_id)
);
CREATE POLICY "Users delete items in accessible lists" ON list_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM lists WHERE lists.id = list_items.list_id)
);

-- ---------------------------------------------------------------------------
-- RLS — family-wide profile visibility (for the audit info panel)
-- ---------------------------------------------------------------------------
-- The original "Users can view own profile" policy from the initial schema
-- is too tight for the audit UI — we need to render other family members'
-- names alongside their UUIDs. Add an OR-ed policy that exposes every
-- profile sharing the caller's family_id. SELECT policies stack via
-- Postgres' default "any policy can permit" RLS semantics.

CREATE POLICY "Users can view family profiles" ON profiles FOR SELECT USING (
  family_id = auth_user_family_id()
);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
-- Supabase Cloud auto-adds new tables to `supabase_realtime`, but being
-- explicit keeps local CLI and self-hosted deploys consistent. The
-- DO/EXCEPTION wrapper is defensive — adding a table that's already a
-- member raises `duplicate_object`, which we treat as success.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE lists;
    ALTER PUBLICATION supabase_realtime ADD TABLE list_items;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
