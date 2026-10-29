@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Updating print bridge (and the shop server next to it) from the internet...
set BASE=https://mohannad087-spec.github.io/Olv-menu-by-cloud-
rem the file lists are checked against the repo by scripts/check.mjs: add any new src file here too
for %%F in (escpos index printer supabase format ticket-builder ticket-core ticket-extra ticket-kitchen ticket-receipt offline) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%BASE%/print-bridge/src/%%F.js' -OutFile 'src\%%F.js.new'; Move-Item -Force 'src\%%F.js.new' 'src\%%F.js'; Write-Host 'OK  print-bridge %%F.js' } catch { Write-Host 'FAILED print-bridge %%F.js'; Write-Host $_.Exception.Message }"
)
if exist "..\local-server\src" (
  for %%F in (index store) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%BASE%/local-server/src/%%F.js' -OutFile '..\local-server\src\%%F.js.new'; Move-Item -Force '..\local-server\src\%%F.js.new' '..\local-server\src\%%F.js'; Write-Host 'OK  local-server %%F.js' } catch { Write-Host 'FAILED local-server %%F.js'; Write-Host $_.Exception.Message }"
  )
)
echo.
echo Done. Restart the print bridge and the shop server (or restart the PC) so the new files load.
rem "update.bat /q" skips the pause (for remote runs)
if /i not "%~1"=="/q" pause
