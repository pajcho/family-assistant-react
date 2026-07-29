# Plan skaliranja: priprema za 100+ porodica

Napisano: 2026-07-28.
Kontekst: analiza opterećenja za scenario od ~100 porodica / ~150 auth korisnika
sa dnevnim korišćenjem.

Ovaj dokument se NE linkuje iz README-a (ista konvencija kao `IMPROVEMENT_PLAN.md`).

## Status (2026-07-29)

| RP             | Stanje               | Šta je urađeno                                                                                                                                |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| RP-4 merenje   | ✅ kod, ⏳ dashboard | `scripts/measure-cron-queries.sh` (seed / measure / cleanup), brojevi ispod. Spend cap i CPU alarm ostaju ručni koraci u Supabase dashboardu. |
| RP-1 cron      | ✅                   | `send-due-pushes` prepisan na bulk upite + jedan claim upsert. 512 -> 12 PostgREST zahteva po ticku.                                          |
| RP-3 retencija | ✅                   | `20260729000000_notification_log_retention.sql`, dnevni `cron` posao, 7 dana.                                                                 |
| RP-2 realtime  | ✅                   | `20260729010000_family_broadcast_channel.sql` + `src/hooks/useFamilyChannel.ts`. 14 kanala -> 1 po porodici.                                  |

Sve je verifikovano lokalno (`supabase start` + `pnpm dev`). Prod ide u tri
koraka: merge ovog PR-a (Pages sam deployuje frontend), pa `supabase db push`
za dve migracije, pa `supabase functions deploy send-due-pushes` (edge funkcije
ne idu kroz CI).

---

## 1. Zašto ovaj plan postoji

Pregled kvota za 100 porodica na Supabase Pro planu pokazao je da **nijedna
platformska kvota nije ni blizu problema**. Sve što nas može zaustaviti je u
našem kodu.

| Dimenzija          | Procena na 100 porodica | Uključeno u Pro | Iskorišćeno   |
| ------------------ | ----------------------- | --------------- | ------------- |
| MAU                | 150                     | 100.000         | 0,15%         |
| Veličina baze      | ~250 MB/god             | 8 GB            | 3%/god        |
| Egress             | ~2-3 GB/mes             | 250 GB          | ~1%           |
| Edge funkcije      | ~96.000/mes             | 2.000.000       | ~5%           |
| Realtime konekcije | ~150 vrh                | 500             | 30%           |
| Realtime poruke    | ~0,02/s                 | 500/s           | <1%           |
| Channel joins      | do ~85/s u naletu       | 500/s           | 17%           |
| **Compute**        | **~75-80 qps stalno**   | Micro/Small     | **usko grlo** |

Zaključak: ostajemo na Supabase-u. Ulažemo u ove popravke umesto u migraciju.
Sa njima putanja do ~1.000 korisnika ne traži promenu platforme.

### Dve stvari koje već radimo kako treba

Ovo ne dirati, jer su razlog što stvari uopšte rade na ovoj skali:

1. **Frontend je na GitHub Pages**, ne ide kroz Supabase. Kroz Supabase ide samo
   JSON, pa je egress zanemarljiv.
2. **Realtime je strogo ograničen na porodicu.** Do RP-2 preko server-side
   filtera `family_id=eq.${familyId}` na svakom `postgres_changes` kanalu, od
   RP-2 preko topic-a `family:<id>` i RLS politike na `realtime.messages`. Bez
   toga bi upis u jednoj porodici išao svim ostalima i ovo bi puklo odmah.

---

## 2. Izmeren polazni podatak

Merenje nad `supabase/functions/send-due-pushes/index.ts` (1.208 linija),
koji se vrti **svakog minuta** preko `pg_cron`.

Funkcija ima **pet** putanja otpreme:

| Putanja                    | Linija | Obrazac                     | Upita/min na 150 korisnika |
| -------------------------- | ------ | --------------------------- | -------------------------- |
| `processDigest`            | 127    | N+1 po korisniku            | ~900                       |
| `processEventReminders`    | 248    | N+1 po događaju pa po članu | ~1.100                     |
| `processExternalReminders` | 394    | N+1                         | ~500                       |
| `processPaymentReminders`  | 547    | N+1 po plaćanju pa po članu | ~1.650                     |
| `processActivityReminders` | 799    | **već set-based**           | ~150-300                   |
|                            |        | **UKUPNO**                  | **~4.500 (≈75 qps)**       |

