# Plan unapređenja — Porodični asistent

> Nastao iz detaljnog pregleda aplikacije (jul 2026): ručni obilazak svih ekrana
> (mobile 375px + desktop 1440px + dark mode) na lokalnom okruženju + analiza
> celog koda (rute, hookovi, migracije, edge funkcije). Svaka faza je skrojena
> tako da može da se preda sub-agentu kao samostalan zadatak.

## Ocena trenutnog stanja

**Šta je već odlično (ne dirati, samo održavati):**

- Jedinstven agenda-model (Danas/Uskoro) koji spaja aktivnosti, događaje, plaćanja,
  rođendane i Google evente, sa filterima po tipu i članu, list/kalendar prikazima
  i detalj-sheetovima sa akcijama (Označi kao plaćeno, Pomeri, Otkaži, Izmeni).
- Aktivnosti + školski raspored (smene A/B, zvona, timetable) — najjača i
  najoriginalnija funkcionalnost aplikacije.
- Web Push sistem kompletan: jutarnji/večernji digest, podsetnici po entitetu,
  instant push kad član nešto doda; idempotentno preko `notification_log`.
- Liste: swipe, drag-reorder, smart-sort, markdown, optimistic updates, izvoz.
- Kod je čist (0 TODO/FIXME, 1 console.\*), RLS dosledan, a11y pristojan,
  dark mode kompletan, PWA sa update-toastom.

**Ključne slabosti (rezime):**

1. Nekonzistentni filteri: person-filter postoji na dashboardu i aktivnostima,
   ali NE na Plaćanjima i Događajima iako podaci (participants) postoje.
2. Plaćanja nisu kategorisana i nisu povezana sa aktivnostima/događajima —
   blokira budžet-modul i "koliko nas košta Engleski".
3. Nema globalne pretrage; pretraga postoji samo u listama.
4. Nema offline podrške za podatke, nema pull-to-refresh, a
   `refetchOnWindowFocus` je isključen — u standalone PWA korisnik nema način
   da ručno osveži podatke ako realtime socket umre posle suspend-a.
5. Occurrence-resolver (ponavljanja aktivnosti/plaćanja) dupliran u
   frontend utils i `send-due-pushes` edge funkciji — rizik divergencije.
6. Onboarding porodice ide kroz CLI skriptu (`scripts/setup-family.ts`) —
   nema in-app kreiranja porodice ni pozivnica.
7. Skoro da nema testova (2 test fajla) za veoma netrivijalnu logiku
   (sinteza ponavljajućih plaćanja u `_app.payments.tsx`, 884 linije).

---

## Faza 0 — Quick wins i higijena (1 PR, ~1 dan)

Sitnice uočene tokom pregleda; sve nisko-rizično:

- [ ] **Bug:** `/settings?tab=kalendar` (ili bilo koja nevalidna vrednost)
      renderuje prazan sadržaj — nijedan tab nije aktivan. `validateSearch` u
      `_app.settings.tsx` odbacuje nepoznate vrednosti, ali UI ne padne nazad
      na Profil. Reprodukovano u browseru. Popraviti fallback (i razmisliti o
      srpskim alias vrednostima: `kalendar`→`calendar`, `porodica`→`family`).
- [ ] **A11y:** list/kalendar view-toggle dugmad i još par icon-only dugmadi
      nemaju `aria-label` (u a11y stablu su bezimena). Week-strip dani imaju
      sirovu labelu `"2026-07-20 — 6"` — humanizovati („ponedeljak 20. jul,
      6 stavki").
- [ ] **Liste:** „Dupliraj" kopira samo podešavanja liste, ne i stavke —
      dodati opciju „Dupliraj sa stavkama" (za nedeljnu šoping listu je to
      glavni use-case).
- [ ] **Događaji:** filter red (`Od`/`Do`/`Prikaži sve` + checkbox) vizuelno
      odudara od ostatka aplikacije — prestilizovati u chip/sheet obrazac kao
      na dashboardu.
