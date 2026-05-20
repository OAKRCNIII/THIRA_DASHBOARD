// ═══════════════════════════════════════════════════════════════════════
//  line-edit-bill — Edge function รับ submission จาก LIFF form
//
//  Deploy แยกจาก line-webhook → endpoint คือ:
//    POST https://<project>.supabase.co/functions/v1/line-edit-bill
//
//  Body: { pending_id, token, date, truck_plate, category, liters, amount, note }
//
//  Flow:
//    1. Validate token + pending_id (กัน abuse)
//    2. Update line_pending_bills with new values + status='awaiting_confirm'
//    3. Push new Flex Message to user → ขอ confirm/cancel ใน chat
//    4. Return { ok: true } → LIFF ปิดหน้าต่าง
//
//  วิธี deploy:
//    cd C:\Users\Admin\Desktop\ANTS_DEV\_freight_calc
//    supabase functions deploy line-edit-bill --no-verify-jwt
//
//  Env vars (auto จาก Supabase):
//    LINE_CHANNEL_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// CORS — LIFF runs on liff.line.me, allow it + any origin (POST + simple)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const {
    pending_id, token,
    date, truck_plate, category, liters, amount, note
  } = body;

  // ── 1. Validate input ──
  if (!pending_id || !token) return json({ error: "missing pending_id or token" }, 400);
  if (!truck_plate) return json({ error: "missing truck_plate" }, 400);
  if (!category) return json({ error: "missing category" }, 400);
  if (typeof amount !== "number" || amount <= 0) return json({ error: "invalid amount" }, 400);

  // ── 2. Check token matches ──
  const { data: pending, error: fetchErr } = await sb
    .schema("thira").from("line_pending_bills")
    .select("*")
    .eq("id", pending_id)
    .eq("edit_token", token)
    .maybeSingle();
  if (fetchErr) return json({ error: "fetch error: " + fetchErr.message }, 500);
  if (!pending) return json({ error: "ไม่พบบิลนี้ หรือลิงก์หมดอายุ" }, 404);
  if (!["awaiting_edit", "awaiting_confirm", "awaiting_truck"].includes(pending.status)) {
    return json({ error: `บิลนี้สถานะ ${pending.status} แล้ว แก้ไม่ได้` }, 400);
  }

  // ── 3. Update with edited values, status → awaiting_confirm ──
  const updates = {
    date,
    truck_plate,
    category,
    liters: liters || null,
    amount,
    note: note || null,
    status: "awaiting_confirm",
    updated_at: new Date().toISOString(),
  };
  const { error: updErr } = await sb
    .schema("thira").from("line_pending_bills")
    .update(updates)
    .eq("id", pending_id);
  if (updErr) return json({ error: "update failed: " + updErr.message }, 500);

  // ── 4. Build & push new Flex Message ──
  const updatedPending = { ...pending, ...updates };
  const flex = buildEditedConfirmFlex(updatedPending);

  try {
    await pushLine(pending.line_user_id, [flex]);
  } catch (e) {
    console.error("LINE push failed:", e);
    // ไม่ rollback ก็ได้ เพราะ status ใน DB อัพเดตแล้ว
    // user ค่อย refresh chat ดูเอง
  }

  return json({ ok: true, id: pending_id });
});

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function fmtBaht(n: number | null): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEditedConfirmFlex(p: any): any {
  const rows: any[] = [
    {
      type: "box", layout: "baseline", contents: [
        { type: "text", text: "วันที่", color: "#888888", size: "sm", flex: 2 },
        { type: "text", text: p.date || "—", flex: 5 }
      ]
    },
    {
      type: "box", layout: "baseline", contents: [
        { type: "text", text: "รถ", color: "#888888", size: "sm", flex: 2 },
        { type: "text", text: p.truck_plate || "—", weight: "bold", flex: 5 }
      ]
    },
    {
      type: "box", layout: "baseline", contents: [
        { type: "text", text: "หมวด", color: "#888888", size: "sm", flex: 2 },
        { type: "text", text: p.category || "—", flex: 5 }
      ]
    },
  ];
  if (p.liters != null) {
    rows.push({
      type: "box", layout: "baseline", contents: [
        { type: "text", text: "ลิตร", color: "#888888", size: "sm", flex: 2 },
        { type: "text", text: String(p.liters), flex: 5 }
      ]
    });
  }
  rows.push({
    type: "box", layout: "baseline", contents: [
      { type: "text", text: "ยอด", color: "#888888", size: "sm", flex: 2 },
      { type: "text", text: fmtBaht(p.amount) + " บ.", weight: "bold", color: "#c05621", size: "lg", flex: 5 }
    ]
  });
  if (p.note) {
    rows.push({
      type: "box", layout: "baseline", contents: [
        { type: "text", text: "หมายเหตุ", color: "#888888", size: "sm", flex: 2 },
        { type: "text", text: p.note, wrap: true, size: "sm", flex: 5 }
      ]
    });
  }

  return {
    type: "flex",
    altText: `กรุณายืนยันบิล ${p.truck_plate} ${fmtBaht(p.amount)} บ.`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical",
        backgroundColor: "#06c755", paddingAll: "12px",
        contents: [
          { type: "text", text: "✏️ แก้ไขแล้ว — กรุณายืนยัน", color: "#ffffff", weight: "bold", size: "lg" },
          { type: "text", text: "ตรวจซ้ำก่อนบันทึก", color: "#ffffff", size: "xs", margin: "xs" }
        ]
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              { type: "button", style: "secondary", action: { type: "postback", label: "✗ ยกเลิก",
                data: `action=bill_cancel&id=${p.id}` } },
              { type: "button", style: "primary", color: "#10b981", action: { type: "postback", label: "✓ ยืนยันบันทึก",
                data: `action=bill_confirm&id=${p.id}` } }
            ]
          },
          { type: "button", style: "link", height: "sm",
            action: { type: "uri", label: "✏️ แก้อีกครั้ง",
              uri: `https://liff.line.me/${Deno.env.get("LIFF_ID_EDIT_BILL") || "DUMMY"}?id=${p.id}&t=${p.edit_token}` } }
        ]
      }
    }
  };
}

async function pushLine(userId: string, messages: any[]): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: userId, messages: messages.slice(0, 5) }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LINE push ${res.status}: ${txt}`);
  }
}
