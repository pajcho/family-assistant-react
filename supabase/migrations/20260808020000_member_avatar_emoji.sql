-- Emoji avatar po clanu porodice, plus izbor kako se clanovi prikazuju.
--
-- Dve kolone, dve razlicite stvari - ne mesati ih:
--
--   avatar_emoji         SVOJSTVO CLANA. Emoji koji predstavlja tu osobu.
--                        Bira ga roditelj u Porodici, uz boju.
--   member_avatar_style  PODESAVANJE GLEDAOCA. Da li JA u svojoj aplikaciji
--                        vidim clanove kao inicijale sa bojom ili kao emoji.
--
-- Zasto se pol ne cuva i ne pogadja: u srpskom je jedini jak signal nastavak
-- -a za zensko, a na njemu padaju najcesca muska imena (Nikola, Luka, Sava,
-- Ilija, Aleksa, Andrija, Matija, Nemanja, Kosta), pa bi promasaj pogodio
-- konkretnog clana porodice. Zato eksplicitan izbor umesto nagadjanja - a
-- usput dete sme da bude jednorog ako hoce, sto je i poenta decje aplikacije.
--
-- NULL avatar_emoji = nije birano. Tada decja aplikacija i dalje prikazuje
-- deterministicku zivotinju izvedenu iz profiles.id (avatarForProfile), pa
-- nista nije prazno dok neko ne izabere. Zato NULL, a ne default vrednost:
-- "nije birano" i "izabrano bas ovo" moraju da se razlikuju.
--
-- member_avatar_style je namerno PO KORISNIKU, kao `accent`: jedan roditelj
-- moze da gleda inicijale a drugi emoji, bez uticaja na ostale. Podrazumevano
-- 'initials' jer u glavnoj aplikaciji boja nosi znacenje (njome su obojene
-- aktivnosti u nedeljnoj mrezi i kalendaru), a na velicini bedza se inicijali
-- citaju brze nego emoji. Decja aplikacija ovo podesavanje NE gleda - tamo je
-- emoji uvek, jer je plocica velika i dete ne cita inicijale dobro.
--
-- Upis na obe kolone pokriva postojeca RLS politika "Users can update own
-- profile" (za sebe) odnosno admin politika (za clanove bez naloga).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;

-- Kratko, ali ne po karakterima: jedan emoji zna da bude vise code pointa
-- (ZWJ sekvence, modifikatori tona koze), pa se granica postavlja na bajtove
-- da nijedan legitiman izbor ne bude odbijen. CHECK samo cuva bazu od smeca
-- kroz direktan upis; klijent bira iz fiksne liste.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_avatar_emoji_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_avatar_emoji_check
  CHECK (avatar_emoji IS NULL OR octet_length(avatar_emoji) BETWEEN 1 AND 32);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS member_avatar_style TEXT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_member_avatar_style_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_member_avatar_style_check
  CHECK (member_avatar_style IS NULL OR member_avatar_style IN ('initials', 'emoji'));

COMMENT ON COLUMN profiles.avatar_emoji IS
  'Emoji koji predstavlja ovog clana. NULL = nije birano, pada na deterministicku zivotinju iz id-a.';
COMMENT ON COLUMN profiles.member_avatar_style IS
  'Kako OVAJ korisnik vidi clanove u glavnoj aplikaciji. NULL = initials. Decja aplikacija ovo ne gleda.';
