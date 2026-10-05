@echo off
title Giveaway Bot
cd /d "%~dp0"

rem Phone addresses: home Wi-Fi (phone-ip.txt) first, then Tailscale (tailscale-ip.txt) so it
rem works from anywhere. The bot uses whichever answers and switches if one stops working.
set WDA_URL=
if exist phone-ip.txt (
  set /p PHONE_IP=<phone-ip.txt
)
if exist tailscale-ip.txt (
  set /p TS_IP=<tailscale-ip.txt
)
if defined PHONE_IP set WDA_URL=http://%PHONE_IP%:8100
if defined TS_IP (
  if defined WDA_URL (set WDA_URL=%WDA_URL%,http://%TS_IP%:8100) else (set WDA_URL=http://%TS_IP%:8100)
)

rem Only "🎁 ..." Bark messages whose title contains this text are entered.
set MATCH=Giveaway

node giveaway-bot.js
pause
