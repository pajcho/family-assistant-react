-- Birthdays as an expense link, mirroring payments.birthday_id.
--
-- 20260717000000_birthday_links.sql gave payments and events a birthday link
-- but left expenses on activity/event only, so a gift bought in a shop (a
-- manual expense or a scanned fiscal receipt) could not be tied to the
-- birthday it was for. This adds the third link column and threads it through
-- every write path that sets the other two:
--
--   1. expenses.birthday_id + `expenses_single_link` widened to all three.
--   2. budget_expense_from_payment - a paid occurrence of a birthday payment
--      now carries the birthday onto its auto-expense.
--   3. budget_expense_sync_payment (+ its trigger condition) - relinking a
--      payment to/from a birthday rewrites its auto-expenses, and a backfill
--      aligns the auto-expenses of payments that were already birthday-linked.
--   4. save_receipt_expense - accepts p_expense.birthday_id.
--
-- ON DELETE SET NULL like the other links: deleting a birthday detaches its
-- expenses, never deletes them. No RLS/realtime changes - the column lives on
-- a table already covered.

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS birthday_id UUID REFERENCES birthdays(id) ON DELETE SET NULL;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_single_link;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_single_link CHECK (num_nonnulls(activity_id, event_id, birthday_id) <= 1);

CREATE INDEX IF NOT EXISTS idx_expenses_birthday ON expenses(birthday_id)
  WHERE birthday_id IS NOT NULL;

COMMENT ON COLUMN expenses.birthday_id IS
  'Optional link to a birthday (e.g. a gift). At most one of activity_id / event_id / birthday_id.';

-- ---------------------------------------------------------------------------
-- 2. Auto-expense from a paid payment occurrence carries the birthday link.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.budget_expense_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  -- Only PAID occurrences become spend; canceled (skipped) ones don't.
  IF NEW.status IS DISTINCT FROM 'paid' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO pay FROM public.payments WHERE id = NEW.payment_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.expenses (
    family_id, amount, currency, original_amount, exchange_rate,
    spent_on, category_id, note,
    source, payment_id, payment_due_date, activity_id, event_id, birthday_id
  )
  VALUES (
    NEW.family_id,
    NEW.amount,
    NEW.currency,
    NEW.original_amount,
    NEW.exchange_rate,
    NEW.due_date, pay.category_id, pay.name,
    'payment', NEW.payment_id, NEW.due_date, pay.activity_id, pay.event_id, pay.birthday_id
  )
  ON CONFLICT (payment_id, payment_due_date) WHERE source = 'payment' DO NOTHING;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Payment -> auto-expense link sync covers the birthday link too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.budget_expense_sync_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.expenses
  SET
    category_id = NEW.category_id,
    activity_id = NEW.activity_id,
    event_id = NEW.event_id,
    birthday_id = NEW.birthday_id
  WHERE source = 'payment'
    AND payment_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_expense_sync_payment ON payments;
CREATE TRIGGER trg_budget_expense_sync_payment
  AFTER UPDATE ON payments
  FOR EACH ROW
  WHEN (
    OLD.category_id IS DISTINCT FROM NEW.category_id
    OR OLD.activity_id IS DISTINCT FROM NEW.activity_id
    OR OLD.event_id IS DISTINCT FROM NEW.event_id
    OR OLD.birthday_id IS DISTINCT FROM NEW.birthday_id
  )
  EXECUTE FUNCTION public.budget_expense_sync_payment();

-- Backfill: auto-expenses of payments that were already linked to a birthday.
UPDATE expenses e
SET birthday_id = p.birthday_id
FROM payments p
WHERE e.source = 'payment'
  AND e.payment_id = p.id
  AND e.birthday_id IS DISTINCT FROM p.birthday_id;

-- ---------------------------------------------------------------------------
-- 4. save_receipt_expense - same signature and body as the v2 in
--    20260803120000_receipt_split_rpcs.sql, plus p_expense.birthday_id.
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

  RETURN jsonb_build_object('status', 'saved', 'expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB, INT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_receipt_expense(JSONB, JSONB, JSONB, INT[]) TO authenticated;
