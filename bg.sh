#!/usr/bin/env bash
# macOS: run WebDriverAgent keep-alive AND the giveaway panel in the background (tmux), so you can
# close/quit Terminal or iTerm without stopping anything. Start it from Terminal/iTerm once; the
# tmux sessions keep that app's Local Network permission.
#
#   ./bg.sh start          start both (WDA keep-alive + panel) in the background
#   ./bg.sh stop           stop both (stops the bot cleanly first)
#   ./bg.sh restart        stop + start
#   ./bg.sh status         what's running?
#   ./bg.sh attach wda     look at the WDA window   (back out: Ctrl+B, then D)
#   ./bg.sh attach panel   look at the panel window (back out: Ctrl+B, then D)
#
# Needs tmux once: brew install tmux
set -uo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
UDID="${UDID:-00008120-001818A92683C01E}"
WDA_DIR="${WDA_DIR:-$HOME/WebDriverAgent}"
S_WDA="wn-wda"
S_PANEL="wn-panel"

command -v tmux >/dev/null || { echo "tmux not found. Install it first: brew install tmux"; exit 1; }
running() { tmux has-session -t "$1" 2>/dev/null; }

start() {
  if running "$S_WDA"; then
    echo "WDA keep-alive: already running"
  else
    pkill -f "xcodebuild.*wda-derived" 2>/dev/null   # leftovers from a closed window
    tmux new-session -d -s "$S_WDA" "cd '$DIR' && WDA_DIR='$WDA_DIR' ./wda-keepalive.sh '$UDID'"
    echo "WDA keep-alive: started (keep the iPhone unlocked for a moment)"
  fi
  if running "$S_PANEL"; then
    echo "Panel: already running"
  elif lsof -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Panel: port 3100 is already in use (close the 'Giveaway Panel' window first, then: ./bg.sh start)"
  else
    tmux new-session -d -s "$S_PANEL" "cd '$DIR' && ./Start\ Panel.command"
    echo "Panel: started"
  fi
  echo
  echo "Waiting for WebDriverAgent..."
  for i in $(seq 1 60); do
    if curl -s -m 3 "http://$(cat phone-ip.txt 2>/dev/null || echo 127.0.0.1):8100/status" | grep -q '"ready" : true'; then
      echo "WebDriverAgent is running. You can close this window / quit Terminal now."
      echo "Open the panel on your phone and press Start."
      return
    fi
    sleep 2
  done
  echo "WebDriverAgent isn't up yet after 2 minutes. Look with: ./bg.sh attach wda"
}

stop() {
  curl -s -m 5 -X POST http://127.0.0.1:3100/api/stop >/dev/null 2>&1 && sleep 4
  running "$S_PANEL" && tmux kill-session -t "$S_PANEL" && echo "Panel: stopped"
  if running "$S_WDA"; then
    tmux send-keys -t "$S_WDA" C-c   # lets wda-keepalive.sh stop xcodebuild cleanly
    sleep 3
    tmux kill-session -t "$S_WDA" 2>/dev/null
    echo "WDA keep-alive: stopped"
  fi
  pkill -f "xcodebuild.*wda-derived" 2>/dev/null || true
}

status() {
  running "$S_WDA" && echo "WDA keep-alive: running" || echo "WDA keep-alive: NOT running"
  running "$S_PANEL" && echo "Panel:          running" || echo "Panel:          NOT running (in background)"
  if curl -s -m 3 "http://$(cat phone-ip.txt 2>/dev/null || echo 127.0.0.1):8100/status" | grep -q '"ready" : true'; then
    echo "iPhone (WDA):   reachable"
  else
    echo "iPhone (WDA):   NOT reachable"
  fi
  curl -s -m 5 http://127.0.0.1:3100/api/status | grep -o '"running":[a-z]*' | head -1 | sed 's/"running":/Bot:            running=/'
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status) status ;;
  attach)
    case "${2:-}" in
      wda) tmux attach -t "$S_WDA" ;;
      panel) tmux attach -t "$S_PANEL" ;;
      *) echo "Usage: $0 attach wda|panel"; exit 1 ;;
    esac ;;
  *) echo "Usage: $0 start|stop|restart|status|attach wda|panel"; exit 1 ;;
esac
