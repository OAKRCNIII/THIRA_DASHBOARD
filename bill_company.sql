-- ขยาย bill_type ใน incomes: รองรับ 4 ค่า
ALTER TABLE thira.incomes DROP CONSTRAINT IF EXISTS incomes_bill_type_check;
ALTER TABLE thira.incomes ADD CONSTRAINT incomes_bill_type_check
  CHECK (bill_type IN ('THIRA_OGM', 'THIRA_ALL', 'TJ_OGM', 'TJ_ALL') OR bill_type IS NULL);

-- Migrate ค่าเดิม (ถ้ามี) — OGM_KNT → THIRA_OGM/TJ_OGM, OTHER → THIRA_ALL/TJ_ALL
UPDATE thira.incomes SET bill_type = CASE
  WHEN truck_plate = '72-2420' AND bill_type = 'OGM_KNT' THEN 'TJ_OGM'
  WHEN bill_type = 'OGM_KNT' THEN 'THIRA_OGM'
  WHEN truck_plate = '72-2420' AND bill_type = 'OTHER' THEN 'TJ_ALL'
  WHEN bill_type = 'OTHER' THEN 'THIRA_ALL'
  ELSE bill_type
END
WHERE bill_type IN ('OGM_KNT', 'OTHER');
