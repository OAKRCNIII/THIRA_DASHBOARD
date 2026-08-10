// ═══════════════════════════════════════════════════════════
//  FREIGHT_CALC — LINE OA Webhook → Claude Haiku 4.5 (with tools)
//
//  Tools:
//   - calculate_freight: ดึงราคาจาก DB + คำนวณ + สร้าง report URL
//   - list_factories:    แสดงโรงงานพร้อมราคาปัจจุบัน
//   - list_price_sets:   แสดงประวัติชุดราคา
// ═══════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handleImageMessage,
  tryHandleTruckSelection,
  tryHandleFuelRate,
  handleBillPostback,
} from "./bill_handler.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Note: whitelist ย้ายไปอยู่ใน DB table `bot_users` แล้ว — env ALLOWED_LINE_USERS ไม่ใช้แล้ว

// Sonnet 4.5 เป็นรุ่นเก่า (legacy) — รับได้เฉพาะพารามิเตอร์แบบเดิม
// ห้ามส่ง output_config.effort (รุ่นนี้ error) และ thinking แบบ adaptive (มีตั้งแต่ 4.6 ขึ้นไป)
// ถ้าเปลี่ยนกลับเป็นรุ่นใหม่ (claude-sonnet-5 / claude-opus-5) ให้เปิด 2 บรรทัดล่างคืนด้วย
const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_MODERN = /^(claude-(opus|sonnet|fable|mythos)-5|claude-opus-4-[678]|claude-sonnet-4-6)/.test(ANTHROPIC_MODEL);
const ANTHROPIC_EFFORT = "medium"; // ใช้เฉพาะรุ่นใหม่ — low = เร็ว/ถูก, high = ฉลาดขึ้นแต่ช้าลง
const FIXED_COST_STANDARD = 20600;
const FIXED_COST_RAIL = 20976; // +6% ค่ารถไฟ
// Report HTML served from GitHub Pages (Supabase edge functions force text/plain for no-jwt funcs)
const REPORT_BASE_URL = "https://oakrcniii.github.io/FREIGHT_CALCULATE/report.html";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── rate limit ───
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const userQueryLog = new Map<string, number[]>();
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const log = userQueryLog.get(userId) || [];
  const fresh = log.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    userQueryLog.set(userId, fresh);
    return false;
  }
  fresh.push(now);
  userQueryLog.set(userId, fresh);
  return true;
}

// ═══════════════════════════════════════════════════════════
//  USER MANAGEMENT (DB-backed whitelist)
// ═══════════════════════════════════════════════════════════
interface BotUser {
  line_user_id: string;
  name: string;
  role: "admin" | "user";
  added_by: string | null;
  added_at: string;
}

async function getBotUser(userId: string): Promise<BotUser | null> {
  const { data, error } = await sb
    .from("bot_users").select("*").eq("line_user_id", userId).maybeSingle();
  if (error) { console.error("getBotUser:", error); return null; }
  return data;
}

async function listBotUsers(): Promise<BotUser[]> {
  const { data, error } = await sb
    .from("bot_users").select("*").order("added_at", { ascending: true });
  if (error) { console.error("listBotUsers:", error); return []; }
  return data || [];
}

async function addBotUser(userId: string, name: string, addedBy: string): Promise<{ ok: boolean; msg?: string }> {
  const { error } = await sb.from("bot_users").insert({
    line_user_id: userId, name, role: "user", added_by: addedBy,
  });
  if (error) return { ok: false, msg: error.message };
  return { ok: true };
}

async function removeBotUser(userId: string): Promise<{ ok: boolean; name?: string }> {
  const { data, error } = await sb.from("bot_users").delete().eq("line_user_id", userId).select().maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, name: data.name };
}

// ═══════════════════════════════════════════════════════════
//  COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════
function thaiTimeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 7) return `${days} วันที่แล้ว`;
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
}

