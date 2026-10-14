@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OLV - Attendance Bridge
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)
if not exist .env (
  echo.
  echo   File .env is missing. Copy .env.example to .env and fill it in. See README-AR.txt
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing, one time only...
  call npm install --omit=dev
)
:loop
node src\index.js
echo.
echo   Stopped. Restarting in 10 seconds...
timeout /t 10 >nul
goto loop
