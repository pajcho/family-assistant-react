-- Friendly names for receipt merchants.
--
-- The name on a fiscal receipt is the registered shop name ("STEFAN PRO 95",
-- "NICEFOODS DOO BEOGRAD OGRANAK"), which often is not what the family calls
-- the place ("Market kod škole", "McDonalds"). A family can give a merchant its
-- own display name once, and every expense from that merchant - past and
-- future - is then shown under it, with the receipt name kept as secondary
-- info.
--
-- Keyed by the exact `merchant` string, the same key the merchant -> category
-- memory already uses (see idx_expenses_family_merchant). The alias lives in
-- its own table instead of on `expenses`/`receipts` so one rename covers every
-- row from the merchant and a newly scanned receipt picks it up with no write.
-- Optional: no row means the receipt name is shown as before.

CREATE TABLE merchant_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 80),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (family_id, merchant)
);

COMMENT ON TABLE merchant_aliases IS
  'Family-chosen display name for a receipt merchant (expenses.merchant), applied to every expense from it.';
COMMENT ON COLUMN merchant_aliases.merchant IS
  'Exact merchant name as stored on expenses.merchant / receipts.merchant.';
COMMENT ON COLUMN merchant_aliases.display_name IS
  'Name shown in the app instead of the receipt name.';

DROP TRIGGER IF EXISTS update_merchant_aliases_updated_at ON merchant_aliases;
CREATE TRIGGER update_merchant_aliases_updated_at
  BEFORE UPDATE ON merchant_aliases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE merchant_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own family merchant_aliases" ON merchant_aliases FOR SELECT
  USING (family_id = auth_user_family_id());
CREATE POLICY "Users insert own family merchant_aliases" ON merchant_aliases FOR INSERT
  WITH CHECK (family_id = auth_user_family_id());
CREATE POLICY "Users update own family merchant_aliases" ON merchant_aliases FOR UPDATE
  USING (family_id = auth_user_family_id());
CREATE POLICY "Users delete own family merchant_aliases" ON merchant_aliases FOR DELETE
  USING (family_id = auth_user_family_id());

-- Join the family broadcast channel so a rename shows up for the other members
-- right away. Keep in sync with TABLE_INVALIDATIONS in
-- src/hooks/useFamilyChannel.ts.
DROP TRIGGER IF EXISTS broadcast_family_change ON merchant_aliases;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON merchant_aliases
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();
