@echo off
title iPhone Control
cd /d "%~dp0"

rem === Change this to the bundle ID you set in Xcode (+ ".xctrunner") ===
set WDA_BUNDLE_ID=com.pepijn.WebDriverAgentRunner.xctrunner

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-iphone.ps1"
if errorlevel 1 exit /b 1

rem Open the browser once the server is up, then run the server in this window.
start /b cmd /c "timeout /t 2 >nul & start "" http://localhost:3000"
node server.js
pause
