# THIRA Auto Sync

ระบบ sync ใบยกตู้V4TEST.xlsm → Supabase `ants.containers` อัตโนมัติ

## 2 วิธี sync (ทำงานคู่กันได้)

### 1️⃣ Local Watcher (ตรวจเจอเซฟไฟล์ → sync ทันที)

ดู `C:\Users\Admin\Dropbox\ใบยกตู้\ใบยกตู้V4TEST.xlsm` → เมื่อมีการเซฟ จะรัน `thira_sync.py --local` ให้อัตโนมัติ

**ติดตั้งครั้งแรก:**
```bash
cd C:\Users\Admin\Dropbox\THITA-RT\supabase\sync
pip install -r requirements.txt
copy .env.example .env
notepad .env     # ใส่ SUPABASE_URL กับ SUPABASE_KEY
```

**ทดสอบรัน:**
```bash
python thira_watch.py
```
เปิดไฟล์ Excel → เซฟ → ดูใน console จะมี `📝 ตรวจเจอการเปลี่ยนแปลง` + `🔄 เริ่ม sync...`

**ให้รันอัตโนมัติตอนเปิดเครื่อง:**
1. กด `Win+R` → พิมพ์ `shell:startup` → Enter
2. คลิกขวา → New → Shortcut → ใส่ path `C:\Users\Admin\Dropbox\THITA-RT\supabase\sync\thira_watch.bat`
3. Restart Windows → จะรันเงียบใน background

**Log file:** `thira_watch.log` (ในโฟลเดอร์เดียวกัน)

---

### 2️⃣ GitHub Actions (cron ทุก 30 นาที)

อยู่ใน `.github/workflows/sync.yml` — รันบน GitHub Actions ทุก 30 นาที โดยดึงไฟล์จาก Dropbox API

**ต้อง set GitHub Secrets:**
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`

(ค่า DROPBOX_* ใช้ตัวเดียวกับ repo `ants-sync-github` ได้เลย)

**กดรันด้วยมือ:** Repo → Actions → "THIRA Auto Sync" → Run workflow

---

## โครงสร้างข้อมูล

อ่านชีต `DATABASE` ตั้งแต่แถว 5 — 11 คอลัมน์:
1. ทะเบียนรถ (`truck_plate`)
2. จำนวนมัด (`bundles`)
3. INV (`invoice_no`)
4. วันเข้าโรงงาน (`date_in`)
5. โรงงาน (`factory`)
6. สายเรือ (`vessel`)
7. เบอร์ตู้ (`container_no`)
8. น้ำหนัก (`weight`)
9. CADO NO. (`cado_no`)
10. วันรับตู้ (`date_pickup`)
11. STATUS (`status`)

→ ล้าง `ants.containers` แล้ว insert ใหม่ทั้งหมด (chunk 500)
