@echo off
rem Project Neo Archiver - CDP Chrome launcher for Windows (dedicated profile, idempotent).
rem Sign in to projectneo.adobe.com once in this profile; auth persists afterwards.
rem Env overrides: CHROME (path to chrome.exe), PROFILE (user-data-dir), PORT (default 9225).
setlocal
set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "ROOT=%%~fI"
if not defined PROFILE set "PROFILE=%ROOT%\.chrome-profile"
if not defined PORT set "PORT=9225"

rem Already running? then nothing to do.
curl -sf --max-time 3 "http://127.0.0.1:%PORT%/json/version" >nul 2>&1
if not errorlevel 1 (
  echo {"already_running":true,"port":%PORT%}
  exit /b 0
)

rem Locate chrome.exe: CHROME env, then common install paths.
if not defined CHROME if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME (
  echo Chrome not found. Set the CHROME environment variable to chrome.exe path. 1>&2
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

start "" "%CHROME%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --hide-crash-restore-bubble --no-first-run --no-default-browser-check "https://projectneo.adobe.com/"

rem Wait for CDP to come up.
for /l %%i in (1,1,20) do (
  curl -sf --max-time 2 "http://127.0.0.1:%PORT%/json/version" >nul 2>&1
  if not errorlevel 1 goto :cdp_ready
  timeout /t 1 /nobreak >nul
)
echo Warning: CDP did not respond. Chrome may still be starting. 1>&2
:cdp_ready
echo Open https://projectneo.adobe.com/ in this Chrome and sign in once. Auth persists in %PROFILE%
exit /b 0