async function handleCommand(text: string, user: BotUser): Promise<string | null> {
  const t = text.trim();
  const lower = t.toLowerCase();
  const isAdmin = user.role === "admin";

  // /me — show own info
  if (lower === "/me" || lower === "/whoami") {
    return `👤 ข้อมูลของคุณ\n\nชื่อ: ${user.name}\nสถานะ: ${user.role === "admin" ? "⭐ Admin" : "👤 User"}\nuserId: ${user.line_user_id}`;
  }

  // /help
  if (lower === "/help" || lower === "/?") {
    const userCmds = "/me — ดูข้อมูลตัวเอง\n/help — คำสั่งทั้งหมด";
    const adminCmds = "\n\n⭐ Admin commands:\n/list — ดูรายชื่อผู้มีสิทธิ์\n/allow <userId> <ชื่อ> — เพิ่มคน\n/remove <ชื่อ> — ตัดสิทธิ์ (ใช้ userId ก็ได้)";
    return `📋 คำสั่งที่ใช้ได้\n\n${userCmds}${isAdmin ? adminCmds : ""}\n\nคำถามคำนวณ ใช้ภาษาธรรมชาติได้เลย เช่น "คำนวณ ทุ่งหลวง 32000"`;
  }

  // /list — admin only
  if (lower === "/list") {
    if (!isAdmin) return "🔒 คำสั่งนี้ใช้ได้เฉพาะ admin\n\nคุณใช้ /me /help ได้";
    const users = await listBotUsers();
    const admins = users.filter((u) => u.role === "admin");
    const regulars = users.filter((u) => u.role === "user");
    let msg = `👥 รายชื่อผู้มีสิทธิ์ใช้งาน (${users.length} คน)\n`;
    if (admins.length) {
      msg += `\n⭐ Admin (${admins.length})\n`;
      admins.forEach((u, i) => msg += `${i + 1}. ${u.name} — ${thaiTimeAgo(u.added_at)}\n`);
    }
    if (regulars.length) {
      msg += `\n👤 User (${regulars.length})\n`;
      regulars.forEach((u, i) => msg += `${i + 1}. ${u.name} — ${thaiTimeAgo(u.added_at)}\n`);
    }
    return msg.trim();
  }

  // /allow — admin only
  if (lower.startsWith("/allow ")) {
    if (!isAdmin) return "🔒 คำสั่งนี้ใช้ได้เฉพาะ admin\n\nคุณใช้ /me /list /help ได้";
    const m = t.slice(7).trim().match(/^(U[a-f0-9]{32})\s+(.+)$/i);
    if (!m) return "❌ รูปแบบไม่ถูก\n\nใช้: /allow <userId> <ชื่อ>\nตัวอย่าง: /allow Uabc123... นาย ก.\n\nuserId ขึ้นต้น U ตามด้วย 32 ตัวอักษร hex";
    const [, newId, newName] = m;
    // check existing
    const existing = await getBotUser(newId);
    if (existing) return `⚠️ user นี้มีอยู่แล้ว: ${existing.name} (${existing.role})\nถ้าจะลบใช้ /remove`;
    const r = await addBotUser(newId, newName.trim(), user.line_user_id);
    if (!r.ok) return `❌ เพิ่มไม่สำเร็จ: ${r.msg}`;
    return `✅ เพิ่ม "${newName.trim()}" เข้าระบบเรียบร้อย\n\nuserId: ${newId}\nเพิ่มโดย: ${user.name}\n\nคนนี้ใช้งานได้ทันที 🎉`;
  }

  // /remove — admin only (รองรับชื่อหรือ userId)
  if (lower.startsWith("/remove ")) {
    if (!isAdmin) return "🔒 คำสั่งนี้ใช้ได้เฉพาะ admin";
    const arg = t.slice(8).trim();
    if (!arg) return "❌ ใช้: /remove <ชื่อ>\nตัวอย่าง: /remove นาย ก.";

    let target: BotUser | null = null;
    const isUserIdFormat = /^U[a-f0-9]{32}$/i.test(arg);

    if (isUserIdFormat) {
      target = await getBotUser(arg);
    } else {
      // หาจากชื่อ — exact match ก่อน แล้ว partial
      const users = await listBotUsers();
      target = users.find((u) => u.name === arg) || null;
      if (!target) {
        const matches = users.filter((u) => u.name.toLowerCase().includes(arg.toLowerCase()));
        if (matches.length === 0) {
          return `❌ ไม่พบ user ชื่อ "${arg}"\n\nดูรายชื่อด้วย /list`;
        }
        if (matches.length > 1) {
          const list = matches.map((u) => `• ${u.name}${u.role === "admin" ? " ⭐" : ""}`).join("\n");
          return `⚠️ พบหลายคนที่ชื่อใกล้เคียง "${arg}":\n\n${list}\n\nระบุชื่อให้ตรงกว่านี้ (ใส่ชื่อเต็ม)`;
        }
        target = matches[0];
      }
    }

    if (!target) return `❌ ไม่พบ user "${arg}"`;
    if (target.line_user_id === user.line_user_id) return "⚠️ ตัดตัวเองออกไม่ได้";
    if (target.role === "admin") {
      return `⚠️ "${target.name}" เป็น admin — ตัดออกไม่ได้\n(ต้องเปลี่ยน role ใน Supabase Dashboard ก่อน)`;
    }

    const r = await removeBotUser(target.line_user_id);
    if (!r.ok) return `❌ ตัดสิทธิ์ไม่สำเร็จ`;
    return `🚫 ถอดสิทธิ์ "${r.name}" เรียบร้อย\n\nมีผลทันที — ครั้งต่อไปคนนี้จะถูก reject`;
  }

  return null; // not a command, fall through to Claude
}

