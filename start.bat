@echo off
rem Project Neo Archiver - double-click launcher for Windows.
rem Chrome (CDP) -> local server -> open GUI in the default browser.
rem The server runs in a separate "Neo Archiver Server" window; close it to stop.
cd /d "%~dp0"
set "PORT=8130"
set "URL=http://127.0.0.1:%PORT%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install Node.js 22 or later.
  pause
  exit /b 1
)

echo == Chrome (CDP) ==
call tools\launch-chrome.bat
if errorlevel 1 echo Warning: Chrome launch failed (not installed?).

echo == Server: %URL% ==
curl -sf --max-time 2 "%URL%/" >nul 2>&1
if not errorlevel 1 (
  echo (already running)
) else (
  start "Neo Archiver Server" node src\server.mjs
  for /l %%i in (1,1,40) do (
    curl -sf --max-time 1 "%URL%/" >nul 2>&1
    if not errorlevel 1 goto :server_ready
    timeout /t 1 /nobreak >nul
  )
  echo Warning: server did not respond within 40s.
  :server_ready
)

echo == Opening GUI in browser ==
start "" "%URL%"
echo Server is running in the "Neo Archiver Server" window. Close that window to stop it.
exit /b 0
