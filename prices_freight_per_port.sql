-- ค่าขนส่งแยกท่า: ชุดราคา (freight_price_sets) เก็บค่าเดียวต่อโรงงาน แยกท่าไม่ได้
-- เคสแรกที่ต่างกันจริง: ปัตตานี 20FT ปาดัง 6,700 vs สงขลา 8,500
-- ใส่ช่องนี้ไว้ที่ thira.prices ซึ่งมี port + effective_date อยู่แล้ว
-- NULL = ใช้ชุดราคาตามเดิม (พฤติกรรมเดิมของทุกโรงงาน)
ALTER TABLE thira.prices
  ADD COLUMN IF NOT EXISTS freight_price numeric;

COMMENT ON COLUMN thira.prices.freight_price IS
  'ค่าขนส่งที่วางบิล เฉพาะเมื่อท่านี้คิดไม่เท่าชุดราคากลาง — NULL = ใช้ freight_price_sets ตามปกติ · ใบวางบิลจริง (transport_bills) ชนะเสมอ';
