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

- [ ] Kontejner sa segmentima + filter cipovi (tip + clanovi) zajednicki za sva tri prikaza
- [ ] Agenda: restyle AgendaUpcomingList (grupe po danu, prazni dani, infinite scroll do 365,
      Prekoraceno na vrhu, visednevni "Dan i/n") - logika netaknuta
- [ ] Nedelja: restyle AgendaWeekCalendar + integracija skolskih blokova (toggle "Prikazi skolu",
      iz postojece WeekGrid/smene logike)
- [ ] Mesec (NOVO): mreza sa tackicama po tipu, span trake visednevnih, tap na dan otvara pregled dana
      ispod; lazy-load chunk; na desktopu celije sa chipovima umesto tackica
- [ ] /uskoro redirect + WeekStrip sa Danas vodi ovde

### Lane D - Novac (1 dan) [posle A]

- [ ] Hub sa segmentima + mesec pager + QR dugme u zaglavlju
- [ ] Pregled: postojece budzet komponente restyle (cycle karta sa Prihodi/Potroseno/Preostalo,
      projekcija, nudge za potvrdu prihoda, Po kategorijama + Uredi, Fiksno vs varijabilno,
      Top prodavnice, Trend) - logika netaknuta; sheetovi Prihodi/Kategorije/CategoryDetail restyle
- [ ] Troskovi: BudgetTimeline kao tab + filteri izvora (Rucno/Racun/Iz placanja) + clanovi + pretraga
      (ukljucujuci stavke racuna, kao sada); cipovi "racun · N stavki" / "deo racuna" / "iz placanja"
- [ ] Placanja: postojeci PaymentsPage sadrzaj kao tab (summary karta, grupe Prekoraceno/Danas/...,
      svi statusi, "Prikazi jos", sakrivena placena linija)
- [ ] Skener + ReceiptPreview + chain + Podeli racun: restyle u nove tokene (tok i logika netaknuti)

### Lane E - Deljeni inputi + sve forme (2 dana) [posle A; E1 pre E2]

- [ ] E1: DateField + DatePickerSheet (precice po modu polja: past/future/dob; mreza sa tackicama
      zauzetosti iz agende; drill godina->mesec->dan; direktan upis za DOB; tap bira i zatvara)
- [ ] E1: TimeField + TimePickerSheet (sat mreza 7-22, minuti 4 cipa, dugi pritisak native fallback) + DurationChips (30/45/60/90/120 racunaju kraj)
- [ ] E1: desktop varijante kao popover (isti sadrzaj, anchor uz polje, tastatura radi)
- [ ] E2: migracija formi na nove tokene + nove inpute: Trosak (+ skener ulaz), Placanje (tip,
      ponavljanje, promenljiv iznos, podsetnici), Dogadjaj (Vise dana + trajanje cipovi), Aktivnost
      (termini editor sa A/B), Rodjendan (DOB tok), Lista, Prihod/Kategorija forme
- [ ] E2: DetailSheet restyle za sve entitete - REDOSLED AKCIJA IDENTICAN sadasnjem (placanje:
      Oznaci kao placeno -> Izmeni -> Istorija -> Pomeri -> Otkazi -> Pauziraj -> Obrisi; itd.)
- [ ] E2: CurrencyToggle + ExchangeRateRow restyle (NBS red, zamrznut kurs - logika ista)

### Lane F - Sekundarni ekrani (1 dan) [posle A, moze paralelno sa E2]

- [ ] Liste: index + detail restyle; smart sort, swipe gestovi, dnd, export, auto-brisanje - sve ostaje
- [ ] Aktivnosti: WeekGrid restyle + skola + Opcije sheet (smene, rasporedi, satnica zvona) + lista svih
- [ ] Dogadjaji: filter bar (mesec, pretraga, zavrseni) + grupe restyle
- [ ] Rodjendani: mesecne grupe, Proslava badge, "za N dana"
- [ ] Globalna pretraga: restyle dijaloga (iste grupe i ponasanje, Cmd+K)

### Lane G - Podesavanja + nalog (1 dan) [posle A]

- [ ] Spajanje /profile u /settings hub sa grupama (profil karta gore; Porodica, Novac-valute,
      Obavestenja, Kalendar, Aplikacija, Odjava) - stari tabovi kao sekcije/pod-ekrani
