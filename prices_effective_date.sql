-- ─────────────────────────────────────────────────────────────
-- thira.prices: เพิ่ม effective_date เพื่อให้รองรับการเปลี่ยนราคา
--   ตามวันที่ (history-aware lookup)
--
-- หลัง migrate:
--   destination_code + effective_date = unique key
--   lookup เลือก row ล่าสุดที่ effective_date <= trip.date_in
--
-- ตัวอย่าง:
--   id 53  | กนกทอง | 2024-01-01 | r1=80 r2=80   ← เดิม
--   id NEW | กนกทอง | 2026-06-17 | r1=90 r2=80   ← ใหม่
-- ─────────────────────────────────────────────────────────────

-- 1. เพิ่ม column (default = 2024-01-01 ครอบคลุม trip ทุกตัวที่มีในระบบ)
ALTER TABLE thira.prices
  ADD COLUMN IF NOT EXISTS effective_date date NOT NULL DEFAULT '2024-01-01';

-- 2. ลบ unique constraint เดิมของ destination_code (ถ้ามี)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prices_destination_code_key'
      AND conrelid = 'thira.prices'::regclass
  ) THEN
    ALTER TABLE thira.prices DROP CONSTRAINT prices_destination_code_key;
  END IF;
END $$;

-- 3. เพิ่ม composite unique (destination_code, effective_date)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prices_dest_date_unique'
      AND conrelid = 'thira.prices'::regclass
  ) THEN
    ALTER TABLE thira.prices
      ADD CONSTRAINT prices_dest_date_unique UNIQUE (destination_code, effective_date);
  END IF;
END $$;

-- 4. (ตัวอย่าง) เพิ่มราคาใหม่ของกนกทอง เริ่ม 17/6/2026
INSERT INTO thira.prices
  (destination_code, destination_name, factory_origin, effective_date,
   fee_driver, fuel_liters_route_1, fuel_liters_route_2)
VALUES
  ('กนกทอง', 'กนกทอง', 'กนกทอง', '2026-06-17',
   500, 90, 80)
ON CONFLICT (destination_code, effective_date) DO UPDATE SET
  fee_driver = EXCLUDED.fee_driver,
  fuel_liters_route_1 = EXCLUDED.fuel_liters_route_1,
  fuel_liters_route_2 = EXCLUDED.fuel_liters_route_2;
