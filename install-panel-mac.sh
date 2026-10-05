#!/usr/bin/env bash
# macOS: make the giveaway control panel start automatically at login.
#
# The panel runs in a Terminal window ("Start Panel.command") instead of a hidden launchd
# service: macOS "Local Network" privacy (macOS 15+) silently blocks a launchd-started node
# from reaching the iPhone and from answering over Tailscale, while Terminal is allowed.
#
# Install:    ./install-panel-mac.sh      (adds a Login Item and starts the panel now)
# Uninstall:  ./install-panel-mac.sh uninstall
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CMD="$DIR/Start Panel.command"
OLD_LABEL="com.wnbot.panel"

# Remove the old launchd version if it's there (it can't reach the network, see above).
launchctl bootout "gui/$(id -u)/$OLD_LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist"

remove_login_item() {
  osascript -e 'tell application "System Events" to delete (every login item whose name is "Start Panel.command")' >/dev/null 2>&1 || true
}

if [ "${1:-}" = "uninstall" ]; then
  remove_login_item
  echo "Panel login item removed. Close the 'Giveaway Panel' Terminal window to stop it."
  exit 0
fi

command -v node >/dev/null || { echo "Node.js not found. Install it first: brew install node"; exit 1; }
for f in passcode.txt phone-ip.txt tailscale-ip.txt; do
  [ -f "$DIR/$f" ] || echo "Warning: $f is missing in $DIR (see README)."
done
chmod +x "$CMD"

remove_login_item
osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$CMD\", hidden:false}" >/dev/null
echo "Login item added: the panel opens in Terminal every time you log in."

if lsof -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "A panel is already running on port 3100 - not starting a second one."
else
  open "$CMD"
  echo "Panel started in a new Terminal window."
fi
echo "Open on your phone: http://$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null || echo '<Mac Tailscale IP>'):3100"
