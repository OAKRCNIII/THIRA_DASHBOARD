-- แยกประเภทบิลใน incomes: OGM_KNT (บิล 1) vs OTHER (บิล 2)
ALTER TABLE thira.incomes
  ADD COLUMN IF NOT EXISTS bill_type TEXT
  CHECK (bill_type IN ('OGM_KNT', 'OTHER') OR bill_type IS NULL);
