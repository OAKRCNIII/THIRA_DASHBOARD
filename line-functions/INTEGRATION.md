# LINE Bill OCR — Integration Guide

## ไฟล์ที่ต้องเพิ่ม

1. คัดลอก `bill_handler.ts` → `C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc\supabase\functions\line-webhook\bill_handler.ts`

## แก้ `index.ts` 3 จุด

### จุดที่ 1: import (บนสุดของไฟล์, หลังบรรทัด `import { createClient } ...`)

```ts
import {
  handleImageMessage,
  tryHandleTruckSelection,
  handleBillPostback
} from "./bill_handler.ts";
```

### จุดที่ 2: ใน Deno.serve, ในลูป `for (const event of events)` — แก้บรรทัด 703

**ก่อน:**
```ts
for (const event of events) {
  if (event.type !== "message" || event.message?.type !== "text") continue;
```

**หลัง (เปิดรับ image + postback):**
```ts
for (const event of events) {
  // accept text, image messages, and postback events
  const isText = event.type === "message" && event.message?.type === "text";
  const isImage = event.type === "message" && event.message?.type === "image";
  const isPostback = event.type === "postback";
  if (!isText && !isImage && !isPostback) continue;
```

### จุดที่ 3: หลัง whitelist check (หลังบรรทัด `if (!checkRateLimit(userId)) {...}` block ~ บรรทัด 723)

แทรกก่อน `// 💬 COMMAND?`:

```ts
    // 📸 IMAGE → bill OCR flow
    if (isImage) {
      await handleImageMessage(event, (msgs) => replyToLineMessages(replyToken, msgs));
      continue;
    }
    // 🔘 POSTBACK → bill confirm/cancel
    if (isPostback) {
      const handled = await handleBillPostback(event, (msgs) => replyToLineMessages(replyToken, msgs));
      if (handled) continue;
    }
    // 🚛 TEXT during awaiting_truck → set plate + send Flex
    if (isText) {
      const handled = await tryHandleTruckSelection(userId, text, (msgs) => replyToLineMessages(replyToken, msgs));
      if (handled) continue;
    }
```

> หมายเหตุ: ส่วน text route ปกติ (`handleCommand` + `askClaude`) อยู่ต่อจากนี้ — ไม่ต้องแก้

## Deploy

```cmd
cd C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc
supabase functions deploy line-webhook
```

(ต้องมี Supabase CLI + login แล้ว)

## Test

1. LINE OA channel เดิม
2. ส่งรูปบิลเข้า
3. Bot reply "📸 รับรูป กำลังอ่าน..."
4. Bot ส่ง Quick Reply ถามรถ
5. แตะ → Bot ส่ง Flex Card ยืนยัน
6. แตะ ✓ → save outcome + reply "✅ บันทึกสำเร็จ"

## Cost

- OCR ใช้ Claude Haiku 4.5 with vision: ~$0.001-0.003 ต่อบิล
- LINE Messaging API: ฟรี (Free plan = 200 push messages/เดือน)
