"""
สร้างรีพอร์ตรายคัน × รอบครึ่งเดือน เป็น HTML (สไตล์เดียวกับ Excel)
Usage:
  python generate_report.py 72-2420 4.2
  → output: report_72-2420_4.2.html (เปิดด้วย browser ได้เลย)
"""
import sys, io, os, argparse
from datetime import date
from calendar import monthrange
from collections import defaultdict
from html import escape

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from supabase import create_client

URL = os.environ.get('SUPABASE_URL', 'https://eurnevjtzxansothqney.supabase.co')
KEY = os.environ.get('SUPABASE_SERVICE_KEY') or ''
if not KEY:
    raise SystemExit('ERROR: set env SUPABASE_SERVICE_KEY (ค่าจาก Supabase Dashboard → Settings → API → service_role secret)')

THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
               'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
THAI_MONTHS_FULL = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']


def parse_period(period: str, year: int = 2026):
    """'4.2' → (year=2026, month=4, half=2, start='2026-04-16', end='2026-04-30')"""
    m, h = period.split('.')
    m, h = int(m), int(h)
    if h == 1:
        start = date(year, m, 1)
        end = date(year, m, 15)
    else:
        end = date(year, m, monthrange(year, m)[1])
        start = date(year, m, 16)
    return year, m, h, start.isoformat(), end.isoformat()


def fmt_baht(n, default='-'):
    if n is None or (isinstance(n, (int, float)) and n == 0):
        return default
    return f'{float(n):,.2f}'


def fmt_liter(n, default='-'):
    if n is None or (isinstance(n, (int, float)) and n == 0):
        return default
    return f'{float(n):,.0f}'


def fmt_thai_date(iso):
    """'2026-04-17' → '17/4/2026'"""
    if not iso: return ''
    y, m, d = iso.split('-')
    return f'{int(d)}/{int(m)}/{y}'


def lookup_price(price_by_code, factory, invoice_no):
    """ตามสูตร Excel: factory ก่อน, ถ้าเปล่า ใช้ LEFT(invoice,3)"""
    key = factory if factory else (invoice_no or '')[:3]
    return price_by_code.get(key), key


def fetch_data(plate, start, end):
    supa = create_client(URL, KEY)
    truck = supa.schema('thira').table('trucks').select('*').eq('plate', plate).execute().data
    if not truck:
        raise SystemExit(f'รถ {plate} ไม่พบใน thira.trucks')
    truck = truck[0]
    prices = supa.schema('thira').table('prices').select('*').execute().data
    price_by_code = {p['destination_code']: p for p in prices}
    trips = supa.schema('ants').table('containers').select('*').eq('truck_plate', plate)\
              .gte('date_in', start).lte('date_in', end).order('date_in').execute().data
    outs = supa.schema('thira').table('outcomes').select('*').eq('truck_plate', plate)\
              .gte('date', start).lte('date', end).order('date').execute().data
    incs = supa.schema('thira').table('incomes').select('*').eq('truck_plate', plate)\
              .gte('date', start).lte('date', end).execute().data
    return truck, price_by_code, trips, outs, incs


