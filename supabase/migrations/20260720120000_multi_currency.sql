-- Multi-currency troškovi (EUR za početak) — "frozen rate" design.
--
-- Design notes worth reading before touching this file:
--
--   • `expenses.amount` stays THE amount in RSD, always — every aggregation in
--     the app (budget cycle, trends, category totals, month comparisons) sums
--     it currency-blind and remains correct without touching a single hook.
--
--   • A foreign-currency entry carries three extra facts, all FROZEN at entry
--     time: `currency` (already existed, default 'RSD'), `original_amount`
--     (what was actually typed, e.g. 50 EUR) and `exchange_rate` (the NBS
--     middle rate used for the conversion). Nothing is ever re-converted when
--     reading history, so rate drift can never change past months.
--
--   • `exchange_rates` is a global cache of official NBS middle rates, filled
--     lazily by the `exchange-rate` edge function (service role). Members get
--     SELECT-only RLS; there are deliberately NO insert/update/delete policies,
--     so user sessions can never poison the cache. `date` is the REQUESTED
--     day; `source_date` is the NBS list it resolved to (weekends/holidays
--     resolve to the last published list).
--
--   • Auto rows (source='payment') and receipt rows stay RSD-only by nature —
--     their insert paths are untouched.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. exchange_rates — NBS middle-rate cache, one row per (requested day, currency).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE exchange_rates (
  date DATE NOT NULL,
  currency TEXT NOT NULL,
  rate NUMERIC(12, 6) NOT NULL CHECK (rate > 0),
  source_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (date, currency)
);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view exchange_rates" ON exchange_rates FOR SELECT
  TO authenticated USING (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. expenses — the frozen original entry. Both columns stay NULL for RSD rows
--    and are both required for foreign ones (enforced below), so a row can
--    never claim to be EUR without recording what was typed and at which rate.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN original_amount NUMERIC(12, 2) CHECK (original_amount > 0),
  ADD COLUMN exchange_rate NUMERIC(12, 6) CHECK (exchange_rate > 0);

ALTER TABLE expenses ADD CONSTRAINT expenses_foreign_currency_complete CHECK (
  (currency = 'RSD' AND original_amount IS NULL AND exchange_rate IS NULL)
  OR (currency <> 'RSD' AND original_amount IS NOT NULL AND exchange_rate IS NOT NULL)
);
