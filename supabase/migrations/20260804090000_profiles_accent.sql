-- Redizajn 2.0: boja aplikacije (akcenat) po korisniku.
-- Dizajn jezik "Sljiva" su neutrale; akcenat je jedan token koji korisnik
-- bira u Podesavanja > Izgled. NULL = podrazumevana plava (brend boja).
-- Brend van aplikacije (PWA ikonica, login mark, splash) ostaje plav bez
-- obzira na izbor - akcenat vazi samo unutar aplikacije.
--
-- Zivi na profilu (ne per-device) da bi izbor pratio korisnika na svim
-- uredjajima; upis pokriva postojeca RLS politika "Users can update own
-- profile". Klijent ionako validira vrednost (normalizeAccent), ali CHECK
-- cuva bazu od smeca kroz direktan upis.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS accent TEXT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_accent_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_accent_check
  CHECK (accent IS NULL OR accent IN ('blue', 'purple', 'green', 'brown'));
