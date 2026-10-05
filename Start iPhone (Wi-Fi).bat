@echo off
title iPhone Control (Wi-Fi)
cd /d "%~dp0"

rem Remembers the phone IP in phone-ip.txt. WDA must already be running on the phone
rem (started from the Mac or the USB launcher).
set PHONE_IP=
if exist phone-ip.txt set /p PHONE_IP=<phone-ip.txt
if "%PHONE_IP%"=="" (
  set /p PHONE_IP=Phone IP address:
) else (
  echo Using phone IP %PHONE_IP%  ^(delete phone-ip.txt to change^)
)
if "%PHONE_IP%"=="" (
  set /p PHONE_IP=Phone IP address:
)
echo %PHONE_IP%>phone-ip.txt

set WDA_URL=http://%PHONE_IP%:8100
start /b cmd /c "timeout /t 2 >nul & start "" http://localhost:3000"
node server.js
pause
