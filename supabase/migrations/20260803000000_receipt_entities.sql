-- Receipts as first-class entities (PR1 of the receipt-split plan).
--
-- Until now a scanned fiscal receipt lived only as columns on its single
-- `expenses` row (receipt_url + merchant) plus a snapshot child table
-- `expense_items`. To let ONE receipt be split into SEVERAL expenses (part
-- "Namirnice", part "Alat", ...) the receipt itself becomes a row:
--
--   receipts       - one row per scanned fiscal receipt (globally-unique URL)
--   receipt_items  - one row per receipt line; `expense_id` records which
--                    expense "claimed" the line (NULL = unclaimed)
--   expenses       - gains `receipt_id`; several expenses may share a receipt
--
-- This migration is the FOUNDATION only - behavior stays 1 receipt = 1
-- expense (the save RPC claims every line). The split UI (partial claims,
-- re-scan shows remaining lines) is the next PR; the claim column and the
-- per-line uniqueness are what make its dedup structural instead of
-- heuristic.
--
-- Design notes:
--
--   * Uniqueness moves from expenses.receipt_url to receipts.receipt_url,
--     still GLOBAL (not per-family) for the same reason as before (see
--     20260716000000_receipt_import.sql): the SUF token is globally unique
--     and a cross-family re-scan must stay a friendly "already added", never
--     a double-counted ledger row. expenses.receipt_url remains (written for
--     compatibility + the open-receipt link + duplicate-jump lookup) but
--     its index is now a plain lookup index.
--
--   * Claiming a line = setting receipt_items.expense_id. The FK is
--     ON DELETE SET NULL, so deleting an expense RELEASES its lines (and the
--     receipt row survives); the save RPC can then re-use such an orphaned
--     receipt when the same URL is scanned again - preserving today's
--     "delete the expense, re-scan works" behavior.
--
--   * expense_items is KEPT (frozen) for now: already-deployed PWA clients
--     still read/write it until their service worker updates. New clients
--     never touch it. Dropping it (+ expenses.receipt_checked_at) is a later
--     cleanup migration once the fleet has moved.
--
--   * Neither new table joins the family broadcast channel (see
--     20260729010000_family_broadcast_channel.sql) - same reasoning as
--     expense_items: lines are a lazily-loaded snapshot, and every mutation
--     that matters to other screens also touches `expenses`, which already
--     broadcasts. Keep this in sync with TABLE_INVALIDATIONS if that ever
--     changes.

-- ---------------------------------------------------------------------------
-- 1. receipts - one row per scanned fiscal receipt.
--    total_amount / issued_on are the receipt's own facts (an expense's
--    amount/spent_on will diverge from them once splitting lands). pib /
--    company_name / store_name were parsed all along but thrown away; start
--    keeping them (backfilled rows have NULL - the parse isn't stored).
-- ---------------------------------------------------------------------------
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  receipt_url TEXT NOT NULL,
  merchant TEXT NULL,
  pib TEXT NULL,
  company_name TEXT NULL,
  store_name TEXT NULL,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  issued_on DATE NOT NULL,
  -- The last refresh-items claim (a server-enforced cooldown) - moves here from
  -- expenses.receipt_checked_at because a refresh is a property of the
  -- RECEIPT, not of one expense carved out of it.
  checked_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Scan-twice dedup, global on purpose (see header).
CREATE UNIQUE INDEX idx_receipts_receipt_url ON receipts(receipt_url);

-- ---------------------------------------------------------------------------
-- 2. receipt_items - one row per receipt line. `idx` is the line's position
--    in the parsed journal (stable identity within the receipt; UNIQUE with
--    receipt_id so a line can never be stored - or claimed - twice).
--    `total` is authoritative (discount-safe); quantity/unit_price are
--    best-effort, exactly like expense_items was.
-- ---------------------------------------------------------------------------
CREATE TABLE receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  -- Denormalized family scope for a join-free RLS policy (house pattern).
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(12, 3),
  unit_price NUMERIC(12, 2),
  total NUMERIC(12, 2) NOT NULL,
  -- The claim: which expense owns this line. NULL = up for grabs (only
  -- possible after its expense is deleted until the split UI lands).
  expense_id UUID NULL REFERENCES expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (receipt_id, idx)
);

-- Reads are "lines of THIS expense" (detail, counts, search join).
CREATE INDEX idx_receipt_items_expense
  ON receipt_items(expense_id)
  WHERE expense_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. expenses.receipt_id + index swap on receipt_url.
-- ---------------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS receipt_id UUID NULL REFERENCES receipts(id) ON DELETE SET NULL;

-- "Which expenses came from this receipt" (orphan check in the save RPC,
-- sibling lookup in the split UI later).
CREATE INDEX idx_expenses_receipt_id
  ON expenses(receipt_id)
  WHERE receipt_id IS NOT NULL;

