-- Multi-currency, deo 3: kurs po RATI (pay-time rate).
--
--   • Strano plaćanje se do sada konvertovalo JEDNOM, pri definisanju — pa je
--     svaka rata knjižena po tom početnom kursu. Ispravna semantika: svaka
--     plaćena rata nosi SVOJ kurs (podrazumevano NBS srednji na dan plaćanja,
--     uz ručnu korekciju u potvrdi). Zato payment_history dobija isti frozen
--     trio kao expenses/payments: currency + original_amount + exchange_rate,
--     snapšotovan u trenutku "Označi kao plaćeno".
--
--   • budget_expense_from_payment sada čita valutu DIREKTNO iz history reda
--     (NEW.*) umesto ranije heuristike "iznos se poklapa sa definicijom" —
--     rata plaćena po drugačijem kursu i dalje nosi tačan € original u ledger.
--
--   • Otkazane rate ostaju čist RSD snapshot (ne knjiže se u troškove).
--     Postojeći redovi su RSD (default) — bez backfill-a.

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
