-- RLS policies — เปิดให้ anon/authenticated อ่านได้ (publishable key ใน browser)
-- service_role bypass RLS อยู่แล้ว ไม่ต้องเพิ่ม policy

-- thira schema
CREATE POLICY "read_all" ON thira.trucks             FOR SELECT USING (true);
CREATE POLICY "read_all" ON thira.outcomes           FOR SELECT USING (true);
CREATE POLICY "read_all" ON thira.incomes            FOR SELECT USING (true);
CREATE POLICY "read_all" ON thira.prices             FOR SELECT USING (true);
CREATE POLICY "read_all" ON thira.fuel_rates         FOR SELECT USING (true);
CREATE POLICY "read_all" ON thira.prefix_factory_map FOR SELECT USING (true);

-- ants schema
CREATE POLICY "read_all" ON ants.containers          FOR SELECT USING (true);
