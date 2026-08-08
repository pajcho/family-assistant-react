-- Decji rezim - odvojena ljuska samo za citanje, za decu koja se prijavljuju
-- uredjajem i PIN-om umesto imejlom i lozinkom.
--
-- Model bezbednosti u jednom pasusu: detetov auth korisnik je SINTETICKI. Ima
-- generisanu adresu koju niko nikad ne vidi, nema lozinku i - sto je ovde
-- najvaznije - nema red u `profiles`. Svaka do sada napisana RLS politika
-- prepoznaje pozivaoca preko `profiles WHERE id = auth.uid()`, pa detetova
-- sesija po difoltu ne pogadja NISTA. Pristup se zatim vraca tabelu po tabelu,
-- uskim politikama SAMO ZA SELECT, vezanim za `public.kid_profile_id()`.
-- Tabela koju zaboravimo je detetu nevidljiva, a ne procurela - greska ide na
-- sigurnu stranu.
--
-- `kid_access.profile_id` ostaje ORIGINALNI id profila deteta. To je namerno
-- suprotno od `manage-family-login`, koji prekljucava `profiles.id` na novog
-- auth korisnika. Veza izmedju profila i sintetickog korisnika zivi jedino u
-- `kid_access.auth_user_id`, pa dete i dalje moze da bude ucesnik dogadjaja i
-- aktivnosti pod svojim starim id-jem, bez ijedne migracije podataka.
--
-- Gasenje pristupa je FK, ne kolona. `kid_access.auth_user_id` referise
-- `auth.users(id)` sa ON DELETE CASCADE, pa brisanje sintetickog auth
-- korisnika (to radi edge funkcija `kid-access`, akcija `disable`) samo od sebe
-- brise i red u `kid_access`. To je NAMERAN put za gasenje, ne slucajnost:
-- jednim potezom nestaju i sesija i svi redovi na kojima vise politike ispod.
-- `is_enabled` je samo mekana pauza (privremeno iskljuci bez brisanja uredjaja).
--
-- Prijava trazi DVA faktora: token uredjaja (koji roditelj zasadi jednokratnim
-- QR linkom) I PIN. Nema polja za korisnicko ime, pa se sa ekrana za prijavu
-- deca u porodici ne mogu ni nabrojati.
--
-- Bez pgcrypto - ne instaliramo ga. PIN se hesira u Denu (PBKDF2-SHA256,
-- 100000 iteracija, 16 bajtova soli) i ovde stize kao gotov string
-- `pbkdf2$<iters>$<saltB64>$<hashB64>`. Baza ga nikad ne racuna ni ne proverava.

