-- Osvezi `profiles_with_login` da vidi i `avatar_emoji`.
--
-- Pogled je definisan kao `SELECT p.*, ...`, ali Postgres zamrzne listu kolona
-- u trenutku kreiranja - kolone dodate posle toga se NE pojavljuju same. Isti
-- korak je vec jednom bio potreban kada je dodat `is_admin` (vidi
-- 20260602000000_family_admin.sql).
--
-- Bez ovoga `useFamilyMembers` cita ceo roster kroz pogled i dobija redove BEZ
-- `avatar_emoji`, pa bi izbor roditelja legao u bazu a nigde se ne bi video:
-- ni bedzevi u glavnoj aplikaciji ni plocice u decjoj.
--
-- DROP + CREATE, a ne CREATE OR REPLACE: nove kolone se ubacuju PRE zavrsne
-- `has_login`, sto menja redosled kolona, a REPLACE to ne dozvoljava.
--
-- Usput ulaze i `onboarding_hidden_at`, `nav_slots` i `accent`, koje je isti
-- zamrznuti spisak drzao napolju. Nista se time ne otkriva: RLS politika
-- "family profiles" ionako dozvoljava clanu porodice da procita ceo red iz
-- `profiles`, a pogled je `security_invoker = true`, pa se ta ista politika
-- primenjuje i ovde.
DROP VIEW IF EXISTS public.profiles_with_login;
CREATE VIEW public.profiles_with_login
WITH (security_invoker = true)
AS
SELECT
  p.*,
  public.profile_has_login(p.id) AS has_login
FROM public.profiles p;

GRANT SELECT ON public.profiles_with_login TO authenticated;
