-- เที่ยวพิเศษ (งานนอก/วิ่งของส่วนตัว) — นับเป็น fuel consumption เพิ่ม

CREATE TABLE IF NOT EXISTS thira.extra_trips (
  id BIGSERIAL PRIMARY KEY,
  truck_plate TEXT NOT NULL REFERENCES thira.trucks(plate),
  date DATE NOT NULL,
  description TEXT NOT NULL,      -- "วิ่งกระดาษทราย"
  liters NUMERIC(8,2) NOT NULL,   -- 20 (จำนวนลิตรที่ใช้)
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT                  -- 'RCN' / 'INK'
);
CREATE INDEX IF NOT EXISTS idx_extra_trips ON thira.extra_trips(truck_plate, date);

ALTER TABLE thira.extra_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all"   ON thira.extra_trips FOR SELECT USING (true);
CREATE POLICY "insert_all" ON thira.extra_trips FOR INSERT WITH CHECK (true);
CREATE POLICY "update_all" ON thira.extra_trips FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "delete_all" ON thira.extra_trips FOR DELETE USING (true);

-- grants for publishable key (anon role) to write
GRANT INSERT, UPDATE, DELETE ON thira.extra_trips TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE thira.extra_trips_id_seq TO anon, authenticated;
