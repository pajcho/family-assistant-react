# REDESIGN_PLAN.md - Porodicni asistent 2.0 ("Sljiva")

Status: ODOBRENO za implementaciju (2026-08-04). Ovaj dokument je izvor istine za obim posla i pracenje.
Vizuelni izvor istine: interaktivni prototip https://claude.ai/code/artifact/ddbb3b67-f7e9-4db3-9c1b-48d6241628c4
(svi ekrani, sheetovi, forme, biraci datuma/vremena i dokumentacija dizajn jezika su tamo klikabilni).

## Nacin rada

- SVE lenduje u JEDNOM PR-u na main (squash-merge preko pajcho naloga, kao i do sada).
- Radi se na integracionoj grani `redesign/v2`. Trake (lanes) ispod se rade u odvojenim worktree-ovima
  i merguju u `redesign/v2` cim su gotove; na kraju jedan PR `redesign/v2 -> main`.
- Pracenje: checkbox-ovi u ovom fajlu se stikliraju tokom rada (fajl je deo grane), a PR opis
  na kraju preslikava ovu listu.
- Prototip je izvor istine za vizuelno; svako svesno odstupanje se upisuje u sekciju "Odstupanja" na dnu.

## Sta se NE menja (tvrda granica)

- Baza, RLS, migracije, edge funkcije, realtime kanal, push/digest, claim model racuna, kursna logika.
- Poslovna pravila: Uskoro pocinje od danas, Prekoraceno izdvojeno, rodjendani izuzeti iz filtera po clanu,
  statusi placanja i redosled akcija u detalj-sheetovima (tacne liste su u prototipu i u
  memoriji projekta - inventar od 2026-08-04).
- Konvencije: valute kao kod (RSD, EUR), bez dugackih crtica (scripts/check-dashes.sh), dugmad
  Odustani/Otkazi/Zatvori/Nazad, pozdravi bez imena, SheetStack obrazac.
- Jedini izuzetak od "bez migracija": OPCIONO `profiles.accent` (vidi Lane G) - sme da se odlozi
  (prvo localStorage), odluka pri implementaciji.

## Kljucne odluke (vec donete, ne otvarati ponovo)

1. Donja traka: Danas · Kalendar · [+] · Novac · Meni. Danas i Meni fiksni, slotovi 2 i 4 personalizovani
   (default Kalendar i Novac), MAX_FREE_SLOTS 3 -> 2. Legacy nav_slots vrednosti se mapiraju u kodu:
   uskoro->kalendar, payments->novac, budget->novac (bez DB migracije).
2. Kalendar objedinjuje Uskoro: segmenti Agenda (stara Uskoro lista) / Nedelja / Mesec (Mesec je NOVO).
3. Novac objedinjuje Budzet i Placanja: segmenti Pregled / Troskovi / Placanja.
4. Danas = jedna vremenska osa (spaja staru listu i dnevni kalendar); ViewToggle na Danas se gasi.
5. Rute: nove /kalendar i /novac; stare /uskoro, /payments, /budget ostaju kao redirecti
   (deep-linkovi iz push notifikacija moraju da rade).
6. Dizajn jezik zadrzava ime "Sljiva" (neutrale sa toplim podtonom), ali DEFAULT AKCENAT JE PLAVA
   (postojeca brend boja - PWA ikonica, login i splash ostaju plavi, nista se tu ne menja).
   Akcenat je JEDAN token per korisnik: Plava (default) / Sljiva / Kedar (zelena) / Cigla (braon).
   8 postojecih boja clanova dobija vocna imena (samo naming/UI, vrednosti iste).
7. Biraci: datum = sheet (precice po kontekstu polja + mreza sa tackicama zauzetosti + drill
   godina->mesec->dan; za datum rodjenja krece od godine + direktan upis). Vreme = sat mreza + minuti
   :00/:15/:30/:45 + cipovi trajanja koji racunaju kraj; dugi pritisak = native input fallback.
   Na desktopu isti sadrzaj kao popover uz polje.