-- ---------------------------------------------------------------------------
-- kid_access - jedan red po detetu; postojanje reda JE prekidac za feature
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kid_access (
  -- Bez ON UPDATE CASCADE ovaj red bi ostao siroce ako roditelj kasnije da
  -- detetu pravu prijavu (tada se `profiles.id` prekljucava na novi auth id).
  -- Invarijanta iz 20260602000000_family_admin.sql: svaki FK na profiles(id)
  -- do kog moze da dodje clan bez prijave MORA da kaskadira i na UPDATE.
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  -- Sinteticki auth korisnik. NULL samo u trenutku izmedju dva koraka u edge
  -- funkciji; brisanje korisnika brise ovaj red (vidi zaglavlje).
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Generisana adresa oblika ime.prezime.<8 hex>@porodica.local. Ne prikazuje
  -- se nigde u aplikaciji; postoji samo zato sto GoTrue trazi imejl.
  login_email TEXT NOT NULL UNIQUE,

  -- "pbkdf2$<iters>$<saltB64>$<hashB64>", racunato u Denu.
  pin_hash TEXT NOT NULL,

  is_enabled BOOLEAN NOT NULL DEFAULT true,

  -- Tema je jedina stvar koju dete sme da promeni, i to preko kid_set_theme().
  -- Kljucevi su engleski (KID_THEME_KEYS u src/types/kid.ts); srpski su samo
  -- natpisi u aplikaciji.
  theme TEXT NOT NULL DEFAULT 'ocean'
    CHECK (theme IN ('ocean', 'jungle', 'sun', 'candy', 'space')),

  -- Zakljucavanje posle previse promasenih PIN-ova. Broji i resetuje edge
  -- funkcija `kid-auth`; baza ovde samo cuva stanje.
  failed_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kid_access_family ON kid_access(family_id);

COMMENT ON TABLE kid_access IS
  'Decji pristup: veza izmedju profila deteta i sintetickog auth korisnika bez profila. Postojanje reda je prekidac za feature; brisanje auth korisnika kaskadno brise red.';

-- ---------------------------------------------------------------------------
-- kid_devices - uredjaji koje je roditelj povezao za dete
-- ---------------------------------------------------------------------------
-- Cuva se samo sha256 tokena. Sirov token zivi u localStorage tog uredjaja i
-- salje se pri svakoj prijavi; oduzimanje pristupa je obicno brisanje reda.
CREATE TABLE IF NOT EXISTS kid_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- Nagovestaj iz User-Agent zaglavlja u trenutku povezivanja ("iPhone", "Mac").
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_kid_devices_profile ON kid_devices(profile_id);
CREATE INDEX IF NOT EXISTS idx_kid_devices_family ON kid_devices(family_id);

COMMENT ON TABLE kid_devices IS
  'Povezani uredjaji deteta. Cuva se samo sha256 tokena; oduzimanje pristupa = brisanje reda.';

-- ---------------------------------------------------------------------------
-- kid_invites - jednokratni QR link kojim roditelj povezuje uredjaj
-- ---------------------------------------------------------------------------
-- Kratkog veka (15 minuta) i jednokratan (`used_at`). Isto kao kod uredjaja,
-- cuva se samo hes; sirov token se vraca tacno jednom, u odgovoru edge funkcije.
CREATE TABLE IF NOT EXISTS kid_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  -- Roditelj koji je napravio poziv. Bez FK namerno: red sme da nadzivi
  -- brisanje naloga roditelja, a vazi ionako samo 15 minuta.
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kid_invites_profile ON kid_invites(profile_id);
CREATE INDEX IF NOT EXISTS idx_kid_invites_expires ON kid_invites(expires_at);

COMMENT ON TABLE kid_invites IS
  'Jednokratni pozivi za povezivanje uredjaja (15 minuta). Samo servisna uloga: nema nijednu RLS politiku.';

-- ---------------------------------------------------------------------------
-- birthday_visibility - koji rodjendan koje dete vidi, i uz koju napomenu
-- ---------------------------------------------------------------------------
-- Rodjendani nemaju ucesnike, pa bez reda ovde nijedan rodjendan nije vidljiv
-- nijednom detetu. Namerno opt-in: rodjendani roditeljskih prijatelja i kolega
-- nemaju sta da traze u decjoj aplikaciji.
--
-- `note` je po detetu, ne po rodjendanu: jedno dete dobija "pozovi baku", drugo
-- "nacrtaj cestitku" za isti rodjendan.
CREATE TABLE IF NOT EXISTS birthday_visibility (
  birthday_id UUID NOT NULL REFERENCES birthdays(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Denormalizovano zbog RLS-a i dohvata cele porodice u jednom upitu
  -- (isti obrazac kao school_break_members).
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (birthday_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_birthday_visibility_person ON birthday_visibility(person_id);
CREATE INDEX IF NOT EXISTS idx_birthday_visibility_family ON birthday_visibility(family_id);

COMMENT ON TABLE birthday_visibility IS
  'Opt-in vidljivost rodjendana za decu, sa napomenom po detetu. Bez reda ovde rodjendan nijedno dete ne vidi.';

-- ---------------------------------------------------------------------------
-- RLS ukljucen na sve cetiri nove tabele
-- ---------------------------------------------------------------------------
ALTER TABLE kid_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE kid_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kid_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE birthday_visibility ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Pomocne funkcije - "ko je dete koje pita?"
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER iz istog razloga kao `is_family_admin` i
-- `auth_user_family_id`: citanje `kid_access` ide mimo RLS-a, pa politika nad
-- `kid_access` ne moze da se zavrti u samu sebe. Prazan search_path plus puna
-- kvalifikacija cuvaju od podmetanja search_path-a.
--
-- Obe vracaju NULL kad pozivalac nije dete (ili je pristup pauziran preko
-- `is_enabled`), pa poredjenje `kolona = public.kid_profile_id()` tada ispada
-- NULL, sto RLS tretira kao "ne" - bez ijednog dodatnog uslova.

CREATE OR REPLACE FUNCTION public.kid_profile_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT profile_id FROM public.kid_access
  WHERE auth_user_id = auth.uid()
    AND is_enabled;
$$;

CREATE OR REPLACE FUNCTION public.kid_family_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT family_id FROM public.kid_access
  WHERE auth_user_id = auth.uid()
    AND is_enabled;
$$;

COMMENT ON FUNCTION public.kid_profile_id() IS
  'Id profila deteta za tekucu sesiju, ili NULL ako pozivalac nije aktivno dete.';
COMMENT ON FUNCTION public.kid_family_id() IS
  'Id porodice deteta za tekucu sesiju, ili NULL ako pozivalac nije aktivno dete.';

REVOKE ALL ON FUNCTION public.kid_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kid_family_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kid_family_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- kid_set_theme - jedina izmena koju dete sme da uradi
-- ---------------------------------------------------------------------------
-- Namerno RPC, a ne UPDATE politika. Politika bi vazila za CEO red, pa bi dete
-- moglo da prepise `pin_hash`, `is_enabled` ili `family_id`. PostgreSQL nema
-- ogranicavanje kolona u USING/WITH CHECK - `profiles` politika
-- "Users can update own profile" je upravo taj presiroki oblik i ne zelimo je
-- ovde ponoviti. Funkcija dira tacno jednu kolonu i tacno jedan red.
CREATE OR REPLACE FUNCTION public.kid_set_theme(p_theme TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_theme IS NULL OR p_theme NOT IN ('ocean', 'jungle', 'sun', 'candy', 'space') THEN
    RAISE EXCEPTION 'Nepoznata tema: %', p_theme USING ERRCODE = '22023';
  END IF;

  UPDATE public.kid_access
    SET theme = p_theme
    WHERE auth_user_id = auth.uid()
      AND is_enabled;
END;
$$;

COMMENT ON FUNCTION public.kid_set_theme(TEXT) IS
  'Menja temu deteta koje poziva. Jedini upis koji decja sesija sme da uradi.';

REVOKE ALL ON FUNCTION public.kid_set_theme(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_set_theme(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Politike za dete - iskljucivo SELECT, i zasto se ne vrte u krug
-- ---------------------------------------------------------------------------
-- Izraz politike Postgres izvrsava sa pravima korisnika koji pita, pa se RLS
-- PRIMENJUJE i na svaku tabelu koju taj izraz pomene. Politika nad tabelom A
-- koja gleda u tabelu B povlaci sve politike tabele B; ako bi neka politika
-- tabele B gledala nazad u A, Postgres puca sa
-- "infinite recursion detected in policy for relation".
--
-- Zato su `kid_profile_id()` i `kid_family_id()` SECURITY DEFINER: citanje
-- `kid_access` unutar njih ide kao vlasnik funkcije i NE pokrece politiku nad
-- `kid_access`. Sve politike ispod koje samo porede kolonu sa tim funkcijama
-- su, dakle, listovi - ne pominju nijednu tabelu.
--
-- Graf zavisnosti (strelica = "politika ove tabele cita onu tabelu"):
--
--   events            -> event_participants     (list)
--   activities        -> activity_participants  (list)
--   activity_schedule -> activity_participants  (list)
--   birthdays         -> birthday_visibility    (list)
--   sve ostalo        -> (list)
--
-- Dubina je najvise jedan skok i nijedna od te cetiri "liste" ne gleda nazad,
-- pa ciklusa nema. Postoji i druga grana: posto se permisivne politike spajaju
-- sa OR, uz decju politiku nad npr. `event_participants` izvrsava se i
-- postojeca roditeljska, koja cita `profiles`. I to se zavrsava: obe SELECT
-- politike nad `profiles` su listovi (`auth.uid() = id` i definer funkcija
-- `auth_user_family_id()`), a `profiles` ne gleda ni u sta drugo. Isti obrazac
-- vec godinu dana radi za `events` -> `profiles`.
--
-- Pravilo za sutra: nova decja politika sme da cita samo tabelu koja je list.
-- Kad bi neko dodao politiku nad `event_participants` koja cita `events`,
-- ciklus bi nastao istog trenutka.

-- Ko je u porodici. Bez ovoga dete ne bi videlo ni svoje ime.
CREATE POLICY "Kid can view own family profiles" ON profiles FOR SELECT
  USING (family_id = public.kid_family_id());

-- VAZNO za onog ko ovo bude citao kasnije: `profiles` ima politiku
-- "Users can update own profile" FOR UPDATE USING (auth.uid() = id), koja NE
-- ogranicava kolone. Za dete je ona mrtvo slovo jer detetov auth uid nikad nije
-- jednak nijednom `profiles.id` (dete nema svoj red u `profiles` - to je cela
-- poenta modela). Zato ovde NEMA nijedne UPDATE, INSERT ni DELETE politike za
-- dete, nigde. Ako neko "usluzno" doda decju UPDATE politiku nad `profiles`,
-- otvorio je detetu ceo red, ukljucujuci `is_admin` i `family_id`. Jedina
-- dozvoljena izmena je tema, i ona ide kroz public.kid_set_theme().

CREATE POLICY "Kid can view own family" ON families FOR SELECT
  USING (id = public.kid_family_id());

-- Dogadjaji: samo oni na kojima je dete zavedeno kao ucesnik.
CREATE POLICY "Kid can view own event_participants" ON event_participants FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own events" ON events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_participants ep
      WHERE ep.event_id = events.id
        AND ep.person_id = public.kid_profile_id()
    )
  );

-- Aktivnosti: isti obrazac, plus raspored i izuzeci.
CREATE POLICY "Kid can view own activity_participants" ON activity_participants FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own activities" ON activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activity_participants ap
      WHERE ap.activity_id = activities.id
        AND ap.person_id = public.kid_profile_id()
    )
  );

CREATE POLICY "Kid can view own activity_schedule" ON activity_schedule FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activity_participants ap
      WHERE ap.activity_id = activity_schedule.activity_id
        AND ap.person_id = public.kid_profile_id()
    )
  );

-- Izuzeci vec nose person_id, pa im ne treba skok preko ucesnika.
CREATE POLICY "Kid can view own activity_overrides" ON activity_overrides FOR SELECT
  USING (person_id = public.kid_profile_id());

-- Skola: raspored casova i smena su licni, zvona i raspusti porodicni.
CREATE POLICY "Kid can view own timetable" ON school_timetable_entries FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own shift_anchors" ON school_shift_anchors FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own family bell_schedule" ON bell_schedules FOR SELECT
  USING (family_id = public.kid_family_id());

CREATE POLICY "Kid can view own family school_breaks" ON school_breaks FOR SELECT
  USING (family_id = public.kid_family_id());

CREATE POLICY "Kid can view own family school_break_members" ON school_break_members FOR SELECT
  USING (family_id = public.kid_family_id());

-- Rodjendani: samo oni koje je roditelj izricito otvorio ovom detetu.
CREATE POLICY "Kid can view own birthday_visibility" ON birthday_visibility FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own birthdays" ON birthdays FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM birthday_visibility bv
      WHERE bv.birthday_id = birthdays.id
        AND bv.person_id = public.kid_profile_id()
    )
  );

