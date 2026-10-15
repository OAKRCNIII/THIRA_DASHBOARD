# -*- coding: utf-8 -*-
"""
THIRA Dashboard — Auto Sync
============================
มิเรอร์ตู้ลง ants.containers บน FREIGHT_CALC (ตัวที่แดชบอร์ด THIRA อ่าน)

แหล่งข้อมูล 2 ทาง:
  ants   (ค่าเริ่มต้น) — อ่าน public.containers_all บนโปรเจกต์ ANTS
                        ได้ครบทุกท่า: ปาดัง + สงขลา + แหลมฉบัง พร้อมคอลัมน์ port
  excel  (ของเดิม)     — อ่าน ใบยกตู้V4TEST.xlsm sheet DATABASE (ได้เฉพาะปาดัง)

ทำไมต้องเปลี่ยน: ตู้สงขลาเข้า skh_containers ไม่ได้เข้าชีท DATABASE
→ ถ้าอ่านจาก Excel อย่างเดียว เที่ยวสงขลาจะหายทั้งเที่ยว ไม่ใช่แค่เรตผิด
(รถชุดเดียวกันวิ่งทั้งปาดังและสงขลา ปิดรอบน้ำมันจะไม่ตรง)

ENV (GitHub Actions):
  SUPABASE_URL, SUPABASE_KEY          — FREIGHT_CALC ปลายทาง
  ANTS_URL, ANTS_KEY                  — โปรเจกต์ ANTS ต้นทาง (โหมด ants)
  DROPBOX_APP_KEY/APP_SECRET/REFRESH_TOKEN — เฉพาะโหมด excel

รันในเครื่อง:
  python thira_sync.py                      # อ่านจาก ANTS
  python thira_sync.py --source excel --local <path>
  python thira_sync.py --dry-run            # ไม่เขียน แค่โชว์สรุป
  python thira_sync.py --from-json rows.json --dry-run   # เทสต์ตัวแปลงข้อมูล
"""

import os, sys, io, argparse
from datetime import datetime, date

# บังคับ stdout ให้เป็น UTF-8 (รองรับอีโมจิ + ภาษาไทย ทั้ง import และ direct run)
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def to_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return None


def to_num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_int(v):
    n = to_num(v)
    return int(n) if n is not None else None


def to_str(v):
    if v is None or v == "":
        return None
    return str(v).strip()


def load_workbook_from_dropbox(dbx_path: str):
    import dropbox, openpyxl
    DBX_APP_KEY = os.environ["DROPBOX_APP_KEY"]
    DBX_APP_SEC = os.environ["DROPBOX_APP_SECRET"]
    DBX_REFRESH = os.environ["DROPBOX_REFRESH_TOKEN"]
    dbx = dropbox.Dropbox(
        oauth2_refresh_token=DBX_REFRESH,
        app_key=DBX_APP_KEY,
        app_secret=DBX_APP_SEC,
    )
    log(f"📥 ดาวน์โหลด {dbx_path} จาก Dropbox...")
    _, res = dbx.files_download(dbx_path)
    buf = io.BytesIO(res.content)
    return openpyxl.load_workbook(buf, read_only=True, keep_vba=True, data_only=True)


def load_workbook_local(path: str):
    import openpyxl
    log(f"📁 อ่านไฟล์ local: {path}")
    return openpyxl.load_workbook(path, read_only=True, keep_vba=True, data_only=True)


def parse_database(wb):
    """Parse DATABASE sheet → list of dict ของ ants.containers"""
    if "DATABASE" not in wb.sheetnames:
        log("⚠️  ไม่พบ sheet 'DATABASE'")
        return []
    ws = wb["DATABASE"]
    rows = []
    for i, r in enumerate(ws.iter_rows(min_row=5, values_only=True), start=5):
        # ต้องการ 11 cols: ทะเบียนรถ, จำนวนมัด, โรงงาน(inv), เข้าโรงงาน ว/ท, โรงงาน, สายเรือ, เบอร์ตู้, น.น.ตู้, CADO NO., DATE PICK UP, STATUS
        plate, bundles, inv, date_in, factory, vessel, cont_no, weight, cado, pickup, status = r[:11]
        if all(v in (None, "", 0) for v in (plate, inv, date_in, cont_no)):
            continue
        rows.append({
            "truck_plate": to_str(plate),
            "bundles": to_int(bundles),
            "invoice_no": to_str(inv),
            "date_in": to_date(date_in),
            "factory": to_str(factory),
            "vessel": to_str(vessel),
            "container_no": to_str(cont_no),
            "weight": to_num(weight),
            "cado_no": to_str(cado),
            "date_pickup": to_date(pickup),
            "status": to_str(status),
            "source_row": i,
        })
    return rows


