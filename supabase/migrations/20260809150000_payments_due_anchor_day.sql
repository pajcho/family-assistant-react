-- Dan u mesecu na koji je placanje originalno postavljeno. Bez njega se
-- mesecni datum dospeca trajno gubi: addMonth(2026-01-31) vraca 2026-02-28,
-- pa sledeci korak racuna od 28. i serija zauvek ostaje na 28.
--
-- Sa sidrom svaki korak racuna dan iz due_anchor_day, a ne iz prethodnog
-- (vec odsecenog) rezultata: 31 -> 28 (februar) -> 31 (mart) -> 30 (april).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS due_anchor_day SMALLINT;

-- Popunjavanje zatecenih redova: uzimamo dan iz trenutnog due_date.
-- Postena napomena: za serije koje su VEC odlutale ovo vraca odlutali dan
-- (28), a ne originalni (31). Original se ne moze pouzdano rekonstruisati, a
-- pogadjanje iz payment_history bi moglo da napuha sidro ako je korisnik
-- legitimno pomerio datum. Dakle: lutanje prestaje ovde, ali se ono do sada
-- nastalo ne ponistava unazad.
UPDATE payments SET due_anchor_day = EXTRACT(DAY FROM due_date)::SMALLINT
  WHERE due_anchor_day IS NULL;

ALTER TABLE payments ADD CONSTRAINT payments_due_anchor_day_range
  CHECK (due_anchor_day IS NULL OR (due_anchor_day >= 1 AND due_anchor_day <= 31));

COMMENT ON COLUMN payments.due_anchor_day IS
  'Dan u mesecu (1-31) na koji je serija usidrena. Svaki mesecni korak racuna dan odavde, pa 31. ne postaje trajno 28. posle februara.';
