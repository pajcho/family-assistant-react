-- Recurring utility bills (electricity, water, the rest) vary month to month.
-- `is_variable_amount` marks such a payment: the live `amount` is only a rough
-- default shown in projections, and each "mark as paid" prompts
-- for the ACTUAL amount, which is snapshotted into `payment_history.amount` (and
-- thus the auto-expense). Fixed payments keep the one-tap flow untouched.
--
-- Only ever true for recurring payments — the form gates the toggle to
-- weekly/monthly/limited. Existing rows back-fill to false (fixed amount).

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS is_variable_amount BOOLEAN NOT NULL DEFAULT false;
