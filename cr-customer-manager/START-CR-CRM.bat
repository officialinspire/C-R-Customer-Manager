@echo off
title C&R Carpet Manager
echo Starting C&R Customer Manager...
cd /d "%~dp0"

:: Check if Node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Node.js is not installed.
  echo Please install Node.js 18+ from https://nodejs.org
  pause
  exit /b 1
)

:: Start server
start "" /min cmd /c "node server.js"
timeout /t 3 /nobreak >nul

:: Open in Chrome kiosk mode (preferred for retail use)
start "" "chrome" --app=http://localhost:3005 --window-size=1440,900 2>nul || ^
start "" "msedge" --app=http://localhost:3005 --window-size=1440,900 2>nul || ^
start "" "http://localhost:3005"

echo C&R CRM is running. Close this window to keep it running in background.
