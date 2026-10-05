@echo off
title iPhone Script
cd /d "%~dp0"

rem Drag a .js automation script onto this file to run it.
rem Uses phone-ip.txt (Wi-Fi) if it exists, otherwise localhost (USB).
if "%~1"=="" (
  echo Drag a .js script onto this file to run it.
  pause
  exit /b
)
if exist phone-ip.txt (
  set /p PHONE_IP=<phone-ip.txt
)
if defined PHONE_IP set WDA_URL=http://%PHONE_IP%:8100

node "%~1"
pause
