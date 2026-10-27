@echo off
title ClipEasy AI Launcher
cd /d "%~dp0"

echo ========================================
echo   ClipEasy AI - starting...
echo ========================================

REM ---- 1) Backend (FastAPI) - skip if already running ----
curl -s -o nul --max-time 2 http://localhost:8420/health >nul 2>&1
if %errorlevel%==0 (
    echo [1/2] Backend already running - skip
) else (
    echo [1/2] Starting backend...
    start "ClipEasy Backend" /min cmd /c ""%~dp0venv\Scripts\python.exe" -m uvicorn api_server.main:app --port 8420 --reload"
)

REM ---- 2) App window (Electron + Vite) ----
echo [2/2] Opening app window...
cd frontend
start "ClipEasy App" /min cmd /c "npm run electron:dev"

echo.
echo Done! The app window will appear in a few seconds.
echo (Two minimized black windows are the engine - keep them open while using the app)
ping -n 7 127.0.0.1 >nul
