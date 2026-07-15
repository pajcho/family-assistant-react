-- Prihodi po mesecu (Faza budžet, deo 3).
--
-- `incomes` OSTAJE tabela IZVORA (recurring šabloni: "Plata — Nikola", iznos,
-- dan u mesecu). Stvarni priliv se sad beleži ovde — jednom po mesecu — pa se
-- istorija prihoda ZAMRZAVA: izmena izvora danas ne menja prošle mesece. Ista
-- ideja kao payment_history + expenses za rashode.
--
-- Semantika koju frontend računa (src/utils/budget.ts):
--   • Mesečni budžet sabira POTVRĐENE prilive za taj mesec (`month`).
--   • Aktivni recurring izvor BEZ potvrde za tekući/budući mesec prikazuje se
--     kao "za potvrdu" (očekivani prihod, projekcija) dok se ne unese stvarni
--     iznos. Prošli meseci prikazuju samo ono što je stvarno potvrđeno.
--   • Jednokratni prihodi (bonus) = red sa income_id IS NULL, is_one_time=true.

CREATE TABLE income_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- Izvor (recurring plata) koji je potvrđen; NULL = jednokratni prihod.
  -- ON DELETE SET NULL: brisanje izvora ne briše istoriju priliva.
  income_id UUID REFERENCES incomes(id) ON DELETE SET NULL,
  -- Ko ga je zaradio. ON UPDATE CASCADE (promocija login-less člana u pravi
  -- login re-keyuje profiles.id), ON DELETE SET NULL zadržava red u istoriji.
  person_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- Snapshot naziva u trenutku potvrde (ili labela jednokratnog prihoda).
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  -- 'YYYY-MM' — mesec za koji se prihod računa (budžetski bucket + idempotencija).
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  -- Kad je stvarno leglo (informativno; NULL dozvoljeno).
  received_on DATE,
  note TEXT,
  is_one_time BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Jedna potvrda po IZVORU po mesecu. NULL-ovi su distinktni u UNIQUE indeksu
-- (Postgres default), pa jednokratni prihodi (income_id NULL) se NE sudaraju —
-- može ih biti više u istom mesecu. Ovo je i ON CONFLICT meta za "potvrdi/izmeni".
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
