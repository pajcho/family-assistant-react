-- Multi-currency, part 2: payments in foreign currencies + a currency setting.
--
-- Design notes worth reading before touching this file:
--
--   - payments gets the SAME frozen-rate trio as expenses (migration
--     20260720120000): `amount` is ALWAYS RSD - the projections
--     (projectedUnpaid), the monthly summaries and the history snapshot sum it
--     currency-blind and stay correct with no change at all.
--     `original_amount` + `exchange_rate` are frozen when the payment
--     definition is entered.
--
--   - The occurrence flow stays pure RSD: payment_history still snapshots the
--     RSD amount (variable amounts are confirmed in RSD), so there are no new
--     columns there.
--
--   - budget_expense_from_payment: when EXACTLY the defined amount is paid
--     (NEW.amount = pay.amount), the auto-expense inherits the
--     currency/original/rate - the ledger then shows the foreign amount for
--     payment-sourced expenses too. A variable payment (an amount other than
--     the defined one) falls back to RSD: the frozen original no longer matches
--     what was actually paid.
--
--   - families.enabled_currencies - which currencies the forms OFFER on entry.
--     RSD is the base currency (NBS rates are pulled towards RSD) and the CHECK
--     guarantees it can never drop out of the list. Disabling a currency does
--     NOT touch existing rows - it only narrows the choice for new entries (the
--     UI offers the enabled set plus the current currency of the entity being
--     edited, so editing someone else's currency does not break).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. payments - the frozen original entry (the same CHECK pattern as expenses).
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'RSD',
  ADD COLUMN original_amount NUMERIC(12, 2) CHECK (original_amount > 0),
  ADD COLUMN exchange_rate NUMERIC(12, 6) CHECK (exchange_rate > 0);

ALTER TABLE payments ADD CONSTRAINT payments_foreign_currency_complete CHECK (
  (currency = 'RSD' AND original_amount IS NULL AND exchange_rate IS NULL)
  OR (currency <> 'RSD' AND original_amount IS NOT NULL AND exchange_rate IS NOT NULL)
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. families.enabled_currencies - the currency choice in the forms. Default RSD+EUR.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE families
  ADD COLUMN enabled_currencies TEXT[] NOT NULL DEFAULT ARRAY['RSD', 'EUR'];

ALTER TABLE families ADD CONSTRAINT families_rsd_always_enabled
  CHECK ('RSD' = ANY (enabled_currencies));

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The auto-expense trigger inherits the currency when exactly the defined
--    amount is paid. The body is a copy from 20260715000000 + a CASE for the
--    three new columns.
-- ───────────────────────────────────────────────────────────────────────────
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
    source, payment_id, payment_due_date, activity_id, event_id
  )
  VALUES (
    NEW.family_id,
    NEW.amount,
    CASE WHEN NEW.amount = pay.amount THEN pay.currency ELSE 'RSD' END,
    CASE WHEN NEW.amount = pay.amount THEN pay.original_amount ELSE NULL END,
    CASE WHEN NEW.amount = pay.amount THEN pay.exchange_rate ELSE NULL END,
    NEW.due_date, pay.category_id, pay.name,
    'payment', NEW.payment_id, NEW.due_date, pay.activity_id, pay.event_id
  )
  ON CONFLICT (payment_id, payment_due_date) WHERE source = 'payment' DO NOTHING;

  RETURN NEW;
END;
$$;
