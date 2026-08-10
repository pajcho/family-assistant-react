-- Licna lista vise ne salje push celoj porodici.
--
-- `notify_on_list_create` je od 20260520250000_notify_on_create.sql bio
-- FOR EACH ROW bez ijednog uslova, a `notify-on-create` salje svakom profilu u
-- porodici (index.ts, upit nad `profiles` po `family_id`) i stavlja ime entiteta
-- u telo poruke. Znaci: lista sa `scope = 'personal'`, cija je cela poenta da je
-- drugi ne vide, objavila je svoj naslov na zakljucanom ekranu svim ukucanima.
-- RLS to nikad nije dozvolio (politika iz 20260520200000_lists_feature.sql
-- pusta licnu listu samo vlasniku), a i zaglavlje broadcast migracije
-- 20260729010000 izricito racuna sa istim pravilom kad objasnjava zasto poruka
-- ne nosi ceo red. Push put je jedini koji to pravilo nikad nije dobio.
--
-- Uslov stoji u WHEN, a ne u telu funkcije: tako se `notify_family_on_entity_create`
-- ne menja (deli je jos triger za dogadjaje, placanja i rodjendane), a za licnu
-- listu se ne potrosi ni jedan `net.http_post`.
--
-- Prelazak licne liste u porodicnu kasnije je UPDATE, ne INSERT, pa push za nju
-- ne stize - to je isto ponasanje kao i do sada za svaku vec kreiranu listu.

DROP TRIGGER IF EXISTS notify_on_list_create ON lists;

CREATE TRIGGER notify_on_list_create
  AFTER INSERT ON lists
  FOR EACH ROW
  WHEN (NEW.scope = 'family')
  EXECUTE FUNCTION notify_family_on_entity_create('list');
