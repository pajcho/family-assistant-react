-- Cetiri tabele koje su ostale van porodicnog broadcast kanala.
--
-- 20260729010000_family_broadcast_channel.sql je zakacio trigere na 22 tabele i
-- u komentaru trazio da se ta lista drzi u koraku sa TABLE_INVALIDATIONS u
-- src/hooks/useFamilyChannel.ts. Cetiri su ipak ostale napolju:
--
--   receipts, receipt_items - nastale kasnije (20260803000000_receipt_entities.sql)
--     i tada je odluceno da im broadcast ne treba, jer "svaka izmena koja je
--     bitna drugim ekranima dira i `expenses`". Podela racuna
--     (20260803120000_receipt_split_rpcs.sql) je to promenila: preuzimanje
--     stavke je UPDATE nad `receipt_items` bez ijednog upisa u `expenses`, pa
--     clan B gleda zastarelo vlasnistvo linija i onda uleti u PT409 sudar oko
--     preuzimanja koji nije morao da se desi.
--   profiles - preimenovanje clana, emodzi, boja. Menja se retko, ali se vidi
--     na svakom ekranu koji crta ucesnike.
--   families - preimenovanje porodice i lista ukljucenih valuta.
--
-- kid_access, kid_devices i kid_invites i dalje NAMERNO nemaju broadcast (vidi
-- kraj 20260808000000_kid_mode.sql), kao ni expense_items, koji je zamrznut.

-- ---------------------------------------------------------------------------
-- 1. Tabele koje nose `family_id` - deljena funkcija radi bez izmene
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'profiles',
    'receipt_items',
    'receipts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE WARNING 'broadcast_family_change: table public.% not found, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS broadcast_family_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER broadcast_family_change
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change()',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. families - jedina tabela kojoj deljena funkcija ne moze da posluzi
-- ---------------------------------------------------------------------------
-- `broadcast_family_change` cita `NEW.family_id`; porodica svoj kljuc drzi u
-- `id`. Kacenje deljene funkcije na `families` ne pukne pri kreiranju triger
-- nego tek pri prvom upisu, i to tako da PADNE ceo UPDATE:
--   ERROR: record "new" has no field "family_id"
--   CONTEXT: PL/pgSQL assignment "fam := NEW.family_id"
-- (provereno na kopiji seme, 2026-08-09). Zato ovde stoji druga funkcija sa
-- istim telom i jednom izmenjenom linijom, umesto da se deljena funkcija
-- prosiruje grananjem po TG_TABLE_NAME - ona se vrti na svakoj izmeni u 25
-- tabela i nema razloga da placa proveru koja se tice jedne.

CREATE OR REPLACE FUNCTION public.broadcast_families_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fam UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    fam := OLD.id;
  ELSE
    fam := NEW.id;
  END IF;

  IF fam IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
      'change',
      'family:' || fam::TEXT,
      true
    );
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.broadcast_families_change() IS
  'AFTER trigger za families: ista poruka kao broadcast_family_change, samo se id porodice cita iz kolone id.';

DROP TRIGGER IF EXISTS broadcast_family_change ON public.families;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_families_change();
