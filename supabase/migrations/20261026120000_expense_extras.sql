-- Expense extras: money spent together with a receipt but missing from it.
--
-- The case: dinner at a restaurant, the fiscal receipt gets scanned, and the
-- cash tip left on the table is on no receipt at all. Until now the tip was a
-- second, unrelated hand-typed expense. An extra is still its own expense row
-- (so every total, filter and category sum keeps working unchanged), but it
-- points at the expense it belongs to through `parent_expense_id`, and the UI
-- shows the two as one spend.
--
-- Why a separate row and not a line on the receipt: receipt_items are the
-- fiscal receipt's own facts, and the split RPC relies on an expense's claimed
-- lines summing exactly to its amount. A tip on the receipt expense would break
-- both. A sibling row breaks neither.
--
--   1. expenses.parent_expense_id - ON DELETE CASCADE: an extra exists only
--      as part of its parent ("the tip at that dinner"), so deleting the
--      dinner deletes the tip too.
--   2. Inheritance triggers - an extra takes its parent's date, category,
--      person and link when it is created, and follows the parent when those
--      change later. That keeps the pair in the same day group and the same
--      filters. The extra itself stays editable.
--   3. save_receipt_expense - accepts p_expense.extras ([{amount, note}]) and
--      inserts them in the same transaction as the receipt expense. Older
--      clients never send the key and keep the exact previous behavior.

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS parent_expense_id UUID NULL REFERENCES expenses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_expenses_parent_expense
  ON expenses(parent_expense_id)
  WHERE parent_expense_id IS NOT NULL;

COMMENT ON COLUMN expenses.parent_expense_id IS
  'Set on an extra (e.g. a cash tip) that belongs to another expense, typically a scanned receipt. The extra inherits the parent''s date, category, person and link. One level only.';

-- ---------------------------------------------------------------------------
-- 2a. A new extra copies its parent's shared fields. One level only (an extra
--     cannot be a parent), same family only. Runs as the caller, so RLS
--     already hides other families' parents - the family check is a backstop.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_extra_inherit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent public.expenses%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM public.expenses WHERE id = NEW.parent_expense_id;
  IF NOT FOUND OR parent.family_id <> NEW.family_id THEN
    RAISE EXCEPTION 'Trošak nije pronađen';
  END IF;
  IF parent.parent_expense_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dodatak ne može da ima svoj dodatak';
  END IF;

  NEW.spent_on := parent.spent_on;
  NEW.category_id := parent.category_id;
  NEW.person_id := parent.person_id;
  NEW.activity_id := parent.activity_id;
  NEW.event_id := parent.event_id;
  NEW.birthday_id := parent.birthday_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_extra_inherit ON expenses;
CREATE TRIGGER trg_expense_extra_inherit
  BEFORE INSERT ON expenses
  FOR EACH ROW
  WHEN (NEW.parent_expense_id IS NOT NULL)
  EXECUTE FUNCTION public.expense_extra_inherit();

-- ---------------------------------------------------------------------------
-- 2b. Editing the parent carries the shared fields over to its extras, so a
--     recategorized or re-dated receipt never leaves its tip behind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expense_extra_follow_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.expenses
  SET
    spent_on = NEW.spent_on,
    category_id = NEW.category_id,
    person_id = NEW.person_id,
    activity_id = NEW.activity_id,
    event_id = NEW.event_id,
    birthday_id = NEW.birthday_id
  WHERE parent_expense_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_extra_follow_parent ON expenses;
CREATE TRIGGER trg_expense_extra_follow_parent
  AFTER UPDATE ON expenses
  FOR EACH ROW
  WHEN (
    OLD.spent_on IS DISTINCT FROM NEW.spent_on
    OR OLD.category_id IS DISTINCT FROM NEW.category_id
    OR OLD.person_id IS DISTINCT FROM NEW.person_id
    OR OLD.activity_id IS DISTINCT FROM NEW.activity_id
    OR OLD.event_id IS DISTINCT FROM NEW.event_id
    OR OLD.birthday_id IS DISTINCT FROM NEW.birthday_id
  )
  EXECUTE FUNCTION public.expense_extra_follow_parent();