- [ ] Izgled: tema Svetla/Tamna/Auto + "Boja aplikacije" (default Plava; opcije Sljiva/Kedar/Cigla;
      akcenat token; prvo localStorage, OPCIONO profiles.accent migracija - odluciti tada;
      login/ikonica uvek plavi)
- [ ] Google kalendar pod-ekran: per-kalendar select (Ne uvozi/Samo ja/Porodica), reauth baner,
      ImportPrefs (putovanja/rodjendani/markeri), povezivanje naloga
- [ ] Porodica: clanovi sa vocnim bojama, uloge (Administrator/Ucenik), nalozi, Ukloni; naziv porodice
- [ ] Obavestenja/digest/sesije/valute kartice restyle
- [ ] Traka navigacije red (vodi na Uredi traku u Meniju)

### Lane H - Desktop (1.5 dan) [posle vecine B-E; prvi task ODMAH moze]

- [x] H0 PRVO: brz staticki mock desktop Danas + Kalendar (prosiriti postojeci artifact prototip)
      i kratka potvrda korisnika pre gradnje - ODOBRENO 2026-08-04
      (artifact: https://claude.ai/code/artifact/25b00c0d-3d0e-4c18-bfad-903267137cf4)
- [x] Sidebar >=lg (~240px): logo, veliko "+ Dodaj", svih 9 sekcija sa ikonama, dole profil mini +
      tema; gasi se top inline nav; <lg ostaje donja traka (postojeci lg breakpoint se zadrzava)
- [x] Danas desktop: 2 kolone - timeline levo (max ~640px), desno sticky: mini-mesec (klik vodi u
      Kalendar), Prekoraceno karta, kratka "Sledeci dani" lista
- [ ] Kalendar desktop: Mesec sa event chipovima u celijama, Nedelja puna visina, Agenda centrirana;
      toolbar sa segmentima i filterima
- [ ] Novac desktop: Pregled kao 2-kolonski grid kartica; Troskovi/Placanja liste max ~720px
- [ ] Liste: postojeci resizable split ostaje, samo restyle
- [ ] Sheetovi -> centrirani dijalozi >=sm (postojeci ResponsiveDialog obrazac), biraci kao popover
- [ ] Hover/focus stanja, Esc, Cmd+K; (opciono, sme da ispadne: precice strelicama u kalendaru)

### Lane I - Integracija + QA (1 dan, poslednja, zajednicka)

- [ ] Dark mode prolaz kroz SVE ekrane i sheetove (tokeni, kontrast)
- [ ] Prazna stanja svuda (postojeci copy iz empty-states speca)
- [ ] PWA: manifest theme_color -> neutralna pozadina (svetla), ikonica NEPROMENJENA; update toast radi
- [ ] iOS standalone QA: skrol, safe-area, tastatura, nav, sheetovi (poznata bolna tacka - proveriti rano)
- [ ] Redirecti + push deep-linkovi + Nedavno + pretraga navigacija
- [ ] Testovi: picker utili (addMin, genGrid, prestupne), normalizeNavSlots legacy mapping,
      timeline slotovanje; CI (check + dash-check + test + build) zeleno
- [ ] Bundle provera (Mesec lazy), Lighthouse brzi pregled
- [ ] PR opis sa checklistom + screenshotovi po ekranu (svetla/tamna, mobil/desktop)

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

- Token `--accent*` je uzet za korisnikov akcenat, pa je shadcn-ov neutralni
  `accent` (hover pozadina) prebacen na `muted` u `components/ui/*`. Vizuelno
  identicno, samo preimenovanje.
- Prototipska paleta ima plum akcenat; podrazumevani akcenat u aplikaciji je
  PLAVA (odluka 6), a plum je opcija "Ljubicasta".
- Danas timeline: prototip prikazuje pocetak i u levoj koloni I u kartici desno;
  kod nas kartica desno nosi samo "do HH:MM" (ponavljanje je bilo suvisno na telefonu).
- Danas ucitava agendu za CELU tekucu nedelju (jedan useAgenda) da bi traka
  imala tackice opterecenja; timeline uzima samo danasnji presek. Na desktopu
  se opseg siri do kraja meseca, jer desna kolona ima mini-mesec i "Sledeci dani".
- Desktop: pretraga postoji i u sidebaru (red "Pretrazi ⌘K"), ne samo u zaglavlju
  ekrana - sidebar je jedina povrsina prisutna na svakom ekranu.
