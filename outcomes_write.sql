-- เปิด RLS policies ให้ outcomes รองรับ INSERT/UPDATE/DELETE จาก publishable key

CREATE POLICY "insert_all" ON thira.outcomes FOR INSERT WITH CHECK (true);
CREATE POLICY "update_all" ON thira.outcomes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "delete_all" ON thira.outcomes FOR DELETE USING (true);

GRANT INSERT, UPDATE, DELETE ON thira.outcomes TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE thira.outcomes_id_seq TO anon, authenticated;

-- เผื่อ incomes ด้วย (รายรับเข้ามา)
CREATE POLICY "insert_all" ON thira.incomes FOR INSERT WITH CHECK (true);
CREATE POLICY "update_all" ON thira.incomes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "delete_all" ON thira.incomes FOR DELETE USING (true);
GRANT INSERT, UPDATE, DELETE ON thira.incomes TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE thira.incomes_id_seq TO anon, authenticated;

-- fuel_periods (ให้แก้ opening / bonus / reviewed ผ่าน UI ภายหลัง)
CREATE POLICY "insert_all" ON thira.fuel_periods FOR INSERT WITH CHECK (true);
CREATE POLICY "update_all" ON thira.fuel_periods FOR UPDATE USING (true) WITH CHECK (true);
GRANT INSERT, UPDATE ON thira.fuel_periods TO anon, authenticated;