8. Serif akcenat samo za pozdrav i ime meseca (sistemski serif stack, 0 KB).

## Trake (lanes), zavisnosti i procene

Redosled: A prva (blokira sve). Zatim B, C, D, E paralelno. F i G paralelno cim ima slobodnih ruku.
H (desktop) posle vecine B-E. I (integracija/QA) poslednja, zajednicka.
Procene su za fokusiran rad jedne sesije/agenta po traci.

### Lane A - Temelj: tokeni + shell + navigacija (1 dan) [blokira sve]

- [x] Tailwind v4 @theme: kompletna Sljiva paleta (svetla+tamna), radiusi, senke, soft/tint sloj,
      CSS var nivo za akcenat (--accent, --accent-soft, --accent-deep)
- [x] Mapa vocnih imena za PROFILE_COLOR_PALETTE (malina, borovnica, kivi, kajsija, sljiva, dunja,
      lavanda, tresnja) - UI naming, iste hex vrednosti
- [x] App shell: fiksni okvir (100dvh, unutrasnji skrol po ekranu), safe-area, uklanjanje
      window-scroll + sticky hakova (resava poznati iOS problem); tastatura i dalje krije donju traku
- [x] Rute: /kalendar (search param view=agenda|nedelja|mesec), /novac (tab=pregled|troskovi|placanja);
      redirecti /uskoro, /payments, /budget; scroll restoration i preload kao do sada
- [x] navSections.ts: novi kljucevi/ikone/redosled; sectionForPathname; recents rade sa novim rutama
- [x] MobileBottomNav v2: 4 taba + centralno [+] dugme; normalizeNavSlots mapping legacy vrednosti,
      MAX_FREE_SLOTS=2; "Uredi traku" logika za 2 slota
- [x] Meni sheet v2: Nedavno + mreza svih sekcija + Uredi traku (po prototipu)
- [x] AddSheet sa [+]: Skeniraj racun hero + Trosak/Placanje/Dogadjaj/Aktivnost/Rodjendan/Lista;
      FAB se uklanja; "Dodaj" dugmad po stranicama ostaju na desktopu
- [x] Login ekran restyle (brend Sljiva, decji rezim link ostaje samo kao placeholder AKO postoji;
      inace bez njega - kid mode NIJE deo ovog PR-a)

### Lane B - Danas (1 dan) [posle A]

- [x] Timeline komponenta: vremenska sipka levo, "Sada · HH:mm" linija, celodnevni/span cipovi gore,
      sekcija "Placanja danas", prosli deo dana prigusen
- [x] WeekStrip v2 (vitka, tackice opterecenja, soft selekcija) + tap vodi na taj dan u Kalendar agendi
- [x] Person filter: avf prstenovi 26px + Svi cip (postojeca filter logika/semantika ostaje)
- [x] Prekoraceno baner (vodi u Novac > Placanja)
- [x] FirstStepsCard + prazna stanja restyle (postojeci copy zadrzan)
- [x] Gasenje starog ViewToggle na Danas; AgendaDayCalendar se povlaci (logika slotovanja se
      reciklira u timeline)

### Lane C - Kalendar (1.5 dan) [posle A]

- [x] Kontejner sa segmentima + filter cipovi (tip + clanovi) zajednicki za sva tri prikaza
- [x] Agenda: restyle AgendaUpcomingList (grupe po danu, prazni dani, infinite scroll do 365,
      Prekoraceno na vrhu, visednevni "Dan i/n") - logika netaknuta
- [x] Nedelja: restyle AgendaWeekCalendar + integracija skolskih blokova (toggle "Prikazi skolu",
      iz postojece WeekGrid/smene logike)
- [x] Mesec (NOVO): mreza sa tackicama po tipu, span trake visednevnih, tap na dan otvara pregled dana
      ispod; lazy-load chunk; desktopske celije sa chipovima ostaju za traku H
- [x] /uskoro redirect + `?day=` predaja sa Danas nedeljne trake (traka B salje)

### Lane D - Novac (1 dan) [posle A]

