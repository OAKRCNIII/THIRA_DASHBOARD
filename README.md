# THIRA_DASHBOARD

Dashboard ระบบติดตามรถหัวลาก THIRA RT LOGISTIC + ระบบบันทึกบิลผ่าน LINE OA OCR

## โครงสร้าง

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `dashboard.html` | Dashboard หลัก — ภาพรวม 6 คัน, รายคัน, บันทึกข้อมูล (รายจ่าย/รายรับ) |
| `monthly.html` | รายงานกำไรรายเดือน 12 เดือน × 6 คัน + modal รายคัน |
| `print_all.html` | ออกรีพอร์ตทั้งฝูง 6 คัน (สรุปต้องโอนคนขับ + รายคันละหน้า) |
| `generate_report.py` | สคริปต์ Python สร้างรีพอร์ตรายคัน เป็น HTML |
| `import_excel.py` | สคริปต์ import ข้อมูลจาก Excel `.xlsm` → Supabase |
| `line-functions/bill_handler.ts` | Edge Function: LINE OA bill OCR (deploy ใน Supabase) |
| `schema.sql` + อื่น ๆ | DDL ตาราง |

## Stack

- **Frontend:** HTML + Vanilla JS + Supabase JS SDK (CDN)
- **Backend:** Supabase (Postgres + Edge Functions Deno)
- **OCR:** Claude Sonnet 4.5 with vision
- **LINE:** Messaging API webhook
- **Excel import:** Python + openpyxl + supabase-py

## Setup

### 1. Supabase
- Project: `eurnevjtzxansothqney.supabase.co` (FREIGHT_CALC)
- Run SQL files ใน `Supabase SQL Editor` ตามลำดับ:
  1. `schema.sql` — tables + views
  2. `grants.sql` — RLS + permissions
  3. `rls_policies.sql`, `outcomes_write.sql` — เปิดสิทธิ์
  4. `fuel_periods.sql` + อื่นๆ ตามต้องการ

### 2. Browser dashboards
เปิด `dashboard.html` / `monthly.html` / `print_all.html` ใน browser ตรง ๆ
- Publishable key อยู่ใน code แล้ว (ปลอดภัยสำหรับ public)
- ANTS Supabase key จะ prompt ครั้งแรก เก็บใน `localStorage`

### 3. Excel import (one-time)
```bash
set SUPABASE_URL=https://eurnevjtzxansothqney.supabase.co
set SUPABASE_SERVICE_KEY=<sb_secret_...>
python import_excel.py
```

### 4. LINE Edge Function
ใน FREIGHT_CALC repo (`_freight_calc/supabase/functions/line-webhook/`):
```bash
supabase functions deploy line-webhook
```

## Security notes

- **Publishable key** (`sb_publishable_...`) อยู่ในโค้ด — ปลอดภัย (RLS controls access)
- **Service role key** (`sb_secret_...`) **ห้ามใส่ใน repo** — ใช้ env var เท่านั้น
- **ANTS Supabase JWT** เก็บใน browser localStorage หลัง prompt
- การลบข้อมูลในระบบ ใช้ PIN code (ใน dashboard.html)
