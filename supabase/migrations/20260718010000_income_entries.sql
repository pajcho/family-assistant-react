-- Income per month (budget phase, part 3).
--
-- `incomes` REMAINS the SOURCE table (recurring templates: a salary, its
-- amount, the day of the month). The actual receipt is now recorded here - once
-- per month - so income history is FROZEN: editing a source today does not
-- change past months. The same idea as payment_history + expenses on the
-- outgoing side.
--
-- The semantics the frontend computes (src/utils/budget.ts):
--   - The monthly budget sums the CONFIRMED receipts for that month (`month`).
--   - An active recurring source WITHOUT a confirmation for the current/future
--     month is shown as awaiting confirmation (expected income, a projection)
--     until the real amount is entered. Past months show only what was actually
--     confirmed.
--   - One-off income (a bonus) = a row with income_id IS NULL,
--     is_one_time=true.

CREATE TABLE income_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- The source (a recurring salary) being confirmed; NULL = one-off income.
  -- ON DELETE SET NULL: deleting the source does not delete the receipt
  -- history.
  income_id UUID REFERENCES incomes(id) ON DELETE SET NULL,
  -- Who earned it. ON UPDATE CASCADE (promoting a login-less member to a real
  -- login re-keys profiles.id), ON DELETE SET NULL keeps the row in history.
  person_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- A snapshot of the name at confirmation time (or the label of a one-off).
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  -- 'YYYY-MM' - the month the income counts for (budget bucket + idempotency).
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  -- When it actually landed (informational; NULL allowed).
  received_on DATE,
  note TEXT,
  is_one_time BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One confirmation per SOURCE per month. NULLs are distinct in a UNIQUE index
-- (the Postgres default), so one-off income (income_id NULL) does NOT collide -
-- there may be several in the same month. This is also the ON CONFLICT target
-- for confirm/edit.
CREATE UNIQUE INDEX idx_income_entries_source_month ON income_entries(income_id, month);
CREATE INDEX idx_income_entries_family_month ON income_entries(family_id, month);

ALTER TABLE income_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family income_entries" ON income_entries FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family income_entries" ON income_entries FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family income_entries" ON income_entries FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family income_entries" ON income_entries FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE TRIGGER update_income_entries_updated_at BEFORE UPDATE ON income_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE income_entries;
  END IF;
END $$;
