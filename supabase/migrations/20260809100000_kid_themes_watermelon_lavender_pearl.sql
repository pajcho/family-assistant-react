-- Tri nove decje teme: Lubenica, Lavanda i Biser (5 -> 8).
--
-- Kljucevi su engleski, kao i svi ostali: 'watermelon', 'lavender', 'pearl'.
-- Srpski postoji samo kao natpis u aplikaciji (KID_THEME_OPTIONS u
-- src/types/kid.ts).
--
-- Spisak tema stoji na DVA mesta u bazi, i oba moraju da se prosire zajedno:
-- CHECK nad `kid_access.theme` i telo funkcije `public.kid_set_theme`. Da je
-- prosiren samo CHECK, RPC bi i dalje odbijao nove kljuceve porukom
-- "Nepoznata tema"; da je prosireno samo telo funkcije, UPDATE unutar nje bi
-- pukao na CHECK-u. Nema smanjenja skupa, pa nema ni migracije podataka.

-- ---------------------------------------------------------------------------
-- 1. CHECK nad kolonom
-- ---------------------------------------------------------------------------
-- Ogranicenje je u 20260808000000_kid_mode.sql napisano unutar CREATE TABLE, pa
-- mu je Postgres sam dao ime `kid_access_theme_check`. Ovde ga rusimo i vracamo
-- pod istim imenom, da bi sledeca ovakva migracija imala sta da nadje.
ALTER TABLE kid_access DROP CONSTRAINT IF EXISTS kid_access_theme_check;

ALTER TABLE kid_access
  ADD CONSTRAINT kid_access_theme_check
  CHECK (theme IN ('ocean', 'jungle', 'sun', 'candy', 'watermelon', 'lavender', 'pearl', 'space'));

-- ---------------------------------------------------------------------------
-- 2. kid_set_theme - jedini upis koji decja sesija sme da uradi
-- ---------------------------------------------------------------------------
-- Prepisana definicija iz 20260808000000_kid_mode.sql, promenjen je samo spisak
-- u IF-u. Razlog zasto je ovo RPC a ne UPDATE politika stoji tamo: politika bi
-- vazila za CEO red, pa bi dete moglo da prepise `pin_hash` ili `is_enabled`.
CREATE OR REPLACE FUNCTION public.kid_set_theme(p_theme TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_theme IS NULL OR p_theme NOT IN (
    'ocean', 'jungle', 'sun', 'candy', 'watermelon', 'lavender', 'pearl', 'space'
  ) THEN
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

-- CREATE OR REPLACE cuva postojeca prava, ali ih ponavljamo da bi funkcija bila
-- ispravno zatvorena i kad se ova migracija primeni na bazu bez prethodne.
REVOKE ALL ON FUNCTION public.kid_set_theme(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_set_theme(TEXT) TO authenticated;
