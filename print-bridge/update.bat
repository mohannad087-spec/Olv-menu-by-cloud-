@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Updating print bridge from the internet...
set BASE=https://mohannad087-spec.github.io/Olv-menu-by-cloud-/print-bridge/src
for %%F in (escpos index offline printer supabase format ticket-builder ticket-core ticket-extra ticket-kitchen ticket-receipt) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%BASE%/%%F.js' -OutFile 'src\%%F.js.new'; Move-Item -Force 'src\%%F.js.new' 'src\%%F.js'; Write-Host 'OK  %%F.js' } catch { Write-Host 'FAILED %%F.js'; Write-Host $_.Exception.Message }"
)
echo.
echo Done. Now CLOSE the print bridge window (the black one) and double-click start.bat again.
pause
