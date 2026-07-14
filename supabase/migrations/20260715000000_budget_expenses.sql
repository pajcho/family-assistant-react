-- Faza 3 (budget, part 1) — expense categories + a rich `expenses` ledger, and
-- the automation that turns every PAID payment occurrence into an expense so the
-- family's whole spend lives in one place with no double entry.
--
-- Design notes worth reading before touching this file:
--
--   • The `expenses` table from the ORIGINAL schema (name/description/amount/
--     is_paid) was a stub for a feature that got removed long ago — it is unused
--     anywhere in the app (only a historical code comment mentions it). We DROP
--     it and recreate `expenses` with the real budget shape.
--
--   • Auto-expense semantics (the important part):
--       - AFTER INSERT on payment_history WHERE status='paid' → insert one
--         `expenses` row (source='payment'). We copy the OCCURRENCE'S due_date
--         into BOTH `spent_on` and `payment_due_date`. `spent_on = due_date`
--         (not the paid_date timestamp) is deliberate: due_date is the canonical
--         occurrence the money is FOR, so July rent lands in July's budget even
--         if you tap "Plaćeno" on Aug 2. It also keeps `spent_on` aligned with
--         the idempotency key.
--       - Idempotency: UNIQUE(payment_id, payment_due_date) WHERE source='payment'
--         + ON CONFLICT DO NOTHING, so re-firing can never double-insert.
--       - Undo (AFTER DELETE on payment_history) removes the matching auto-expense
--         — but ONLY when the parent payment still exists. Deleting a whole
--         payment cascades its history here too, yet `expenses.payment_id` is
--         ON DELETE SET NULL by design (keep the money trail, just detach), so
--         the guard `IF EXISTS (payment)` prevents the cascade from wiping it.
--       - 'canceled' history rows leave no money trail (guarded by status check).
--
--   • Single-family app: default categories are seeded for existing families
--     here. There is no per-new-family trigger on purpose (the roster is created
--     once via scripts/setup-family.ts); add one if the app is ever multi-tenant.

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Retire the dead legacy `expenses` table (+ its updated_at trigger via the
--    table drop). CASCADE is safe: nothing references it.
-- ───────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS expenses CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. expense_categories — family-scoped, editable. `monthly_limit` is used in
--    Faza 4 (nullable = no limit set). `icon` is a short key the UI maps to a
--    heroicon; `color` is a hex string like profiles.color.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT NOT NULL DEFAULT 'tag',
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Faza 4: optional monthly budget ceiling. NULL = untracked.
  monthly_limit NUMERIC(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_expense_categories_family ON expense_categories(family_id);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family expense_categories" ON expense_categories FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family expense_categories" ON expense_categories FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family expense_categories" ON expense_categories FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family expense_categories" ON expense_categories FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- Seed sensible defaults for every existing family.
INSERT INTO expense_categories (family_id, name, color, icon, sort_order)
SELECT f.id, c.name, c.color, c.icon, c.sort_order
FROM families f
CROSS JOIN (
  VALUES
    ('Namirnice', '#22c55e', 'cart', 0),
    ('Režije', '#3b82f6', 'bolt', 1),
    ('Deca i aktivnosti', '#a855f7', 'academic', 2),
    ('Prevoz', '#f59e0b', 'truck', 3),
    ('Zdravlje', '#ef4444', 'heart', 4),
    ('Izlasci', '#ec4899', 'ticket', 5),
    ('Ostalo', '#6b7280', 'tag', 6)
) AS c(name, color, icon, sort_order);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. expenses — the ledger. `source` distinguishes manual entries from the
--    auto rows the payment trigger writes (and the receipt scanner in Faza 5).
--    activity_id/event_id mirror the payments link (at most one, same CHECK).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'RSD',
  spent_on DATE NOT NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  -- Who the spend is attributed to. ON UPDATE CASCADE so a login-less member
  -- (a child) assigned an expense can still be promoted to a real login later
  -- (the promote flow re-keys profiles.id — see the family_admin migration).
  person_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'payment', 'receipt')),
  -- Set only for source='payment': the payment + the occurrence it came from.
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  payment_due_date DATE,
  -- At most one link, mirroring payments_single_link.
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT expenses_single_link CHECK (num_nonnulls(activity_id, event_id) <= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_expenses_family_spent_on ON expenses(family_id, spent_on);
CREATE INDEX idx_expenses_category ON expenses(category_id);

-- Idempotency key for the auto-expense trigger: one expense per (payment,
-- occurrence). Partial so manual/receipt rows (payment_id NULL) don't collide.
CREATE UNIQUE INDEX idx_expenses_payment_occurrence
  ON expenses(payment_id, payment_due_date)
  WHERE source = 'payment';

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family expenses" ON expenses FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family expenses" ON expenses FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family expenses" ON expenses FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family expenses" ON expenses FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- ───────────────────────────────────────────────────────────────────────────
-- 3. payments.category_id — categorize a recurring bill once; the auto-expense
--    inherits it on every occurrence.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Auto-expense automation. SECURITY DEFINER so the ledger row is written /
--    removed regardless of the triggering member's RLS (the family scope is
--    inherited from the payment_history row itself). Empty search_path +
--    fully-qualified refs guard against search_path attacks.
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
    family_id, amount, currency, spent_on, category_id, note,
    source, payment_id, payment_due_date, activity_id, event_id
  )
  VALUES (
    NEW.family_id, NEW.amount, 'RSD', NEW.due_date, pay.category_id, pay.name,
    'payment', NEW.payment_id, NEW.due_date, pay.activity_id, pay.event_id
  )
  ON CONFLICT (payment_id, payment_due_date) WHERE source = 'payment' DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.budget_expense_undo_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Genuine UNDO: the payment still exists, so remove its auto-expense.
  -- Whole-payment DELETE cascades this history row away too, but then the
  -- payment is already gone — we skip, letting expenses.payment_id go NULL
  -- (ON DELETE SET NULL) so the historical spend is kept, just detached.
  IF EXISTS (SELECT 1 FROM public.payments WHERE id = OLD.payment_id) THEN
    DELETE FROM public.expenses
    WHERE source = 'payment'
      AND payment_id = OLD.payment_id
      AND payment_due_date = OLD.due_date;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_budget_expense_from_payment
  AFTER INSERT ON payment_history
  FOR EACH ROW EXECUTE FUNCTION public.budget_expense_from_payment();

CREATE TRIGGER trg_budget_expense_undo_payment
  AFTER DELETE ON payment_history
  FOR EACH ROW EXECUTE FUNCTION public.budget_expense_undo_payment();

-- Backfill: turn already-recorded PAID history into expenses so the budget
-- isn't empty on day one. Same idempotent insert the trigger uses.
INSERT INTO expenses (
  family_id, amount, currency, spent_on, category_id, note,
  source, payment_id, payment_due_date, activity_id, event_id
)
SELECT
  h.family_id, h.amount, 'RSD', h.due_date, p.category_id, p.name,
  'payment', h.payment_id, h.due_date, p.activity_id, p.event_id
FROM payment_history h
JOIN payments p ON p.id = h.payment_id
WHERE h.status = 'paid'
ON CONFLICT (payment_id, payment_due_date) WHERE source = 'payment' DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. updated_at triggers (reuse the shared function from the initial schema).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TRIGGER update_expense_categories_updated_at BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Realtime publication — guarded so local `supabase start` matches Cloud.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE expense_categories;
    ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
  END IF;
END $$;
