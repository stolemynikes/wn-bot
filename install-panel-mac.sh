#!/usr/bin/env bash
# macOS: run the giveaway control panel (panel.js) in the background, always.
# It starts at login, restarts if it crashes, and is reachable from your phone over Tailscale:
#   http://<Mac's Tailscale IP>:3100
#
# Install:    ./install-panel-mac.sh
# Uninstall:  ./install-panel-mac.sh uninstall
set -euo pipefail

LABEL="com.wnbot.panel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Panel autostart removed."
  exit 0
fi

[ -z "$NODE" ] && { echo "Node.js not found. Install it first: brew install node"; exit 1; }
for f in passcode.txt phone-ip.txt tailscale-ip.txt; do
  [ -f "$DIR/$f" ] || echo "Warning: $f is missing in $DIR (see README)."
done

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/panel.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/panel-out.txt</string>
  <key>StandardErrorPath</key><string>$DIR/panel-err.txt</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2
echo "Panel installed and running:"
cat "$DIR/panel-out.txt" 2>/dev/null | tail -5
echo
echo "Open on your phone: http://$( (command -v tailscale >/dev/null && tailscale ip -4) || echo '<Mac Tailscale IP>' ):3100"
echo "If macOS asks whether node may accept incoming connections: Allow."
