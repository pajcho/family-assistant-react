-- Per-occurrence overrides for payments. Mirrors activity_overrides, but is
-- applied purely as a DISPLAY/projection layer in the frontend's occurrence
-- synthesizer (computeCombinedList) — the live `payments.due_date` (series
-- anchor) and the mark-paid / undo accounting are never touched. A stale
-- override on an occurrence that later gets paid is harmless: the synthesizer
-- no longer emits a row for that date.
--
--   'cancel'     — this occurrence is skipped: hidden from the dashboard,
--                  struck-through ("Otkazano") on the payments page,
--                  restorable. Optional `reason`.
--   'reschedule' — this occurrence moves to `override_date`, shown "Pomereno".
--                  For RECURRING payments (one-time payments just edit their
--                  own due_date). Optional `reason`.
--
-- Keyed by the ORIGINAL projected due date of the occurrence.

CREATE TABLE IF NOT EXISTS payment_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  -- Denormalized so RLS matches without joining and the synthesizer pulls all
  -- overrides for a family in one query.
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'reschedule')),
  -- Required for reschedule; NULL for cancel. Not DB-enforced (the client
  -- always sends it for reschedule) to keep the constraint simple.
  override_date DATE,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (payment_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_payment_overrides_family ON payment_overrides(family_id);
CREATE INDEX IF NOT EXISTS idx_payment_overrides_payment ON payment_overrides(payment_id);

ALTER TABLE payment_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family payment_overrides" ON payment_overrides FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family payment_overrides" ON payment_overrides FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family payment_overrides" ON payment_overrides FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family payment_overrides" ON payment_overrides FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE TRIGGER update_payment_overrides_updated_at BEFORE UPDATE ON payment_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payment_overrides;
  END IF;
END $$;
