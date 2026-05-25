// ═══════════════════════════════════════════════════════════
//  THIRA bill handler — รับรูปบิลจาก LINE, OCR ผ่าน Claude, save outcomes
//
//  Flow:
//   1. handleImageMessage(event) — รับรูป, OCR, สร้าง pending_bill, ถาม truck
//   2. handlePendingTruckText(event, text) — รับ text หลังส่งรูป → set truck_plate, ส่ง Flex
//   3. handleBillPostback(event, data) — รับ postback confirm/cancel
//
//  ใช้:
//   - thira.line_pending_bills table (status: awaiting_truck → awaiting_confirm → confirmed/cancelled)
//   - thira.outcomes table (เป้าหมาย insert)
//   - Claude Haiku 4.5 with vision
// ═══════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// LIFF app ID สำหรับฟอร์มแก้ไขบิล — set หลังสร้างใน LINE Developers Console
// ถ้ายังไม่ตั้ง → ปุ่มแก้ไขจะ fallback ไปแบบเก่า (พิมพ์ใน chat)
const LIFF_ID_EDIT_BILL = Deno.env.get("LIFF_ID_EDIT_BILL") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TRUCK_PLATES = ["71-9538", "72-1620", "72-2237", "72-2420", "72-2953", "72-3148", "XX-XXXX"];

const CATEGORIES = [
  "ค่าน้ำมัน", "ค่ายาง", "เช็คระยะ",
  "ค่าเคลียหมวดกร", "ค่าเคลียจ่าแชมป์", "ค่าผ่านด่าน",
  "บุญช่วย", "ประกัน", "สุวิทย์", "ร้อยละ4", "บัญชี", "อื่นๆ"
];

// หมวดที่เป็นรายจ่ายรวมของฝูง → auto truck = XX-XXXX (ไม่ต้องถาม)
const SHARED_CATEGORIES = ["บัญชี", "ร้อยละ4", "สุวิทย์", "บุญช่วย"];

// สร้าง Quick Reply ปุ่มทะเบียนรถ (รวม XX-XXXX สำหรับ shared)
function truckQuickReplyItems(): any[] {
  return TRUCK_PLATES.map(plate => ({
    type: "action",
    action: {
      type: "message",
      label: plate === "XX-XXXX" ? "🌐 รวมฝูง" : plate,
      text: plate
    }
  }));
}

// ═══════════════════════════════════════════════════════════
//  Step 1: รับรูปบิล → OCR → สร้าง pending
// ═══════════════════════════════════════════════════════════

export async function handleImageMessage(
  event: any,
  reply: (msgs: any[]) => Promise<void>
): Promise<void> {
  const userId = event.source?.userId;
  const messageId = event.message?.id;
  if (!userId || !messageId) return;

  // ตอบเร็วๆ ก่อนว่ารับแล้ว
  await reply([{ type: "text", text: "📸 รับรูปบิลแล้ว กำลังอ่าน..." }]);

  try {
    // 1. ดาวน์โหลดรูปจาก LINE
    const imageBuf = await fetchLineImage(messageId);
    const base64 = arrayBufferToBase64(imageBuf);

    // 2. OCR ผ่าน Claude vision
    const parsed = await ocrBillImage(base64);

    let autoPlate = parsed.plate && TRUCK_PLATES.includes(parsed.plate) ? parsed.plate : null;

    // ทุก entry ผ่าน LINE = outcome (รายจ่าย) — ไม่แยก kind
    // ถ้าเป็นสลิป category ยังเป็น null → user เลือกหมวดผ่าน edit
    if (parsed.is_slip && !parsed.category) parsed.category = "อื่นๆ";

    // ถ้าหมวดเป็น "รายจ่ายรวม" (บัญชี/ร้อยละ4/สุวิทย์/บุญช่วย) → auto truck = XX-XXXX
    if (parsed.category && SHARED_CATEGORIES.includes(parsed.category)) {
      autoPlate = "XX-XXXX";
    }

    const { data: pending, error } = await sb
      .schema("thira").from("line_pending_bills").insert({
        line_user_id: userId,
        status: autoPlate ? "awaiting_confirm" : "awaiting_truck",
        kind: "outcome",
        truck_plate: autoPlate,
        date: parsed.date,
        category: parsed.category,
        liters: parsed.liters,
        amount: parsed.amount,
        note: parsed.note,
        raw_ocr: JSON.stringify(parsed),
        image_message_id: messageId,
      }).select().single();
    if (error) throw error;

    if (autoPlate) {
      await sendLinePush(userId, [
        { type: "text", text: `✓ อ่านบิลได้ (อ่านทะเบียน ${autoPlate} จากบิล)` },
        buildConfirmFlex({ ...pending, truck_plate: autoPlate })
      ]);
    } else {
      await sendLinePush(userId, [{
        type: "text",
        text: `📋 อ่านบิลได้:\n• วันที่: ${parsed.date || '—'}\n• ประเภท: ${parsed.category || '—'}\n• ยอด: ${fmtBaht(parsed.amount)}${parsed.liters ? `\n• ลิตร: ${parsed.liters}` : ''}\n\n👉 บิลนี้เป็นของรถคันไหน? (🌐 รวมฝูง = ค่าใช้จ่ายส่วนรวม XX-XXXX)`,
        quickReply: {
          items: [
            ...truckQuickReplyItems(),
            { type: "action", action: { type: "message", label: "❌ ยกเลิก", text: "/ยกเลิกบิล" } }
          ]
        }
      }]);
    }

  } catch (e) {
    console.error("handleImageMessage failed:", e);
    await sendLinePush(userId, [{ type: "text", text: `⚠️ อ่านบิลไม่สำเร็จ: ${(e as Error).message}` }]);
  }
}

