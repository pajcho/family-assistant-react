-- kid_register_pin_failure - brojac promasenih PIN-ova u JEDNOM iskazu.
--
-- Do sada je `kid-auth` citao `failed_attempts` iz reda ucitanog ranije, dodavao
-- jedinicu u JS-u i upisivao APSOLUTNU vrednost nazad. Dva istovremena pogodka
-- procitaju istu vrednost i upisu isti rezultat, pa N paralelnih pokusaja kosta
-- JEDAN strajk. Zaglavlje same funkcije kaze da je zakljucavanje - a ne hes -
-- ono sto cetvorocifreni PIN cini odbranjivim, tako da je oslabljena tacno ona
-- kontrola na koju se dizajn oslanja.
--
-- Ovde se citanje i pisanje dese u jednom UPDATE-u: drugi poziv ceka na
-- kljucanju reda, pa posle commit-a prvog ponovo procita SVEZU vrednost
-- (READ COMMITTED re-check) i doda svoju jedinicu. Rezultat je +2, ne +1.
--
-- Semantika je namerno identicna dosadasnjoj:
--   * promasaj koji NE dostize prag samo uveca brojac;
--   * promasaj koji dostigne prag postavi `locked_until` i VRATI brojac na 0,
--     tako da sledeci prozor krece cist umesto da se zakljucava na svaki dalji
--     pokusaj;
--   * zatecen `locked_until` iz proslosti se ne dira (kao ni do sada) - njega
--     edge funkcija ionako procenjuje pre poziva.
--
-- Prag i trajanje stizu kao argumenti da bi ostali tamo gde vec zive
-- (MAX_PIN_ATTEMPTS / LOCKOUT_MINUTES u supabase/functions/kid-auth/index.ts,
-- ogledani u KID_MAX_PIN_ATTEMPTS u src/types/kid.ts). Baza i dalje samo cuva
-- stanje, kao sto kaze komentar uz kolone u 20260808000000_kid_mode.sql.

CREATE OR REPLACE FUNCTION public.kid_register_pin_failure(
  p_profile_id UUID,
  p_max_attempts INT,
  p_lock_seconds INT
)
RETURNS TABLE (failed_attempts SMALLINT, locked_until TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.kid_access AS k
     SET failed_attempts =
           CASE WHEN k.failed_attempts + 1 >= p_max_attempts
                THEN 0
                ELSE k.failed_attempts + 1
           END,
         locked_until =
           CASE WHEN k.failed_attempts + 1 >= p_max_attempts
                THEN now() + make_interval(secs => p_lock_seconds)
                ELSE k.locked_until
           END
   WHERE k.profile_id = p_profile_id
  RETURNING k.failed_attempts, k.locked_until;
$$;

COMMENT ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT) IS
  'Belezi jedan promasen PIN atomicno i vraca stanje posle upisa. Poziva je iskljucivo edge funkcija kid-auth servisnom ulogom.';

-- Samo servisna uloga. `kid-auth` je jedini pozivalac i radi service role
-- kljucem; dete i gost ovde nemaju sta da traze - moglo bi da im posluzi za
-- zakljucavanje tudjeg naloga bez ijednog pokusaja prijave. REVOKE mora da
-- imenuje i anon i authenticated, jer im ALTER DEFAULT PRIVILEGES nad semom
-- public daje EXECUTE vec u trenutku kreiranja (REVOKE FROM PUBLIC to ne skida).
REVOKE ALL ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kid_register_pin_failure(UUID, INT, INT)
  TO service_role;
