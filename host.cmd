@echo off
rem RIMRIFT: host the game for a few friends (README: "Play online with friends").
rem Runs the one game service everybody plays on (TCP port 8765, on every network interface) and opens your game.
rem Your friends need only a browser: they open http://YOUR-ADDRESS:8765/ (or double-click join.cmd).
setlocal
title RIMRIFT - hosting for friends
cd /d "%~dp0"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3.10 or newer is required. Install it from https://www.python.org/downloads/
  echo ^(tick "Add python.exe to PATH" during setup^), then double-click host.cmd again.
  pause
  exit /b 1
)

rem The game can't already be running: the hosted service is the one your own game uses too.
curl -s --max-time 2 "%URL%api/health" >nul 2>nul
if not errorlevel 1 (
  echo RIMRIFT is already running on port %PORT%. Quit it first ^(Menu, Quit to desktop^), then run host.cmd again.
  pause
  exit /b 1
)

rem The join code: your friends type it once, when they make their account. Remembered for next time, in
rem %LocalAppData%\RIMRIFT (the folder from before the rename moves over the first time; if it can't, it's used as it is)
set "OLDCFG=%LocalAppData%\Afterhours16"
set "CFG=%LocalAppData%\RIMRIFT"
if not exist "%CFG%" if exist "%OLDCFG%" move "%OLDCFG%" "%CFG%" >nul 2>nul
if not exist "%CFG%" if exist "%OLDCFG%" set "CFG=%OLDCFG%"
if not exist "%CFG%" mkdir "%CFG%"
set "CODE="
if exist "%CFG%\join_code.txt" set /p CODE=<"%CFG%\join_code.txt"
if not defined CODE set /p "CODE=Pick a join code for your friends (they type it once, to make an account): "
if not defined CODE set "CODE=hoops16"
>"%CFG%\join_code.txt" echo %CODE%
set "RIMRIFT_JOIN_CODE=%CODE%"

start "RIMRIFT online service" /min cmd /c "%PY% -m server.app --online --port %PORT% || pause"
timeout /t 2 /nobreak >nul

echo.
echo  RIMRIFT is hosted on port %PORT%.   Join code for new accounts: %CODE%
echo  Asking your router to open port %PORT% for your friends (UPnP)...
echo.
rem The service asks the router to forward the port to this PC by itself, and reads the public address from it
set "PUBURL="
set "PORTOK="
set "SHARED="
set "GAMEBUILD="
for /f "usebackq tokens=1,*" %%A in (`curl -s --max-time 20 "%URL%api/hosting.txt" 2^>nul`) do (
  if "%%A"=="BUILD" set "GAMEBUILD=%%B"
  if "%%A"=="PUBLIC" set "PUBURL=%%B"
  if "%%A"=="SHARED" set "SHARED=1"
  if "%%A"=="OK" set "PORTOK=1"
  if "%%A"=="OK" echo  %%B
  if "%%A"=="NO" echo  %%B
  if "%%A"=="FORWARD" echo  %%B
)
if not defined PUBURL if not defined SHARED (
  for /f "delims=" %%I in ('curl -s --max-time 4 https://api.ipify.org 2^>nul') do set "PUBURL=http://%%I:%PORT%/"
)
echo.
if defined SHARED (
  echo  Friends over the internet: not through this connection as it is ^(see above^).
) else if defined PUBURL (
  echo  Friends over the internet open:   %PUBURL%
) else (
  echo  Friends over the internet open:   http://YOUR-PUBLIC-IP:%PORT%/
)
if not defined PORTOK echo  ^(forward TCP %PORT% on your router to this PC by hand: README, "Play online with friends"^)
echo  ^(the first time, allow Python through Windows Firewall when Windows asks^)
echo  Friends on your own network can use:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%B in ("%%A") do echo     http://%%B:%PORT%/
echo.
echo  Friends with their own copy of the game keep their own players: in their game, social phone ^(O / LB+RB^),
echo  Online tab, they type your address and connect. Their copy has to be the same version as yours:
if defined GAMEBUILD echo     %GAMEBUILD%   ^(the same files you have; their Online tab tells them if it isn't^)
echo  Friends without a copy double-click join.cmd instead ^(they make a new player on your PC^).
echo.
echo  Everyone adds each other on the social phone, Online tab. Your username there is localplayer
echo  if you use the local session. Close the "RIMRIFT online service" window to stop hosting
echo  ^(that also closes the port on your router again^).
echo.

rem Your own game window (as start.cmd)
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
pause
endlocal
