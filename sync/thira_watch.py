# -*- coding: utf-8 -*-
"""
THIRA Local File Watcher
========================
เฝ้าดูไฟล์ใบยกตู้V4TEST.xlsm ใน Dropbox local
เมื่อตรวจเจอว่ามีการเซฟใหม่ → รัน thira_sync.py --local ทันที

วิธีรัน (background):
    pythonw thira_watch.py

วิธีให้รันอัตโนมัติตอนเปิดเครื่อง:
    1) กด Win+R → พิมพ์ shell:startup → Enter
    2) สร้าง shortcut ไปที่ thira_watch.bat (อยู่ในโฟลเดอร์เดียวกัน)

ENV:
    SUPABASE_URL, SUPABASE_KEY  (set ใน .env หรือ environment)
"""

import os
import sys
import time
import subprocess
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────
WATCH_FILE = Path(r"C:\Users\Admin\Dropbox\ใบยกตู้\ใบยกตู้V4TEST.xlsm")
SYNC_SCRIPT = Path(__file__).parent / "thira_sync.py"
DEBOUNCE_SEC = 5       # รวบ event หลายรอบใน 5 วินาทีเป็นครั้งเดียว
LOG_FILE = Path(__file__).parent / "thira_watch.log"

# โหลด .env ถ้ามี
ENV_FILE = Path(__file__).parent / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def run_sync():
    if not SYNC_SCRIPT.exists():
        log(f"❌ ไม่พบ {SYNC_SCRIPT}")
        return
    if not WATCH_FILE.exists():
        log(f"❌ ไม่พบไฟล์ {WATCH_FILE}")
        return

    log(f"🔄 เริ่ม sync...")
    try:
        result = subprocess.run(
            [sys.executable, str(SYNC_SCRIPT), "--local", str(WATCH_FILE)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
        if result.stdout:
            for ln in result.stdout.splitlines():
                log(f"  | {ln}")
        if result.returncode == 0:
            log(f"✅ sync เสร็จ")
        else:
            log(f"❌ sync ล้มเหลว (exit={result.returncode})")
            if result.stderr:
                for ln in result.stderr.splitlines():
                    log(f"  ! {ln}")
    except subprocess.TimeoutExpired:
        log(f"⏰ sync timeout (>180s)")
    except Exception as e:
        log(f"❌ exception: {e}")


# ─────────────────────────────────────────────────────────────────
# WATCHER (watchdog)
# ─────────────────────────────────────────────────────────────────
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    log("❌ ต้องติดตั้ง watchdog ก่อน: pip install watchdog")
    sys.exit(1)


class Handler(FileSystemEventHandler):
    def __init__(self):
        self.last_run = 0
        self.pending = False

    def _maybe_trigger(self, event_path):
        # match เฉพาะไฟล์ที่เราดู (Excel จะสร้าง .tmp ขณะ save → ignore)
        p = Path(event_path)
        if p.name != WATCH_FILE.name:
            return
        now = time.time()
        if now - self.last_run < DEBOUNCE_SEC:
            self.pending = True
            return
        self.last_run = now
        log(f"📝 ตรวจเจอการเปลี่ยนแปลง: {p.name}")
        run_sync()

    def on_modified(self, event):
        if not event.is_directory:
            self._maybe_trigger(event.src_path)

    def on_created(self, event):
        if not event.is_directory:
            self._maybe_trigger(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._maybe_trigger(event.dest_path)


def main():
    if not WATCH_FILE.exists():
        log(f"⚠️  ยังไม่พบไฟล์ {WATCH_FILE} (จะรอจนกว่าจะมี)")

    log(f"👁️  เริ่มเฝ้าดู: {WATCH_FILE}")
    log(f"📜 log file: {LOG_FILE}")

    handler = Handler()
    observer = Observer()
    # ดูทั้งโฟลเดอร์ (เพราะ Dropbox จะ rename .tmp → ไฟล์จริง)
    observer.schedule(handler, str(WATCH_FILE.parent), recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(2)
            # ตรวจว่ามี pending event ที่ debounce ดอง → flush
            if handler.pending and (time.time() - handler.last_run) >= DEBOUNCE_SEC:
                handler.pending = False
                handler.last_run = time.time()
                log(f"⏱️  flush debounced event")
                run_sync()
    except KeyboardInterrupt:
        log("⛔ หยุดเฝ้าดู (Ctrl+C)")
    finally:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