// ═══════════════════════════════════════════════════════════
//  CRYPTO: verify LINE signature
// ═══════════════════════════════════════════════════════════
async function verifyLineSignature(body: string, sig: string | null): Promise<boolean> {
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(LINE_CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return sig === btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// ═══════════════════════════════════════════════════════════
//  DATA: cached price sets per request (fetch once)
// ═══════════════════════════════════════════════════════════
async function fetchPriceSets() {
  const { data, error } = await sb
    .from("freight_price_sets")
    .select("id, name, prices, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data || [];
}

// ═══════════════════════════════════════════════════════════
//  TOOLS — executed when Claude calls them
// ═══════════════════════════════════════════════════════════
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const THAI_MONTHS_FULL = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

// อ่านวันที่มีผลจากชื่อชุดราคา เช่น "วันเสาร์ที่ 4 กรกฎาคม 2569" → "2026-07-04"
// (ต้องใช้สูตรเดียวกับแดชบอร์ด ไม่งั้น 2 ระบบเลือกคนละชุดราคา)
function parseThaiDate(text: string): string | null {
  const m = String(text || "").match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (!m) return null;
  const monthIdx = THAI_MONTHS_FULL.indexOf(m[2].trim());
  if (monthIdx < 1) return null;
  const year = +m[3] > 2500 ? +m[3] - 543 : +m[3];
  return `${year}-${String(monthIdx).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
}

// ชุดราคาที่มีผล ณ วันนี้ = ชุดที่วันที่มีผลใหม่สุดแต่ยังไม่เกินวันนี้
// เดิมใช้ตัวท้ายสุดของ created_at ซึ่งไม่ใช่ลำดับวันที่มีผลจริง
function pickActivePriceSet(priceSets: any[]): any {
  const d = new Date();
  const today =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dated = priceSets
    .map((p) => ({ ps: p, eff: parseThaiDate(p.name) }))
    .filter((x) => x.eff)
    .sort((a, b) => (a.eff! < b.eff! ? -1 : 1));
  if (!dated.length) return priceSets[priceSets.length - 1];
  const active = [...dated].reverse().find((x) => x.eff! <= today);
  return (active || dated[dated.length - 1]).ps;
}

const normName = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, "");

function findFactoryPrice(priceSets: any[], factoryName: string, priceSetId?: string): {
  found: boolean;
  matched_name?: string;
  price?: number;
  price_set_name?: string;
  price_set_id?: string;
  available_factories?: string[];
  ambiguous?: string[];
} {
  if (!priceSets.length) return { found: false };
  const ps = priceSetId
    ? priceSets.find((p) => p.id === priceSetId) || pickActivePriceSet(priceSets)
    : pickActivePriceSet(priceSets);
  const factoryKeys = Object.keys(ps.prices || {});
  const q = normName(factoryName);

  const pack = (matched: string) => ({
    found: true,
    matched_name: matched,
    price: ps.prices[matched] || 0,
    price_set_name: ps.name,
    price_set_id: ps.id,
  });

  // 1. ตรงเป๊ะ (ตัดช่องว่างแล้วเทียบ — ชื่อโรงงานพิมพ์เว้นวรรคไม่เหมือนกันบ่อย)
  const exact = factoryKeys.filter((k) => normName(k) === q);
  if (exact.length === 1) return pack(exact[0]);

  // 2. ชื่อโรงงานมีคำที่ user พิมพ์อยู่ข้างใน
  const contains = factoryKeys.filter((k) => normName(k).includes(q));
  if (contains.length === 1) return pack(contains[0]);

  // 3. user พิมพ์หลายคำ เช่น "กัมพล สะบ้าย้อย" → ต้องเจอครบทุกคำในชื่อเดียว
  const words = String(factoryName).trim().split(/\s+/).filter((w) => w.length > 1);
  if (words.length > 1) {
    const allWords = factoryKeys.filter((k) => words.every((w) => normName(k).includes(normName(w))));
    if (allWords.length === 1) return pack(allWords[0]);
    if (allWords.length > 1) return { found: false, ambiguous: allWords };
  }

  // เข้าได้หลายตัว → ให้ Claude ถามกลับ ห้ามเดา (เดาแล้วได้ราคาผิดเงียบๆ)
  if (contains.length > 1) return { found: false, ambiguous: contains };
  if (exact.length > 1) return { found: false, ambiguous: exact };

  const available = factoryKeys.filter((k) => (ps.prices[k] || 0) > 0).slice(0, 40);
  return { found: false, available_factories: available };
}

function calculateFreight(input: {
  factory_name: string;
  selling_price_thb?: number;
  freight_usd?: number;
  usd_rm?: number;
  rm_thb?: number;
  destination?: string;
  container?: string;
  price_set_id?: string;
  use_rail?: boolean;
}, priceSets: any[]) {
  const usdRm = input.usd_rm ?? 4.5;
  const rmThb = input.rm_thb ?? 8.3;
  const freightUsd = input.freight_usd ?? 0;
  const sell = input.selling_price_thb ?? 0;
  const hasSellingPrice = sell > 0;
  const dest = input.destination || "NANSHA";
  const useRail = input.use_rail === true;
  const FIXED_COST_THB = useRail ? FIXED_COST_RAIL : FIXED_COST_STANDARD;

  const lookup = findFactoryPrice(priceSets, input.factory_name, input.price_set_id);
  if (!lookup.found) {
    if (lookup.ambiguous) {
      return {
        error: `"${input.factory_name}" ตรงกับหลายโรงงาน ต้องถาม user ว่าหมายถึงตัวไหน ห้ามเดา`,
        ambiguous: lookup.ambiguous,
      };
    }
    return {
      error: `ไม่พบโรงงาน "${input.factory_name}" ในระบบ`,
      available_factories: lookup.available_factories,
    };
  }
  if (lookup.price === 0) {
    return {
      error: `โรงงาน "${lookup.matched_name}" ยังไม่มีราคาในชุดล่าสุด (${lookup.price_set_name})`,
    };
  }

  const transport = lookup.price!;
  const freightRm = freightUsd * usdRm;
  const freightThb = freightRm * rmThb;
  const totalCost = freightThb + FIXED_COST_THB + transport;
  const profit = hasSellingPrice ? sell - totalCost : null;

  // build report URL
  const params = new URLSearchParams({
    factory: lookup.matched_name!,
    destination: dest,
    sell: String(Math.round(sell)),
    freight_usd: String(freightUsd),
    usd_rm: String(usdRm),
    rm_thb: String(rmThb),
    transport: String(Math.round(transport)),
    price_set: lookup.price_set_name!,
    fixed: String(FIXED_COST_THB),
  });
  if (input.container) params.set("container", input.container);
  const reportUrl = `${REPORT_BASE_URL}?${params.toString()}`;

  return {
    factory: lookup.matched_name,
    price_set_used: lookup.price_set_name,
    destination: dest,
    has_selling_price: hasSellingPrice,
    selling_price: hasSellingPrice ? sell : null,
    freight_usd: freightUsd,
    freight_rm: Math.round(freightRm),
    freight_thb: Math.round(freightThb),
    fixed_cost: FIXED_COST_THB,
    fixed_cost_type: useRail ? "รถไฟ (+6%)" : "มาตรฐาน",
    transport_cost: transport,
    total_cost: Math.round(totalCost),
    profit_or_loss: profit !== null ? Math.round(profit) : null,
    profit_status: profit === null ? null : (profit > 0 ? "กำไร" : profit < 0 ? "ขาดทุน" : "เท่าทุน"),
    report_url: reportUrl,
  };
}

function listFactories(priceSets: any[]) {
  if (!priceSets.length) return { error: "ยังไม่มีชุดราคาในระบบ" };
  const latest = pickActivePriceSet(priceSets);
  const factories = Object.entries(latest.prices as Record<string, number>)
    .map(([name, price]) => ({ name, price }));
  return {
    price_set_name: latest.name,
    total_factories: factories.length,
    with_price: factories.filter((f) => f.price > 0),
    without_price: factories.filter((f) => f.price === 0).map((f) => f.name),
  };
}

function listPriceSets(priceSets: any[]) {
  return {
    total_sets: priceSets.length,
    sets: priceSets.map((ps, i) => {
      const prices = ps.prices as Record<string, number>;
      const nonZero = Object.values(prices).filter((p) => p > 0).length;
      return {
        index: i + 1,
        id: ps.id,
        name: ps.name,
        factories_with_price: nonZero,
        total_factories: Object.keys(prices).length,
        is_latest: i === priceSets.length - 1,
      };
    }),
  };
}

const TOOLS = [
  {
    name: "calculate_freight",
    description:
      "คำนวณต้นทุนการขนส่งโรงงาน (ถ้ามี selling_price_thb จะคำนวณกำไร/ขาดทุนด้วย) " +
      "ใช้ราคาค่าขนส่งจากชุดราคาล่าสุด (หรือชุดที่ระบุ) พร้อมสร้างลิงก์รายงาน HTML\n" +
      "- ใช้ตอน user ขอคำนวณ เช่น 'คำนวณ ทุ่งหลวง 32000 ระวาง 200' → ใส่ selling_price_thb\n" +
      "- ใช้ตอน user ถามแค่ต้นทุน เช่น 'ต้นทุนทุ่งหลวง', 'ราคาขนส่งทุ่งหลวง' → ไม่ต้องใส่ selling_price_thb",
    input_schema: {
      type: "object",
      properties: {
        factory_name: { type: "string", description: "ชื่อโรงงาน เช่น 'ทุ่งหลวง', 'บ้านส้อง' (ภาษาไทย)" },
        selling_price_thb: { type: "number", description: "ราคาขาย (THB) — OPTIONAL: ไม่ต้องใส่ถ้า user ถามแค่ต้นทุน ใส่เฉพาะเมื่อ user ระบุราคาขายชัดเจน" },
        freight_usd: { type: "number", description: "ค่าระวางเรือ USD — default 0 (ถ้า user ไม่ระบุ)" },
        usd_rm: { type: "number", description: "อัตรา USD/RM default 4.5" },
        rm_thb: { type: "number", description: "อัตรา RM/THB default 8.3" },
        destination: { type: "string", description: "ปลายทาง default NANSHA" },
        container: { type: "string", description: "ตู้ที่ optional" },
        price_set_id: { type: "string", description: "ใช้ราคาจากชุดเก่า (ID) ถ้าไม่ระบุใช้ชุดล่าสุด" },
        use_rail: { type: "boolean", description: "ใช้ค่าดำเนินการรถไฟ (20,976 = +6%) แทนค่ามาตรฐาน (20,600) — ตั้ง true เฉพาะเมื่อ user พูดคำว่า 'รถไฟ' หรือ 'ตู้รถไฟ'" },
      },
      required: ["factory_name"],
    },
  },
  {
    name: "list_factories",
    description: "แสดงรายชื่อโรงงานที่มีในระบบพร้อมราคาค่าขนส่งปัจจุบัน ใช้ตอน user ถาม 'มีโรงงานอะไรบ้าง', 'ลิสต์โรงงาน', 'ราคาทั้งหมด'",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_price_sets",
    description: "แสดงประวัติชุดราคาทั้งหมด ใช้ตอน user ถาม 'ประวัติราคา', 'ชุดราคา', 'มีกี่ชุด'",
    input_schema: { type: "object", properties: {} },
  },
];

// ═══════════════════════════════════════════════════════════
//  CLAUDE AGENTIC LOOP
// ═══════════════════════════════════════════════════════════
function buildSystemPrompt(): string {
  return `คุณคือผู้ช่วยคำนวณราคาขนส่งและค่าระวางเรือ สำหรับบริษัท RCN Logistics ที่ใช้งานผ่าน LINE OA
ตอบเป็นภาษาไทย กระชับ เป็นกันเอง ใช้ emoji ประปราย ใส่ตัวเลขมี comma (เช่น 12,560)

═══════════════════════════════════════════════════════
ข้อมูลคงที่
═══════════════════════════════════════════════════════
- ค่าดำเนินการ: ${FIXED_COST_STANDARD.toLocaleString()} ฿ (มาตรฐาน) หรือ ${FIXED_COST_RAIL.toLocaleString()} ฿ (รถไฟ +6%)
  → ถ้า user พูดคำว่า "รถไฟ" หรือ "ตู้รถไฟ" → set use_rail=true
  → default (ไม่ระบุ) → ใช้มาตรฐาน 20,600
- อัตราแลกเปลี่ยน default: USD/RM = 4.5, RM/THB = 8.3
- ปลายทางหลัก: NANSHA (จีน) — มีปลายทางอื่น: JIUJIANG, CAT LAI, NINGBO, QINGDAO

═══════════════════════════════════════════════════════
หน้าที่ของคุณ
═══════════════════════════════════════════════════════
1. ถ้า user ขอคำนวณกำไร/ขาดทุน (มีราคาขาย) → เรียก calculate_freight พร้อม selling_price_thb
   - แสดงตัวเลขทุกขั้นตอน (ค่าระวาง THB, ต้นทุน, กำไร/ขาดทุน)
   - ถ้าขาดทุน → เตือนด้วย ⚠️

2. ถ้า user ถามแค่ต้นทุน/ค่าขนส่ง (ไม่มีราคาขาย) → เรียก calculate_freight แบบ**ไม่ใส่** selling_price_thb
   - tool จะคืนค่าต้นทุนรวม โดย profit_or_loss = null
   - **ห้ามพูดถึงกำไร/ขาดทุน** ในคำตอบ — แค่บอกต้นทุน
   - ตัวอย่างคำตอบ: "ต้นทุนทุ่งหลวงรวม 31,600 ฿ (ค่าขนส่ง 11,000 + ค่าดำเนินการ 20,600)"

3. ใส่ลิงก์รายงาน HTML (report_url) ต่อท้ายทุกครั้งที่เรียก calculate_freight สำเร็จ
   - รูปแบบ: "📄 รายงาน: <url>"

4. ถ้าหาโรงงานไม่เจอ → list โรงงานที่มีในระบบให้ user

4b. ถ้า tool คืน ambiguous มา = ชื่อที่ user พิมพ์ตรงกับหลายโรงงาน
   - **ห้ามเดาเองเด็ดขาด** และห้ามเลือกตัวแรกให้ เพราะราคาแต่ละสาขาไม่เท่ากัน
   - ให้ถามกลับว่าหมายถึงตัวไหน พร้อมลิสต์ชื่อเต็มที่ tool ส่งมาให้เลือก
   - เช่น user พิมพ์ "กัมพล" → ถาม "หมายถึงกัมพล พาราวู้ด(นาทวี) หรือ กัมพล พาราวู้ด(สะบ้าย้อย) ครับ"
   - พอ user ตอบแล้วค่อยเรียก calculate_freight ใหม่ด้วยชื่อเต็ม

5. ถ้า user ถามรายชื่อโรงงาน → เรียก list_factories
6. ถ้า user ถามประวัติชุดราคา → เรียก list_price_sets
7. ถ้าคำถามทั่วไป (สวัสดี, ใช้ยังไง) → ตอบสั้นๆ + ยกตัวอย่างคำสั่ง
8. ถ้าคำถามไม่เกี่ยวข้อง → บอกว่าผมเป็นบอทคำนวณค่าระวาง

═══════════════════════════════════════════════════════
ตัวอย่างคำถาม → tool call
═══════════════════════════════════════════════════════
- "คำนวณ ทุ่งหลวง 32000" → calculate_freight(factory_name="ทุ่งหลวง", selling_price_thb=32000)
- "คำนวณทุ่งหลวง ขาย 32000 ค่าระวาง 200" → calculate_freight(factory_name="ทุ่งหลวง", selling_price_thb=32000, freight_usd=200)
- "ต้นทุนทุ่งหลวงเท่าไหร่" → calculate_freight(factory_name="ทุ่งหลวง")  ← ไม่ใส่ราคาขาย
- "ราคาขนส่งทุ่งหลวง" → calculate_freight(factory_name="ทุ่งหลวง")  ← ไม่ใส่ราคาขาย
- "ทุ่งหลวง ระวาง 200 ต้นทุนเท่าไหร่" → calculate_freight(factory_name="ทุ่งหลวง", freight_usd=200) ← ไม่ใส่ราคาขาย
- "ลิสต์โรงงาน" → list_factories
- "ประวัติราคา" → list_price_sets

⚠️ สำคัญ: ห้ามตั้ง selling_price_thb=0 ถ้า user ไม่ระบุราคาขาย — ใช้ "ไม่ใส่ parameter" แทน
   เพราะ tool จะคืน null สำหรับ profit ทำให้ระบบรู้ว่าไม่ต้องแสดงกำไรขาดทุน`;
}

interface ClaudeResult {
  text: string;
  calcResult?: any; // raw calculate_freight result for Flex Message
}

async function askClaude(userMessage: string, priceSets: any[]): Promise<ClaudeResult> {
  const systemPrompt = buildSystemPrompt();
  const messages: any[] = [{ role: "user", content: userMessage }];
  const MAX_TURNS = 5;
  let lastCalcResult: any | undefined;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        // max_tokens คุมทั้งส่วนที่คิดและส่วนที่ตอบรวมกัน — เผื่อไว้ไม่งั้นคำตอบขาดกลางคัน
        max_tokens: 4096,
        // 2 ตัวนี้ใส่ได้เฉพาะรุ่นใหม่ — รุ่นเก่าอย่าง Sonnet 4.5 จะตอบ 400 ถ้าส่งไป
        ...(ANTHROPIC_MODERN
          ? { thinking: { type: "adaptive" }, output_config: { effort: ANTHROPIC_EFFORT } }
          : {}),
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Anthropic ${res.status}:`, err);
      return { text: `⚠️ ระบบขัดข้อง (${res.status})\nลองใหม่อีกครั้งครับ` };
    }

    const data = await res.json();

    if (data.stop_reason === "end_turn" || !data.content?.some((b: any) => b.type === "tool_use")) {
      const textBlock = data.content?.find((b: any) => b.type === "text");
      return { text: textBlock?.text || "ขออภัย ไม่สามารถสร้างคำตอบได้", calcResult: lastCalcResult };
    }

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });
      const toolResults: any[] = [];
      for (const block of data.content) {
        if (block.type !== "tool_use") continue;
        let result: any;
        try {
          if (block.name === "calculate_freight") {
            result = calculateFreight(block.input, priceSets);
            if (!result.error) lastCalcResult = result;
          } else if (block.name === "list_factories") {
            result = listFactories(priceSets);
          } else if (block.name === "list_price_sets") {
            result = listPriceSets(priceSets);
          } else {
            result = { error: `Unknown tool: ${block.name}` };
          }
        } catch (e) {
          result = { error: (e as Error).message };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const txt = data.content?.find((b: any) => b.type === "text")?.text;
    return { text: txt || "ขออภัย ระบบไม่สามารถประมวลผลได้", calcResult: lastCalcResult };
  }

  return { text: "⚠️ ระบบประมวลผลเกินรอบที่กำหนด ลองถามใหม่อีกครั้งครับ" };
}

