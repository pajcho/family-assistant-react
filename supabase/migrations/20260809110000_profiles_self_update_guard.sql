-- ---------------------------------------------------------------------------
-- Self-update nad `profiles` vise ne sme da dira privilegije
-- ---------------------------------------------------------------------------
-- Stara politika je glasila:
--
--   CREATE POLICY "Users can update own profile" ON profiles
--     FOR UPDATE USING (auth.uid() = id);
--
-- Bez WITH CHECK-a i bez ikakvog ogranicenja po kolonama. Posto se permisivne
-- politike sabiraju sa OR, admin politika "Admins can update family profiles"
-- je time cuvala samo TUDJE redove - svoj red je svaki clan mogao da prepise
-- ceo. Odatle dve rupe, obe dohvatljive obicnim klijentskim pozivom
-- supabase.from("profiles").update():
--
--   1. Podizanje privilegija: clan sam sebi postavi is_admin = true i dobije
--      sve sto admin sme (PIN i uredjaji deteta, otvaranje i gasenje naloga,
--      izmena sastava porodice, preimenovanje porodice).
--   2. Preuzimanje druge porodice: clan sam sebi prepise family_id. Posto
--      svaka politika u semi racuna pripadnost preko
--      `family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())`,
--      sa tom jednom kolonom seli se ceo opseg podataka koji sesija vidi -
--      dogadjaji, placanja, troskovi, racuni, primanja, rodjendani.
--
-- Nova politika uz USING dobija i WITH CHECK koji NOVI red poredi sa redom
-- kakav vec stoji u tabeli: sme da se menja sve osim `is_admin` i `family_id`.
-- Kolona `id` ne moze da se promeni jer je i USING i WITH CHECK vezuju za
-- auth.uid().
--
-- Zasto politika, a ne BEFORE UPDATE triger: triger bi se okidao i za
-- service_role, a edge funkcija `manage-family-login` bas preko service_role
-- kljuca radi `UPDATE profiles SET id = <novi auth id>` (pri otvaranju naloga
-- clanu bez logina) i `UPDATE profiles SET is_admin = false` (pri gasenju
-- naloga). RLS politike se na service_role ne primenjuju, pa taj put ostaje
-- netaknut.
--
-- Podupit nad `profiles` unutar politike NAD `profiles` se ovde ne vrti u
-- krug: SELECT politike te tabele su listovi (`auth.uid() = id` i definer
-- funkcije `auth_user_family_id()` / `kid_family_id()`), pa se sirenje zavrsi
-- posle jednog skoka. Svoj red korisnik uvek vidi kroz "Users can view own
-- profile", a `is_admin` i `family_id` su NOT NULL, pa podupit nikad ne vrati
-- NULL onome ko uopste sme da radi izmenu.
--
-- Sta ovo NE dira: politika "Admins can update family profiles" ostaje ista,
-- pa admin i dalje menja tudje redove, ukljucujuci is_admin. Decja sesija
-- nema red u `profiles`, pa je za nju i stara i nova politika mrtvo slovo.
--
-- Pravilo za sutra: svaka nova kolona na `profiles` je pod ovom politikom
-- automatski self-writable. Ako nova kolona nosi privilegiju, mora u istoj
-- migraciji da udje i u WITH CHECK ispod.

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid())
    AND family_id = (SELECT p.family_id FROM public.profiles p WHERE p.id = auth.uid())
  );

COMMENT ON POLICY "Users can update own profile" ON profiles IS
  'Clan menja svoj red, ali ne i is_admin, family_id niti id.';
