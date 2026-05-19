-- Fuel ledger per period — ยกมา + พิเศษ + ยินยัน
-- closing = opening + refilled − target_used − bonus
-- คงเหลือรอบนี้ → ยกไปเป็น opening รอบถัดไป

CREATE TABLE IF NOT EXISTS thira.fuel_periods (
  truck_plate TEXT NOT NULL REFERENCES thira.trucks(plate),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  half INT NOT NULL CHECK (half IN (1, 2)),
  opening_liters NUMERIC(8,2) NOT NULL DEFAULT 0,
  bonus_liters NUMERIC(8,2) NOT NULL DEFAULT 0,
  bonus_note TEXT,
  reviewed BOOLEAN DEFAULT false,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  PRIMARY KEY (truck_plate, year, month, half)
);

ALTER TABLE thira.fuel_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON thira.fuel_periods FOR SELECT USING (true);

-- Seed: opening balance ของรอบ 5.2/2026 (จากที่ user ยืนยัน)
INSERT INTO thira.fuel_periods (truck_plate, year, month, half, opening_liters) VALUES
  ('71-9538', 2026, 5, 2, 395),
  ('72-1620', 2026, 5, 2, 190),
  ('72-2237', 2026, 5, 2, 290),
  ('72-2420', 2026, 5, 2, 650),
  ('72-2953', 2026, 5, 2, 160),
  ('72-3148', 2026, 5, 2, 80)
ON CONFLICT (truck_plate, year, month, half) DO UPDATE SET
  opening_liters = EXCLUDED.opening_liters;
