-- School breaks - the periods in which the timetable is NOT shown.
--
-- The problem: the timetable is a pure weekly template
-- (school_timetable_entries), so it was rendered every week of the year -
-- including all of July and August, when children are not at school. On top of
-- that, children in different grades do get different breaks, so a single
-- family-wide switch would not have been enough.
--
-- The model: one concept. The summer holiday is not a separate entity, just the
-- longest break in the list - there is no separate "school year" setting.
--
-- No year, deliberately. Only the month and the day are stored, so a break
-- applies in EVERY year. With full dates, the summer holiday would have to be
-- re-entered every August (or, if forgotten, the timetable would come back in
-- the middle of summer). The winter break crosses New Year, which is
-- recognized by the end being BEFORE the start (30.12 - 20.01): the range is
-- then computed wrapping over 31.12.
--
-- The comparison is always numeric, through month*100 + day, so a real date is
-- never constructed. That means 29.02 works in a non-leap year too (it is never
-- turned into a date that does not exist), and the CHECK can stay simple.

-- ---------------------------------------------------------------------------
-- school_breaks - one break for the family
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  name TEXT NOT NULL,

  -- The start/end month and day, both inclusive (like events.end_date).
  start_month SMALLINT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day SMALLINT NOT NULL CHECK (start_day BETWEEN 1 AND 31),
  end_month SMALLINT NOT NULL CHECK (end_month BETWEEN 1 AND 12),
  end_day SMALLINT NOT NULL CHECK (end_day BETWEEN 1 AND 31),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_breaks_family ON school_breaks(family_id);

COMMENT ON TABLE school_breaks IS
  'Periods with no classes. Only month+day is stored, so a break applies every year; an end before the start means the range wraps over New Year.';

-- ---------------------------------------------------------------------------
-- school_break_members - which children a break applies to
-- ---------------------------------------------------------------------------
-- The same pattern as event_participants / payment_participants. An EMPTY list
-- is not a mistake but the default state, and means "every child with a
-- timetable" - so the most common case (everyone is off) is entered without a
-- single extra tap.
CREATE TABLE IF NOT EXISTS school_break_members (
  break_id UUID NOT NULL REFERENCES school_breaks(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalized for RLS and for fetching the whole family in one query.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (break_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_school_break_members_family ON school_break_members(family_id);
CREATE INDEX IF NOT EXISTS idx_school_break_members_person ON school_break_members(person_id);

-- ---------------------------------------------------------------------------
-- RLS - the same pattern as the other family tables
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

-- updated_at trigger (the helper from the initial schema)
DROP TRIGGER IF EXISTS update_school_breaks_updated_at ON school_breaks;
CREATE TRIGGER update_school_breaks_updated_at BEFORE UPDATE ON school_breaks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Realtime - the family broadcast channel
-- ---------------------------------------------------------------------------
-- Without this, editing a break on one device would stay invisible on another
-- until the next refetch. The mapping onto query keys lives in
-- src/hooks/useFamilyChannel.ts (TABLE_INVALIDATIONS) - the two go together.
DROP TRIGGER IF EXISTS broadcast_family_change ON school_breaks;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON school_breaks
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();

DROP TRIGGER IF EXISTS broadcast_family_change ON school_break_members;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON school_break_members
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();