// ═══════════════════════════════════════════════════════════
//  Step 2: user พิมพ์/แตะทะเบียนรถ → set plate + ส่ง Flex
// ═══════════════════════════════════════════════════════════

export async function tryHandleTruckSelection(
  userId: string,
  text: string,
  reply: (msgs: any[]) => Promise<void>
): Promise<boolean> {
  // หา pending ที่ user รอตอบ
  const { data: pending } = await sb
    .schema("thira").from("line_pending_bills")
    .select("*").eq("line_user_id", userId)
    .in("status", ["awaiting_truck", "awaiting_edit"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pending) return false;

  // ผู้ใช้สั่งยกเลิก?
  if (text === "/ยกเลิกบิล" || text.toLowerCase() === "cancel") {
    await sb.schema("thira").from("line_pending_bills").update({
      status: "cancelled", updated_at: new Date().toISOString()
    }).eq("id", pending.id);
    await reply([{ type: "text", text: "✗ ยกเลิกบิลแล้ว" }]);
    return true;
  }

  // ── awaiting_edit: parse ตัวเลขจาก text ──
  if (pending.status === "awaiting_edit") {
    const updates = parseEditMessage(text);
    if (Object.keys(updates).length === 0) {
      await reply([{ type: "text", text: `❓ พิมพ์ตัวเลขที่ต้องการแก้ — เช่น "3500" หรือ "3500 200ลิตร 17/5"` }]);
      return true;
    }
    const newRow = { ...pending, ...updates, status: "awaiting_confirm", updated_at: new Date().toISOString() };
    await sb.schema("thira").from("line_pending_bills").update({
      ...updates, status: "awaiting_confirm", updated_at: new Date().toISOString()
    }).eq("id", pending.id);
    await reply([
      { type: "text", text: `✓ อัพเดทแล้ว — ตรวจดูอีกครั้ง` },
      buildConfirmFlex(newRow)
    ]);
    return true;
  }

  // ── awaiting_truck: ต้องเลือกรถ ──
  const plate = TRUCK_PLATES.find(p => text.trim() === p);
  if (!plate) {
    await reply([{
      type: "text",
      text: `❓ ไม่รู้จักทะเบียน "${text}" — กรุณาแตะปุ่ม`,
      quickReply: {
        items: [
          ...truckQuickReplyItems(),
          { type: "action", action: { type: "message", label: "❌ ยกเลิก", text: "/ยกเลิกบิล" } }
        ]
      }
    }]);
    return true;
  }

  await sb.schema("thira").from("line_pending_bills").update({
    truck_plate: plate, status: "awaiting_confirm", updated_at: new Date().toISOString()
  }).eq("id", pending.id);
  await reply([buildConfirmFlex({ ...pending, truck_plate: plate })]);
  return true;
}

function askTruck(_kind?: string): any {
  return {
    type: "text",
    text: `👉 รถคันไหน?`,
    quickReply: {
      items: [
        ...truckQuickReplyItems(),
        { type: "action", action: { type: "message", label: "❌ ยกเลิก", text: "/ยกเลิกบิล" } }
      ]
    }
  };
}

function askBillType(_pending: any): any {
  return {
    type: "text",
    text: `👉 รายรับจากบิลไหน?`,
    quickReply: {
      items: [
        { type: "action", action: { type: "message", label: "🟡 THIRA OGM", text: "/บิล THIRA_OGM" } },
        { type: "action", action: { type: "message", label: "🟢 THIRA ALL", text: "/บิล THIRA_ALL" } },
        { type: "action", action: { type: "message", label: "🟣 TJ OGM", text: "/บิล TJ_OGM" } },
        { type: "action", action: { type: "message", label: "🌸 TJ ALL", text: "/บิล TJ_ALL" } },
        { type: "action", action: { type: "message", label: "❌ ยกเลิก", text: "/ยกเลิกบิล" } }
      ]
    }
  };
}

function parseBillTypeText(text: string): string | null {
  const t = text.replace(/\s+/g, "").toUpperCase();
  if (t.includes("THIRA_OGM") || t === "THIRAOGM") return "THIRA_OGM";
  if (t.includes("THIRA_ALL") || t === "THIRAALL") return "THIRA_ALL";
  if (t.includes("TJ_OGM") || t === "TJOGM") return "TJ_OGM";
  if (t.includes("TJ_ALL") || t === "TJALL") return "TJ_ALL";
  return null;
}

// แยกข้อมูลจากข้อความ user พิมพ์ตอน awaiting_edit
// รองรับ: date, liters, amount, category, plate, note
function parseEditMessage(text: string): {
  amount?: number; liters?: number; date?: string;
  category?: string; truck_plate?: string; note?: string;
} {
  const updates: any = {};
  let t = text.trim();

  // 1. ทะเบียนรถ (เช่น "72-2420")
  const plateMatch = t.match(/\b(7[12]-\d{4})\b/);
  if (plateMatch && TRUCK_PLATES.includes(plateMatch[1])) {
    updates.truck_plate = plateMatch[1];
    t = t.replace(plateMatch[0], " ");
  }

  // 2. note (prefix: "note", "n", "หมายเหตุ", "หมายเหตุ:")
  const noteMatch = t.match(/(?:note|n|หมายเหตุ)\s*[:=]?\s*(.+?)(?:$|\n)/i);
  if (noteMatch) {
    const noteText = noteMatch[1].trim();
    if (noteText.length > 0) {
      updates.note = noteText.slice(0, 200);
      t = t.replace(noteMatch[0], " ");
    }
  }

  // 3. category — สแกนหา keyword จาก CATEGORIES (เช่น "ค่ายาง")
  for (const cat of CATEGORIES) {
    if (t.includes(cat)) {
      updates.category = cat;
      t = t.replace(cat, " ");
      break;
    }
  }

  // 4. วันที่ pattern: 17/5/26, 17/5/2026, 2026-05-17
  const dateMatch = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (dateMatch) {
    const d = parseInt(dateMatch[1]);
    const m = parseInt(dateMatch[2]);
    let y = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
    if (y < 100) y += 2000;
    if (y > 2500) y -= 543;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      updates.date = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      t = t.replace(dateMatch[0], " ");
    }
  }

  // 5. ลิตร pattern
  const literMatch = t.match(/(\d+(?:\.\d+)?)\s*ลิตร|ลิตร\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*L\b/i);
  if (literMatch) {
    const v = parseFloat(literMatch[1] || literMatch[2] || literMatch[3]);
    if (v > 0) updates.liters = v;
    t = t.replace(literMatch[0], " ");
  }

  // 6. amount = ตัวเลขที่เหลือ (ใหญ่สุด)
  const nums = [...t.matchAll(/(\d+(?:[,.]?\d+)*(?:\.\d+)?)/g)]
    .map(m => parseFloat(m[1].replace(/,/g, "")))
    .filter(n => n > 0);
  if (nums.length > 0) {
    updates.amount = Math.max(...nums);
  }

  return updates;
}

