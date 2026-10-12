@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OLV - Local Server
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again.
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
echo   Server stopped. Restarting in 5 seconds...
timeout /t 5 >nul
goto loop