Sedamdeset pet upita u sekundi, 24/7, bez obzira da li išta treba poslati.
Raste **linearno sa brojem korisnika**: na 1.000 korisnika je ~500 qps čistog
rasipanja, i compute nikad ne miruje pa nikad ne može da se smanji.

### Ključni nalaz: obrazac već postoji u kodu

`processActivityReminders` (linija 799) **je već napisan kako treba**: radi 8
bulk upita u jednom `Promise.all`, pa sve spajanje radi u memoriji preko mapa.

```ts
await Promise.all([
  supabase.from("activities").select(...),
  supabase.from("activity_schedule").select(...),
  supabase.from("activity_participants").select("activity_id, person_id"),
  supabase.from("activity_overrides").select(...),
  supabase.from("school_shift_anchors").select(...),
  supabase.from("notification_preferences").select("user_id, timezone"),
  supabase.from("profiles").select("id, family_id, first_name, last_name"),
  supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth"),
]);
```

**Ne treba izmišljati arhitekturu. Treba preslikati ovaj obrazac na preostale
četiri putanje.** To ceo posao svodi na refaktorisanje po uzoru na postojeći kod,
što je bitno manji rizik nego redizajn.

### Izmereno pre i posle (RP-4 + RP-1)

Lokalni stack, sintetički teret od 10 porodica x 4 člana (40 korisnika),
5 događaja i 5 plaćanja po porodici, svi sa uključenim digestima.
Merač: `scripts/measure-cron-queries.sh`, 3 ticka po režimu, brojevi iz
`pg_stat_statements`.

| Režim            | Metrika                | Pre   | Posle  |
| ---------------- | ---------------------- | ----- | ------ |
| običan tick      | PostgREST zahteva/tick | 512   | **12** |
| običan tick      | SQL statement-a/tick   | 1.033 | **37** |
| `?force=morning` | PostgREST zahteva/tick | 619   | **13** |
| `?force=morning` | SQL statement-a/tick   | 1.217 | **27** |

(Svaki PostgREST zahtev pravi bar dva statement-a: `set_config` preambulu i sam
upit. Razlika između 12 i 37 su konekcije koje pool otvara, ne upiti.)

Bitnije od faktora ~40: broj upita više **ne zavisi od broja porodica**. Pre je
bio ~500 zahteva na 40 korisnika, dakle ~1.900 na 150; posle je 12-13 bez obzira
na veličinu baze.

---

## 3. Radni paketi

Rangirano po odnosu koristi i truda. Preporučeni redosled je 1 -> 4 -> 2 -> 3
(vidi sekciju 4).

---

### RP-1: `send-due-pushes` na set-based upite

**Prioritet: najviši. Efekat: red veličine. Status: ✅ urađeno (2026-07-29).**

**Kako je izvedeno**

Funkcija je podeljena na dva fajla umesto da se krpi u mestu:

- `supabase/functions/send-due-pushes/plan.ts` - čista logika. Dobija sve redove
  i jedan `now`, vraća listu `PlannedClaim` (kome, koji `kind`, koji `ref_id`,
  koji payload). Nema Supabase klijenta, nema `web-push`, nema `Deno` globala,
  pa se vrti pod vitest-om: `plan.test.ts` (33 testa) pokriva vremenske zone,
  prelazak preko ponoći, A/B smene, override-e i tekst poruka.
- `index.ts` - samo ulaz/izlaz: bulk čitanja, `planDispatch`, jedan claim
  upsert, slanje, jedno brisanje mrtvih pretplata.

Odstupanja od plana, svesna:

- Umesto da se `notification_log` za tekući dan čita unapred, claim ide kroz
  `upsert(..., { onConflict, ignoreDuplicates: true }).select()`. `RETURNING`
  na `ON CONFLICT DO NOTHING` vraća **tačno one redove koje je ovaj tick upisao**,
  pa je idempotencija i dalje u Postgres-u, atomično, bez trke između čitanja i
  upisa. Provereno lokalno: drugi poziv istog minuta vrati 40x `already_sent` i
  ne napravi nijedan nov red.
- `now` se uzima jednom po ticku. Stari kod je zvao `new Date()` u svakom
  poređenju, pa je spor tick mogao da preskoči minut.
- Slanje ide u 8 paralelnih tokova (`SEND_CONCURRENCY`). Claim je već uzet kad
  se šalje, pa preklapanje mrežnih čekanja ništa ne menja u tome šta se šalje.

