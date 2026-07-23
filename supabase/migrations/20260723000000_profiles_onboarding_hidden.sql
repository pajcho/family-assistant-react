-- "Prvi koraci" onboarding kartica na Danas: per-korisnik "Sakrij".
-- NULL = kartica sme da se prikaze (dok koraci nisu kompletirani);
-- postavlja se na now() kad korisnik tapne "Sakrij". Zivi na profilu da bi
-- vazio na svim uredjajima (PWA na telefonu + desktop).
-- RLS: postojeca politika "Users can update own profile" pokriva upis.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_hidden_at TIMESTAMPTZ;
