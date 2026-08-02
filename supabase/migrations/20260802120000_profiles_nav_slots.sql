-- Personalizovana donja navigacija: "Danas" je uvek prvi slot, a korisnik
-- bira do 3 sekcije za preostala mesta ("Meni" sheet > "Uredi traku").
-- NULL = podrazumevani raspored (uskoro/payments/lists); prazan niz je
-- legitiman izbor (samo Danas + Meni). Vrednosti su kljucevi sekcija sa
-- fronta - klijent ih validira kroz normalizeNavSlots, pa nepoznat kljuc
-- u bazi nikad ne stize do UI-ja.
-- Zivi na profilu (ne per-device) da vazi na svim uredjajima; upis pokriva
-- postojeca RLS politika "Users can update own profile".
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nav_slots TEXT[];
