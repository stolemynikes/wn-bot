#!/usr/bin/env bash
# macOS: run the giveaway control panel in this Terminal window (double-click to start).
# Runs through Terminal on purpose: macOS "Local Network" privacy blocks a hidden launchd
# service from talking to the iPhone / Tailscale, while Terminal has that permission.
# Restarts the panel automatically if it stops. Close the window (or Ctrl+C) to stop it.
cd "$(dirname "$0")"
printf '\033]0;Giveaway Panel\007'
# Keep the Mac from sleeping while the panel runs.
caffeinate -i -w $$ &
while true; do
  node panel.js
  echo "$(date '+%H:%M:%S') panel stopped - restarting in 5s (Ctrl+C to quit)"
  sleep 5
done
