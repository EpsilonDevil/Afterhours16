@echo off
rem Afterhours 16 v0.3 launcher: starts the local game service and opens the game in its own app window.
setlocal
cd /d "%~dp0"
set "URL=http://127.0.0.1:8765/"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3.10 or newer is required. Install it from https://www.python.org/downloads/
  echo ^(tick "Add python.exe to PATH" during setup^), then double-click start.cmd again.
  pause
  exit /b 1
)

rem Start the service in a minimized window. Close that window to stop the game service.
start "Afterhours 16 service" /min cmd /c "%PY% -m server.app || pause"
timeout /t 2 /nobreak >nul

rem Prefer a chromeless app window (Chrome or Edge); fall back to the default browser.
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL% --window-size=1600,900 --autoplay-policy=no-user-gesture-required
  goto :done
)
if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL% --window-size=1600,900 --autoplay-policy=no-user-gesture-required
  goto :done
)
start "" %URL%

:done
endlocal