// ═══════════════════════════════════════════════════════════
//  Step 3: user แตะ ✓/✗ → handle postback
// ═══════════════════════════════════════════════════════════

export async function handleBillPostback(
  event: any,
  reply: (msgs: any[]) => Promise<void>
): Promise<boolean> {
  const data = event.postback?.data || "";
  const params = new URLSearchParams(data);
  const action = params.get("action");
  const id = params.get("id");
  if (!action || !id) return false;
  if (!["bill_confirm", "bill_cancel", "bill_edit"].includes(action)) return false;

  const { data: pending, error } = await sb
    .schema("thira").from("line_pending_bills").select("*").eq("id", id).maybeSingle();
  if (error || !pending) {
    await reply([{ type: "text", text: "⚠️ ไม่พบบิลนี้" }]);
    return true;
  }
  if (!["awaiting_confirm", "awaiting_edit"].includes(pending.status)) {
    await reply([{ type: "text", text: `บิลนี้สถานะ ${pending.status} แล้ว` }]);
    return true;
  }

  if (action === "bill_edit") {
    await sb.schema("thira").from("line_pending_bills").update({
      status: "awaiting_edit", updated_at: new Date().toISOString()
    }).eq("id", id);
    await reply([{
      type: "text",
      text: `✏️ พิมพ์รายละเอียดที่จะแก้ ส่งมาเลย — รองรับหลายอย่างในประโยคเดียว:

• ตัวเลข → ยอดเงิน (เช่น "3500")
• "200ลิตร" → ลิตร
• "17/5/26" → วันที่
• แตะปุ่มหมวด ↓ หรือพิมพ์ "ค่ายาง"
• "72-2420" → รถ
• "note เปลี่ยนยาง 2 เส้น" → หมายเหตุ

ตัวอย่าง: "500 ค่ายาง note ปะยาง 1 เส้น"

(พิมพ์ /ยกเลิกบิล เพื่อยกเลิก)`,
      quickReply: {
        items: [
          { type: "action", action: { type: "message", label: "ค่าน้ำมัน", text: "ค่าน้ำมัน" } },
          { type: "action", action: { type: "message", label: "ค่ายาง", text: "ค่ายาง" } },
          { type: "action", action: { type: "message", label: "เช็คระยะ", text: "เช็คระยะ" } },
          { type: "action", action: { type: "message", label: "ค่าผ่านด่าน", text: "ค่าผ่านด่าน" } },
          { type: "action", action: { type: "message", label: "ค่าเคลียจ่าแชมป์", text: "ค่าเคลียจ่าแชมป์" } },
          { type: "action", action: { type: "message", label: "ค่าเคลียหมวดกร", text: "ค่าเคลียหมวดกร" } },
          { type: "action", action: { type: "message", label: "ประกัน", text: "ประกัน" } },
          { type: "action", action: { type: "message", label: "อื่นๆ", text: "อื่นๆ" } },
          { type: "action", action: { type: "message", label: "❌ ยกเลิกบิล", text: "/ยกเลิกบิล" } }
        ]
      }
    }]);
    return true;
  }

  if (action === "bill_cancel") {
    await sb.schema("thira").from("line_pending_bills").update({
      status: "cancelled", updated_at: new Date().toISOString()
    }).eq("id", id);
    await reply([{ type: "text", text: "✗ ยกเลิกบิลแล้ว" }]);
    return true;
  }

  // ── OUTCOME flow (เฉพาะ LINE OA — ทุก entry ผ่าน LINE = outcome) ──
  if (!pending.truck_plate || !pending.amount || !pending.category) {
    await reply([{ type: "text", text: "⚠️ ข้อมูลไม่ครบ — บันทึกไม่ได้" }]);
    return true;
  }
  let outNote: string;
  if (pending.category === "ค่าน้ำมัน" && pending.liters) {
    outNote = `เติมน้ำมัน ${pending.liters} ลิตร`;
  } else if (pending.note) {
    outNote = pending.note;
  } else {
    outNote = pending.category || "";
  }
  const { data: outcome, error: insErr } = await sb
    .schema("thira").from("outcomes").insert({
      truck_plate: pending.truck_plate,
      date: pending.date || new Date().toISOString().slice(0, 10),
      category: pending.category,
      liters: pending.liters,
      amount: pending.amount,
      note: outNote
    }).select().single();
  if (insErr) {
    await reply([{ type: "text", text: `⚠️ บันทึก outcome ไม่สำเร็จ: ${insErr.message}` }]);
    return true;
  }
  await sb.schema("thira").from("line_pending_bills").update({
    status: "confirmed", outcome_id: outcome.id, updated_at: new Date().toISOString()
  }).eq("id", id);

  await reply([{
    type: "text",
    text: `✅ บันทึกสำเร็จ (#${outcome.id})\n${pending.truck_plate} • ${pending.category} • ${fmtBaht(pending.amount)} บ.`
  }]);
  return true;
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

async function fetchLineImage(messageId: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!res.ok) throw new Error(`LINE image fetch ${res.status}`);
  return await res.arrayBuffer();
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

interface OcrResult {
  date: string | null;     // YYYY-MM-DD
  category: string | null;
  amount: number | null;
  liters: number | null;
  note: string | null;
  plate: string | null;
  is_slip: boolean;        // true = สลิปโอนเงิน (จะถาม รายรับ/จ่ายออก)
}

const BILL_TYPE_LABELS: Record<string, string> = {
  THIRA_OGM: "THIRA OGM",
  THIRA_ALL: "THIRA ALL",
  TJ_OGM: "TJ OGM",
  TJ_ALL: "TJ ALL",
};

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
    }
  }
  return dp[m][n];
}