-- Svoj red u kid_access - odatle aplikacija cita temu.
-- Napomena: RLS je po redu, ne po koloni, pa dete tehnicki vidi i `pin_hash`
-- svog reda. To je hes njegovog SOPSTVENOG PIN-a, koji ionako zna napamet, pa
-- se ne dobija nista novo. Kolone se namerno ne oduzimaju GRANT-om, jer bi
-- `select=*` iz PostgREST-a tada pucao umesto da vrati red.
CREATE POLICY "Kid can view own kid_access" ON kid_access FOR SELECT
  USING (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Sta dete NAMERNO ne vidi
-- ---------------------------------------------------------------------------
-- Nijedne decje politike nema (niti sme da bude) na: payments,
-- payment_participants, payment_overrides, payment_history, expenses,
-- expense_categories, expense_items, receipts, receipt_items,
-- receipt_import_rate, incomes, income_entries, exchange_rates, lists,
-- list_items, notification_log, notification_preferences, push_subscriptions,
-- google_connections, google_calendars, google_sync_preferences,
-- external_calendar_events, external_event_local, kid_devices, kid_invites.
--
-- Novac, spiskovi, obavestenja i tudji kalendari nisu decja stvar. Posto RLS
-- podrazumevano zabranjuje sve, dovoljno je da ih ovde ne pomenemo - i zato je
-- ovaj spisak komentar, a ne kod.

-- ---------------------------------------------------------------------------
-- Roditeljska strana
-- ---------------------------------------------------------------------------

-- birthday_visibility - obican porodicni blok od cetiri politike. UPDATE
-- postoji zbog `note`, koji se menja iz forme rodjendana.
CREATE POLICY "Users can view own family birthday_visibility" ON birthday_visibility FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family birthday_visibility" ON birthday_visibility FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family birthday_visibility" ON birthday_visibility FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family birthday_visibility" ON birthday_visibility FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- kid_access i kid_devices - SAMO citanje, i to samo administratorima porodice.
-- Sve izmene idu kroz edge funkciju `kid-access` sa servisnom ulogom, jer
-- ukljucivanje pristupa istovremeno pravi i auth korisnika, sto klijent ne moze.
-- Nema INSERT/UPDATE/DELETE politike - to nije previd.
CREATE POLICY "Admins can view own family kid_access" ON kid_access FOR SELECT
  USING (public.is_family_admin(family_id));

CREATE POLICY "Admins can view own family kid_devices" ON kid_devices FOR SELECT
  USING (public.is_family_admin(family_id));

-- kid_invites nema NIJEDNU politiku, namerno. Red sadrzi hes tokena kojim se
-- povezuje uredjaj; klijentu nema sta da se prikaze osim isteka, a to edge
-- funkcija vraca u odgovoru. RLS je ukljucen, pa je tabela za sve osim servisne
-- uloge prazna.

-- ---------------------------------------------------------------------------
-- Realtime - decja sesija na porodicnom broadcast kanalu
-- ---------------------------------------------------------------------------
-- Sestra politici iz 20260729010000_family_broadcast_channel.sql. Ona resava
-- pozivaoca preko `profiles`, sto za dete ne radi (nema red), pa bi bez ove
-- politike detetu prijava na kanal bila odbijena i ekran se ne bi osvezavao dok
-- ne uradi refetch. `kid_family_id()` vraca NULL za sve koji nisu deca, a
-- `topic() = 'family:' || NULL` je NULL, dakle "ne".
DROP POLICY IF EXISTS "Kids read their family topic" ON realtime.messages;

CREATE POLICY "Kids read their family topic"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (realtime.topic() = 'family:' || public.kid_family_id()::TEXT);

-- ---------------------------------------------------------------------------
-- Trigeri
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_kid_access_updated_at ON kid_access;
CREATE TRIGGER update_kid_access_updated_at BEFORE UPDATE ON kid_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Broadcast SAMO za birthday_visibility. Mapiranje na query kljuceve je u
-- src/hooks/useFamilyChannel.ts (TABLE_INVALIDATIONS) - to dvoje ide u paru.
--
-- kid_access, kid_devices i kid_invites NAMERNO nemaju broadcast: menjaju se
-- pri svakoj prijavi deteta (last_login_at, last_seen_at, failed_attempts), pa
-- bi svakoj porodici slali cistu buku. Ekrani roditelja koji to prikazuju
-- osvezavaju se posle sopstvene mutacije.
DROP TRIGGER IF EXISTS broadcast_family_change ON birthday_visibility;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON birthday_visibility
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();