- [x] Hub sa segmentima + mesec pager + QR dugme u zaglavlju
- [x] Pregled: postojece budzet komponente restyle (cycle karta sa Prihodi/Potroseno/Preostalo,
      projekcija, nudge za potvrdu prihoda, Po kategorijama + Uredi, Fiksno vs varijabilno,
      Top prodavnice, Trend) - logika netaknuta; sheetovi Prihodi/Kategorije/CategoryDetail restyle
- [x] Troskovi: BudgetTimeline kao tab + filteri izvora (Rucno/Racun/Iz placanja) + clanovi + pretraga
      (ukljucujuci stavke racuna, kao sada); cipovi "racun · N stavki" / "deo racuna" / "iz placanja"
- [x] Placanja: postojeci PaymentsPage sadrzaj kao tab (summary karta, grupe Prekoraceno/Danas/...,
      svi statusi, "Prikazi jos", sakrivena placena linija)
- [x] Skener + ReceiptPreview + chain + Podeli racun: restyle u nove tokene (tok i logika netaknuti)

### Lane E - Deljeni inputi + sve forme (2 dana) [posle A; E1 pre E2]

- [x] E1: DateField + DatePickerSheet (precice po modu polja: past/future/dob; mreza sa tackicama
      zauzetosti iz agende; drill godina->mesec->dan; direktan upis za DOB; tap bira i zatvara)
- [x] E1: TimeField + TimePickerSheet (sat mreza 7-22, minuti 4 cipa, dugi pritisak native fallback) + DurationChips (30/45/60/90/120 racunaju kraj)
- [x] E1: desktop varijante kao popover (isti sadrzaj, anchor uz polje, tastatura radi)
- [x] E2: migracija formi na nove tokene + nove inpute: Trosak (+ skener ulaz), Placanje (tip,
      ponavljanje, promenljiv iznos, podsetnici), Dogadjaj (Vise dana + trajanje cipovi), Aktivnost
      (termini editor sa A/B), Rodjendan (DOB tok), Lista, Prihod/Kategorija forme
- [x] E2: DetailSheet restyle za sve entitete - REDOSLED AKCIJA IDENTICAN sadasnjem (placanje:
      Oznaci kao placeno -> Izmeni -> Istorija -> Pomeri -> Otkazi -> Pauziraj -> Obrisi; itd.)
- [x] E2: CurrencyToggle + ExchangeRateRow restyle (NBS red, zamrznut kurs - logika ista)

### Lane F - Sekundarni ekrani (1 dan) [posle A, moze paralelno sa E2]

- [x] Liste: index + detail restyle; smart sort, swipe gestovi, dnd, export, auto-brisanje - sve ostaje
- [x] Aktivnosti: WeekGrid restyle + skola + Opcije sheet (smene, rasporedi, satnica zvona) + lista svih
- [x] Dogadjaji: filter bar (mesec, pretraga, zavrseni) + grupe restyle
- [x] Rodjendani: mesecne grupe, Proslava badge, "za N dana"
- [x] Globalna pretraga: restyle dijaloga (iste grupe i ponasanje, Cmd+K)

### Lane G - Podesavanja + nalog (1 dan) [posle A]

- [x] Spajanje /profile u /settings hub sa grupama (profil karta gore; Porodica, Novac-valute,
      Obavestenja, Kalendar, Aplikacija, Odjava) - stari tabovi kao sekcije/pod-ekrani
- [x] Izgled: tema Svetla/Tamna/Auto + "Boja aplikacije" (default Plava; opcije Sljiva/Kedar/Cigla;
      akcenat token; prvo localStorage, OPCIONO profiles.accent migracija - odluciti tada;
      login/ikonica uvek plavi)
- [x] Google kalendar pod-ekran: per-kalendar select (Ne uvozi/Samo ja/Porodica), reauth baner,
      ImportPrefs (putovanja/rodjendani/markeri), povezivanje naloga
