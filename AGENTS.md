# AGENTS.md

Uputstva za AI agente (Claude Code, Cursor i sl.) koji rade na ovom repozitorijumu.

## Interpunkcija: nikad dugačka crtica

**Nikada ne koristi dugačku crticu.** Koristi običan ASCII hyphen `-` (U+002D).

Zabranjeni znakovi, svuda u repozitorijumu - u kodu, komentarima, tekstu koji korisnik
vidi, commit porukama, PR opisima, dokumentaciji i SQL-u:

| Znak        | Kod                    | Ime                     |
| ----------- | ---------------------- | ----------------------- |
| `—`         | U+2014                 | em dash                 |
| `–`         | U+2013                 | en dash                 |
| `−`         | U+2212                 | minus sign              |
| `‐` `‑` `―` | U+2010, U+2011, U+2015 | ostale varijante crtice |

Umesto njih uvek `-`:

```
LOŠE:   Iznos je okvirni — tačan potvrđuješ pri plaćanju.
DOBRO:  Iznos je okvirni - tačan potvrđuješ pri plaćanju.

LOŠE:   prihodi − troškovi = ostatak        LOŠE:   6–12 meseci
DOBRO:  prihodi - troškovi = ostatak        DOBRO:  6-12 meseci
```

Razlog: duga crtica je tipičan trag AI-generisanog teksta i vlasnik repozitorijuma je
ne želi. Ovo nije stilska preferencija oko koje se pregovara po fajlu - važi za ceo
projekat, bez izuzetka.

### Provera

`pnpm check` obuhvata i `pnpm check:dashes` ([scripts/check-dashes.sh](scripts/check-dashes.sh)),
koji skenira sve git-tracked fajlove i pada ako naiđe na bilo koji od gornjih znakova.
Pokreni ga pre commit-a.

Skripta gleda `git ls-files`, pa **ne vidi fajlove koji još nisu dodati u git**. Ako
proveravaš novi fajl, prvo `git add` pa onda `pnpm check` - inače prolazi lažno.

Ovaj fajl (`AGENTS.md`) je jedini izuzet iz provere, jer mora da prikaže zabranjene
znakove da bi uopšte objasnio koji su zabranjeni.

### Dva svesna izuzetka

1. Ceo folder `supabase/migrations/` se preskače. To su već primenjene, istorijske
   migracije; njihov tekst je bajt-po-bajt zapisan u
   `supabase_migrations.schema_migrations.statements` na produkciji, pa bi izmena
   napravila drift bez ikakve koristi (sve crtice su tamo samo u SQL komentarima).
   **Nove migracije piši bez dugačke crtice** - pravilo važi i za njih, samo ih skripta
   ne proverava retroaktivno.

2. **`─` (U+2500, box drawing)** - dozvoljen. To nije crtica u rečenici nego ASCII-art
   separator sekcija u komentarima (`// ──── Sekcija ────`) i takav ostaje.

## Ostalo

- Jezik: tekst koji korisnik vidi je **srpski** (latinica). Komentari u kodu su engleski.
- Labele dugmadi imaju ustaljeno značenje: `Odustani` (odbaci formu), `Otkaži X`
  (domenska otkazivanja), `Zatvori` (zatvori prikaz bez izmena), `Nazad` (korak nazad u
  pod-prikazu).
- Lint/format je Oxc: `pnpm check` = `oxfmt --check` + `oxlint --deny-warnings` +
  provera crtica. CI (`.github/workflows/deploy.yml`) pokreće samo `pnpm build`, pa
  `pnpm check` i `pnpm test` moraju da prođu lokalno pre PR-a.
- Nikad ne commit-uj direktno na `main` - uvek grana pa PR (squash-merge).
