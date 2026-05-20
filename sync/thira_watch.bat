@echo off
REM ─────────────────────────────────────────────────────────────
REM THIRA Watch — ตัวเฝ้าดูไฟล์ใบยกตู้ (รันเงียบใน background)
REM วาง shortcut ไฟล์นี้ใน shell:startup เพื่อรันตอนเปิดเครื่อง
REM ─────────────────────────────────────────────────────────────
cd /d "%~dp0"
start "" pythonw thira_watch.py
exit
