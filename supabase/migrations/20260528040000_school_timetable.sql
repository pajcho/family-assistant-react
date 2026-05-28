-- School timetable feature: type the subjects per day, derive the times.
--
-- Distinct from `activities` (trainings / music / English), which store
-- explicit start/end times per occurrence. School classes are entered as an
-- ordered list of subjects per day; their concrete times are ALWAYS computed
-- from a family-wide bell schedule (`bell_schedules`) + the child's resolved
-- time band. Nothing here stores a wall-clock time on a class — change the
-- bell schedule and every class shifts automatically.
--
-- Three pieces:
--
--   bell_schedules            — one editable row per family. Uniform period /
--                               break durations + per-band start time and the
--                               position of the big break (veliki odmor). Three
--                               bands: morning, afternoon, afternoon-with-pred-čas.
--   school_timetable_entries  — (person, variant, day, period#, subject). The
--                               variant is the A/B rota label; times are NOT here.
--   school_shift_anchors.*    — two new per-child columns that DECOUPLE the
--                               time band from the A/B rota (see below).
--
-- A/B vs time band — the important distinction:
--   The child's shift anchor still decides the rota label each week
--   ('morning'→variant A, 'afternoon'→variant B) via the existing
--   `deriveShiftForWeek`. That selects WHICH timetable (A or B) is active.
--   Independently, the TIME band (which bell-schedule start applies) is
--   `fixed_time_band` when set, else the rota label. This is what 1st/2nd
--   graders need: rota keeps flipping A↔B (subjects change weekly) while the
--   time band stays pinned to 'morning' all year.
--
-- Day-of-week is 0=Mon … 6=Sun, same convention as activity_schedule.

-- ───────────────────────────────────────────────────────────────────────────
-- bell_schedules — one row per family (PK on family_id enforces it).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bell_schedules (
  family_id UUID PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,

  -- Uniform building blocks. A class is `period_minutes` long; the gap after
  -- a class is `small_break_minutes`, except right after the big-break period
  -- where it's `big_break_minutes`.
  period_minutes SMALLINT NOT NULL DEFAULT 45 CHECK (period_minutes BETWEEN 1 AND 180),
  small_break_minutes SMALLINT NOT NULL DEFAULT 5 CHECK (small_break_minutes BETWEEN 0 AND 120),
  big_break_minutes SMALLINT NOT NULL DEFAULT 20 CHECK (big_break_minutes BETWEEN 0 AND 120),

  -- How many class slots a band can have. Caps the derived grid; the actual
  -- number of classes a day is whatever the timetable entries define.
  max_periods SMALLINT NOT NULL DEFAULT 7 CHECK (max_periods BETWEEN 1 AND 12),

  -- Morning band.
  morning_start TIME NOT NULL DEFAULT '08:00',
  morning_big_break_after SMALLINT NOT NULL DEFAULT 2
    CHECK (morning_big_break_after BETWEEN 0 AND 12),

  -- Regular afternoon band (no pred-čas).
  afternoon_start TIME NOT NULL DEFAULT '14:00',
  afternoon_big_break_after SMALLINT NOT NULL DEFAULT 2
    CHECK (afternoon_big_break_after BETWEEN 0 AND 12),

  -- Afternoon band WITH the leading "pred-čas": the day starts an hour
  -- earlier (13:00) and the big break slides one class later (after the 3rd).
  -- Applied per child via `school_shift_anchors.afternoon_uses_predcas`.
  afternoon_predcas_start TIME NOT NULL DEFAULT '13:00',
  afternoon_predcas_big_break_after SMALLINT NOT NULL DEFAULT 3
    CHECK (afternoon_predcas_big_break_after BETWEEN 0 AND 12),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed a default schedule for every existing family so the feature is usable
-- immediately; new families upsert one from the client on first edit.
INSERT INTO bell_schedules (family_id)
SELECT id FROM families
ON CONFLICT (family_id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- school_timetable_entries — one subject in one slot of one day.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_timetable_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized for RLS speed and so the week resolver pulls a family's
  -- whole timetable in one query (same pattern as activity_schedule).
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Rota label this row belongs to. 'A' = the weeks the child's shift
  -- resolves to morning, 'B' = afternoon weeks. A non-alternating child uses
  -- only one variant (whichever their anchor shift maps to).
  variant TEXT NOT NULL CHECK (variant IN ('A', 'B')),

  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),

  -- 1-based class slot WITHIN the band. Slot 1 is the first class of the day
  -- for that band (so for a pred-čas afternoon, slot 1 = the 13:00 pred-čas).
  -- The resolver maps this index onto the computed bell grid.
  period_index SMALLINT NOT NULL CHECK (period_index BETWEEN 1 AND 12),

  subject TEXT NOT NULL,
  -- Optional classroom / cabinet, shown as a subtitle on the block.
  room TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One subject per slot per (person, variant, day). Re-entering a slot edits
  -- the existing row rather than stacking two classes at the same time.
  UNIQUE (person_id, variant, day_of_week, period_index)
);

CREATE INDEX IF NOT EXISTS idx_timetable_entries_family ON school_timetable_entries(family_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_person ON school_timetable_entries(person_id);

-- ───────────────────────────────────────────────────────────────────────────
-- school_shift_anchors — decouple time band from the A/B rota.
-- ───────────────────────────────────────────────────────────────────────────

-- When set, the bell-schedule time band is ALWAYS this, regardless of which
-- shift the rota resolves to that week. NULL (the default) = use the rota's
-- own label as the band. 1st/2nd graders set this to 'morning': the rota still
-- flips A↔B (so their subjects rotate) but the day always starts in the morning.
ALTER TABLE school_shift_anchors
  ADD COLUMN IF NOT EXISTS fixed_time_band TEXT
    CHECK (fixed_time_band IN ('morning', 'afternoon'));

-- Whether THIS child's afternoon weeks use the pred-čas band (13:00 start, big
-- break after the 3rd) rather than the regular afternoon band (14:00, after
-- the 2nd). Defaults true since that's how most kids at the family's school go;
-- irrelevant for children whose `fixed_time_band` pins them to mornings.
ALTER TABLE school_shift_anchors
  ADD COLUMN IF NOT EXISTS afternoon_uses_predcas BOOLEAN NOT NULL DEFAULT true;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS — same family-scoped pattern as activities / events / payments.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE bell_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_timetable_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own family bell_schedule" ON bell_schedules FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family bell_schedule" ON bell_schedules FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family bell_schedule" ON bell_schedules FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family bell_schedule" ON bell_schedules FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view own family timetable" ON school_timetable_entries FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family timetable" ON school_timetable_entries FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family timetable" ON school_timetable_entries FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family timetable" ON school_timetable_entries FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- updated_at triggers (reuse the project-wide helper from the initial schema)
CREATE TRIGGER update_bell_schedules_updated_at BEFORE UPDATE ON bell_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_school_timetable_entries_updated_at BEFORE UPDATE ON school_timetable_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