**Regresija provereno mehanički:** stari `index.ts` (iz `git show HEAD:`) i novi
su vrćeni kroz isti in-memory lažni Supabase klijent, minut po minut kroz ceo
dan (1.440 minuta x 2 ticka), na fiksiranom skupu podataka sa svih pet putanja,
sa i bez mrtvog push endpoint-a. Isti skup poslatih poruka, isti
`notification_log`, isto brisanje pretplata, isti statusi. Harness je bio
privremen i nije u repou; `plan.test.ts` je ono što ostaje.

**Trenutno stanje**
Četiri od pet putanja rade N+1: povuku listu, pa u petlji po svakom redu rade
dodatne upite. `dispatchActivityReminder` (linija 1035) i dalje radi
`notification_log` upit po primaocu, iako je putanja iznad njega set-based.

**Cilj**
Sve putanje po uzoru na `processActivityReminders`: nekoliko bulk upita na
početku zahteva, pa spajanje u memoriji.

Ciljna struktura:

```
1. Jedan Promise.all sa bulk upitima:
     - notification_preferences (svi)
     - profiles (svi, sa family_id)
     - push_subscriptions (sve)
     - notification_log za tekući dan (svi)
     - events / payments / birthdays / external_calendar_events sa podsetnicima
2. Indeksiranje u Map po user_id / family_id
3. Sve pet putanja rade nad tim mapama, bez novih upita
4. Jedan bulk insert u notification_log na kraju
5. Jedan bulk delete mrtvih push pretplata na kraju
```

**Očekivani rezultat: sa ~4.500 upita/min na ~10-15.**

**Koraci**

1. Izdvojiti postojeći bulk-fetch iz `processActivityReminders` u zajednički
   `loadDispatchContext()` koji vraća sve mape.
2. Prebaciti `processDigest` (127) na taj kontekst.
3. Prebaciti `processEventReminders` (248) + `dispatchEventReminder` (274).
4. Prebaciti `processPaymentReminders` (547) + `dispatchPaymentReminder` (576).
5. Prebaciti `processExternalReminders` (394) + `dispatchExternalReminder` (440).
6. Prebaciti `processActivityReminders` (799) da koristi zajednički kontekst
   umesto sopstvenog `Promise.all`.
7. Skupiti `notification_log` upise u jedan bulk `insert` sa
   `onConflict: "user_id,kind,ref_id"` i `ignoreDuplicates`.
8. Skupiti brisanja mrtvih pretplata (410/404) u jedan `delete().in("id", [...])`.

**Rizici i na šta paziti**

- **Idempotencija se NE sme pokvariti.** Trenutna zaštita je
  `UNIQUE(user_id, kind, ref_id)` na `notification_log`
  (`20260518000000_notification_system.sql:72`). Bulk insert mora da zadrži
  isto ponašanje, inače korisnici dobijaju duple push poruke.
- **Vremenske zone se računaju po korisniku.** `isCurrentMinute` (1165),
  `localTime` (1171), `localDateISO` (1184) moraju da rade nad istim ulazima kao
  sada. Ovo je najlakše mesto za tihu regresiju.
- Memorija: na 150 korisnika bulk fetch je trivijalan. Na 10.000+ bi trebalo
  paginirati, ali to je daleko van trenutnog horizonta.
- Funkcija je pod `verify_jwt = false` i štiti se `X-Cron-Secret` headerom
  (`supabase/config.toml`). Ne dirati taj deo.

**Verifikacija**

- Postojeći testovi: `supabase/functions/_shared/expandEvent.test.ts`.
- Ručno preko `?force=morning` i `?force=evening` knobova (traže `X-Cron-Secret`).
- Lokalni Supabase, uporediti broj upita pre i posle preko `pg_stat_statements`.
- Kontrolna provera: isti skup push poruka pre i posle, za isti fiksirani minut.

**Procena: 8-16h.**

---

### RP-2: 20 realtime kanala u jedan po porodici

**Prioritet: srednji. Efekat: skida limit na `channel joins/s` i per-subscriber
RLS proveru. Status: ✅ urađeno (2026-07-29).**

**Kako je izvedeno**

- `20260729010000_family_broadcast_channel.sql`: `public.broadcast_family_change()`
  (SECURITY DEFINER) okačen na 22 tabele, plus RLS politika na
  `realtime.messages`.
