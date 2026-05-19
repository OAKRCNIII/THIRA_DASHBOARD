-- ภาพรวมทั้งฝูง (เพิ่มเติมจาก profit_by_truck)
-- แสดง: รายรับรวม / รายจ่ายต่อรถ / overhead (XX-XXXX) / กำไร direct / กำไรสุทธิ

CREATE OR REPLACE VIEW thira.fleet_summary AS
SELECT
  (SELECT SUM(amount_net) FROM thira.incomes)                                          AS total_income_net,
  (SELECT SUM(amount) FROM thira.outcomes WHERE truck_plate != 'XX-XXXX')              AS total_outcome_trucks,
  (SELECT SUM(amount) FROM thira.outcomes WHERE truck_plate  = 'XX-XXXX')              AS shared_overhead,
  (SELECT SUM(amount) FROM thira.outcomes)                                             AS total_outcome_all,
  (SELECT SUM(amount_net) FROM thira.incomes)
    - (SELECT SUM(amount) FROM thira.outcomes WHERE truck_plate != 'XX-XXXX')          AS profit_direct,
  (SELECT SUM(amount_net) FROM thira.incomes)
    - (SELECT SUM(amount) FROM thira.outcomes)                                         AS profit_net;
