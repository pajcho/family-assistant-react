-- Receipt splitting, part 2 (PR2): the RPCs that make one fiscal receipt
-- splittable into several expenses. No table changes - the claim model from
-- 20260803000000_receipt_entities.sql already carries everything; this only
-- upgrades the write paths:
--
--   save_receipt_expense  - gains p_claim_idxs (which lines THIS expense
--                           claims) + a partial-add branch: scanning a
--                           receipt that already has some lines claimed adds
--                           an expense over the FREE lines instead of
--                           reporting a duplicate.
--   split_receipt_expense - NEW: split an already-saved receipt expense by
--                           moving some of its claimed lines onto a new
--                           expense (amounts adjust on both sides).
--
-- Client-side rule both RPCs verify where it matters: partial amounts are
-- always SUMS OF LINE TOTALS (line totals are discount-authoritative), so the
-- parts always add up to exactly the receipt total - no rounding drift.
--
-- Claim races surface as SQLSTATE 'PT409' (custom): the client maps it to a
-- "someone claimed these lines meanwhile" retry UX. RAISE (not a status
-- return) on purpose - it rolls back the whole transaction, so a lost race
-- never leaves a half-made expense behind.

-- ---------------------------------------------------------------------------
-- 1. save_receipt_expense v2.
--    The parameter list changes (added p_claim_idxs), which would CREATE a
--    second overload next to the 3-arg v1 - and overloads make PostgREST's
--    dispatch ambiguous. Drop v1 explicitly; the 4-arg version with a DEFAULT
--    keeps the old named-args call shape working (already-deployed clients
--    keep calling {p_receipt, p_expense, p_items} and get NULL = "claim every
--    free line", exactly v1's behavior).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS save_receipt_expense(JSONB, JSONB, JSONB);

CREATE FUNCTION save_receipt_expense(
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

  RETURN jsonb_build_object('status', 'saved', 'expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB, INT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB, INT[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. split_receipt_expense - carve lines OUT of an existing receipt expense
--    into a new one. The original keeps the rest (amount shrinks by exactly
--    the moved lines' sum). Guarded by the same receipts row lock as saves.
--
--    Preconditions (client greys the affordance out, RPC still verifies):
--      - the expense is a receipt expense with a linked receipts row
--        (stragglers first converge through a refresh of the items),
--      - its claimed lines sum EXACTLY to its amount (otherwise carving by
--        lines would break the ledger - e.g. a partially-parsed receipt),
--      - at least one line moves AND at least one stays.
-- ---------------------------------------------------------------------------
CREATE FUNCTION split_receipt_expense(
  p_expense_id UUID,
  p_claim_idxs INT[],
  p_new_expense JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family UUID;
  v_expense RECORD;
  v_lines_count INTEGER;
  v_lines_sum NUMERIC;
  v_moved_count INTEGER;
  v_moved_sum NUMERIC;
  v_new_id UUID;
  v_updated INTEGER;
BEGIN
  SELECT family_id INTO v_family FROM profiles WHERE id = auth.uid();
  IF v_family IS NULL THEN
    RAISE EXCEPTION 'Nema porodice';
  END IF;
  IF COALESCE(array_length(p_claim_idxs, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Izaberi bar jednu stavku';
  END IF;

  SELECT e.* INTO v_expense
  FROM expenses e
  WHERE e.id = p_expense_id AND e.source = 'receipt' AND e.receipt_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trošak nije pronađen';
  END IF;

  -- Same lock every receipt write takes - serializes against saves/refreshes.
  PERFORM 1 FROM receipts r WHERE r.id = v_expense.receipt_id FOR UPDATE;

  SELECT count(*), COALESCE(sum(ri.total), 0)
  INTO v_lines_count, v_lines_sum
  FROM receipt_items ri
  WHERE ri.receipt_id = v_expense.receipt_id AND ri.expense_id = p_expense_id;

  SELECT count(*), COALESCE(sum(ri.total), 0)
  INTO v_moved_count, v_moved_sum
  FROM receipt_items ri
  WHERE ri.receipt_id = v_expense.receipt_id
    AND ri.expense_id = p_expense_id
    AND ri.idx = ANY(p_claim_idxs);

  IF v_moved_count <> array_length(p_claim_idxs, 1) THEN
    RAISE EXCEPTION 'Neko je u međuvremenu izmenio ovaj račun. Osveži pregled pa pokušaj ponovo.'
      USING ERRCODE = 'PT409';
  END IF;
  IF v_moved_count = v_lines_count THEN
    RAISE EXCEPTION 'Bar jedna stavka mora da ostane na postojećem trošku';
  END IF;
  IF v_lines_sum <> v_expense.amount THEN
    RAISE EXCEPTION 'Stavke se ne poklapaju sa iznosom troška pa deljenje nije moguće';
  END IF;
  IF v_moved_sum <= 0 THEN
    RAISE EXCEPTION 'Izabrane stavke nemaju iznos';
  END IF;

  INSERT INTO expenses
    (family_id, amount, spent_on, category_id, person_id, note, currency,
     source, merchant, receipt_url, receipt_id)
  VALUES
    (v_family,
     v_moved_sum,
     v_expense.spent_on,
     (p_new_expense->>'category_id')::UUID,
     (p_new_expense->>'person_id')::UUID,
     p_new_expense->>'note',
     'RSD',
     'receipt',
     v_expense.merchant,
     v_expense.receipt_url,
     v_expense.receipt_id)
  RETURNING id INTO v_new_id;

  UPDATE receipt_items
  SET expense_id = v_new_id
  WHERE receipt_id = v_expense.receipt_id
    AND expense_id = p_expense_id
    AND idx = ANY(p_claim_idxs);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_moved_count THEN
    RAISE EXCEPTION 'Neko je u međuvremenu izmenio ovaj račun. Osveži pregled pa pokušaj ponovo.'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE expenses
  SET amount = amount - v_moved_sum
  WHERE id = p_expense_id;

  RETURN jsonb_build_object(
    'status', 'saved',
    'expense_id', v_new_id,
    'remaining_amount', v_expense.amount - v_moved_sum
  );
END;
$$;

REVOKE ALL ON FUNCTION split_receipt_expense(UUID, INT[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION split_receipt_expense(UUID, INT[], JSONB) TO authenticated;