- [x] Porodica: clanovi sa vocnim bojama, uloge (Administrator/Ucenik), nalozi, Ukloni; naziv porodice
- [x] Obavestenja/digest/sesije/valute kartice restyle
- [~] Traka navigacije red (vodi na Uredi traku u Meniju) - red postoji i prikazuje trenutne
  slotove, ali je informativan: "Uredi traku" je lokalno stanje u AppNav-u i nema ulaz iz rute
  (vidi Odstupanja)

### Lane H - Desktop (1.5 dan) [posle vecine B-E; prvi task ODMAH moze]

- [x] H0 PRVO: brz staticki mock desktop Danas + Kalendar (prosiriti postojeci artifact prototip)
      i kratka potvrda korisnika pre gradnje - ODOBRENO 2026-08-04
      (artifact: https://claude.ai/code/artifact/25b00c0d-3d0e-4c18-bfad-903267137cf4)
- [x] Sidebar >=lg (~240px): logo, veliko "+ Dodaj", svih 9 sekcija sa ikonama, dole profil mini +
      tema; gasi se top inline nav; <lg ostaje donja traka (postojeci lg breakpoint se zadrzava)
- [x] Danas desktop: 2 kolone - timeline levo (max ~640px), desno sticky: mini-mesec (klik vodi u
      Kalendar), Prekoraceno karta, kratka "Sledeci dani" lista
- [x] Kalendar desktop: Mesec sa event chipovima u celijama, Nedelja puna visina, Agenda centrirana;
      toolbar sa segmentima i filterima
- [x] Novac desktop: Pregled kao 2-kolonski grid kartica; Troskovi/Placanja liste max ~720px
- [x] Liste: postojeci resizable split ostaje, samo restyle
- [x] Sheetovi -> centrirani dijalozi >=sm (postojeci ResponsiveDialog obrazac), biraci kao popover
- [x] Hover/focus stanja, Esc, Cmd+K; (opciono, sme da ispadne: precice strelicama u kalendaru)

### Lane I - Integracija + QA (1 dan, poslednja, zajednicka)

- [x] Dark mode prolaz kroz SVE ekrane i sheetove (tokeni, kontrast)
- [x] Prazna stanja svuda (postojeci copy iz empty-states speca)
- [x] PWA: manifest theme_color -> neutralna pozadina (svetla), ikonica NEPROMENJENA; update toast radi
- [~] iOS standalone QA: kod je proveren (nema window-scroll nigde, safe-area na traci/zaglavlju/
  loginu, tastatura demontira donju traku, trake su neprozirne bez backdrop-filtera), ali
  pravi prolaz na iPhone-u u standalone rezimu ostaje na korisniku - to se ne moze odglumiti
- [x] Redirecti + push deep-linkovi + Nedavno + pretraga navigacija
- [x] Testovi: picker utili (addMin, genGrid, prestupne), normalizeNavSlots legacy mapping,
      timeline slotovanje; CI (check + dash-check + test + build) zeleno
- [x] Bundle provera (Mesec lazy), Lighthouse brzi pregled
- [ ] PR opis sa checklistom + screenshotovi po ekranu (svetla/tamna, mobil/desktop) - CEKA korisnikovu lokalnu potvrdu; PR se ne otvara pre toga

## Paralelizacija (predlog za agente/worktree-ove)

- Agent 1: A, zatim B, zatim pomaze I
- Agent 2: E1 pa E2 (posle A)
- Agent 3: C pa F (posle A)
- Agent 4: D pa G (posle A)
- H: Agent 1 ili 3 posle svojih traka (H0 mock sme i pre, cim korisnik potvrdi)
- Ukupno ~10-11 lane-dana; sa 3-4 paralelna toka realno 3-4 dana rada.
- Svaki lane = poseban worktree + grana `redesign/v2-<lane>`, merge u `redesign/v2` cim je zelen
  (build + testovi); konflikti se resavaju u integracionoj grani, ne u lane granama.

## Definition of Done (za PR)

- pnpm check (ukljucujuci check-dashes) + test + build zeleno na CI
- Svi stari linkovi rade: /uskoro, /payments, /budget, push URL-ovi, Nedavno, pretraga
- Svaki ekran proveren u svetloj i tamnoj temi, mobil (iOS PWA standalone) i desktop
- Vizuelno odgovara prototipu; odstupanja popisana u PR opisu
- Bez promena u bazi/edge funkcijama (osim eventualno profiles.accent, uz eksplicitnu odluku)
- Prod deploy: frontend ide automatski na merge (Pages); NEMA rucnog backend deploja

## Kickoff za novu sesiju

U novoj sesiji reci: "Kreni implementaciju redizajna po REDESIGN_PLAN.md" - sesija treba da:

1. procita ovaj fajl + memoriju projekta + otvori prototip artifact kao vizuelnu referencu,
2. napravi granu `redesign/v2` i krene od Lane A,
3. stiklira checkbox-ove ovde kako taskovi prolaze,
4. za paralelizaciju podigne worktree agente po semi iznad (uz dogovor koliko paralele korisnik zeli),
5. H0 (desktop mock) posalje korisniku na potvrdu pre Lane H gradnje.

## Sta je provereno u integracionom prolazu (2026-08-04)

- Rute i redirecti uzivo: `/uskoro` -> `/kalendar?view=agenda`, `/payments` ->
  `/novac?tab=placanja`, `/budget` -> `/novac?tab=pregled`, `/profile` -> `/settings`.
  Push deep-linkovi iz edge funkcija (`/payments`, `/uskoro`, `/events`, `/activities`,
  `/lists/:id`, `/`) svi padaju na te rute - edge funkcije nisu dirane.
- Nedavno (Meni sheet), Uredi traku 2/2, globalna pretraga i ⌘K, Esc zatvara dijaloge.
- Akcenat: prebacivanje na Braon/Zelena/Plava preboji celu aplikaciju i upise se u
  `profiles.accent` (lokalna baza).
- Detalj-sheet placanja: redosled akcija nepromenjen (Oznaci kao placeno -> Izmeni ->
  Istorija -> Pomeri -> Otkazi -> Obrisi).
- Svetla i tamna tema: Danas, Kalendar (Agenda/Nedelja/Mesec), Novac (sva tri taba),
  Podesavanja, Liste, Dogadjaji, Rodjendani, Aktivnosti, forma troska sa novim biracem.
- Desktop (>=lg): sidebar, Danas 2 kolone, Mesec sa cipovima, Novac Pregled 2 kolone,
  Liste split (izmereno: 320 + 8 + 712 = puna sirina).
- Bundle: Mesec je zaseban lazy chunk (5,2 kB), skener 21 kB + wasm odvojeno,
  glavni chunk 254 kB (82 kB gzip) - u rangu pre redizajna.
- Lighthouse (produkcijski build, login ekran, mobilni): 100 pristupacnost /
  100 najbolje prakse / 100 SEO. Prvi prolaz je nasao da nedostaje `<main>` orijentir
  (izgubljen pri prepisivanju okvira) - popravljeno.
- Ograda: Lighthouse i dalje moze samo login (ostali ekrani traze sesiju).

## Prolaz praznih ekrana za nove korisnike (2026-08-05)

Prodjeni SVI ekrani kao svez nalog (lokalno: novi.korisnik@example.com / novi1234,
porodica "Novakovi", bez podataka), mobil + desktop. Ispravke iz prolaza:

- MonthCalendar: weekCount formula je SVAKOM mesecu dodavala suvisnu (praznu)
  sedmu nedelju - +1 je pripadao broju dana, ne kolicniku.
- Filter clanova se krije kad porodica ima jednog clana (nema po kome da se
  filtrira): Danas, Kalendar, Novac > Troskovi/Placanja, Aktivnosti.
- "Google" cip u Kalendar filterima se pojavljuje tek kad porodica stvarno ima
  preslikane Google dogadjaje (novi hook useHasExternalEvents; cip ostaje dok
  je selektovan da se moze iskljuciti).
- Novac > Troskovi: pravi starter empty state ("Jos nema troskova" + Dodaj
  trosak) umesto jedne recenice; odvojeni slucajevi prazan mesec ("Dodaj
  trosak" link) i prazni filteri ("Ocisti filtere"). Empty logika preseljena
  iz BudgetTimeline u BudgetPage.
- Aktivnosti: "Prikazi skolu" cip tek kad skolski raspored postoji (ista
  kapija kao Kalendar > Nedelja); ceo filter red se krije kad je prazan.
- Prikaz imena bez postavljenog imena: naslov vise ne ponavlja email (kartica
  u Podesavanjima, Licni podaci pregled, sidebar mini profil -> "Bez imena" /
  "Profil", email ostaje u podnaslovu).
- Prvi koraci: "Dopuni svoj profil" vodi pravo u /settings?tab=profile (ne na hub).

Svesno NIJE menjano: prazna dnevna zaglavlja u Kalendar > Agenda ispod starter
kartice (dokumentovana odluka - agenda se cita kao kontinuiran kalendar).

## Odluke donete tokom rada

- Akcenat se cuva u bazi: migracija `20260804090000_profiles_accent.sql` (kolona
  `profiles.accent` + CHECK), localStorage je samo ogledalo za prvi paint.
- SVI kljucevi koji zavrsavaju u bazi su na ENGLESKOM (kasnija lokalizacija):
  akcenti `blue|purple|green|brown` (labele Plava/Ljubicasta/Zelena/Braon),
  nav sekcije `today|calendar|money|lists|activities|events|birthdays|family|settings`.
  Stare vrednosti se mapiraju u kodu (`LEGACY_KEY_MAP`), bez migracije podataka.
- Imena akcenata su prosta imena boja umesto "Sljiva/Kedar/Cigla" (ime dizajn
  jezika i dalje je "Sljiva", ali korisnik bira Plavu/Ljubicastu/Zelenu/Braon).

## Odstupanja od prototipa (popunjava se tokom rada)

- Lane E: biraci se otvaraju kao sheet na mobilnom, ali kroz postojeci
  ResponsiveDialog (vaul), ne kao pod-prikaz forme - forma ostaje na svom
  mestu i vraca se netaknuta. Na desktopu je popover uz polje, kao u planu.
- Lane E: uz mrezu sati 7-22 stoji i cip "Ostali sati" plus polje "Tacno vreme",
  jer dugi pritisak na native picker ne radi svuda (Safari nema showPicker).
- Lane E: cipovi trajanja se ne nude za visednevne dogadjaje - kraj tada pripada
  drugom danu, pa bi racunanje "pocetak + N" bilo pogresno.

- Token `--accent*` je uzet za korisnikov akcenat, pa je shadcn-ov neutralni
  `accent` (hover pozadina) prebacen na `muted` u `components/ui/*`. Vizuelno
  identicno, samo preimenovanje.
- Prototipska paleta ima plum akcenat; podrazumevani akcenat u aplikaciji je
  PLAVA (odluka 6), a plum je opcija "Ljubicasta".
  Traka B (Danas) i H (desktop):

- Danas timeline: prototip prikazuje pocetak i u levoj koloni I u kartici desno;
  kod nas kartica desno nosi samo "do HH:MM" (ponavljanje je bilo suvisno na telefonu).
- Danas ucitava agendu za CELU tekucu nedelju (jedan useAgenda) da bi traka
  imala tackice opterecenja; timeline uzima samo danasnji presek. Na desktopu
  se opseg siri do kraja meseca, jer desna kolona ima mini-mesec i "Sledeci dani".
- Desktop: pretraga postoji i u sidebaru (red "Pretrazi ⌘K"), ne samo u zaglavlju
  ekrana - sidebar je jedina povrsina prisutna na svakom ekranu.

Traka D (Novac):

- Pretraga u zaglavlju Novca je toggle (lupa -> polje ispod naslova), a ne poseban
  sheet kao u prototipu. Otvaranje pretrage sa Pregleda prebacuje na Troskove
  (tamo su rezultati), a povratak na Pregled gasi pretragu.
- Mesec pager je nova komponenta (`money/MonthPager`) umesto deljenog
  `MonthPicker`-a; u zaglavlju su strelice tiho hrom, a labela otvara mrezu
  meseci sa "Ovaj mesec" i (samo na Placanjima) "Sva placanja".
- Filteri na Troskovima/Placanjima su cip-red (Svi / izvori / Placena) umesto
  FilterBar + FilterSheet; sheet je ostao samo za izbor clanova.
- Dan-zaglavlja u Troskovima vise ne koriste `AgendaDateHeader` (to je agenda
  obrazac, traka B) nego `.gh` grupu sa brojacem; relativni tokeni su
  Danas/Juce (knjiga troskova gleda unazad), plus Sutra za retke buduce unose.
- Dvokolonski `xl` raspored Budzeta je uklonjen - Troskovi su sada zaseban tab.
  Desktop raspored je posao trake H.
- "Dodaj" dugmad (BudgetAddMenu, Dodaj placanje) prikazuju se samo od `lg`
  navise; na dodiru je ulaz centralno [+] iz trake.
- `PaymentsPage` vise ne drzi mesec/pretragu (dolaze iz huba); prop
  `onMonthChange` nije bio potreban pa ga nema.

Traka G (Podesavanja):

- Grupa "Obavestenja" je jedan red (push + pregledi dana + sesije) umesto
  cetiri iz prototipa: sve cetiri kartice dele isti `notification_preferences`
  red i cuvaju se zajedno, pa bi cetiri ulaza vodila na isti pod-ekran.
- "Valute" su izvucene iz Porodice u svoj pod-ekran (`?tab=currencies`), kako
  nalaze grupa "Porodica / Novac-valute"; `CurrenciesCard` se vise ne renderuje
  unutar `FamilyTab`.
- Red "Donja traka" je informativan (prikazuje trenutna dva slota) uz fusnotu
  gde se menja. "Uredi traku" zivi kao lokalno stanje u `AppNav`-u i nema
  ulaz iz rute; ako traka A/I doda npr. search param ili globalni event,
  red je spreman da postane dugme.
- `/profile` je sada redirect na `/settings` (nista vise ne linkuje na njega).
- `?tab=` prihvata i `currencies`/`valute`; nepoznata vrednost vodi na hub
  (ranije na Profil).

Traka C (Kalendar) i F (sekundarni ekrani):

- Traka C: Kalendar > Agenda NEMA nedeljnu traku (prototip je ne prikazuje na tom
  ekranu). Ostaje na Danas i predaje dan preko `?day=`; mesecni skok iz stare
  WeekStrip biraca zamenjuje prikaz Mesec.
- Traka C: neutralno stanje filter cipova. Ranije su, dok filter nije aktivan,
  SVI cipovi bili upaljeni; sada je upaljen samo "Sve" (kao u prototipu), a
  cipovi tipova/clanova svetle tek kad se stvarno izaberu. Sama logika
  filtriranja je nepromenjena (prazan skup = bez filtera). Isto vazi za cipove
  clanova na Aktivnostima ("Svi"); PersonFilterChips unutar FilterSheet-a
  (placanja/dogadjaji/rodjendani) i dalje koristi staru konvenciju.
- Traka C: ikon-dugmad su vizuelno 40px (prototip 38px) sa providnim ::after
  okvirom do 44px, zbog minimalne dodirne mete.
- Traka F: detalj liste na mobilnom je sada zaseban AppScreen; desktop
  master-detail split je netaknut.

Integracija (traka I):

- Nedeljni prikaz je PROBAN bez vodoravnog skrola (sedam kolona od ~46px staje
  na telefon, kao u prototipu) pa VRACEN na 140px kolone + vodoravni skrol
  (2026-08-05, na zahtev korisnika): na 46px je svaki blok neprepoznatljiva
  traka i labele su morale da se sakriju ispod `sm`, a nedelja koja se ne cita
  ne vredi ni da se vidi cela. Uz to: mreza sada skroluje u OBA smera unutar
  svog okvira (`AppScreen fillBody`), pa su zaglavlje dana i satnica levo
  stvarno lepljivi, i otvara se na danasnjem danu i tekucem satu.
