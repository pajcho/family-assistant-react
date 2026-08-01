-- Kategorija plaćanja se do sada kopirala u auto-trošak SAMO u trenutku
-- "Označi kao plaćeno" (budget_expense_from_payment čita pay.category_id).
-- Ko je kategoriju dodao NAKON što je rata/račun već plaćen, zatekao je na
-- /budget "Bez kategorije" - a auto-troškovi su u UI read-only, pa se to nije
-- moglo ispraviti ni ručno. Isto važi za naknadno povezivanje sa aktivnošću
-- ili događajem.
--
-- Popravka u dva dela:
--   1. AFTER UPDATE triger na payments: kad se promeni category_id ili veza
--      (activity_id / event_id), prepiši ih u SVE auto-troškove tog plaćanja
--      (source='payment'). Kategorija i veza su klasifikacija serije - žive na
--      plaćanju, a troškovi su njegova projekcija; za razliku od name/amount
--      koji su namerno zamrznuti snapshot po rati (vidi payment_history.name).
--   2. Backfill: postojeći auto-troškovi se jednokratno poravnaju sa živim
--      plaćanjem.
--
-- Troškovi čiji je payment obrisan (payment_id IS NULL preko ON DELETE SET
-- NULL) ostaju netaknuti - istorijski trag se ne prepravlja.
--
-- SECURITY DEFINER + prazan search_path iz istog razloga kao
-- budget_expense_from_payment: red u ledgeru se ažurira nezavisno od RLS-a
-- člana koji menja plaćanje, a family scope nosi samo payment red.

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
    event_id = NEW.event_id
  WHERE source = 'payment'
    AND payment_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_budget_expense_sync_payment
  AFTER UPDATE ON payments
  FOR EACH ROW
  WHEN (
    OLD.category_id IS DISTINCT FROM NEW.category_id
    OR OLD.activity_id IS DISTINCT FROM NEW.activity_id
    OR OLD.event_id IS DISTINCT FROM NEW.event_id
  )
  EXECUTE FUNCTION public.budget_expense_sync_payment();

-- Backfill: poravnaj postojeće auto-troškove sa živim plaćanjem. Uslov u
-- WHERE preskače već usklađene redove, pa update (i broadcast triger po redu)
-- pogađa samo ono što je stvarno razišlo.
UPDATE expenses e
SET
  category_id = p.category_id,
  activity_id = p.activity_id,
  event_id = p.event_id
FROM payments p
WHERE e.source = 'payment'
  AND e.payment_id = p.id
  AND (
    e.category_id IS DISTINCT FROM p.category_id
    OR e.activity_id IS DISTINCT FROM p.activity_id
    OR e.event_id IS DISTINCT FROM p.event_id
  );
