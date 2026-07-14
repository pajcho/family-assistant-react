-- Faza 5 (receipt scanning) — import a Serbian fiscal receipt (SUF/PURS) into the
-- budget. The `receipt-import` Edge Function fetches + parses the public
-- suf.purs.gov.rs verification page and returns the parsed data; the CLIENT then
-- saves it through the normal `expenses` insert path (so RLS/mutations stay
-- uniform — no service-role DB writes from the function). This migration adds the
-- two columns a receipt expense needs plus a child `expense_items` table for the
-- per-line breakdown.
--
-- Design notes:
--
--   • `source='receipt'` already exists on `expenses` (added in the budget
--     migration's CHECK), so no CHECK change is needed here — we only add the
--     receipt-specific columns.
--
--   • Dedup ("scan the same receipt twice"): a PARTIAL UNIQUE index on
--     `receipt_url` alone (NOT composite with family_id). Reasoning — every SUF
--     receipt URL carries a globally-unique verification token (`?vl=<token>`),
--     so the URL is already unique across the whole system; adding family_id
--     would be redundant AND would let two families import the identical physical
--     receipt as two separate ledger rows (a double-count if the receipt were
--     ever shared). The tradeoff of the global index: if family B scans a receipt
--     family A already imported, B hits the unique violation but RLS hides A's
--     row, so B's "jump to that month" UX finds nothing and we just show the
--     friendly "already added" dialog without navigation. That cross-family
--     collision is pathological (families don't share fiscal receipts), so the
--     simpler global index is the right call. WHERE receipt_url IS NOT NULL keeps
--     every manual/payment row (receipt_url NULL) out of the uniqueness check.
--
--   • `expense_items` is family-scoped for RLS symmetry with every sibling table,
--     even though it could reach family scope transitively through `expense_id`.
--     Carrying `family_id` directly keeps the RLS policy a one-liner (no join)
--     and matches how activity_participants / payment_participants are scoped.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Receipt columns on `expenses`.
--    merchant     — display name parsed from the receipt (store name, e.g.
--                   "ZARA TC USCE"); also the key for merchant→category memory.
--    receipt_url  — the canonical suf.purs.gov.rs/v/?vl=<token> link; opened
--                   from the expense detail ("Otvori račun ↗") and the dedup key.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS merchant TEXT NULL,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT NULL;

-- Scan-twice dedup. Global (not per-family) because the receipt token is already
-- globally unique — see the design note above.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_receipt_url
  ON expenses(receipt_url)
  WHERE receipt_url IS NOT NULL;

-- Merchant→category memory lookup ("did we ever categorize a receipt from this
-- store?"). Family-scoped + partial so only receipt rows are indexed.
CREATE INDEX IF NOT EXISTS idx_expenses_family_merchant
  ON expenses(family_id, merchant)
  WHERE merchant IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. expense_items — one row per receipt line. Loaded WITH the parent expense
--    when its detail opens (lazy), never live-synced on its own.
--    quantity / unit_price are best-effort (nullable): the parser guarantees a
--    line `total` but the price×qty split can be missing on odd receipt layouts.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE expense_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  -- Denormalized family scope for a join-free RLS policy (see design note).
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity NUMERIC(12, 3),
  unit_price NUMERIC(12, 2),
  total NUMERIC(12, 2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_expense_items_expense ON expense_items(expense_id);

ALTER TABLE expense_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family expense_items" ON expense_items FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family expense_items" ON expense_items FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family expense_items" ON expense_items FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family expense_items" ON expense_items FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- NOTE: expense_items is deliberately NOT added to the supabase_realtime
-- publication. Items are immutable snapshots of a receipt and are fetched lazily
-- alongside their parent expense the moment its detail opens — there is nothing
-- to live-sync (the parent `expenses` row already streams over realtime, and a
-- receipt's lines never change after import). Keeping it off the publication
-- avoids needless WAL traffic + client channel churn.
