-- Rođendani kao treći tip linka.
--
--   payments.birthday_id — "poklon za Markov rođendan": plaćanje se veže za
--   rođendan isto kao za aktivnost/događaj. `payments_single_link` se širi na
--   sva tri stupca (i dalje najviše JEDAN link po plaćanju).
--
--   events.birthday_id — "Organizuj proslavu" sa stranice rođendana kreira
--   događaj vezan za taj rođendan, pa stranica može da prikaže "proslava
--   zakazana" čip. Bez CHECK ograničenja — događaj ima najviše taj jedan link.
--
-- ON DELETE SET NULL iz istog razloga kao postojeći linkovi: brisanje
-- rođendana ne sme da povuče plaćanja/događaje — link se samo otkači.
-- Bez RLS/realtime izmena: kolone žive na već pokrivenim tabelama.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS birthday_id UUID REFERENCES birthdays(id) ON DELETE SET NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_single_link;
ALTER TABLE payments
  ADD CONSTRAINT payments_single_link CHECK (num_nonnulls(activity_id, event_id, birthday_id) <= 1);

CREATE INDEX IF NOT EXISTS idx_payments_birthday ON payments(birthday_id)
  WHERE birthday_id IS NOT NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS birthday_id UUID REFERENCES birthdays(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_birthday ON events(birthday_id)
  WHERE birthday_id IS NOT NULL;
