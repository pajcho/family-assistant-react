-- Add sort_order column to expenses table for custom ordering
ALTER TABLE expenses ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Set initial sort_order based on current order (by amount desc)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY family_id ORDER BY amount DESC) as rn
  FROM expenses
)
UPDATE expenses SET sort_order = numbered.rn
FROM numbered WHERE expenses.id = numbered.id;
