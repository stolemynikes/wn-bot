@echo off
title Giveaway Panel
cd /d "%~dp0"
rem Control panel: open http://<this PC's Tailscale IP>:3100 on your phone to start/stop the bot.
node panel.js
pause
