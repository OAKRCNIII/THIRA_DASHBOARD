// ปุ่ม ⚡ SYNC เดี๋ยวนี้ ในแดชบอร์ด THIRA
// ───────────────────────────────────────────────────────────
// แดชบอร์ดอ่าน ants.containers บน FREIGHT_CALC ซึ่ง sync มาจาก ANTS ทุก 30 นาที
// ถ้าเพิ่งแก้อะไรใน ANTS แล้วอยากเห็นใน THIRA เลย ต้องกดตัวนี้
//
// ถือ GitHub token ไว้ฝั่ง server — ใส่ในหน้าเว็บตรงๆ ไม่ได้เพราะจะหลุด
// secret ที่ต้องตั้ง: GH_SYNC_TOKEN (สิทธิ์ actions:write บน OAKRCNIII/THIRA_DASHBOARD)
//
// deploy: supabase functions deploy trigger-thira-sync --no-verify-jwt --project-ref eurnevjtzxansothqney

const REPO = "OAKRCNIII/THIRA_DASHBOARD";
const WORKFLOW = "sync.yml";
const COOLDOWN_SEC = 60;   // กันกดรัวจนเปลือง GitHub Actions minutes

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  const token = Deno.env.get("GH_SYNC_TOKEN");
  if (!token) return reply(500, { ok: false, error: "ยังไม่ได้ตั้ง secret GH_SYNC_TOKEN" });

  const gh = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.github.com/repos/${REPO}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "thira-sync-button",
        ...(init.headers || {}),
      },
    });

  try {
    // ── กันกดซ้ำ: ถ้ายังรันอยู่ หรือเพิ่งรันไปไม่ถึง COOLDOWN ให้บอกไปเลย ไม่ต้องสั่งใหม่
    const listRes = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
    if (listRes.ok) {
      const last = (await listRes.json())?.workflow_runs?.[0];
      if (last) {
        if (last.status !== "completed") {
          return reply(200, { ok: true, already: true, runId: last.id,
                              message: "กำลัง sync อยู่แล้ว รออีกสักครู่" });
        }
        const ageSec = (Date.now() - new Date(last.created_at).getTime()) / 1000;
        if (ageSec < COOLDOWN_SEC) {
          return reply(429, { ok: false, cooldown: Math.ceil(COOLDOWN_SEC - ageSec),
                              message: `เพิ่ง sync ไปเมื่อ ${Math.round(ageSec)} วินาทีก่อน รออีกสักครู่` });
        }
      }
    }

    const res = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status !== 204) {
      return reply(502, { ok: false, error: `GitHub ตอบ ${res.status}`, detail: await res.text() });
    }
    return reply(200, { ok: true, message: "สั่ง sync แล้ว ใช้เวลาประมาณ 20-30 วินาที" });
  } catch (e) {
    return reply(500, { ok: false, error: String(e) });
  }
});