- Poruka nosi **samo** `{ table, op }`, ne ceo red. Klijentu ništa više ne treba
  za invalidaciju, a slanje celog reda bi lične liste (`lists.scope='personal'`)
  poslalo celoj porodici - tačno ono što RLS inače brani.
- `src/hooks/useFamilyChannel.ts` drži jednu privatnu pretplatu i mapira ime
  tabele na query key-eve. Montiran jednom, u `_app` layout ruti.
- Kad kanal ponovo uđe posle prekida veze, radi se `invalidateQueries` nad
  aktivnim upitima - broadcast nema replay, pa se poruke iz pauze ne vraćaju.
- Publikacija `supabase_realtime` je namerno netaknuta. Postgres changes i dalje
  radi za bilo koga ko je još pretplaćen (npr. stara Nuxt aplikacija); vađenje
  tabela iz publikacije je zaseban, kasniji korak.

**Sporedni efekat:** `useBirthdaysData` je postojao samo zato što je
`birthdays` kanal imao fiksan topic bez `useId()`, pa je drugo montiranje
pucalo. Sad je alias za `useBirthdaysList`.

**Verifikovano lokalno:** `supabase.realtime.getChannels()` vraća **1** kanal
(`realtime:family:<id>`, private, joined) na svim ekranima, uključujući
`/uskoro` gde je pre bilo 14. Upis pravo u Postgres (događaj, stavka liste,
trošak, plaćanje) stigne na otvoren ekran bez osvežavanja. RLS provera
simulirana u SQL-u: član porodice A vidi poruke svog topic-a, a 0 poruka na
topic-u porodice B.

**Trenutno stanje**
20 hook-ova otvara po jedan `postgres_changes` kanal. `useAgenda`
(`src/hooks/useAgenda.ts:121`) montira 14 njih odjednom, pa jedno otvaranje
aplikacije pravi 14 istovremenih join-ova.

Pun spisak kanala:

```
useActivities            useEvents               useLists
useActivitySchedule      useEventParticipants    useExpenseCategories
useActivityOverrides     usePayments             useExpenses
useActivityParticipants  usePaymentParticipants  useIncomes
useBirthdays             usePaymentOverrides     useIncomeEntries
useBellSchedule          useExternalEvents       useSchoolShifts
useSchoolTimetable       useExternalEventLocal
```

Limit na Pro planu je 500 join-ova/s. Deljeno sa 14 kanala po otvaranju daje
**~35 otvaranja aplikacije u sekundi** pre throttlinga. Na 150 korisnika prolazi
komotno; na 500+ postaje tesno tokom jutarnjeg push naleta.

Uz to, Supabase dokumentacija je eksplicitna da se kod `postgres_changes` svaka
promena RLS-proverava **po pretplatniku**, i zvanično preporučuju `Broadcast`
za veći obim.

**Cilj**
Jedan `broadcast` kanal po porodici (`family:${familyId}`), pa DB trigeri koji
zovu `realtime.broadcast_changes()`. Klijent mapira dolazni `table` na
odgovarajući `queryClient.invalidateQueries`.

**Koraci**

1. Migracija: trigeri sa `realtime.broadcast_changes()` na svih ~20 tabela,
   topic `family:${family_id}`.
2. RLS politika za `realtime.messages` tako da član porodice sme da čita samo
   svoj topic.
3. Novi hook `useFamilyChannel()` koji drži jednu pretplatu i radi dispatch po
   imenu tabele na postojeće query key-eve.
4. Ukloniti `.channel()` blok iz svih 20 hook-ova, zadržati `useQuery` deo.
5. Ukloniti `channelKey = useId()` obilaznicu, koja postoji samo zato što se
   isti kanal montirao više puta.

**Sporedna korist**
Nestaje cela klasa bagova tipa "nikad ne montiraj dva `useAgenda` odjednom"
(vidi komentare u `AgendaTodayTab.tsx:147` i `AgendaUpcomingTab.tsx:11`).

**Rizici**

- Ovo dodiruje **svaki** ekran koji prikazuje podatke. Radi se u zasebnom PR-u,
  ne mešati sa RP-1.
- Treba proveriti da invalidacija i dalje gađa iste query key-eve, uključujući
  one sa opsegom (`["events", familyId, { from, to }]`).
- Lokalni `supabase_realtime` nije `FOR ALL TABLES`, pa migracija mora da bude
  zaštićena kao i postojeće (vidi obrazac u ranijim migracijama).

