-- ON UPDATE CASCADE na tri zaostala strana kljuca ka profiles(id).
--
-- 20260602000000_family_admin.sql je uveo pravilo: SVAKI strani kljuc ka
-- profiles(id) koji clan BEZ naloga moze da popuni mora da nosi ON UPDATE
-- CASCADE. Razlog je nacin na koji se clan promovise u pravi nalog -
-- supabase/functions/manage-family-login pravi auth korisnika pa uradi
-- `UPDATE profiles SET id = <novi auth id>`, da bi sva istorija tog clana
-- (aktivnosti, raspored, smene) presla na novi identitet. Bez CASCADE-a taj
-- UPDATE puca na FK gresci i promocija se rollbackuje.
--
-- Tri tabele dodate posle tog pravila su ga propustile i stoje na NO ACTION:
--
--   event_participants.person_id
--   payment_participants.person_id
--   school_break_members.person_id
--
-- Sve tri dete stvarno popunjava - deca su ucesnici dogadjaja, ucesnici
-- placanja i clanovi skolskih raspusta. Znaci promocija bilo kog deteta koje
-- ima red u nekoj od njih danas puca. Bag je zatecen, nije uveden decjim
-- rezimom, ali se na njemu lako pogadja, pa ide kao zasebna migracija koja ne
-- zavisi ni od cega iz te price.
--
-- Popravka je isti DROP + ADD ples kao sekcija 2 pomenute migracije. ON DELETE
-- ponasanje se ne dira: sve tri su bile i ostaju ON DELETE CASCADE (brisanje
-- clana uklanja njegovo ucesce, ne i sam dogadjaj / placanje / raspust).
--
-- Nema prepravke podataka - menja se samo pravilo, ne redovi.

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