def fetch_from_ants():
    """อ่าน public.containers_all บนโปรเจกต์ ANTS → list of dict ของ ants.containers

    containers_all เป็น view ที่ union ปาดัง + แหลมฉบัง + สงขลา เข้าด้วยกัน
    และมีคอลัมน์ source บอกท่า → เอามาเก็บเป็น port ตรงๆ
    """
    from supabase import create_client
    url = os.environ["ANTS_URL"]
    key = os.environ["ANTS_KEY"]
    ants = create_client(url, key)

    # แผนที่คอลัมน์ containers_all → ants.containers (FREIGHT_CALC)
    #   factory_date   → date_in       (ชื่อคนละแบบ ความหมายเดียวกัน = วันเข้าโรงงาน)
    #   shipping_line  → vessel
    #   pickup_date    → date_pickup
    #   source         → port
    # ไม่มีใน containers_all: bundles, source_row → ปล่อยว่าง (แดชบอร์ด THIRA ไม่ได้ใช้ทั้งคู่)
    sel = ("source,truck_plate,invoice_no,factory,factory_date,shipping_line,"
           "container_no,weight,cado_no,pickup_date,status")
    rows, page, size = [], 0, 1000
    while True:
        res = (ants.table("containers_all").select(sel)
               .order("id").range(page * size, page * size + size - 1).execute())
        batch = res.data or []
        rows.extend(batch)
        log(f"  📥 ดึงจาก ANTS containers_all: {len(rows)} rows")
        if len(batch) < size:
            break
        page += 1

    out = []
    for r in rows:
        out.append({
            "truck_plate": to_str(r.get("truck_plate")),
            "bundles": None,
            "invoice_no": to_str(r.get("invoice_no")),
            "date_in": to_str(r.get("factory_date")),
            "factory": to_str(r.get("factory")),
            "vessel": to_str(r.get("shipping_line")),
            "container_no": to_str(r.get("container_no")),
            "weight": to_num(r.get("weight")),
            "cado_no": to_str(r.get("cado_no")),
            "date_pickup": to_str(r.get("pickup_date")),
            "status": to_str(r.get("status")),
            "source_row": None,
            "port": to_str(r.get("source")) or "PADANG",
        })
    return out


def summarise(rows):
    """สรุปให้ดูก่อนเขียนจริง — กันเคสข้อมูลหายแล้วไม่รู้ตัว"""
    from collections import Counter
    by_port = Counter(r.get("port") or "PADANG" for r in rows)
    THIRA = {"71-9538", "72-1620", "72-2237", "72-2420", "72-2953", "72-3148"}
    thira = Counter((r.get("port") or "PADANG")
                    for r in rows if r.get("truck_plate") in THIRA)
    dates = sorted(r["date_in"] for r in rows if r.get("date_in"))
    log(f"  รวม {len(rows)} rows · ตามท่า {dict(by_port)}")
    log(f"  เฉพาะฝูง THIRA 6 คัน {sum(thira.values())} เที่ยว · ตามท่า {dict(thira)}")
    if dates:
        log(f"  ช่วงวันเข้าโรงงาน {dates[0]} .. {dates[-1]}")
    no_plate = sum(1 for r in rows if not r.get("truck_plate"))
    no_date = sum(1 for r in rows if not r.get("date_in"))
    if no_plate or no_date:
        log(f"  ⚠️  ไม่มีทะเบียน {no_plate} rows · ไม่มีวันเข้าโรงงาน {no_date} rows")


