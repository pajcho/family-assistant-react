-- Faza 4 (budget, part 2) — recurring household incomes. Multiple salaries with
-- different pay-days is the exact family scenario (see IMPROVEMENT_PLAN Faza 4).
-- The monthly-cycle math (income − spent = remaining, + projection) lives in the
-- frontend (src/utils/budget.ts); this table just stores the income sources.

CREATE TABLE incomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- Who earns it. ON UPDATE CASCADE so a login-less member assigned an income
  -- can still be promoted to a real login later (profiles.id re-key — see the
  -- family_admin migration). ON DELETE SET NULL keeps the income on the books.
  person_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  -- Nominal pay-day; the cycle helper caps it to the month's last day.
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  is_recurring BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_incomes_family ON incomes(family_id);

ALTER TABLE incomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family incomes" ON incomes FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family incomes" ON incomes FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family incomes" ON incomes FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family incomes" ON incomes FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE TRIGGER update_incomes_updated_at BEFORE UPDATE ON incomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE incomes;
  END IF;
END $$;