def build_html(plate, period, year=2026):
    yyyy, mm, hh, start, end = parse_period(period, year)
    truck, price_by_code, trips, outs, incs = fetch_data(plate, start, end)

    half_label = 'ครึ่งแรก (1-15)' if hh == 1 else f'ครึ่งหลัง (16-{monthrange(yyyy, mm)[1]})'
    period_title = f'{THAI_MONTHS_FULL[mm]} {yyyy + 543} — {half_label}'

    # Bucket outcomes
    DRIVER_PAY = {'ค่าเที่ยวคนขับ': 'fee', 'ค่าล่วง': 'overtime', 'เงินเดือน': 'salary'}
    refills = [o for o in outs if o['category'] == 'ค่าน้ำมัน']
    paid_to_driver = [o for o in outs if o['category'] in DRIVER_PAY]
    other_costs = [o for o in outs if o['category'] not in DRIVER_PAY and o['category'] != 'ค่าน้ำมัน']

    # Calculations
    fuel_route_col = 'fuel_liters_route_1' if truck['fuel_route'] == 1 else 'fuel_liters_route_2'

    trip_target_total = 0
    trip_fee_total = 0
    trip_rows = []
    for t in trips:
        pr, key = lookup_price(price_by_code, t.get('factory'), t.get('invoice_no'))
        target_l = float(pr.get(fuel_route_col) or 0) if pr else 0
        fee = float(pr['fee_driver']) if pr else 0
        trip_target_total += target_l
        trip_fee_total += fee
        label = t.get('factory') or f'[{key}] {t.get("invoice_no") or ""}'
        trip_rows.append({
            'date': t['date_in'],
            'label': label[:30],
            'invoice': t.get('invoice_no') or '',
            'container': t.get('container_no') or '',
            'target_l': target_l,
            'fee': fee,
            'price_found': pr is not None,
        })

    refill_total_l = sum(float(r.get('liters') or 0) for r in refills)
    refill_total_b = sum(float(r['amount']) for r in refills)

    driver_fee_paid = sum(float(o['amount']) for o in paid_to_driver if o['category'] == 'ค่าเที่ยวคนขับ')
    driver_overtime = sum(float(o['amount']) for o in paid_to_driver if o['category'] == 'ค่าล่วง')
    driver_salary_logged = sum(float(o['amount']) for o in paid_to_driver if o['category'] == 'เงินเดือน')
    other_total = sum(float(o['amount']) for o in other_costs)

    # Base monthly salary (paid in .2 only)
    base_salary = float(truck.get('monthly_salary') or 0)
    salary_due = base_salary if hh == 2 else 0  # auto-include in .2 period
    # If category=เงินเดือน already logged, use that; else use base
    driver_salary = driver_salary_logged if driver_salary_logged > 0 else salary_due
    income_net = sum(float(i['amount_net']) for i in incs)
    income_gross = sum(float(i['amount_gross']) for i in incs)

    total_truck_cost = refill_total_b + other_total + driver_fee_paid + driver_overtime + driver_salary
    period_profit = income_net - total_truck_cost

    # Fuel ledger (placeholder — needs thira.fuel_periods)
    fuel_opening = None       # TBD: from fuel_periods table
    fuel_bonus = None         # TBD: from fuel_periods table
    fuel_closing = None       # = opening + refilled - target_used - bonus

    # === Build HTML ===
    rows_html = []

    # Pink: trips
    if trip_rows:
        for tr in trip_rows:
            warn = '' if tr['price_found'] else ' ⚠️'
            rows_html.append(f'''
            <tr class="row-trip">
              <td class="cat">ค่าพิเศษ</td>
              <td>{fmt_thai_date(tr['date'])}</td>
              <td>{escape(tr['label'])}{warn}<br><small class="muted">{escape(tr['invoice'])} • {escape(tr['container'])}</small></td>
              <td class="num">{fmt_liter(tr['target_l'])}</td>
              <td class="num">—</td>
              <td class="num">{fmt_baht(tr['fee'])}</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
            </tr>''')
    else:
        rows_html.append('<tr class="row-trip"><td class="cat">ค่าพิเศษ</td><td colspan="8" class="empty">— ไม่มีเที่ยวรอบนี้ —</td></tr>')

    # Orange: fuel
    if refills:
        for r in refills:
            note = r.get('note') or 'เติมน้ำมัน'
            rows_html.append(f'''
            <tr class="row-fuel">
              <td class="cat">ค่าน้ำมัน</td>
              <td>{fmt_thai_date(r['date'])}</td>
              <td>{escape(note)}</td>
              <td class="num">{fmt_liter(r.get('liters'))}</td>
              <td class="num">{fmt_baht(r['amount'])}</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
            </tr>''')
    else:
        rows_html.append('<tr class="row-fuel"><td class="cat">ค่าน้ำมัน</td><td colspan="8" class="empty">— ไม่มีการเติมน้ำมันรอบนี้ —</td></tr>')

    # Gray: other expenses
    if other_costs:
        for o in other_costs:
            note = o.get('note') or o['category']
            rows_html.append(f'''
            <tr class="row-other">
              <td class="cat">ค่าใช้จ่ายอื่นๆ</td>
              <td>{fmt_thai_date(o['date'])}</td>
              <td><strong>{escape(o['category'])}</strong>{(" — " + escape(note)) if note != o['category'] else ""}</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">{fmt_baht(o['amount'])}</td>
            </tr>''')
    else:
        rows_html.append('<tr class="row-other"><td class="cat">ค่าใช้จ่ายอื่นๆ</td><td colspan="8" class="empty">— ไม่มีค่าใช้จ่ายอื่นรอบนี้ —</td></tr>')

    # White: driver-paid (overtime/salary breakdown if exists)
    if paid_to_driver:
        for d in paid_to_driver:
            note = d.get('note') or d['category']
            col_idx = {'ค่าเที่ยวคนขับ': 5, 'ค่าล่วง': 6, 'เงินเดือน': 7}.get(d['category'], 8)
            cells = ['—']*5  # target_l, fuel_baht, fee, overtime, salary
            cells = ['—', '—', '—', '—', '—', '—']  # target, fuel, fee, ot, salary, other
            cells[col_idx-3] = fmt_baht(d['amount'])
            rows_html.append(f'''
            <tr class="row-paid">
              <td class="cat">จ่ายคนขับ</td>
              <td>{fmt_thai_date(d['date'])}</td>
              <td>{escape(d['category'])} — {escape(note) if note != d['category'] else "บันทึกการจ่ายจริง"}</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num">{fmt_baht(d['amount']) if d['category']=='ค่าเที่ยวคนขับ' else "—"}</td>
              <td class="num">{fmt_baht(d['amount']) if d['category']=='ค่าล่วง' else "—"}</td>
              <td class="num">{fmt_baht(d['amount']) if d['category']=='เงินเดือน' else "—"}</td>
              <td class="num">—</td>
            </tr>''')

    body_rows = '\n'.join(rows_html)

    # Payslip totals
    payslip_total = trip_fee_total + driver_overtime + driver_salary

    # Match check — actual bulk payment vs calculated payslip
    # ค่าเที่ยวคนขับ (logged) มักรวมหลายอย่าง — เปรียบกับ payslip total
    fee_match_html = ''
    if driver_fee_paid > 0:
        diff = payslip_total - driver_fee_paid
        if abs(diff) < 0.01:
            fee_match_html = f'<div class="ok">✅ ยอดคำนวณ ({fmt_baht(payslip_total)}) = จ่ายจริงในบันทึก ({fmt_baht(driver_fee_paid)})</div>'
        else:
            fee_match_html = f'<div class="warn">⚠️ ยอดคำนวณ ({fmt_baht(payslip_total)}) ≠ จ่ายจริงในบันทึก ({fmt_baht(driver_fee_paid)}) — ต่าง {diff:+,.2f} บ.</div>'

    # Fuel diff
    fuel_variance = refill_total_l - trip_target_total

    html = f'''<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>รีพอร์ต {plate} รอบ {period}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Sarabun', sans-serif; margin: 0; padding: 24px; background: #f5f5f5; color: #222; }}
  .wrap {{ max-width: 1280px; margin: 0 auto; }}
  h1, h2, h3 {{ margin: 0; }}
  .header {{
    background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%);
    color: white; padding: 20px 28px; border-radius: 12px 12px 0 0;
    display: flex; justify-content: space-between; align-items: center;
  }}
  .header-l h1 {{ font-size: 28px; font-weight: 700; }}
  .header-l .driver {{ opacity: 0.85; font-size: 16px; margin-top: 4px; }}
  .header-r {{ text-align: right; }}
  .header-r .period {{ font-size: 22px; font-weight: 600; }}
  .header-r .period-sub {{ opacity: 0.85; font-size: 14px; }}

  .panels {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }}
  .panel {{ background: white; border-radius: 8px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }}
  .panel h3 {{ font-size: 16px; color: #555; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee; }}

  /* Fuel ledger */
  .ledger {{ font-size: 14px; }}
  .ledger .line {{ display: flex; justify-content: space-between; padding: 4px 0; }}
  .ledger .line.subtotal {{ border-top: 1px solid #ccc; margin-top: 6px; padding-top: 8px; font-weight: 600; }}
  .ledger .line.warn {{ color: #c05621; }}
  .ledger .line.ok {{ color: #2f855a; }}
  .ledger .label {{ color: #555; }}
  .ledger .value {{ font-variant-numeric: tabular-nums; }}
  .placeholder {{ color: #999; font-style: italic; }}
  .badge {{ display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }}
  .badge-pending {{ background: #fef3c7; color: #92400e; }}
  .badge-confirmed {{ background: #d1fae5; color: #065f46; }}

  /* KPI cards */
  .kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }}
  .kpi {{ background: white; padding: 14px; border-radius: 8px; border-left: 4px solid #2c5282; }}
  .kpi .label {{ font-size: 12px; color: #666; }}
  .kpi .value {{ font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 4px; }}
  .kpi.profit-pos {{ border-color: #2f855a; }} .kpi.profit-pos .value {{ color: #2f855a; }}
  .kpi.profit-neg {{ border-color: #c53030; }} .kpi.profit-neg .value {{ color: #c53030; }}

  /* Main table */
  table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-top: 12px; }}
  thead th {{ background: #1e3a5f; color: white; padding: 10px 12px; font-size: 13px; text-align: left; }}
  thead th.num {{ text-align: right; }}
  tbody td {{ padding: 10px 12px; border-top: 1px solid #eee; font-size: 14px; vertical-align: top; }}
  tbody td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  tbody td.cat {{ font-weight: 600; font-size: 12px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 8px 6px; }}
  tbody td.empty {{ color: #999; font-style: italic; text-align: center; }}
  small.muted {{ color: #888; font-size: 11px; }}

  /* Row colors (สีตาม Excel เดิม) */
  .row-trip td {{ background: #fce4ec; }}           /* ชมพู */
  .row-trip td.cat {{ background: #f8bbd0; }}
  .row-fuel td {{ background: #ffe0b2; }}           /* ส้ม */
  .row-fuel td.cat {{ background: #ffcc80; }}
  .row-other td {{ background: #f0f0f0; }}          /* เทา */
  .row-other td.cat {{ background: #e0e0e0; }}
  .row-paid td {{ background: #ffffff; }}           /* ขาว */
  .row-paid td.cat {{ background: #f5f5f5; }}

  /* Payslip box */
  .payslip {{ background: white; padding: 20px 28px; margin: 20px 0; border-radius: 12px; border: 2px solid #1e3a5f; }}
  .payslip h2 {{ font-size: 18px; color: #1e3a5f; margin-bottom: 12px; }}
  .payslip-grid {{ display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; font-size: 15px; }}
  .payslip-grid .lbl {{ color: #555; }}
  .payslip-grid .val {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .payslip-grid .total {{ border-top: 2px solid #1e3a5f; margin-top: 8px; padding-top: 8px; font-size: 22px; font-weight: 700; color: #1e3a5f; }}

  .warn {{ color: #c05621; font-weight: 600; margin-top: 8px; }}
  .ok {{ color: #2f855a; font-weight: 600; margin-top: 8px; }}
  .footer {{ text-align: center; color: #888; font-size: 12px; margin-top: 24px; }}
  @media print {{ body {{ background: white; padding: 0; }} .header {{ border-radius: 0; }} }}
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <div class="header-l">
      <h1>🚛 {plate}</h1>
      <div class="driver">{escape(truck['driver_name'])}  •  ใช้ลิตรชุดที่ {truck['fuel_route']}</div>
    </div>
    <div class="header-r">
      <div class="period">{THAI_MONTHS[mm]} {yyyy + 543}  รอบ {period}</div>
      <div class="period-sub">{half_label}</div>
    </div>
  </div>

  <div class="panels">
    <div class="panel">
      <h3>⛽ สมุดน้ำมัน (Fuel Ledger)</h3>
      <div class="ledger">
        <div class="line"><span class="label">ยกมาจากรอบก่อน</span><span class="value placeholder">[ตั้งต้น manual] ล.</span></div>
        <div class="line"><span class="label">+ เติมจริงรอบนี้ ({len(refills)} ครั้ง)</span><span class="value">{fmt_liter(refill_total_l)} ล.  •  {fmt_baht(refill_total_b)} บ.</span></div>
        <div class="line"><span class="label">− ใช้ตามเป้า ({len(trips)} เที่ยว)</span><span class="value">−{fmt_liter(trip_target_total)} ล.</span></div>
        <div class="line"><span class="label">− น้ำมันพิเศษให้คนขับ</span><span class="value placeholder">[ใส่ค่า]</span></div>
        <div class="line subtotal"><span class="label">คงเหลือ ยกไปรอบหน้า</span><span class="value placeholder">[คำนวณหลังกรอกข้างบน]</span></div>
        <div class="line {("warn" if fuel_variance > 0 else "ok")}"><span class="label">เติม vs เป้า (ส่วนต่าง)</span><span class="value">{"+"+fmt_liter(fuel_variance) if fuel_variance>0 else fmt_liter(fuel_variance)} ล.</span></div>
        <div style="margin-top:10px"><span class="badge badge-pending">⏳ ยังไม่ยินยัน</span></div>
      </div>
    </div>

    <div class="panel">
      <h3>📊 KPI รอบนี้</h3>
      <div class="kpis">
        <div class="kpi"><div class="label">เที่ยวที่วิ่ง</div><div class="value">{len(trips)}</div></div>
        <div class="kpi"><div class="label">รายรับ (net)</div><div class="value">{fmt_baht(income_net) if income_net else "—"}</div></div>
        <div class="kpi"><div class="label">รายจ่ายรวม</div><div class="value">{fmt_baht(total_truck_cost)}</div></div>
        <div class="kpi {"profit-pos" if period_profit>=0 else "profit-neg"}"><div class="label">กำไรรอบนี้</div><div class="value">{("+" if period_profit>=0 else "")}{fmt_baht(period_profit)}</div></div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th></th>
        <th>วันที่</th>
        <th>รายการ</th>
        <th class="num">น้ำมัน<br>(ลิตร)</th>
        <th class="num">น้ำมัน<br>(บาท)</th>
        <th class="num">ค่าเที่ยว<br>(บาท)</th>
        <th class="num">ค่าล่วง<br>(บาท)</th>
        <th class="num">เงินเดือน<br>(บาท)</th>
        <th class="num">อื่นๆ<br>(บาท)</th>
      </tr>
    </thead>
    <tbody>
      {body_rows}
    </tbody>
    <tfoot>
      <tr style="background:#1e3a5f;color:white;font-weight:700;">
        <td colspan="3" style="padding:12px;">รวม {escape(truck['driver_name'])}</td>
        <td class="num" style="padding:12px;">{fmt_liter(trip_target_total)} / {fmt_liter(refill_total_l)}</td>
        <td class="num" style="padding:12px;">{fmt_baht(refill_total_b)}</td>
        <td class="num" style="padding:12px;">{fmt_baht(trip_fee_total)}</td>
        <td class="num" style="padding:12px;">{fmt_baht(driver_overtime) if driver_overtime else "—"}</td>
        <td class="num" style="padding:12px;">{fmt_baht(driver_salary) if driver_salary else "—"}</td>
        <td class="num" style="padding:12px;">{fmt_baht(other_total) if other_total else "—"}</td>
      </tr>
    </tfoot>
  </table>

  <div class="payslip">
    <h2>💰 รวมต้องจ่ายให้ {escape(truck['driver_name'])} รอบนี้</h2>
    <div class="payslip-grid">
      <div class="lbl">ค่าเที่ยว (จาก {len(trips)} เที่ยว × PRICE)</div><div class="val">{fmt_baht(trip_fee_total)}</div>
      <div class="lbl">ค่าล่วง</div><div class="val">{fmt_baht(driver_overtime) if driver_overtime else "—"}</div>
      <div class="lbl">เงินเดือน{(f" base ({fmt_baht(base_salary)} ต่อเดือน — จ่ายครึ่งหลัง)" if hh==2 and base_salary else " (ครึ่งแรก — รอจ่ายครึ่งหลัง)")}</div><div class="val">{fmt_baht(driver_salary) if driver_salary else "—"}</div>
      <div class="lbl">อื่นๆ ที่จ่ายคนขับ</div><div class="val">—</div>
      <div class="lbl total">💼 รวมรอบนี้</div><div class="val total">{fmt_baht(payslip_total)} บ.</div>
    </div>
    {fee_match_html}
  </div>

  <div class="footer">
    Generated from Supabase live data  •  {date.today().isoformat()}  •  ANTS·THIRA Logistics
  </div>

</div>
</body>
</html>'''
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('plate', help='ทะเบียนรถ เช่น 72-2420')
    ap.add_argument('period', help='รอบ เช่น 4.2')
    ap.add_argument('--year', type=int, default=2026)
    ap.add_argument('-o', '--output', default=None)
    args = ap.parse_args()

    html = build_html(args.plate, args.period, args.year)
    out = args.output or f'report_{args.plate}_{args.period}.html'
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), out)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'✅ Generated: {out_path}')
    print(f'   เปิดด้วย browser: start "" "{out_path}"')


if __name__ == '__main__':
    main()