def sync_to_supabase(rows, scope_ports=None):
    """
    Atomic sync ผ่าน RPC function ants.sync_containers(jsonb, text[])
    ─────────────────────────────────────────────────────────
    function นี้ทำ DELETE+INSERT ใน transaction เดียว + ถือ advisory lock
    → กัน race condition เมื่อ local watcher + GitHub cron รันทับกัน

    scope_ports = ท่าที่แหล่งนี้รับผิดชอบ (None = ทุกท่า)
    แหล่ง Excel เห็นแค่ปาดัง → ต้องส่ง ['PADANG'] ไม่งั้นจะลบตู้สงขลา/แหลมฉบังทิ้ง

    Fallback: ถ้า RPC ยังไม่ deploy (function ไม่มี) → ใช้แบบเดิม + warning
    """
    from supabase import create_client
    URL = os.environ["SUPABASE_URL"]
    KEY = os.environ["SUPABASE_KEY"]
    supa = create_client(URL, KEY)

    log(f"📊 มี {len(rows)} rows จะ sync ลง ants.containers"
        + (f" (แทนที่เฉพาะท่า {scope_ports})" if scope_ports else " (แทนที่ทุกท่า)"))

    # ใช้ RPC atomic function (default)
    try:
        log("  ⚙️  เรียก ants.sync_containers (atomic) ...")
        resp = supa.schema("ants").rpc(
            "sync_containers", {"rows_json": rows, "scope_ports": scope_ports}).execute()
        result = resp.data[0] if resp.data else {}
        deleted = result.get("deleted_count", "?")
        inserted = result.get("inserted_count", 0)
        log(f"     ลบ {deleted} rows → insert {inserted} rows  (atomic ✓)")
        return inserted
    except Exception as e:
        msg = str(e)
        # ถ้า function ไม่ exist — fallback ไปแบบเดิม (race-prone)
        if "function" in msg.lower() and ("not exist" in msg.lower() or "not found" in msg.lower() or "PGRST202" in msg):
            log(f"  ⚠️  RPC function ยังไม่ deploy — fallback แบบเดิม (เสี่ยง race)")
            log(f"     → รัน sync_atomic.sql ที่ Supabase Dashboard ก่อน")
        else:
            raise

    # ===== Fallback (เดิม) — ใช้เมื่อยังไม่ได้ deploy RPC =====
    log("  🗑️  ลบ rows เก่า...")
    q = supa.schema("ants").table("containers").delete().gt("id", 0)
    if scope_ports:
        q = q.in_("port", scope_ports)      # กันลบข้ามท่า
    del_res = q.execute()
    log(f"     ลบไป {len(del_res.data) if del_res.data else '?'} rows")

    inserted = 0
    chunk = 500
    for i in range(0, len(rows), chunk):
        batch = rows[i:i + chunk]
        resp = supa.schema("ants").table("containers").insert(batch).execute()
        inserted += len(resp.data) if resp.data else 0
        log(f"  ✓ insert {inserted}/{len(rows)}")
    return inserted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["ants", "excel"], default="ants",
                    help="ants = containers_all บน ANTS (ได้ทุกท่า) · excel = ชีท DATABASE (ปาดังอย่างเดียว)")
    ap.add_argument("--local", help="path to local .xlsm (โหมด excel, ข้าม Dropbox API)")
    ap.add_argument("--from-json", help="อ่าน rows จากไฟล์ JSON (ไว้เทสต์ตัวแปลงข้อมูล)")
    ap.add_argument("--dry-run", action="store_true", help="ไม่เขียนลง Supabase แค่สรุปให้ดู")
    args = ap.parse_args()

    scope = None                    # None = แทนที่ทุกท่า
    if args.from_json:
        import json
        log(f"📄 อ่าน rows จาก {args.from_json}")
        with io.open(args.from_json, encoding="utf-8") as f:
            rows = json.load(f)
    elif args.source == "ants":
        missing = [k for k in ("ANTS_URL", "ANTS_KEY") if not os.environ.get(k)]
        if missing:
            log(f"❌ โหมด ants ต้องมี env {', '.join(missing)}")
            log("   ตั้ง secret ใน GitHub (Settings → Secrets → Actions) หรือใช้ --source excel")
            return 1
        log("🌐 แหล่งข้อมูล: ANTS containers_all (ทุกท่า)")
        rows = fetch_from_ants()
    else:
        log("📗 แหล่งข้อมูล: Excel ชีท DATABASE (ปาดังอย่างเดียว)")
        wb = load_workbook_local(args.local) if args.local \
            else load_workbook_from_dropbox("/ใบยกตู้/ใบยกตู้V4TEST.xlsm")
        rows = parse_database(wb)
        for r in rows:
            r.setdefault("port", "PADANG")
        scope = ["PADANG"]          # เห็นแค่ปาดัง → ห้ามไปลบท่าอื่น

    if not rows:
        log("⚠️  ไม่มี rows — skip sync (ไม่ลบของเดิม)")
        return 0

    summarise(rows)

    if args.dry_run:
        log("🧪 dry-run — ไม่ได้เขียนลง Supabase")
        return 0

    n = sync_to_supabase(rows, scope_ports=scope)
    log(f"✅ sync เสร็จ: {n} containers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