-- Uniqueness now lives on receipts.receipt_url; keep a plain index for the
-- duplicate-jump lookup (fetchExpenseByReceiptUrl).
DROP INDEX IF EXISTS idx_expenses_receipt_url;
CREATE INDEX idx_expenses_receipt_url
  ON expenses(receipt_url)
  WHERE receipt_url IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. RLS - the standard four family-scoped one-liners, both tables.
-- ---------------------------------------------------------------------------
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family receipts" ON receipts FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family receipts" ON receipts FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family receipts" ON receipts FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family receipts" ON receipts FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view own family receipt_items" ON receipt_items FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family receipt_items" ON receipt_items FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family receipt_items" ON receipt_items FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family receipt_items" ON receipt_items FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Backfill - today every receipt expense is exactly one whole receipt, so
--    the mapping is mechanical: expense -> receipts row, its expense_items ->
--    receipt_items claimed by it. User triggers on expenses are disabled for
--    the receipt_id UPDATE so the backfill neither bumps updated_at nor spams
--    the family broadcast topic with one message per historical receipt.
-- ---------------------------------------------------------------------------
ALTER TABLE expenses DISABLE TRIGGER USER;

INSERT INTO receipts
  (family_id, receipt_url, merchant, total_amount, issued_on, checked_at, created_at)
SELECT e.family_id, e.receipt_url, e.merchant, e.amount, e.spent_on,
       e.receipt_checked_at, e.created_at
FROM expenses e
WHERE e.receipt_url IS NOT NULL;

UPDATE expenses e
SET receipt_id = r.id
FROM receipts r
WHERE e.receipt_url = r.receipt_url;

-- ROW_NUMBER instead of trusting sort_order: guarantees the UNIQUE
-- (receipt_id, idx) even if any legacy rows shared a sort_order.
INSERT INTO receipt_items
  (receipt_id, family_id, idx, name, quantity, unit_price, total, expense_id, created_at)
SELECT e.receipt_id, i.family_id,
       (ROW_NUMBER() OVER (PARTITION BY i.expense_id
                           ORDER BY i.sort_order, i.created_at, i.id)) - 1,
       i.name, i.quantity, i.unit_price, i.total, i.expense_id, i.created_at
FROM expense_items i
JOIN expenses e ON e.id = i.expense_id
WHERE e.receipt_id IS NOT NULL;