- [ ] **Prekoračeno:** u header sekcije dodati ukupan zbir (npr.
      „PREKORAČENO · 16.000 RSD") — sada se vide samo pojedinačni iznosi.
- [ ] **FAB „Dodaj"** na Danas/Uskoro nema stavku „Lista" — dodati (vodi na
      /lists sa otvorenim dijalogom).
- [ ] **Higijena koda:** zastareo komentar u `src/sw.ts:25` („Push handlers are
      stubs" — a implementirani su); mrtav flag `SHOW_DEVTOOLS` u
      `__root.tsx:28`.

## Faza 1 — UX konzistencija (1–2 PR-a)

- [ ] **Person-filter svuda:** dodati filter po članu na Plaćanja i Događaje
      (isti chip-obrazac kao `AgendaFilters`); na Plaćanjima uz to prikazati
      sumu za izabranog člana.
- [ ] **Skeleton loading:** zameniti golo „Učitavanje…" skeleton redovima
      (bar na dashboardu, plaćanjima i listama) — percepcija brzine.
- [ ] **Pull-to-refresh** na mobilnom (standalone PWA nema refresh dugme):
      povući → `queryClient.invalidateQueries()`. Uz to razmisliti o
      re-subscribe realtime kanala na `visibilitychange` (iOS suspend gotcha).
- [ ] **Prazna stanja sa akcijom:** „Za danas nemaš zakazanih obaveza" →
      dodati preview sutrašnjeg dana ili CTA („Pogledaj Uskoro →"); prazni
      Rođendani/Događaji → dugme „Dodaj prvi…" umesto samo teksta.
- [ ] **Month-picker na week-strip:** tap na „Jul 2026" otvara mini mesečni
      kalendar za brzi skok (sada se do daljeg datuma stiže samo skrolom).
- [ ] **Globalna pretraga (⌘K / ikonica na mobilnom):** jedan endpoint preko
      TanStack Query kesha — pretraži aktivnosti, plaćanja, događaje, liste,
      stavke listi, rođendane; rezultat vodi na odgovarajući detalj.

## Faza 2 — Povezivanje plaćanja ↔ aktivnosti/događaji

Korisnički zahtev: „Engleski Lucija" (aktivnost) ↔ „Engleski Lucija" (plaćanje);
proslava rođendana (događaj) ↔ trošak proslave.

**Šema (jednostavno, bez generičkog polimorfizma):**

```sql
ALTER TABLE payments
  ADD COLUMN activity_id uuid NULL REFERENCES activities(id) ON DELETE SET NULL,
  ADD COLUMN event_id    uuid NULL REFERENCES events(id)     ON DELETE SET NULL,
  ADD CONSTRAINT payments_single_link CHECK (num_nonnulls(activity_id, event_id) <= 1);
```

(+ isto kasnije na `expenses` u Fazi 3 — ista dva FK polja, isti CHECK.)

**UI:**

- U payment formi opcioni picker „Poveži sa…" (searchable: aktivnosti + događaji).
- Payment detail sheet: link „↗ Engleski Lucija" vodi na aktivnost.
- Activity detail/edit: nova sekcija **„Plaćanja"** — live plaćanje + istorija
  (`payment_history` kroz povezani payment), grupisano po mesecima.
- Event detail: isto, sekcija „Plaćanja".
- **Pohađanje po mesecima:** pošto `activity_overrides` već čuva otkazane
  termine, za povezanu aktivnost prikazati mesečni pregled: broj održanih
  termina (raspored − otkazani) + plaćanja tog meseca. To je direktno ono što
  je traženo („lista pohađanja po mesecima + plaćanja povezana s tim").
- Auto-predlog: pri kreiranju plaćanja, ako naziv fuzzy-matchuje postojeću
  aktivnost, ponuditi link jednim tapom.

## Faza 3 — Budžet, deo 1: kategorije + ručni troškovi

Minimalni korisni budžet — bez plata, bez limita (to je Faza 4), da ne bude
prekomplikovano.

**Šema:**

- `expense_categories` (family_id, name, icon/color, sort) + seed default
  kategorija (Namirnice, Režije, Deca/aktivnosti, Prevoz, Zdravlje, Izlasci,
  Ostalo).
- `expenses` (family_id, amount, currency, date, category_id, person_id NULL,
  note, source `manual|payment|receipt`, payment_id NULL, activity_id/event_id
  NULL kao u Fazi 2).
- `payments.category_id NULL` — postojeća plaćanja dobiju kategoriju; kad se
  occurrence označi plaćenim, automatski se upiše `expenses` red
  (source='payment') → sva potrošnja na jednom mestu bez dvostrukog unosa.

**UI — nova stranica „Budžet" (u Više meni / desktop nav):**

- Mesečni pregled: ukupno po kategoriji (bar/donut), lista troškova, month-chips
  kao na Plaćanjima.
- **Brzi unos** (dizajniran za 5 sekundi na kasi): FAB → iznos (numpad) →
  kategorija (grid ikonica) → sačuvaj; opciono osoba/beleška/link.
- Filter po članu i kategoriji.

## Faza 4 — Budžet, deo 2: prihodi i mesečni ciklus

- `incomes` (family_id, person_id, amount, day_of_month, name, is_recurring) —
  više plata, različiti dani u mesecu (tačno korisnikov scenario).
- Mesečni ciklus na Budžet stranici: prihodi − (plaćena plaćanja + troškovi) =
  preostalo; projekcija do kraja meseca na osnovu poznatih recurring plaćanja
  (occurrence-resolver već postoji).
- Opcioni limiti po kategoriji + push kad potrošnja pređe 80%/100%
  (novi dispatch put u `send-due-pushes` — infrastruktura već postoji).
- Grafikon trenda kroz mesece (potrošnja po kategoriji, 6–12 meseci).

## Faza 5 — Fiskalni računi (QR skener)

Srpski fiskalni računi nose QR koji vodi na javnu verifikacionu stranicu
(`suf.purs.gov.rs`) sa svim stavkama računa — **nije potreban OCR**.

- **Klijent:** skener u PWA (BarcodeDetector API + `zxing-js` fallback;
  kamera radi u instaliranoj PWA na iOS 15.1+). Skeniraš QR → dobiješ URL.
- **Edge funkcija `receipt-import`:** primi URL, validira da je
  `suf.purs.gov.rs`, fetchuje i parsira (prodavnica, datum, ukupno, stavke) →
  vrati strukturu; klijent prikaže pregled → korisnik potvrdi kategoriju →
  upiše se `expenses` red (source='receipt') + `expense_items` stavke.
- **Napomena za izvođača:** prvo validirati format stranice/journal endpointa
  na 2–3 stvarna računa; parser držati u edge funkciji da se popravka ne čeka
  na store review (PWA prednost).
- Fallback kasnije (opciono): slikaj račun → Claude API vision ekstrakcija.

## Faza 6 — Otpornost i kvalitet (tehnički dug)

- [ ] **Deljeni occurrence-resolver:** izdvojiti `src/utils/activity.ts` +
      `payment.ts` resolver logiku u `packages/shared` (pnpm workspace već
      postoji) i importovati ga i u frontend i u `send-due-pushes` (Deno može
      relativni import TS fajlova; proveriti bundling kroz
      `supabase functions deploy`). Ukida dupliranu implementaciju od ~180 linija.
- [ ] **Testovi za kritičnu logiku:** sinteza plaćanja (monthly/weekly/limited/
      interval + overrides + istorija), agenda merge, budžet ciklus. Vitest već
      konfigurisan.
- [ ] **Refaktor `_app.payments.tsx` (884 l.):** izdvojiti `computeSummary`/
      `computeCombinedList` u utils (duplirana month-expansion matematika),
      dialog scaffolding u zajednički `useEntityDialogs` hook (isti obrazac
      copy-pastovan na 4 mesta).
- [ ] **Error boundary** po ruti + **Sentry** (@sentry/react) — sada greška u
      renderu ruši celu stranicu, a produkcijske greške se ne vide.
- [ ] **Offline čitanje:** TanStack Query `persistQueryClient` u IndexedDB —
      šoping lista mora da se otvori u podrumu prodavnice bez signala.
      (Mutation-queue za offline izmene NE raditi sada — velika kompleksnost.)
- [ ] **Onboarding porodice in-app** (ako se aplikacija ikad da drugoj
      porodici): signup → kreiraj porodicu → email pozivnica članu
      (zamena za `scripts/setup-family.ts`).

## Faza 7 — Novi moduli (backlog ideja, po želji)

Poređano po proceni vrednost/trud:

1. **Kućni zadaci (chores):** ponavljajući zadaci dodeljeni deci sa rokom i
   opcionim poenima/streakom („iznesi đubre — svake srede"). Modelirati kao
   poseban tip, ne preko listi (ponavljanje + dodela + istorija). Push
   podsetnik uveče ako nije štiklirano.
2. **„Ko vozi":** na occurrence aktivnosti dodela vozača (roditelja) —
   `activity_overrides` već ima per-occurrence infrastrukturu; prikaz u agendi
   („Trening · vozi Nikola") + filter „moja zaduženja".
3. **Rođendani++:** godine koje osoba puni, ideje za poklone (notes već
   postoji — strukturirati), dugme „Napravi proslavu" (pre-popunjen event),
   spajanje sa importovanim Google kontakt-rođendanima (import checkbox već
   postoji u gcal podešavanjima — prikazati ih i u modulu Rođendani).
4. **Dokumenti sa istekom:** pasoši, lične karte, registracija auta, polise —
   samo naziv + datum isteka + podsetnik X dana ranije (postojeći push sistem);
   opciono attachment u Supabase Storage.
5. **Meal planning:** nedeljni jelovnik + „dodaj sastojke u šoping listu".
   Veliki modul — raditi samo ako porodica zaista planira obroke.
6. **AI brzi unos:** tekst/glas „zubar za Tonija sredа 15h" → Claude API
   parsira → pre-popunjena forma događaja. Zabavan diferencijator, edge
   funkcija + jedan input na dashboardu.

---

## Predlog redosleda izvršavanja

| Prioritet | Faza                      | Zašto                                         |
| --------- | ------------------------- | --------------------------------------------- |
| 1         | Faza 0                    | jeftino, odmah vidljivo                       |
| 2         | Faza 2 (linkovanje)       | korisnikov eksplicitni zahtev, otključava 3/4 |
| 3         | Faza 3 (budžet v1)        | najveća nova vrednost                         |
| 4         | Faza 1 (UX konzistencija) | može paralelno sa 2/3 (različiti fajlovi)     |
| 5         | Faza 4 (budžet v2)        | nadogradnja na 3                              |
| 6         | Faza 5 (QR računi)        | wow-faktor, zavisi od 3                       |
| 7         | Faza 6 (kvalitet)         | provlačiti kontinuirano, resolver pre 4       |
| 8         | Faza 7                    | backlog                                       |

**Napomene za sub-agente:**

- Svaka faza = zasebna grana + PR (squash-merge, `pajcho` nalog — videti
  postojeći workflow).
- Migracije: guard za realtime publikaciju (`IF EXISTS ... pg_publication`),
  lokalno `supabase migration up --local`; nova edge funkcija zahteva pun
  `supabase stop && start` + `supabase functions serve --env-file
supabase/functions/.env.local` za custom secrets.
- Nikad ne mountovati dva `useAgenda` istovremeno (dupli realtime-sub crash).
- UI tekstovi na srpskom; dugmad po konvenciji: Odustani / Otkaži / Zatvori /
  Nazad (videti postojeće dijaloge).
