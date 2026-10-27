@echo off
chcp 65001 >nul
title ClipEasy AI Launcher
cd /d "%~dp0"

echo ========================================
echo   ClipEasy AI - กำลังเปิดโปรแกรม...
echo ========================================

REM ---- 1) Backend (FastAPI) — ข้ามถ้ารันอยู่แล้ว ----
curl -s -o nul --max-time 2 http://localhost:8420/health >nul 2>&1
if %errorlevel%==0 (
    echo [1/2] Backend รันอยู่แล้ว - ข้าม
) else (
    echo [1/2] เปิด Backend...
    start "ClipEasy Backend" /min cmd /c ""%~dp0venv\Scripts\python.exe" -m uvicorn api_server.main:app --port 8420 --reload"
)

REM ---- 2) หน้าต่างแอป (Electron + Vite) ----
echo [2/2] เปิดหน้าต่างแอป...
cd frontend
start "ClipEasy App" /min cmd /c "npm run electron:dev"

echo.
echo เสร็จแล้ว! หน้าต่างแอปจะเด้งขึ้นมาในไม่กี่วินาที
echo (หน้าต่างดำ 2 อันที่ย่ออยู่คือตัวระบบ อย่าเพิ่งปิดระหว่างใช้งาน)
timeout /t 6 >nul
