#!/usr/bin/env bash
# macOS: keep WebDriverAgent running on the iPhone. If it stops (phone left home, Mac slept,
# cable pulled, iOS killed it), it is started again as soon as the phone can be reached.
#
# Usage (in Terminal on the Mac, leave the window open):
#   WDA_DIR=~/WebDriverAgent ./wda-keepalive.sh [iphone-udid]
# Stop with Ctrl+C.
set -uo pipefail

WDA_DIR="${WDA_DIR:-$HOME/WebDriverAgent}"
UDID="${1:-00008120-001818A92683C01E}"
DERIVED="${TMPDIR:-/tmp}/wda-derived"
LOG="${TMPDIR:-/tmp}/wda-keepalive.log"
# Every stop is recorded here with its reason (next to this script; not in git).
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
HIST="$SELF_DIR/wda-history.log"
# The iPhone's addresses (home Wi-Fi, Tailscale), used by the watchdog to check WDA is still answering.
PHONE_URLS=()
for F in phone-ip.txt tailscale-ip.txt; do
  IP="$(head -1 "$SELF_DIR/$F" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$IP" ] && PHONE_URLS+=("http://$IP:8100")
done

# Keep the Mac awake while this runs (display may sleep; system won't).
caffeinate -i -w $$ &

# Background jobs in a script ignore Ctrl+C, so stop xcodebuild ourselves when the script stops.
XCB=""
cleanup() {
  echo
  echo "Stopping WebDriverAgent..."
  [ -n "$XCB" ] && kill "$XCB" 2>/dev/null
  pkill -f "xcodebuild.*$DERIVED" 2>/dev/null
  exit 0
}
trap cleanup INT TERM HUP

if ls "$DERIVED"/Build/Products/*.xctestrun >/dev/null 2>&1 && [ -z "${FORCE_BUILD:-}" ]; then
  echo "Using the existing WebDriverAgent build (FORCE_BUILD=1 to rebuild, e.g. after renewing the signature)."
else
echo "Building WebDriverAgent once (needs the phone connected/paired)..."
until xcodebuild -project "$WDA_DIR/WebDriverAgent.xcodeproj" -scheme WebDriverAgentRunner \
    -destination "id=$UDID" -derivedDataPath "$DERIVED" -allowProvisioningUpdates \
    build-for-testing > "$LOG" 2>&1; do
  echo "$(date '+%H:%M:%S') build failed (phone not reachable?) - retrying in 60s. Details: $LOG"
  sleep 60
done
echo "Build OK."
fi

while true; do
  echo "$(date '+%H:%M:%S') starting WebDriverAgent on $UDID ..."
  xcodebuild -destination "id=$UDID" -derivedDataPath "$DERIVED" \
    -xctestrun "$(ls "$DERIVED"/Build/Products/*.xctestrun | head -1)" \
    test-without-building > "$LOG" 2>&1 &
  XCB=$!
  STARTED=$(date +%s)
  # Report when it's up.
  for i in $(seq 1 60); do
    if grep -q 'ServerURLHere->' "$LOG" 2>/dev/null; then
      echo "$(date '+%H:%M:%S') running: $(grep -o 'ServerURLHere->[^<]*' "$LOG" | head -1 | sed 's/ServerURLHere->//')"
      echo "$(date '+%Y-%m-%d %H:%M:%S') started OK" >> "$HIST"
      break
    fi
    kill -0 $XCB 2>/dev/null || break
    sleep 2
  done
  # Watchdog: when the Mac loses the iPhone, WebDriverAgent exits right away ("Exiting due to IDE
  # disconnection"), but xcodebuild can then hang for 10 minutes collecting diagnostics. Don't wait
  # for that: restart as soon as the log says the connection is gone, or when WebDriverAgent hasn't
  # answered for 30s after it was up.
  WHY=""
  FAILS=0
  while kill -0 $XCB 2>/dev/null; do
    sleep 5
    if grep -qE 'Exiting due to IDE disconnection|Lost connection to|device (was|has been) disconnected|connection to this device could not be established' "$LOG" 2>/dev/null; then
      WHY="connection to the iPhone lost"
    elif grep -q 'ServerURLHere->' "$LOG" 2>/dev/null && [ ${#PHONE_URLS[@]} -gt 0 ]; then
      OK=""
      for U in "${PHONE_URLS[@]}"; do curl -s -m 4 "$U/status" >/dev/null 2>&1 && { OK=1; break; }; done
      if [ -n "$OK" ]; then FAILS=0; else FAILS=$((FAILS + 1)); fi
      [ $FAILS -ge 6 ] && WHY="WebDriverAgent not answering for 30s"
    fi
    if [ -n "$WHY" ]; then
      echo "$(date '+%H:%M:%S') $WHY - restarting now (instead of waiting for xcodebuild)"
      kill $XCB 2>/dev/null
      sleep 3
      kill -9 $XCB 2>/dev/null
      pkill -9 -f "xcodebuild.*$DERIVED" 2>/dev/null
      break
    fi
  done
  wait $XCB 2>/dev/null
  CODE=$?
  RAN=$(( $(date +%s) - STARTED ))
  PAUSE=15; [ -n "$WHY" ] && PAUSE=5
  echo "$(date '+%H:%M:%S') WebDriverAgent stopped after ${RAN}s${WHY:+ ($WHY)} - restarting in ${PAUSE}s. Reason: see $HIST"
  # Record why it stopped: xcodebuild's error lines + the Mac's latest sleep/wake events.
  {
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') STOPPED after ${RAN}s (xcodebuild exit $CODE)${WHY:+ - $WHY}"
    grep -iE 'error|fail|lost|interrupt|crash|terminat|disconnect|unavailable|locked|timed out|\*\* TEST' "$LOG" | tail -12
    echo "-- Mac sleep/wake (last 3):"
    pmset -g log 2>/dev/null | grep -E ' (Sleep|Wake|DarkWake) ' | tail -3
    echo
  } >> "$HIST"
  sleep $PAUSE
done