ALTER TABLE expenses ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- 6. save_receipt_expense - the transactional save for a scanned receipt.
--    Replaces the client's two best-effort inserts (expense, then items) with
--    one atomic call: receipt row (insert or orphan re-use), expense row,
--    claimed lines. All-or-nothing, so "the expense saved but the items did not"
--    can no longer happen.
--
--    SECURITY INVOKER on purpose - every statement runs under the caller's
--    RLS, and family_id comes from their profile, never from the payload.
--
--    Returns {status:'saved', expense_id} or {status:'duplicate'}. The
--    duplicate arm covers, in one place:
--      - the receipt already claimed by a live expense of this family,
--      - a concurrent save racing this one (unique_violation on the URL),
--      - another FAMILY's receipt (RLS hides their row, the global unique
--        index still rejects ours) - same UX as the old global index gave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_receipt_expense(
  p_receipt JSONB,
  p_expense JSONB,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family UUID;
  v_receipt_url TEXT := p_receipt->>'receipt_url';
  v_receipt_id UUID;
  v_expense_id UUID;
BEGIN
  SELECT family_id INTO v_family FROM profiles WHERE id = auth.uid();
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'Nema porodice';
  END IF;
  IF v_receipt_url IS NULL OR v_receipt_url = '' THEN
    RAISE EXCEPTION 'Nedostaje link računa';
  END IF;

  -- FOR UPDATE serializes two same-family saves of the same receipt: the
  -- second waits here, then sees the first one's expense and reports
  -- 'duplicate' instead of tripping over its lines.
  SELECT r.id INTO v_receipt_id
  FROM receipts r
  WHERE r.receipt_url = v_receipt_url
  FOR UPDATE;

  IF v_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM expenses e WHERE e.receipt_id = v_receipt_id)
       OR EXISTS (SELECT 1 FROM receipt_items ri
                  WHERE ri.receipt_id = v_receipt_id AND ri.expense_id IS NOT NULL)
    THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
    -- Orphan (its expense was deleted, lines released): refresh the snapshot
    -- from the fresh parse and fall through to claim it anew.
    DELETE FROM receipt_items WHERE receipt_id = v_receipt_id;
    UPDATE receipts
    SET merchant = p_receipt->>'merchant',
        pib = p_receipt->>'pib',
        company_name = p_receipt->>'company_name',
        store_name = p_receipt->>'store_name',
        total_amount = (p_receipt->>'total_amount')::NUMERIC,
        issued_on = (p_receipt->>'issued_on')::DATE
    WHERE id = v_receipt_id;
  ELSE
    BEGIN
      INSERT INTO receipts
        (family_id, receipt_url, merchant, pib, company_name, store_name,
         total_amount, issued_on)
      VALUES
        (v_family, v_receipt_url, p_receipt->>'merchant', p_receipt->>'pib',
         p_receipt->>'company_name', p_receipt->>'store_name',
         (p_receipt->>'total_amount')::NUMERIC, (p_receipt->>'issued_on')::DATE)
      RETURNING id INTO v_receipt_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END;
  END IF;

  INSERT INTO expenses
    (family_id, amount, spent_on, category_id, person_id, note, currency,
     source, merchant, receipt_url, receipt_id, activity_id, event_id)
  VALUES
    (v_family,
     (p_expense->>'amount')::NUMERIC,
     (p_expense->>'spent_on')::DATE,
     (p_expense->>'category_id')::UUID,
     (p_expense->>'person_id')::UUID,
     p_expense->>'note',
     'RSD',
     'receipt',
     p_receipt->>'merchant',
     v_receipt_url,
     v_receipt_id,
     (p_expense->>'activity_id')::UUID,
     (p_expense->>'event_id')::UUID)
  RETURNING id INTO v_expense_id;

  -- PR1 claims every line for the single expense; the split UI will pass a
  -- subset per expense here.
  INSERT INTO receipt_items
    (receipt_id, family_id, idx, name, quantity, unit_price, total, expense_id)
  SELECT v_receipt_id, v_family,
         (it->>'idx')::INTEGER,
         it->>'name',
         (it->>'quantity')::NUMERIC,
         (it->>'unit_price')::NUMERIC,
         (it->>'total')::NUMERIC,
         v_expense_id
  FROM jsonb_array_elements(p_items) AS it;

  RETURN jsonb_build_object('status', 'saved', 'expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. claim_receipt_refresh v2 - same contract as v1 (the Edge Function is
--    NOT redeployed: {status:'claimed'|'not_found'|'too_soon',
--    retry_after_seconds}), but the cooldown now lives on receipts.checked_at.
--
--    Self-heal: an expense imported by an old client AFTER this migration has
--    receipt_url but no receipts row. The first refresh of its items creates
--    the receipt from the expense snapshot, links receipt_id, and ports any
--    legacy expense_items - so stragglers converge without manual fixes.
--
--    expenses.receipt_checked_at is still mirrored on claim: deployed clients
--    render their countdown from it, and the expenses UPDATE also rides the
--    broadcast channel, refreshing the other devices' view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_receipt_refresh(p_receipt_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cooldown CONSTANT INTERVAL := INTERVAL '180 seconds';
  v_receipt RECORD;
BEGIN
  SELECT id, checked_at INTO v_receipt
  FROM receipts
  WHERE receipt_url = p_receipt_url;

  IF NOT FOUND THEN
    -- Straggler from an old client: build the receipt from its expense.
    INSERT INTO receipts
      (family_id, receipt_url, merchant, total_amount, issued_on, checked_at, created_at)
    SELECT e.family_id, e.receipt_url, e.merchant, e.amount, e.spent_on,
           e.receipt_checked_at, e.created_at
    FROM expenses e
    WHERE e.receipt_url = p_receipt_url
    ORDER BY e.created_at
    LIMIT 1
    ON CONFLICT (receipt_url) DO NOTHING;

    SELECT id, checked_at INTO v_receipt
    FROM receipts
    WHERE receipt_url = p_receipt_url;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;

    UPDATE expenses
    SET receipt_id = v_receipt.id
    WHERE receipt_url = p_receipt_url AND receipt_id IS NULL;

    INSERT INTO receipt_items
      (receipt_id, family_id, idx, name, quantity, unit_price, total, expense_id, created_at)
    SELECT v_receipt.id, i.family_id,
           (ROW_NUMBER() OVER (ORDER BY i.sort_order, i.created_at, i.id)) - 1,
           i.name, i.quantity, i.unit_price, i.total, i.expense_id, i.created_at
    FROM expense_items i
    JOIN expenses e ON e.id = i.expense_id
    WHERE e.receipt_url = p_receipt_url
    ON CONFLICT (receipt_id, idx) DO NOTHING;
  END IF;

  UPDATE receipts
  SET checked_at = now()
  WHERE id = v_receipt.id
    AND (checked_at IS NULL OR checked_at < now() - v_cooldown);
  IF FOUND THEN
    UPDATE expenses
    SET receipt_checked_at = now()
    WHERE receipt_id = v_receipt.id;
    RETURN jsonb_build_object('status', 'claimed');
  END IF;

  RETURN jsonb_build_object(
    'status', 'too_soon',
    'retry_after_seconds', GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (COALESCE(v_receipt.checked_at, now()) + v_cooldown - now())))::INT
    )
  );
END;
$$;
