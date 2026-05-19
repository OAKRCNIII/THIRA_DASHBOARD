-- ตารางพักบิลที่ผ่าน OCR แล้ว รอ user ระบุรถ + ยืนยัน

CREATE TABLE IF NOT EXISTS thira.line_pending_bills (
  id BIGSERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_truck',
    -- awaiting_truck: รอ user แตะ Quick Reply เลือกรถ
    -- awaiting_confirm: รอ user แตะ ✓/✗ ใน Flex Card
    -- confirmed: บันทึกลง outcomes แล้ว
    -- cancelled: user ยกเลิก
  truck_plate TEXT,
  date DATE,
  category TEXT,
  liters NUMERIC(8,2),
  amount NUMERIC(12,2),
  note TEXT,
  raw_ocr TEXT,             -- Claude OCR raw response (เก็บไว้ debug)
  image_message_id TEXT,     -- LINE message ID
  image_path TEXT,           -- Storage path (ถ้าใช้)
  outcome_id BIGINT,         -- FK ไป outcomes หลัง confirm
  error TEXT,                -- ถ้า OCR fail
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_pending_user_status
  ON thira.line_pending_bills(line_user_id, status);

CREATE INDEX IF NOT EXISTS idx_line_pending_created
  ON thira.line_pending_bills(created_at DESC);

ALTER TABLE thira.line_pending_bills ENABLE ROW LEVEL SECURITY;

-- service_role bypass; anon/authenticated ไม่ต้องเข้าถึง (เป็น backend table)
-- ไม่ต้องตั้ง policy
