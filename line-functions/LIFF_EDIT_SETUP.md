# LIFF Edit Bill — Setup Guide

ระบบ **แก้ไขบิลผ่านฟอร์ม LIFF → ยืนยันใน chat อีกครั้ง → บันทึก**

## 🎯 Flow

```
[Bot OCR บิล]
   ↓
[Flex Message + ปุ่ม "✏️ แก้ไขในฟอร์ม"]
   ↓ (กดปุ่ม)
[LIFF form เด้งใน LINE — pre-filled]
   ↓ (user แก้ + กดส่ง)
[Edge function อัพเดต pending + push Flex ใหม่]
   ↓
[Flex "✏️ แก้ไขแล้ว — กรุณายืนยัน" + ปุ่ม ✓ ยืนยัน / ✗ ยกเลิก / ✏️ แก้อีก]
   ↓ (กด ✓)
[บันทึกลง outcomes table]
```

---

## 📋 ขั้นตอนติดตั้ง (ทำครั้งเดียว)

### 1. รัน SQL ที่ Supabase

เปิด: https://supabase.com/dashboard/project/eurnevjtzxansothqney/sql/new

Copy SQL จาก `supabase/line_edit_token.sql` → Run

จะได้:
- Column `edit_token uuid` ใน `thira.line_pending_bills`
- RPC `thira.fetch_pending_for_edit(id, token)` ที่ LIFF เรียก

---

### 2. Deploy edge function `line-edit-bill`

```bash
# คัดลอกไฟล์ไป FREIGHT_CALC project
copy "C:\Users\Admin\Dropbox\THITA-RT\supabase\line-functions\line_edit_bill_endpoint.ts" ^
     "C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc\supabase\functions\line-edit-bill\index.ts"

cd C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc
supabase functions deploy line-edit-bill --no-verify-jwt
```

ได้ URL: `https://ywslgrusflfuxtrtvlfu.supabase.co/functions/v1/line-edit-bill`

---

### 3. Deploy `edit-bill.html` ที่ GitHub Pages

ไฟล์ `edit-bill.html` push ขึ้น THIRA_DASHBOARD repo แล้ว → URL:
```
https://oakrcniii.github.io/THIRA_DASHBOARD/edit-bill.html
```

> ⚠️ ยังต้องแทน `__LIFF_ID_HERE__` ใน HTML ด้วย LIFF ID จริง (หลังสร้างในขั้นที่ 4)

---

### 4. สร้าง LIFF App ใน LINE Developers Console

1. ไปที่: https://developers.line.biz/console/
2. เลือก Provider → Channel (ของ LINE OA THIRA)
3. แท็บ **LIFF** → กด **Add**
4. กรอกข้อมูล:
   - **LIFF app name:** `แก้ไขบิล THIRA`
   - **Size:** `Tall` (75%) ← เหมาะกับฟอร์ม
   - **Endpoint URL:** `https://oakrcniii.github.io/THIRA_DASHBOARD/edit-bill.html`
   - **Scope:** ติ๊ก `chat_message.write` (กรณีจะส่ง msg เพิ่มในอนาคต)
   - **Bot link feature:** Off
5. กด **Add** → ได้ **LIFF ID** เช่น `2006543210-abcdefgh`

---

### 5. ใส่ LIFF ID ใน 2 ที่

#### ที่ 1: ใน edit-bill.html
แก้บรรทัด:
```js
const LIFF_ID = '__LIFF_ID_HERE__';
```
เป็น:
```js
const LIFF_ID = '2006543210-abcdefgh';   // ← LIFF ID จริง
```
push ขึ้น GitHub Pages

#### ที่ 2: ใส่เป็น env var ของ edge function

ที่ Supabase Dashboard → **Edge Functions** → ทั้ง `line-webhook` และ `line-edit-bill`
→ **Settings** → **Add secret**:
- Name: `LIFF_ID_EDIT_BILL`
- Value: `2006543210-abcdefgh`

---

### 6. Deploy bill_handler.ts ใหม่ (มี LIFF_ID_EDIT_BILL fallback)

```bash
copy "C:\Users\Admin\Dropbox\THITA-RT\supabase\line-functions\bill_handler.ts" ^
     "C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc\supabase\functions\line-webhook\bill_handler.ts"

cd C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc
supabase functions deploy line-webhook --no-verify-jwt
```

---

## ✅ ทดสอบ

1. ส่งรูปบิลใน LINE
2. รอ bot OCR เสร็จ
3. กดปุ่ม **"✏️ แก้ไขในฟอร์ม"** — LIFF เด้งขึ้น
4. แก้ข้อมูล → กด **"ส่งเพื่อยืนยันใน LINE →"**
5. LIFF ปิด → กลับมาดู chat
6. มี Flex ใหม่ **"✏️ แก้ไขแล้ว — กรุณายืนยัน"** ขึ้น
7. กด **✓ ยืนยันบันทึก** → ✅ บันทึกลง outcomes

---

## 🐛 Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| ปุ่ม "✏️ แก้ไข" ยังเป็น postback แบบเดิม | `LIFF_ID_EDIT_BILL` env var ไม่ set | เพิ่มที่ Supabase secrets |
| LIFF เปิดแล้วบอก "ลิงก์ไม่ถูกต้อง" | url ไม่มี `id` หรือ `t` param | เช็คใน buildBillFlex ว่า edit_token มาด้วย |
| LIFF บอก "ไม่พบบิลนี้" | RPC `fetch_pending_for_edit` ไม่ deploy | รัน SQL ใน step 1 |
| LIFF ส่งแล้ว ไม่มี Flex confirm กลับมา | edge function `line-edit-bill` ไม่ deploy หรือ permission ผิด | ดู Function logs |
| รูปบิลซ้ำหลัง confirm | กดยืนยันซ้ำ — handle ใน `handleBillPostback` กัน `status='confirmed'` ไว้แล้ว | OK |

---

## ⏰ TTL (อายุของ pending bills)

- RPC `fetch_pending_for_edit` filter `created_at > NOW() - 24 hours`
- ดังนั้น **ลิงก์ LIFF ใช้ได้ภายใน 24 ชั่วโมง** หลังบอท OCR
- หลัง 24 ชม. — user ต้องส่งรูปบิลใหม่
