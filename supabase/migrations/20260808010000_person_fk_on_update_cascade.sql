-- ON UPDATE CASCADE on the three foreign keys to profiles(id) that were missed.
--
-- 20260602000000_family_admin.sql introduced the rule: EVERY foreign key to
-- profiles(id) that a member WITHOUT a login can fill must carry ON UPDATE
-- CASCADE. The reason is how a member is promoted to a real account -
-- supabase/functions/manage-family-login creates an auth user and then runs
-- `UPDATE profiles SET id = <new auth id>`, so that all of that member's
-- history (activities, timetable, shifts) moves onto the new identity. Without
-- CASCADE that UPDATE fails on an FK error and the promotion is rolled back.
--
-- Three tables added after that rule missed it and sit at NO ACTION:
--
--   event_participants.person_id
--   payment_participants.person_id
--   school_break_members.person_id
--
-- A child really does fill all three - children are event participants,
-- payment participants and members of school breaks. So promoting any child
-- with a row in one of them fails today. The bug was pre-existing, not
-- introduced by kid mode, but kid mode makes it easy to hit, so it ships as a
-- separate migration that depends on nothing from that story.
--
-- The fix is the same DROP + ADD dance as section 2 of that migration. The ON
-- DELETE behaviour is untouched: all three were and remain ON DELETE CASCADE
-- (deleting a member removes their participation, not the event / payment /
-- break itself).
--
-- No data is rewritten - only the rule changes, not the rows.

-- ---------------------------------------------------------------------------
-- event_participants
-- ---------------------------------------------------------------------------
ALTER TABLE event_participants
  DROP CONSTRAINT IF EXISTS event_participants_person_id_fkey;

ALTER TABLE event_participants
  ADD CONSTRAINT event_participants_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- payment_participants
-- ---------------------------------------------------------------------------
ALTER TABLE payment_participants
  DROP CONSTRAINT IF EXISTS payment_participants_person_id_fkey;

ALTER TABLE payment_participants
  ADD CONSTRAINT payment_participants_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- school_break_members
-- ---------------------------------------------------------------------------
ALTER TABLE school_break_members
  DROP CONSTRAINT IF EXISTS school_break_members_person_id_fkey;

ALTER TABLE school_break_members
  ADD CONSTRAINT school_break_members_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
