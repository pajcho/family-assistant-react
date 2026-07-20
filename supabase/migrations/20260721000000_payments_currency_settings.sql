-- Multi-currency, deo 2: plaćanja u stranim valutama + podešavanje valuta.
--
-- Design notes worth reading before touching this file:
--
--   • payments dobija ISTI "frozen rate" trio kao expenses (migracija
--     20260720120000): `amount` je UVEK RSD — projekcije (projectedUnpaid),
--     mesečni pregledi i history snapshot ga sabiraju currency-blind i ostaju
--     tačni bez ijedne izmene. `original_amount` + `exchange_rate` se
--     zamrzavaju pri unosu definicije plaćanja.
--
--   • Occurrence tok ostaje čist RSD: payment_history i dalje snapšotuje RSD
--     iznos (varijabilni iznosi se potvrđuju u RSD), pa tu nema novih kolona.
--
--   • budget_expense_from_payment: kada je plaćen TAČNO definisani iznos
--     (NEW.amount = pay.amount), auto-trošak nasleđuje valutu/original/kurs —
--     ledger onda prikazuje "50 €" i za troškove iz plaćanja. Varijabilna
--     uplata (iznos ≠ definisanom) pada na RSD: zamrznuti original se više ne
--     poklapa sa onim što je stvarno plaćeno.
--
--   • families.enabled_currencies — koje valute forme NUDE pri unosu. RSD je
--     osnovna valuta (NBS kursevi se vuku ka RSD) i CHECK garantuje da nikad
--     ne ispadne iz liste. Isključivanje valute NE dira postojeće redove —
--     samo sužava izbor za nove unose (UI nudi enabled ∪ trenutnu valutu
--     entiteta koji se menja, pa izmena tuđe valute ne puca).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. payments — frozen original entry (isti CHECK obrazac kao expenses).
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
-- 2. families.enabled_currencies — izbor valuta u formama. Default RSD+EUR.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE families
  ADD COLUMN enabled_currencies TEXT[] NOT NULL DEFAULT ARRAY['RSD', 'EUR'];

ALTER TABLE families ADD CONSTRAINT families_rsd_always_enabled
  CHECK ('RSD' = ANY (enabled_currencies));

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Auto-expense trigger nasleđuje valutu kad se plaća tačan definisani
--    iznos. Telo je kopija iz 20260715000000 + CASE za tri nove kolone.
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
