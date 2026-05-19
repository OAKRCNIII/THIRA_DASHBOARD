-- ANTS + THIRA Supabase schema
-- Run via Supabase SQL Editor or psql

-- ============================================================
-- Schemas
-- ============================================================
CREATE SCHEMA IF NOT EXISTS thira;
CREATE SCHEMA IF NOT EXISTS ants;

-- ============================================================
-- THIRA: รถหัวลาก
-- ============================================================

CREATE TABLE thira.trucks (
  plate TEXT PRIMARY KEY,
  driver_name TEXT,
  fuel_route SMALLINT NOT NULL CHECK (fuel_route IN (1, 2)),
  active BOOLEAN DEFAULT true,
  note TEXT
);

CREATE TABLE thira.outcomes (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  truck_plate TEXT,
  category TEXT NOT NULL,
  liters NUMERIC(8,2),
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  source_row INT
);
CREATE INDEX idx_outcomes_truck_date ON thira.outcomes(truck_plate, date);
CREATE INDEX idx_outcomes_category ON thira.outcomes(category);

CREATE TABLE thira.incomes (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  truck_plate TEXT REFERENCES thira.trucks(plate),
  amount_gross NUMERIC(12,2) NOT NULL,
  amount_net NUMERIC(12,2) GENERATED ALWAYS AS (amount_gross * 0.99) STORED,
  note TEXT,
  source_row INT
);
CREATE INDEX idx_incomes_truck_date ON thira.incomes(truck_plate, date);

CREATE TABLE thira.prices (
  id BIGSERIAL PRIMARY KEY,
  destination_code TEXT NOT NULL,
  destination_name TEXT,
  factory_origin TEXT,
  fee_driver NUMERIC(10,2) NOT NULL,
  fuel_liters_route_1 NUMERIC(8,2),
  fuel_liters_route_2 NUMERIC(8,2),
  UNIQUE(destination_code, factory_origin)
);

CREATE TABLE thira.fuel_rates (
  effective_date DATE PRIMARY KEY,
  baht_per_liter NUMERIC(6,2) NOT NULL
);

-- prices_update: ใช้ public.freight_price_sets (มีอยู่แล้วจาก FREIGHT_CALC) แทน
-- โครงสร้าง: id text PK, name text, prices jsonb (key=factory_name → price), updated_at/created_at
-- mapping prefix (Excel) → factory_name (JSONB key) เก็บใน thira.prefix_factory_map

CREATE TABLE thira.prefix_factory_map (
  prefix TEXT PRIMARY KEY,           -- "TWI", "BSW", "PTN" (จาก PRICE_UPDATE)
  factory_name TEXT NOT NULL         -- "ทุ่งหลวง", "บ้านส้อง", "PTN40" (key ใน freight_price_sets)
);

INSERT INTO thira.prefix_factory_map (prefix, factory_name) VALUES
  ('TWI',         'ทุ่งหลวง'),
  ('BSW',         'บ้านส้อง'),
  ('INV',         'ไทยนคร'),
  ('SHL',         'เอส.เอช.แอล (รัตภูมิ)'),
  ('พัทลุง',       'พัทลุงซัพพลาย'),
  ('ชะอวด',       'J.M. (ชะอวด)'),
  ('SJ-',         'สวนจันทร์ (ตรัง)'),
  ('กนกทอง',      'กนกทอง (เทพา)'),
  ('นาวาพารา',     'นาวาพารา'),
  ('นาเมืองเพชร',   'นาเมืองเพชร'),
  ('PTN',         'PTN40'),
  ('PTN20',       'PTN20'),
  ('APK',         'เอ.พี.เค.เฟอร์นิชชิ่ง'),
  ('วินวิน',       'วิน วิน')
ON CONFLICT (prefix) DO UPDATE SET factory_name = EXCLUDED.factory_name;

-- ============================================================
-- ANTS: ใบยกตู้V4 — เฉพาะ DATABASE ส่วนที่ THIRA ใช้
-- ============================================================

