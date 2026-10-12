@echo off
rem Afterhours 16 v0.4.7.5 qp3: join a friend's hosted game (README: "Play online with friends").
rem This file and Chrome or Edge are all you need: the game itself comes from your friend's PC.
setlocal
set "CFG=%LocalAppData%\Afterhours16Join"
if not exist "%CFG%" mkdir "%CFG%"
set "HOST="
set "NEW="
if exist "%CFG%\host.txt" set /p HOST=<"%CFG%\host.txt"
if defined HOST (
  set /p "NEW=Host address [%HOST%] (Enter to use it again): "
) else (
  set /p "NEW=Host address (the one your friend gave you, e.g. 203.0.113.7): "
)
if defined NEW set "HOST=%NEW%"
if not defined HOST exit /b 1
set "HOST=%HOST:http://=%"
set "HOST=%HOST:/=%"
>"%CFG%\host.txt" echo %HOST%
set "ADDR=%HOST%"
echo %HOST%| find ":" >nul || set "ADDR=%HOST%:8765"
set "URL=http://%ADDR%/"

rem Its own browser profile, and the game's address treated as secure (controllers and full-screen keyboard
rem lock only work on secure pages; the game is plain http on your friend's PC)
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "FLAGS=--app=%URL% --window-size=1600,900 --user-data-dir="%CFG%\browser" --unsafely-treat-insecure-origin-as-secure=http://%ADDR% --autoplay-policy=no-user-gesture-required"
if exist "%CHROME%" (
  start "" "%CHROME%" %FLAGS%
  goto :done
)
if exist "%EDGE%" (
  start "" "%EDGE%" %FLAGS%
  goto :done
)
echo Chrome or Edge not found: opening your default browser ^(a controller may not work there^).
start "" %URL%
pause
:done
endlocal
