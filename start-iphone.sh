#!/usr/bin/env bash
# macOS: build/launch WebDriverAgent on the iPhone with xcodebuild (USB or Wi-Fi paired), then start the UI.
# Usage: WDA_DIR=~/WebDriverAgent ./start-iphone.sh [device-udid]
set -euo pipefail

WDA_DIR="${WDA_DIR:-$HOME/WebDriverAgent}"
UDID="${1:-$(xcrun xctrace list devices 2>/dev/null | grep -E 'iPhone' | grep -v Simulator | head -1 | sed -E 's/.*\(([0-9A-Fa-f-]{20,})\)$/\1/')}"
LOG="/tmp/wda-xcodebuild.log"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -z "$UDID" ] && { echo "No iPhone found. Connect via USB or enable 'Connect via network' in Xcode > Devices."; exit 1; }
echo "Device: $UDID"
echo "Launching WebDriverAgent (log: $LOG)..."

xcodebuild -project "$WDA_DIR/WebDriverAgent.xcodeproj" -scheme WebDriverAgentRunner \
  -destination "id=$UDID" -allowProvisioningUpdates test > "$LOG" 2>&1 &
XCB_PID=$!
trap 'kill $XCB_PID $SERVER_PID 2>/dev/null' EXIT

for i in $(seq 1 180); do
  URL=$(grep -o 'ServerURLHere->[^<]*' "$LOG" | head -1 | sed 's/ServerURLHere->//') || true
  [ -n "$URL" ] && break
  kill -0 $XCB_PID 2>/dev/null || { echo "xcodebuild exited, see $LOG"; tail -20 "$LOG"; exit 1; }
  sleep 1
done
[ -z "$URL" ] && { echo "Timed out waiting for WDA, see $LOG"; exit 1; }

URL="${URL%/}"
echo "WDA running at $URL  (reachable from any machine on the same Wi-Fi)"
WDA_URL="$URL" node "$HERE/server.js" &
SERVER_PID=$!
sleep 1
open "http://localhost:3000" || true
wait $XCB_PID