**Verifikacija**

- Dva browsera, dva korisnika iste porodice: upis u jednom se vidi u drugom na
  svim ekranima (Danas, Uskoro, Liste, Budžet, Plaćanja).
- Provera da korisnik iz porodice A ne prima poruke porodice B.
- Brojanje otvorenih kanala u Network tabu: očekivano 1 umesto 14.

**Procena: 16-24h.**

---

### RP-3: retencija na `notification_log`

**Prioritet: nizak. Efekat: mali, ali trivijalno jeftino. Status: ✅ urađeno
(2026-07-29): `20260729000000_notification_log_retention.sql`, posao
`purge-notification-log` svakog dana u 03:17 UTC, prag 7 dana.**

**Trenutno stanje**
Tabela raste ~700 redova po porodici godišnje i nikad se ne čisti. Na 100
porodica to je ~70.000 redova godišnje bez ikakve svrhe posle nekoliko dana.
Služi isključivo kao idempotency zaštita za tekući dan.

Definicija: `supabase/migrations/20260518000000_notification_system.sql:72`.
Već postoji `idx_notification_log_sent_at`, pa je brisanje po `sent_at` jeftino.

**Koraci**

1. Migracija sa `cron.schedule` poslom, jednom dnevno:
   `DELETE FROM notification_log WHERE sent_at < NOW() - INTERVAL '7 days'`.
2. Pratiti postojeći obrazac iz `20260518100000_schedule_send_due_pushes.sql`
   (provera `cron.job` pa `cron.unschedule` pre ponovnog zakazivanja).

**Rizik**
Retencija mora da bude **duža** od najdužeg prozora idempotencije. Sedam dana je
komotno; ne spuštati ispod 2 dana zbog vremenskih zona.

**Procena: 1h.**

---

### RP-4: merenje i alarmi

**Prioritet: uraditi PRVI, da RP-1 ima sa čim da se uporedi.**

**Koraci**

1. ✅ Uključiti `pg_stat_statements` i snimiti polaznu sliku pre RP-1.
   Očekivano i potvrđeno: `notification_preferences` i `profiles` upiti iz
   `send-due-pushes` su bili 97% liste.
2. ⏳ Postaviti **spend cap** na Supabase organizaciji.
3. ⏳ Alarm na compute CPU preko 70% kao signal za sledeći tier.
4. ⏳ Pratiti u Supabase usage dashboardu: compute CPU, realtime peak connections,
   egress.
5. ✅ Zabeležiti polazne brojeve u ovaj dokument (sekcija 2).

Koraci 2-4 su klikovi u Supabase dashboardu, ne kod - ostaju za ručno.

**Alat**

`scripts/measure-cron-queries.sh`:

```
scripts/measure-cron-queries.sh seed      # 10 porodica x 4 clana + podsetnici
scripts/measure-cron-queries.sh measure   # reset pg_stat_statements pa 3 ticka
scripts/measure-cron-queries.sh cleanup   # obrise sinteticki teret
```

Sintetički teret je ograničen na porodice `ZZ scaling probe%` i korisnike sa
`@scaling-probe.local` mejlom, pa `cleanup` ne može da dodirne stvarne podatke.
Za `measure` edge funkcije moraju da se vrte sa custom secret-ima:
`supabase functions serve --env-file supabase/functions/.env.local`.

**Procena: 2-4h.**

---

## 4. Redosled izvršavanja

```
RP-4 (merenje)  ->  RP-1 (cron)  ->  RP-3 (retencija)  ->  RP-2 (realtime)
```

Obrazloženje:

- **RP-4 ide prvi** jer bez polazne slike nemamo čime da dokažemo da je RP-1
  pomogao.
- **RP-1 je najveći dobitak za najmanji rizik.** Menja samo edge funkciju, ne
  dira frontend, ima jasan uzor u postojećem kodu.
- **RP-3 je usputan**, uraditi ga dok je `notification_log` još svež u glavi
  posle RP-1.
- **RP-2 ide poslednji** jer dodiruje svaki ekran i traži najviše testiranja.
  Nije hitan na 150 korisnika, postaje bitan oko 500.

**Svaki RP je zaseban PR.** Ne mešati RP-1 i RP-2 u isti.

Ukupna procena: **27-45h.**

