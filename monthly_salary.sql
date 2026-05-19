-- เงินเดือน base ต่อคันรถ (driver salary, paid in .2 period)
-- ทุกคัน 3,000 บ./เดือน

ALTER TABLE thira.trucks
  ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(10,2) DEFAULT 0;

UPDATE thira.trucks SET monthly_salary = 3000
WHERE plate IN ('71-9538','72-1620','72-2237','72-2420','72-2953','72-3148');
