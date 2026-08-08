-- attach_receipt_to_expense - turn an already-typed manual expense INTO a
-- receipt expense by scanning its fiscal receipt afterwards.
--
-- The gap this closes: you pay, you type "1200, Hrana" in five seconds, and
-- only later remember the receipt is still in your pocket. Until now the only
-- way to get the lines in was to delete the row and scan from scratch, which
-- also threw away the category, the date, the person and the link you had
-- already picked.
--
-- What changes on the expense: `amount` (the claimed lines' sum, or the whole
-- receipt total when the lines can't be selected) and its receipt identity
-- (source/merchant/receipt_url/receipt_id + the claimed receipt_items).
-- EVERYTHING else - spent_on, category, person, note, activity/event link -
-- is left exactly as the member typed it. That is the promise of the feature:
-- scanning fills in what you couldn't type, it doesn't overwrite what you did.
--
-- Currency is the one non-obvious reset: a fiscal receipt is RSD by
-- definition, so a foreign-currency manual row loses its frozen
-- original_amount/exchange_rate here - keeping them would leave the row
-- claiming "50 EUR at 117.2" next to an RSD receipt total.
--
-- The receipts-row handling (create / reuse an orphan / refuse a duplicate)
-- and the claim race guard (SQLSTATE 'PT409') are identical to
-- save_receipt_expense in 20260803120000_receipt_split_rpcs.sql - same lock,
-- same semantics, so an attach and a scan racing over one receipt resolve the
-- same way.

CREATE FUNCTION attach_receipt_to_expense(
  p_expense_id UUID,
  p_receipt JSONB,
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
  v_expense RECORD;
  v_has_claims BOOLEAN;
  v_free_count INTEGER;
  v_claimed INTEGER;
  v_amount NUMERIC;
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

  -- Only a hand-typed row with no receipt of its own can take one on. A
  -- payment-sourced row is regenerated from its payment, and a row that
  -- already has a receipt is the split/refresh case, not this one.
  SELECT e.* INTO v_expense
  FROM expenses e
  WHERE e.id = p_expense_id AND e.family_id = v_family;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trošak nije pronađen';
  END IF;
  IF v_expense.source <> 'manual' THEN
    RAISE EXCEPTION 'Samo ručno unet trošak može da se poveže sa računom';
  END IF;
  IF v_expense.receipt_id IS NOT NULL OR v_expense.receipt_url IS NOT NULL THEN
    RAISE EXCEPTION 'Ovaj trošak je već povezan sa računom';
  END IF;

  -- FOR UPDATE serializes same-receipt writes (a parallel scan, a split, the
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
      -- the fresh parse is authoritative, refresh the snapshot.
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

  IF p_claim_idxs IS NULL THEN
    -- Whole-receipt attach: this expense takes every free line, and the
    -- receipt's own total is the amount (the lines may be missing entirely,
    -- or not add up - exactly when the client turns selection off).
    UPDATE receipt_items
    SET expense_id = p_expense_id
    WHERE receipt_id = v_receipt_id AND expense_id IS NULL;
    SELECT r.total_amount INTO v_amount FROM receipts r WHERE r.id = v_receipt_id;
  ELSE
    UPDATE receipt_items
    SET expense_id = p_expense_id
    WHERE receipt_id = v_receipt_id
      AND idx = ANY(p_claim_idxs)
      AND expense_id IS NULL;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed <> array_length(p_claim_idxs, 1) THEN
      RAISE EXCEPTION 'Neko je u međuvremenu dodao deo ovih stavki. Osveži pregled pa pokušaj ponovo.'
        USING ERRCODE = 'PT409';
    END IF;
    -- Amount comes from the claimed LINES, never from the client: line totals
    -- are discount-authoritative, so the parts of a receipt always add up to
    -- exactly its total with no rounding drift.
    SELECT COALESCE(sum(ri.total), 0) INTO v_amount
    FROM receipt_items ri
    WHERE ri.receipt_id = v_receipt_id AND ri.expense_id = p_expense_id;
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Izabrane stavke nemaju iznos';
  END IF;

  UPDATE expenses
  SET amount = v_amount,
      -- A fiscal receipt is RSD; a foreign manual row drops its frozen pair.
      currency = 'RSD',
      original_amount = NULL,
      exchange_rate = NULL,
      source = 'receipt',
      merchant = p_receipt->>'merchant',
      receipt_url = v_receipt_url,
      receipt_id = v_receipt_id
  WHERE id = p_expense_id;

  RETURN jsonb_build_object('status', 'saved', 'expense_id', p_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION attach_receipt_to_expense(UUID, JSONB, JSONB, INT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attach_receipt_to_expense(UUID, JSONB, JSONB, INT[]) TO authenticated;