-- ---------------------------------------------------------------------------
-- 3. save_receipt_expense - same signature and body as the version in
--    20261022120000_expenses_birthday_link.sql, plus p_expense.extras.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_receipt_expense(
  p_receipt JSONB,
  p_expense JSONB,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_claim_idxs INT[] DEFAULT NULL
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
  v_has_claims BOOLEAN;
  v_free_count INTEGER;
  v_claimed INTEGER;
BEGIN
  SELECT family_id INTO v_family FROM profiles WHERE id = auth.uid();
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'Nema porodice';
  END IF;
  IF v_receipt_url IS NULL OR v_receipt_url = '' THEN
    RAISE EXCEPTION 'Nedostaje link računa';
  END IF;
  IF p_claim_idxs IS NOT NULL AND COALESCE(array_length(p_claim_idxs, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Izaberi bar jednu stavku';
  END IF;

  -- FOR UPDATE serializes same-receipt writes (concurrent saves, splits, the
  -- refresh backfill): the loser waits here and then sees fresh claims.
  SELECT r.id INTO v_receipt_id
  FROM receipts r
  WHERE r.receipt_url = v_receipt_url
  FOR UPDATE;

  IF v_receipt_id IS NOT NULL THEN
    v_has_claims :=
      EXISTS (SELECT 1 FROM expenses e WHERE e.receipt_id = v_receipt_id)
      OR EXISTS (SELECT 1 FROM receipt_items ri
                 WHERE ri.receipt_id = v_receipt_id AND ri.expense_id IS NOT NULL);
    SELECT count(*) INTO v_free_count
    FROM receipt_items ri
    WHERE ri.receipt_id = v_receipt_id AND ri.expense_id IS NULL;

    IF v_has_claims AND v_free_count = 0 THEN
      -- Every line is owned (or a 0-line receipt is held whole) - a true dup.
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;

    IF NOT v_has_claims AND jsonb_array_length(p_items) > 0 THEN
      -- Orphan (its expenses were deleted, lines released) being re-scanned:
      -- the fresh parse is authoritative, refresh the snapshot. When the
      -- caller has no parse (p_items empty - the from-DB fast path), keep the
      -- stored lines instead.
      DELETE FROM receipt_items WHERE receipt_id = v_receipt_id;
      UPDATE receipts
      SET merchant = p_receipt->>'merchant',
          pib = p_receipt->>'pib',
          company_name = p_receipt->>'company_name',
          store_name = p_receipt->>'store_name',
          total_amount = (p_receipt->>'total_amount')::NUMERIC,
          issued_on = (p_receipt->>'issued_on')::DATE
      WHERE id = v_receipt_id;
      INSERT INTO receipt_items
        (receipt_id, family_id, idx, name, quantity, unit_price, total)
      SELECT v_receipt_id, v_family,
             (it->>'idx')::INTEGER, it->>'name',
             (it->>'quantity')::NUMERIC, (it->>'unit_price')::NUMERIC,
             (it->>'total')::NUMERIC
      FROM jsonb_array_elements(p_items) AS it;
    END IF;
    -- Partial add (v_has_claims AND v_free_count > 0): existing lines and the
    -- snapshot stay untouched - we only claim free lines below.
  ELSE
    -- A straggler expense saved by a pre-receipts client holds this URL
    -- without a receipts row - creating one here would double-count it.
    IF EXISTS (SELECT 1 FROM expenses e WHERE e.receipt_url = v_receipt_url) THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
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
    INSERT INTO receipt_items
      (receipt_id, family_id, idx, name, quantity, unit_price, total)
    SELECT v_receipt_id, v_family,
           (it->>'idx')::INTEGER, it->>'name',
           (it->>'quantity')::NUMERIC, (it->>'unit_price')::NUMERIC,
           (it->>'total')::NUMERIC
    FROM jsonb_array_elements(p_items) AS it;
  END IF;

  INSERT INTO expenses
    (family_id, amount, spent_on, category_id, person_id, note, currency,
     source, merchant, receipt_url, receipt_id, activity_id, event_id, birthday_id)
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
     (p_expense->>'event_id')::UUID,
     (p_expense->>'birthday_id')::UUID)
  RETURNING id INTO v_expense_id;

  IF p_claim_idxs IS NULL THEN
    -- v1 semantics: this expense takes every free line.
    UPDATE receipt_items
    SET expense_id = v_expense_id
    WHERE receipt_id = v_receipt_id AND expense_id IS NULL;
  ELSE
    UPDATE receipt_items
    SET expense_id = v_expense_id
    WHERE receipt_id = v_receipt_id
      AND idx = ANY(p_claim_idxs)
      AND expense_id IS NULL;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed <> array_length(p_claim_idxs, 1) THEN
      RAISE EXCEPTION 'Neko je u međuvremenu dodao deo ovih stavki. Osveži pregled pa pokušaj ponovo.'
        USING ERRCODE = 'PT409';
    END IF;
  END IF;

  -- Extras spent alongside the receipt (a cash tip). Plain manual rows; the
  -- inherit trigger fills in date, category, person and link from the parent.
  -- spent_on is passed only because the column is NOT NULL.
  INSERT INTO expenses
    (family_id, amount, spent_on, note, currency, source, parent_expense_id)
  SELECT v_family,
         (ex->>'amount')::NUMERIC,
         (p_expense->>'spent_on')::DATE,
         NULLIF(btrim(ex->>'note'), ''),
         'RSD',
         'manual',
         v_expense_id
  FROM jsonb_array_elements(COALESCE(p_expense->'extras', '[]'::JSONB)) AS ex;

  RETURN jsonb_build_object('status', 'saved', 'expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB, INT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB, INT[]) TO authenticated;
