-- Phase 2 (payments) — assign a payment to one or more family members
-- (OPTIONAL), mirroring event_participants / activity_participants. A payment
-- may have ZERO participants (a shared household bill needs no assignee).

CREATE TABLE IF NOT EXISTS payment_participants (
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalized for RLS speed + single-query family fetches.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (payment_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_participants_family ON payment_participants(family_id);
CREATE INDEX IF NOT EXISTS idx_payment_participants_person ON payment_participants(person_id);

ALTER TABLE payment_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family payment_participants" ON payment_participants FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family payment_participants" ON payment_participants FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family payment_participants" ON payment_participants FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- Keep local `supabase start` in sync with Cloud's auto-add so the realtime
-- subscription fires for participant edits.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payment_participants;
  END IF;
END $$;
