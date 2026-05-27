-- Drop the `category` column from `activities`. Originally it tagged each
-- activity as training / school / music / english / other, but in practice
-- the activity's name already conveys this ("Trening fudbala" vs
-- "Muzička škola"), and nothing functionally depends on it — no filter,
-- no color, no behaviour. Removing it tightens the form.
--
-- Easy to re-add later via a new migration if a real use shows up.

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_category_check;
ALTER TABLE activities DROP COLUMN IF EXISTS category;
