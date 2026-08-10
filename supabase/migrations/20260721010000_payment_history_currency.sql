-- Multi-currency, part 3: a per-INSTALMENT rate (the pay-time rate).
--
--   - A foreign payment used to be converted ONCE, at definition time - so
--     every instalment was booked at that initial rate. The correct semantics:
--     every paid instalment carries its OWN rate (the NBS middle rate on the
--     payment date by default, with a manual correction in the confirmation).
--     Hence payment_history gets the same frozen trio as expenses/payments:
--     currency + original_amount + exchange_rate, snapshotted at the moment the
--     payment is marked as paid.
--
--   - budget_expense_from_payment now reads the currency DIRECTLY from the
--     history row (NEW.*) instead of the earlier "the amount matches the
--     definition" heuristic - an instalment paid at a different rate still
--     carries the exact foreign original into the ledger.
--
--   - Canceled instalments stay a pure RSD snapshot (they are not booked as
--     expenses). Existing rows are RSD (the default) - no backfill.

ALTER TABLE payment_history
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'RSD',
  ADD COLUMN original_amount NUMERIC(12, 2) CHECK (original_amount > 0),
  ADD COLUMN exchange_rate NUMERIC(12, 6) CHECK (exchange_rate > 0);

ALTER TABLE payment_history ADD CONSTRAINT payment_history_foreign_currency_complete CHECK (
  (currency = 'RSD' AND original_amount IS NULL AND exchange_rate IS NULL)
  OR (currency <> 'RSD' AND original_amount IS NOT NULL AND exchange_rate IS NOT NULL)
);

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
    NEW.currency,
    NEW.original_amount,
    NEW.exchange_rate,
    NEW.due_date, pay.category_id, pay.name,
    'payment', NEW.payment_id, NEW.due_date, pay.activity_id, pay.event_id
  )
  ON CONFLICT (payment_id, payment_due_date) WHERE source = 'payment' DO NOTHING;

  RETURN NEW;
END;
$$;