// ═══════════════════════════════════════════════════════════
//  LINE: build Flex Message for calculation result
// ═══════════════════════════════════════════════════════════
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function buildCalcFlexMessage(result: any): any | null {
  if (!result || result.error) return null;
  const hasSell = result.has_selling_price === true;
  const profit = result.profit_or_loss;
  const profitColor = !hasSell ? "#6b7280" : profit > 0 ? "#059669" : profit < 0 ? "#dc2626" : "#6b7280";
  const profitLabel = result.profit_status || "ผลต่าง";
  const profitText = hasSell ? `${profit >= 0 ? '+' : ''}${fmtNum(profit)} ฿` : "—";

  // cost rows
  const costRows = [
    {
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: "ค่าระวางเรือ", size: "sm", color: "#6b7280", flex: 4 },
        { type: "text", text: `${fmtNum(result.freight_thb)} ฿`, size: "sm", align: "end", flex: 3 },
      ],
    },
    {
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: result.fixed_cost === 20976 ? "ค่าดำเนินการ (รถไฟ)" : "ค่าดำเนินการ", size: "sm", color: "#6b7280", flex: 4 },
        { type: "text", text: `${fmtNum(result.fixed_cost)} ฿`, size: "sm", align: "end", flex: 3 },
      ],
      margin: "sm",
    },
    {
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: "ค่าขนส่งโรงงาน", size: "sm", color: "#6b7280", flex: 4 },
        { type: "text", text: `${fmtNum(result.transport_cost)} ฿`, size: "sm", align: "end", flex: 3 },
      ],
      margin: "sm",
    },
  ];

  const bodyContents: any[] = [
    // freight info if any
    ...(result.freight_usd > 0 ? [{
      type: "text",
      text: `ระวาง ${fmtNum(result.freight_usd)} USD (${result.usd_rm || 4.5} × ${result.rm_thb || 8.3})`,
      size: "xs",
      color: "#9ca3af",
      margin: "none",
    }] : []),
    { type: "separator", margin: "md" },
    ...costRows,
    { type: "separator", margin: "md" },
    // total cost
    {
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: "รวมต้นทุน", size: "md", weight: "bold", flex: 4 },
        { type: "text", text: `${fmtNum(result.total_cost)} ฿`, size: "md", weight: "bold", align: "end", color: "#2563eb", flex: 3 },
      ],
      margin: "md",
    },
  ];

  // selling price + profit (if has sell)
  if (hasSell) {
    bodyContents.push(
      { type: "separator", margin: "md" },
      {
        type: "box", layout: "horizontal", contents: [
          { type: "text", text: "ราคาขาย", size: "sm", color: "#6b7280", flex: 4 },
          { type: "text", text: `${fmtNum(result.selling_price)} ฿`, size: "sm", align: "end", flex: 3 },
        ],
        margin: "md",
      },
      {
        type: "box", layout: "horizontal",
        backgroundColor: profit > 0 ? "#d1fae5" : profit < 0 ? "#fee2e2" : "#f3f4f6",
        cornerRadius: "md",
        paddingAll: "12px",
        contents: [
          { type: "text", text: profitLabel, size: "md", weight: "bold", flex: 4, color: "#111827" },
          { type: "text", text: profitText, size: "lg", weight: "bold", align: "end", color: profitColor, flex: 5 },
        ],
        margin: "md",
      },
    );
  } else {
    bodyContents.push(
      { type: "separator", margin: "md" },
      {
        type: "text",
        text: "ⓘ ยังไม่ได้กรอกราคาขาย — แสดงเฉพาะต้นทุน",
        size: "xs",
        color: "#854d0e",
        margin: "md",
        wrap: true,
      },
    );
  }

  return {
    type: "flex",
    altText: `${result.factory}: ต้นทุน ${fmtNum(result.total_cost)} ฿${hasSell ? ` · ${profitLabel} ${profitText}` : ''}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: result.factory, weight: "bold", color: "#ffffff", size: "xl", wrap: true },
          { type: "text", text: `ปลายทาง ${result.destination}`, color: "#bfdbfe", size: "xs", margin: "xs" },
          { type: "text", text: `ชุดราคา: ${result.price_set_used}`, color: "#bfdbfe", size: "xxs", margin: "xs", wrap: true },
        ],
        backgroundColor: "#2563eb",
        paddingAll: "16px",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: bodyContents,
        paddingAll: "16px",
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            action: { type: "uri", label: "📄 ดูรายงาน / บันทึก PDF", uri: result.report_url },
            style: "primary",
            color: "#2563eb",
            height: "md",
          },
        ],
        paddingAll: "16px",
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════
//  LINE: reply (text or flex)
// ═══════════════════════════════════════════════════════════
async function replyToLineMessages(replyToken: string, messages: any[]): Promise<void> {
  // LINE allows max 5 messages per reply
  const safeMessages = messages.slice(0, 5);
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: safeMessages }),
  });
  if (!res.ok) console.error(`LINE reply ${res.status}:`, await res.text());
}

async function replyToLine(replyToken: string, text: string): Promise<void> {
  const truncated = text.length > 4900 ? text.slice(0, 4900) + "..." : text;
  return replyToLineMessages(replyToken, [{ type: "text", text: truncated }]);
}

// ═══════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  if (req.method === "GET") return new Response("FREIGHT_CALC LINE webhook OK", { status: 200 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();
  const sig = req.headers.get("x-line-signature");
  if (!await verifyLineSignature(rawBody, sig)) {
    console.warn("Invalid LINE signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const events = payload.events || [];
  let priceSets: any[] = [];
  try { priceSets = await fetchPriceSets(); }
  catch (e) { console.error("Fetch price sets failed:", e); }

  for (const event of events) {
    // accept text, image messages, and postback events
    const isText = event.type === "message" && event.message?.type === "text";
    const isImage = event.type === "message" && event.message?.type === "image";
    const isPostback = event.type === "postback";
    if (!isText && !isImage && !isPostback) continue;

    const userId = event.source?.userId;
    const text: string = isText ? (event.message.text || "") : "";
    const replyToken = event.replyToken;

    // 🔒 WHITELIST default deny — query DB
    const botUser = userId ? await getBotUser(userId) : null;
    if (!userId || !botUser) {
      console.log("[UNAUTHORIZED]", { userId, text: text.slice(0, 50) });
      await replyToLine(replyToken,
        `🔒 ระบบจำกัดสิทธิ์ใช้งานเฉพาะคนในบริษัท\n\nหากต้องการใช้งาน ฟอร์เวิร์ดข้อความนี้ให้แอดมิน (OAK / INK):\n\n/allow ${userId || "(unknown)"} <ชื่อของคุณ>`);
      continue;
    }

    // 🚦 RATE LIMIT
    if (!checkRateLimit(userId)) {
      console.warn("[RATE LIMIT]", userId);
      await replyToLine(replyToken,
        `🐌 ใช้งานบ่อยเกินไป (max ${RATE_LIMIT_MAX} ครั้ง/10 นาที)\nกรุณารอสักครู่แล้วลองใหม่`);
      continue;
    }

    console.log("[AUTHORIZED]", { user: botUser.name, role: botUser.role, text: text.slice(0, 80) });

    // 📸 IMAGE → bill OCR flow
    if (isImage) {
      try {
        await handleImageMessage(event, (msgs) => replyToLineMessages(replyToken, msgs));
      } catch (e) {
        console.error("handleImageMessage failed:", e);
        await replyToLine(replyToken, `⚠️ ประมวลผลรูปบิลล้มเหลว: ${(e as Error).message}`);
      }
      continue;
    }

    // 🔘 POSTBACK → bill confirm/cancel/edit
    if (isPostback) {
      try {
        const handled = await handleBillPostback(event, (msgs) => replyToLineMessages(replyToken, msgs));
        if (handled) continue;
      } catch (e) {
        console.error("handleBillPostback failed:", e);
        await replyToLine(replyToken, `⚠️ ประมวลผล postback ล้มเหลว: ${(e as Error).message}`);
        continue;
      }
      // ถ้าไม่ใช่ bill postback → ตกลงไป (อาจมี postback ของฟีเจอร์อื่นในอนาคต)
      continue;
    }

    // 🎫 TEXT during awaiting_fuel_rate → parse rate → compute amount → confirm Flex
    if (isText) {
      try {
        const handled = await tryHandleFuelRate(userId, text, (msgs) => replyToLineMessages(replyToken, msgs));
        if (handled) continue;
      } catch (e) {
        console.error("tryHandleFuelRate failed:", e);
      }
    }

    // 🚛 TEXT during awaiting_truck/awaiting_edit → set plate / parse edit → send Flex
    if (isText) {
      try {
        const handled = await tryHandleTruckSelection(userId, text, (msgs) => replyToLineMessages(replyToken, msgs));
        if (handled) continue;
      } catch (e) {
        console.error("tryHandleTruckSelection failed:", e);
        // ไม่ break — ปล่อยให้ตกไปที่ logic ปกติ
      }
    }

    // 💬 COMMAND? handle before Claude (text only)
    if (isText && text.trim().startsWith("/")) {
      try {
        const cmdResult = await handleCommand(text, botUser);
        if (cmdResult !== null) {
          await replyToLine(replyToken, cmdResult);
          continue;
        }
      } catch (e) {
        console.error("Command failed:", e);
        await replyToLine(replyToken, `⚠️ ประมวลผลคำสั่งล้มเหลว: ${(e as Error).message}`);
        continue;
      }
    }

    // จาก patch ก่อนหน้านี้ — isImage + isPostback handled above ด้วย continue
    // ถ้าไม่ใช่ text → skip askClaude (safety guard)
    if (!isText) continue;

    try {
      const { text: replyText, calcResult } = await askClaude(text, priceSets);
      const messages: any[] = [];

      // ถ้ามี calc result → ส่ง text สั้นๆ + Flex card
      if (calcResult) {
        // strip URL จาก text (เพราะอยู่ใน Flex button แล้ว)
        const cleanText = replyText
          .replace(/https?:\/\/[^\s]+/g, "")
          .replace(/📄[^\n]*$/m, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (cleanText) messages.push({ type: "text", text: cleanText.slice(0, 4900) });
        const flex = buildCalcFlexMessage(calcResult);
        if (flex) messages.push(flex);
      } else {
        messages.push({ type: "text", text: (replyText.length > 4900 ? replyText.slice(0, 4900) + "..." : replyText) });
      }

      await replyToLineMessages(replyToken, messages);
    } catch (e) {
      console.error("askClaude failed:", e);
      await replyToLine(replyToken, "⚠️ เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่");
    }
  }

  return new Response("OK", { status: 200 });
});