async function callClaudeWithRetry(body: any, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (res.ok) return res;
    // 529 Overloaded or 503 → retry with backoff
    if ((res.status === 529 || res.status === 503) && attempt < maxRetries) {
      const wait = 1500 * (attempt + 1);
      console.warn(`Claude ${res.status} overloaded, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  throw new Error("retry exhausted");
}

async function ocrBillImage(base64: string): Promise<OcrResult> {
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();
  const currentYearBE = currentYear + 543;
  const yy2 = currentYearBE % 100;
  const prompt = `รูปนี้คือ "ใบเสร็จ/บิลค่าใช้จ่าย" ของรถบรรทุก
วันนี้คือ ${today} (พ.ศ. ${currentYearBE} หรือย่อ "${yy2}")

สกัดข้อมูลและตอบเป็น JSON เท่านั้น:

{
  "is_slip": true/false  (เป็นสลิปโอนเงินจากธนาคาร? — มี "โอนสำเร็จ" / "เลขที่อ้างอิง" / logo ธนาคาร),
  "date": "YYYY-MM-DD หรือ null",
  "category": "ค่าน้ำมัน | ค่ายาง | เช็คระยะ | ค่าเคลียหมวดกร | ค่าเคลียจ่าแชมป์ | ค่าผ่านด่าน | ประกัน | บัญชี | สุวิทย์ | บุญช่วย | ร้อยละ4 | อื่นๆ",
  "amount": ตัวเลขจำนวนเงินรวม (บาท) หรือ null,
  "liters": ตัวเลขลิตร (เฉพาะบิลน้ำมัน) หรือ null,
  "note": "รายละเอียดสั้นๆ <= 80 ตัวอักษร (สลิป: ใส่ 'โอน → [ชื่อปลายทาง]')",
  "plate": "ทะเบียนรถถ้าเห็น หรือ null"
}

⚠️ category ห้ามใส่ null — ต้องเลือก 1 ค่าเสมอ (ถ้าไม่แน่ใจใช้ "อื่นๆ")

🚛 รถที่ระบบรู้จัก (ถ้าเห็นในบิลให้ระบุ plate ให้ตรง):
  71-9538, 72-1620, 72-2237, 72-2420, 72-2953, 72-3148

📂 ตัดสินใจ category ตามลำดับ:

  ── STEP 1: ถ้า is_slip=true → ดูชื่อปลายทาง (ในช่อง "ไปยัง") ──
     • ปลายทางมี "เดอะ เบส" หรือ "The Best" หรือ "แอ๊คเค้าท์" หรือ "เบสแอคเค้าน์"
       → category = "บัญชี" (เด็ดขาด!)
     • ปลายทางมี "สุวิทย์" หรือ "Suwit"
       → category = "สุวิทย์"
     • ปลายทางมี "บุญช่วย" หรือ "Boonchuay"
       → category = "บุญช่วย"
     • ปลายทางมี "ร้อยละ4" / "ภาษี ณ ที่จ่าย" / "หัก ณ ที่จ่าย"
       → category = "ร้อยละ4"
     • ปลายทางอื่น
       → category = "อื่นๆ" (ใส่ชื่อปลายทางใน note)

  ── STEP 2: ถ้า is_slip=false (บิล/ใบเสร็จปกติ) ใช้ priority นี้ ──

  ⚡ Priority 1: "ยาง" (เด็ดขาด)
     "ยาง", "ยางนอก", "ยางใน", "ปะยาง", "เปลี่ยนยาง", "Tire"
     ชื่อร้าน "ทรัค ไทร์" / "Truck Tire" / "ยานยนต์"
     → category = "ค่ายาง"

  ⚡ Priority 2: น้ำมัน
     คำในบิล: "น้ำมัน", "ดีเซล", "แก๊สโซฮอล", "Diesel", "HSD", "ULGSH"
     ชื่อร้านน้ำมันท้องถิ่น/ปั๊มเล็ก:
       "เจ๊ตาล", "น้ำมันซิ่ง", "เจ๊ตาลน้ำมัน",
       "วนิดาพานิช", "วนิดา",
       "บางจาก", "ปตท", "PTT", "ESSO", "Shell", "เชลล์",
       "พีที", "PT", "บมจ.", "ปั๊ม"
     → category = "ค่าน้ำมัน" (เด็ดขาด — กรอก liters!)

     📐 รูปแบบ "ลิตร × ราคา/ลิตร" (เขียนมือ):
       บิลเล็กมักเขียน "NNN x NN.NN = TOTAL"
       เช่น "380 x 38.79" = 14,740 → liters=380, amount=14740
       เช่น "420 x 37.99" = 15,955 → liters=420, amount=15955
       → liters = ตัวเลขที่อยู่ก่อนเครื่องหมาย × (multiplied)
       → amount = ผลลัพธ์รวม (TOTAL/รวม)

  ⚡ Priority 3: ผ่านด่าน
     "ผ่านด่าน", "ทางด่วน", "Toll", "EXAT", "ETC"
     → category = "ค่าผ่านด่าน"

  ⚡ Priority 4: ประกัน
     "ประกัน", "พ.ร.บ.", "พรบ", "ภาษีรถยนต์"
     → category = "ประกัน"

  ⚡ Priority 5: เช็คระยะ/ซ่อม
     "เช็คระยะ", "ตรวจระยะ", "เปลี่ยนถ่าย", "ไส้กรอง", "filter", "oil"
     ชื่อร้าน "หาดใหญ่ สหมอเตอร์" / "ศูนย์อีซุซุ" / "ISUZU" / "ฮีโน่" / "HINO" / "ศูนย์บริการ"
     → category = "เช็คระยะ"

  ❌ ห้าม: ถ้าเห็น "ยาง" → อย่าใส่ "เช็คระยะ" หรือ "อื่นๆ"
  ❌ ห้าม: category ห้าม null — ต้องเลือก 1 ค่าเสมอ

🗓️ กฎเรื่องวันที่ — สำคัญที่สุด (อ่านช้าๆ ระวัง):

💡 หลักการสำคัญ: บิลที่ส่งมา **ส่วนมากเป็นวันนี้หรือเมื่อวาน** (${today} หรือใกล้เคียง)
   ถ้าได้วันที่ห่างจาก ${today} เกิน 7 วัน → สงสัยทันทีว่าอ่านผิด!
   อย่าเดือนผิด เช่น 25/5 ห้ามอ่านเป็น 25/9, 29/9 ฯลฯ

ขั้นที่ 1: หา "ช่อง DATE" ในบิลก่อน (ป้ายภาษาไทย/อังกฤษ: "วันที่", "DATE:", "Date:")
ขั้นที่ 2: อ่าน 3 ตัวเลขที่อยู่ในช่อง DATE → DD MM YY (วัน เดือน ปี)
   เช่น "20 05 69" หรือ "20/05/69" หรือ "20-5-69"
   → วัน = 20, เดือน = 5 (พ.ค.), ปี = 69 (พ.ศ. 2569)
ขั้นที่ 3: แปลงเป็น YYYY-MM-DD
   - ปี 2 หลัก "69" → พ.ศ. 2569 → ค.ศ. ${currentYear}
   - ปี 2 หลัก "${currentYear % 100}" → ค.ศ. ${currentYear} โดยตรง
   - ปี 4 หลัก > 2500 = พ.ศ. → ลบ 543
   - ปี 4 หลัก < 2500 = ค.ศ. ใช้ตามนั้น
ขั้นที่ 4: ✅ Validate — เทียบกับ ${today}:
   - ถ้าได้วันที่ → "ห่างกัน ≤ 7 วัน" = ปกติ ใช้ค่านี้
   - ถ้าได้วันที่ → "ห่างกัน > 7 วัน" = อาจอ่านผิด — ลองอ่านใหม่อย่างระมัดระวัง
   - ถ้าได้วันที่ → "เป็นอนาคต > 1 วัน" = ผิดแน่ — บิลไม่ลงอนาคต
   - ถ้าอ่านไม่ได้แน่ๆ → ใช้ null (ระบบจะ default เป็น ${today})

❌ ห้ามทำผิดเหล่านี้:
   - ห้ามดึงตัวเลขจาก BILL NO หรือ เลขประจำตัวประชาชน หรือยอดเงิน มาเป็นวันที่
   - ห้ามกลับ DD กับ MM (วันก่อนเดือน เสมอ ในรูปแบบไทย)
   - ห้ามอ่านเดือนผิด (5 vs 9, 6 vs 9) — ดูตำแหน่งช่องเดือนชัดเจน
   - ห้ามคำนวณ/เดาวันที่ — ใช้ตัวเลขที่เห็นในช่อง DATE ตรงๆ

⚠️ Sanity check: ผลลัพธ์ควรอยู่ใน ±7 วันจาก ${today} (บิลปกติเขียนเมื่อจ่าย)
   ถ้าออกนอกช่วงนี้ → อ่านผิดแน่นอน, ลองอ่านเลขใหม่อย่างระมัดระวัง

💰 amount = "ยอดเงินสุทธิที่จ่ายจริง":
  - บิลปกติ: ดู "รวม" / "ยอดรวม" / "TOTAL"
  - บิลกำกับภาษี/ใบกำกับภาษี: ดู "จำนวนเงินรวมทั้งสิ้น" (รวม VAT แล้ว) ไม่ใช่ "มูลค่าสินค้า"
  - ห้ามใช้ราคาต่อหน่วย (Unit Price) หรือ "หน่วยละ"
  - ห้ามคำนวณเอง — ใช้ตัวเลขที่พิมพ์อยู่ในบิล

🛢️ liters (เฉพาะบิลน้ำมัน):
  - ปั๊มน้ำมัน → ดูตัวเลขลิตร (มักอยู่ใต้ "ปริมาณ" หรือ "Liter")
  - บิลอื่นๆ (ยาง, ซ่อม) → liters = null

📝 note format (กระชับ ตรงประเด็น):
  - ค่าน้ำมัน → ไม่ต้องใส่ note (ระบบใส่ "เติมน้ำมัน X ลิตร" ให้)
  - ค่ายาง:
       🔴 จำนวนเส้น = นับจาก "จำนวน" คอลัมน์ของรายการยาง (เช่น "4 เส้น")
       🔴 หรือถ้ามีระบุ "ล้อที่XX" → นับเลขล้อทั้งหมด (เช่น "ล้อที่29 ล้อที่30 ล้อที่31 ล้อที่32" = 4 เส้น)
       ⚠️ อย่านับจำนวนรายการอื่นในบิล (เช่น "ข้าวสาร 1 ถง" — ไม่นับ!)
       Format: "เปลี่ยนยาง N เส้น (ล้อ ##, ##, ##, ##)" หรือ "ปะยาง N เส้น"
       ตัวอย่าง:
         - บิล: "AS ยางนอก 11R22.5  4 เส้น  ล้อที่29 ล้อที่30 ล้อที่31 ล้อที่32"
           → note = "เปลี่ยนยาง 4 เส้น (ล้อ 29, 30, 31, 32)"
         - บิล: "ปะยาง 11-2  1 เส้น"
           → note = "ปะยาง 1 เส้น"
  - เช็คระยะ → ใส่กิจกรรมหลัก เช่น "เปลี่ยนถ่ายน้ำมันเครื่อง"
  - อื่นๆ → ใส่รายละเอียดสั้น (<=80 ตัวอักษร)

🚛 plate (ทะเบียนรถ):
  - หาในบิลก่อน (มักอยู่บรรทัด "อ้างอิง" หรือ "ทะเบียน")
  - "72-2954" ก็เป็น truck (แม้ไม่อยู่ใน list หลัก — ใส่มาเลย)
  - ถ้าไม่เห็น → null

ตอบ JSON เท่านั้น ห้ามมีข้อความอื่น`;

  const res = await callClaudeWithRetry({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: prompt }
      ]
    }]
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const textOut = data.content?.[0]?.text || "{}";
  // strip code fences if Claude wraps in ```json
  const cleaned = textOut.replace(/```json\s*/, "").replace(/```\s*$/, "").trim();
  let parsed: OcrResult;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new Error(`OCR returned invalid JSON: ${cleaned.slice(0, 100)}`); }
  // sanity
  if (parsed.amount === undefined) parsed.amount = null;
  if (parsed.liters === undefined) parsed.liters = null;
  if (parsed.plate === undefined) parsed.plate = null;
  if (parsed.is_slip === undefined) parsed.is_slip = false;
  if (parsed.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) parsed.date = null;
  if (parsed.category && !CATEGORIES.includes(parsed.category)) parsed.category = "อื่นๆ";
  if (parsed.is_slip) parsed.category = null;  // สลิปไม่กำหนดหมวด — user เลือกเอง

  // Fuzzy plate match — เฉพาะรถจริง 6 คัน (ไม่รวม XX-XXXX)
  if (parsed.plate) {
    const realTrucks = TRUCK_PLATES.filter(p => p !== "XX-XXXX");
    if (realTrucks.includes(parsed.plate)) {
      // exact match — OK
    } else {
      const fuzzy = realTrucks.find(p => levenshtein(p, parsed.plate!) <= 1);
      if (fuzzy) {
        if (parsed.plate !== fuzzy) {
          parsed.note = (parsed.note || "") + ` (OCR: ${parsed.plate})`;
        }
        parsed.plate = fuzzy;
      } else {
        parsed.plate = null;
      }
    }
  }
  // Safety net: date sanity check — บิลส่วนมากเป็นวันนี้/เมื่อวาน
  // ถ้าห่างจากวันนี้เกิน 7 วัน หรือเป็นอนาคต > 1 วัน → ถือว่าอ่านผิด
  if (parsed.date) {
    const dt = new Date(parsed.date).getTime();
    const now = Date.now();
    const SEVEN_DAYS = 7 * 86400 * 1000;
    const ONE_DAY = 86400 * 1000;
    const diff = now - dt;                    // positive = past, negative = future
    const inPast7d = diff >= 0 && diff <= SEVEN_DAYS;
    const inFuture1d = diff < 0 && -diff <= ONE_DAY;
    if (!inPast7d && !inFuture1d) {
      // ออกนอกช่วง → default to today (ปลอดภัยกว่าเดาผิด)
      const today = new Date().toISOString().slice(0, 10);
      console.warn(`[OCR] date ${parsed.date} ออกนอกช่วง (±7 วัน) → default to ${today}`);
      parsed.date = today;
    }
  } else {
    // ไม่ได้วันที่เลย → default เป็นวันนี้ (ส่วนใหญ่บิลเป็นวันนี้)
    parsed.date = new Date().toISOString().slice(0, 10);
  }
  return parsed;
}

function buildConfirmFlex(pending: any): any {
  const rows: any[] = [
    { type: "box", layout: "baseline", contents: [
      { type: "text", text: "รถ", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: pending.truck_plate || "—", weight: "bold", flex: 5 }
    ]},
    { type: "box", layout: "baseline", contents: [
      { type: "text", text: "วันที่", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: pending.date || "—", flex: 5 }
    ]},
    { type: "box", layout: "baseline", contents: [
      { type: "text", text: "ประเภท", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: pending.category || "—", flex: 5 }
    ]},
  ];
  if (pending.liters != null) rows.push({
    type: "box", layout: "baseline", contents: [
      { type: "text", text: "ลิตร", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: String(pending.liters), flex: 5 }
    ]
  });
  rows.push({
    type: "box", layout: "baseline", contents: [
      { type: "text", text: "ยอด", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: fmtBaht(pending.amount) + " บ.", weight: "bold", color: "#c05621", size: "lg", flex: 5 }
    ]
  });
  if (pending.note) rows.push({
    type: "box", layout: "baseline", contents: [
      { type: "text", text: "หมายเหตุ", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: pending.note, wrap: true, size: "sm", flex: 5 }
    ]
  });

  return {
    type: "flex",
    altText: `ยืนยันบิล ${pending.truck_plate} ${fmtBaht(pending.amount)} บ.`,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: "#1e3a5f", paddingAll: "12px",
        contents: [{ type: "text", text: "💸 ยืนยันบันทึกบิล", color: "#ffffff", weight: "bold", size: "lg" }]
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "box", layout: "horizontal", spacing: "sm", contents: [
          { type: "button", style: "secondary", action: { type: "postback", label: "✗ ยกเลิก",
            data: `action=bill_cancel&id=${pending.id}` }},
          { type: "button", style: "primary", color: "#10b981", action: { type: "postback", label: "✓ ยืนยัน",
            data: `action=bill_confirm&id=${pending.id}` }}
        ]},
        // ปุ่ม "✏️ แก้ไข" → เปิด LIFF form ถ้ามี LIFF_ID set ไว้
        // ไม่งั้น fallback ไป postback (พิมพ์แก้ใน chat แบบเดิม)
        LIFF_ID_EDIT_BILL
          ? { type: "button", style: "secondary", height: "sm",
              action: { type: "uri", label: "✏️ แก้ไขในฟอร์ม",
                uri: `https://liff.line.me/${LIFF_ID_EDIT_BILL}?id=${pending.id}&t=${pending.edit_token}` } }
          : { type: "button", style: "secondary", height: "sm",
              action: { type: "postback", label: "✏️ แก้ไขตัวเลข",
                data: `action=bill_edit&id=${pending.id}` } }
      ]}
    }
  };
}

async function sendLinePush(userId: string, messages: any[]): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ to: userId, messages: messages.slice(0, 5) })
  });
  if (!res.ok) console.error(`LINE push ${res.status}:`, await res.text());
}

function fmtBaht(n: any): string {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
