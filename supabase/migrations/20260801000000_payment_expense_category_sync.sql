-- Until now a payment's category was copied into its auto-expense ONLY at the
-- moment it was marked as paid (budget_expense_from_payment reads
-- pay.category_id). Anyone who added the category AFTER the instalment or bill
-- was already paid found an uncategorized row on /budget - and auto-expenses
-- are read-only in the UI, so it could not be corrected by hand either. The
-- same held for linking to an activity or an event after the fact.
--
-- The fix, in two parts:
--   1. An AFTER UPDATE trigger on payments: when category_id or the link
--      (activity_id / event_id) changes, write them into ALL of that payment's
--      auto-expenses (source='payment'). The category and the link classify the
--      series - they live on the payment, and the expenses are its projection;
--      unlike name/amount, which are a deliberately frozen per-instalment
--      snapshot (see payment_history.name).
--   2. Backfill: existing auto-expenses are aligned with the live payment once.
--
-- Expenses whose payment was deleted (payment_id IS NULL through ON DELETE SET
-- NULL) are left untouched - a historical trace is not rewritten.
--
-- SECURITY DEFINER + an empty search_path for the same reason as
-- budget_expense_from_payment: the ledger row is updated independently of the
-- RLS of the member changing the payment, and only the payment row carries the
-- family scope.

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

-- Backfill: align existing auto-expenses with the live payment. The WHERE
-- condition skips rows that already agree, so the update (and the per-row
-- broadcast trigger) only touches what actually drifted.
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
