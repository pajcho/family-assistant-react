-- Skolski raspusti - periodi u kojima se raspored casova NE prikazuje.
--
-- Problem: raspored casova je cist nedeljni sablon (school_timetable_entries),
-- pa se prikazivao svake nedelje u godini - ukljucujuci ceo jul i avgust, kad
-- deca ne idu u skolu. Uz to, deca razlicitih razreda znaju da imaju razlicite
-- raspuste, pa jedan porodicni prekidac ne bi bio dovoljan.
--
-- Model: jedan pojam. Letnji raspust nije poseban entitet nego samo najduzi
-- raspust u nizu - nema odvojenog podesavanja "skolska godina".
--
-- Bez godine, namerno. Cuvaju se samo mesec i dan, pa raspust vazi u SVAKOJ
-- godini. Da su datumi puni, letnji raspust bi se svakog avgusta unosio ispocetka
-- (ili bi se, ako se zaboravi, raspored vratio usred leta). Zimski raspust
-- prelazi Novu godinu, sto se prepoznaje po tome da je kraj PRE pocetka
-- (30.12 - 20.01): opseg se tada racuna sa preskokom preko 31.12.
--
-- Poredjenje je uvek numericko, preko mesec*100 + dan, pa se nikad ne pravi
-- pravi datum. To znaci da 29.02 radi i u neprestupnoj godini (nikad se ne
-- pretvara u nepostojeci datum), a CHECK moze da ostane jednostavan.

-- ---------------------------------------------------------------------------
-- school_breaks - jedan raspust porodice
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  name TEXT NOT NULL,

  -- Mesec i dan pocetka/kraja, oba ukljucivo (kao events.end_date).
  start_month SMALLINT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day SMALLINT NOT NULL CHECK (start_day BETWEEN 1 AND 31),
  end_month SMALLINT NOT NULL CHECK (end_month BETWEEN 1 AND 12),
  end_day SMALLINT NOT NULL CHECK (end_day BETWEEN 1 AND 31),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_breaks_family ON school_breaks(family_id);

COMMENT ON TABLE school_breaks IS
  'Periodi bez nastave. Cuva se samo mesec+dan, pa raspust vazi svake godine; kraj pre pocetka znaci opseg preko Nove godine.';

-- ---------------------------------------------------------------------------
-- school_break_members - na koju decu se raspust odnosi
-- ---------------------------------------------------------------------------
-- Isti obrazac kao event_participants / payment_participants. PRAZAN spisak
-- nije greska nego podrazumevano stanje i znaci "sva deca sa rasporedom" -
-- tako se najcesci slucaj (svi su na raspustu) unosi bez ijednog dodatnog tapa.
CREATE TABLE IF NOT EXISTS school_break_members (
  break_id UUID NOT NULL REFERENCES school_breaks(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalizovano zbog RLS-a i dohvata cele porodice u jednom upitu.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (break_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_school_break_members_family ON school_break_members(family_id);
CREATE INDEX IF NOT EXISTS idx_school_break_members_person ON school_break_members(person_id);

-- ---------------------------------------------------------------------------
-- RLS - isti obrazac kao ostale porodicne tabele
-- ---------------------------------------------------------------------------
ALTER TABLE school_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_break_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family school_breaks" ON school_breaks FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family school_breaks" ON school_breaks FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family school_breaks" ON school_breaks FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family school_breaks" ON school_breaks FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view own family school_break_members" ON school_break_members FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family school_break_members" ON school_break_members FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family school_break_members" ON school_break_members FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- updated_at triger (helper iz inicijalne seme)
DROP TRIGGER IF EXISTS update_school_breaks_updated_at ON school_breaks;
CREATE TRIGGER update_school_breaks_updated_at BEFORE UPDATE ON school_breaks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Realtime - porodicni broadcast kanal
-- ---------------------------------------------------------------------------
-- Bez ovoga bi izmena raspusta na jednom uredjaju ostala nevidljiva na drugom
-- do sledeceg refetch-a. Mapiranje na query kljuceve je u
-- src/hooks/useFamilyChannel.ts (TABLE_INVALIDATIONS) - to dvoje ide u paru.
DROP TRIGGER IF EXISTS broadcast_family_change ON school_breaks;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON school_breaks
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();

DROP TRIGGER IF EXISTS broadcast_family_change ON school_break_members;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON school_break_members
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();