CREATE TABLE ants.containers (
  id BIGSERIAL PRIMARY KEY,
  truck_plate TEXT,
  bundles INTEGER,
  invoice_no TEXT,
  date_in DATE,
  factory TEXT,
  vessel TEXT,
  container_no TEXT,
  weight NUMERIC(10,2),
  cado_no TEXT,
  date_pickup DATE,
  status TEXT,
  source_row INT
);
CREATE INDEX idx_containers_truck_date ON ants.containers(truck_plate, date_in);
CREATE INDEX idx_containers_invoice ON ants.containers(invoice_no);
CREATE INDEX idx_containers_container_no ON ants.containers(container_no);

-- ============================================================
-- Views: report cards (replace Excel pivot sheets)
-- ============================================================

-- รวมกำไร/ขาดทุนต่อรถ (replace SUM OUTCOME)
CREATE OR REPLACE VIEW thira.profit_by_truck AS
SELECT
  t.plate,
  t.driver_name,
  COALESCE(SUM(i.amount_net), 0) AS income,
  COALESCE((SELECT SUM(o.amount) FROM thira.outcomes o WHERE o.truck_plate = t.plate), 0) AS outcome,
  COALESCE(SUM(i.amount_net), 0)
    - COALESCE((SELECT SUM(o.amount) FROM thira.outcomes o WHERE o.truck_plate = t.plate), 0) AS profit
FROM thira.trucks t
LEFT JOIN thira.incomes i ON i.truck_plate = t.plate
GROUP BY t.plate, t.driver_name;

-- กำไรต่อเที่ยว × รถ × ปลายทาง (replace PRICE.J/K)
-- ใช้ public.freight_price_sets (ราคา latest จาก updated_at) — join ผ่าน prefix_factory_map
CREATE OR REPLACE VIEW thira.trip_profit AS
WITH latest_fuel AS (
  SELECT baht_per_liter
  FROM thira.fuel_rates
  WHERE effective_date <= CURRENT_DATE
  ORDER BY effective_date DESC LIMIT 1
),
latest_prices AS (
  SELECT prices
  FROM public.freight_price_sets
  ORDER BY updated_at DESC LIMIT 1
)
SELECT
  t.plate,
  t.driver_name,
  p.destination_code,
  p.destination_name,
  m.factory_name,
  p.fee_driver,
  fr.baht_per_liter,
  CASE t.fuel_route
    WHEN 1 THEN p.fuel_liters_route_1
    WHEN 2 THEN p.fuel_liters_route_2
  END AS fuel_liters_target,
  (lp.prices->>m.factory_name)::numeric                                AS revenue,
  (lp.prices->>m.factory_name)::numeric * 0.99                         AS revenue_net,
  (lp.prices->>m.factory_name)::numeric * 0.99 - p.fee_driver
    - (CASE t.fuel_route
         WHEN 1 THEN p.fuel_liters_route_1
         WHEN 2 THEN p.fuel_liters_route_2
       END) * fr.baht_per_liter
    - 300                                                              AS profit_per_trip
FROM thira.trucks t
CROSS JOIN thira.prices p
CROSS JOIN latest_fuel fr
CROSS JOIN latest_prices lp
LEFT JOIN thira.prefix_factory_map m ON m.prefix = p.destination_code
WHERE t.active;

-- ============================================================
-- Seed: trucks (จากที่วิเคราะห์สูตร)
-- ============================================================
INSERT INTO thira.trucks (plate, driver_name, fuel_route) VALUES
  ('71-9538', 'นายหัวเลย์',     2),
  ('72-1620', 'นายหัวปอ',       2),
  ('72-2237', 'นายหัวประเสริฐ', 1),
  ('72-2420', 'นายหัวบังเฮง',   1),
  ('72-2953', 'นายหัวบังฟี',    1),
  ('72-3148', 'นายหัวอาคม',     1),
  ('XX-XXXX', 'รายจ่ายรวม/นอกฝูง', 1)
ON CONFLICT (plate) DO NOTHING;