Izvršeno tim redom 2026-07-29. RP-1 i RP-2 ne dele nijedan fajl, pa bi se
cepali na dva PR-a bez konflikta, ali je vlasnik odlučio da idu zajedno jer su
verifikovani kao celina. U PR-u su odvojeni commit-i:

- RP-1 + RP-3: `supabase/functions/send-due-pushes/*`,
  `supabase/migrations/20260729000000_*`, `scripts/measure-cron-queries.sh`
- RP-2: `src/hooks/*`, `src/routes/_app.tsx`,
  `src/components/dashboard/Agenda*Tab.tsx`,
  `supabase/migrations/20260729010000_*`

Posledica: pošto je merge squash, prod revert vraća oba RP-a odjednom. Ako
zatreba vraćanje samo RP-2, radi se revert commit-a nad `src/` fajlovima, ne
revert celog merge-a.

---

## 5. Kada šta postaje hitno

| Porodica | Korisnika | Prvo usko grlo                 | Compute | ~$/mes | Šta mora biti gotovo     |
| -------- | --------- | ------------------------------ | ------- | ------ | ------------------------ |
| 100      | 150       | nema                           | Small   | ~$30   | RP-4, RP-1               |
| 300      | 450       | cron N+1                       | Medium  | ~$75   | + RP-3                   |
| 700      | 1.000     | joins/s + cron                 | Large   | ~$135  | + RP-2                   |
| 2.000+   | 3.000     | `postgres_changes` arhitektura | -       | -      | redizajn, van ovog plana |

Na 100 porodica to je ~$30 mesečno, odnosno $0,30 po porodici.

---

## 6. Šta NE raditi

Ovo je zabeleženo da se ne bi ponovo otvaralo u nekoj budućoj sesiji.

- **Ne migrirati sa Supabase-a.** Analizirani su SQLite/DigitalOcean (230-400h),
  Neon Data API (100-180h), Firebase Firestore (250-400h, uz gubitak relacionog
  modela) i Firebase SQL Connect (150-250h, uz povratak naplate po projektu).
  Nijedan se ne isplati naspram ~$30 mesečno kad aplikacija ima 100 porodica.
- **Ne prelaziti na compute tier veći od Small pre nego što RP-1 bude gotov.**
  Veći tier bi samo platio N+1 obrazac umesto da ga popravi.
- **Ne dodavati nove `postgres_changes` kanale.** Realtime ide isključivo kroz
  `family:<id>` broadcast. Nova tabela kojoj treba realtime ide na dva mesta:
  u listu triger tabela u
  `20260729010000_family_broadcast_channel.sql` (nova migracija, isti obrazac)
  i u `TABLE_INVALIDATIONS` u `src/hooks/useFamilyChannel.ts`. Triger bez mape
  je bačena poruka, mapa bez trigera je ekran koji se nikad ne osveži.
- **Ne montirati `useFamilyChannel` više puta.** Jedan kanal po topic-u; dva
  mounta na isti topic su tačno ono zbog čega su stari hook-ovi imali
  `useId()` sufiks.
- **Ne slati ceo red u broadcast poruci.** `{ table, op }` je dovoljno za
  invalidaciju, a ceo red bi probio RLS na ličnim listama.

---

## 7. Otvorena pitanja

- ~~Da li `processExternalReminders` treba da ostane odvojen od
  `processEventReminders`?~~ Ostaju odvojeni. Posle RP-1 dele isti kontekst i
  isti helper za vreme paljenja, a razlikuju se u tome što je kod eksternih
  `ref_id` `<ical_uid>:<local_date>` (id reda se menja pri svakom sync-u).
  Spajanje bi bilo grananje unutar jedne petlje, ne manje koda.
- Da li nam treba per-porodica rate limit na push slanju, ili je
  `notification_log` dovoljna zaštita? Posle RP-1 slanje ide u 8 paralelnih
  tokova, pa je ovo sad pitanje o push servisu, ne o bazi.
- Da li `send-due-pushes` treba i dalje da se vrti svakog minuta, ili može na
  5 minuta uz zaokruživanje vremena podsetnika? Posle RP-1 je tick 12-13 upita,
  pa je ovo prestalo da bude pitanje troška - ostaje samo ako compute i dalje
  smeta.
- Vaditi tabele iz `supabase_realtime` publikacije? Tek kad se potvrdi da
  nijedan drugi klijent (stara Nuxt aplikacija) ne visi na `postgres_changes`.
