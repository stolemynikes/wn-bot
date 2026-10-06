#!/usr/bin/env bash
# macOS: run the giveaway panel in the background (tmux), so you can close/quit Terminal or iTerm
# without stopping it. Start it from Terminal/iTerm once; the tmux session keeps that app's
# Local Network permission.
#
# WebDriverAgent is NOT started here: the panel starts it when you press Start and switches it
# off again on Stop (so nothing runs on the iPhone while the bot is off).
#
#   ./bg.sh start      start the panel in the background
#   ./bg.sh stop       stop the bot, WebDriverAgent and the panel
#   ./bg.sh restart    stop + start
#   ./bg.sh status     what's running?
#   ./bg.sh attach     look at the panel window (back out: Ctrl+B, then D)
#   ./bg.sh logs       last lines of the panel, bot and WebDriverAgent output
#
# Needs tmux once: brew install tmux
set -uo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
S_PANEL="wn-panel"
S_WDA_OLD="wn-wda"   # used by older versions of this script

command -v tmux >/dev/null || { echo "tmux not found. Install it first: brew install tmux"; exit 1; }
running() { tmux has-session -t "$1" 2>/dev/null; }

cleanup_old_wda() {
  # Older versions kept WebDriverAgent running all the time in a separate session.
  if running "$S_WDA_OLD"; then
    tmux send-keys -t "$S_WDA_OLD" C-c; sleep 3
    tmux kill-session -t "$S_WDA_OLD" 2>/dev/null
    echo "Stopped the old always-on WebDriverAgent session."
  fi
}

start() {
  cleanup_old_wda
  if running "$S_PANEL"; then
    echo "Panel: already running"
  elif lsof -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Panel: port 3100 is already in use (close the 'Giveaway Panel' window first, then: ./bg.sh start)"
    exit 1
  else
    pkill -f "xcodebuild.*wda-derived" 2>/dev/null   # leftovers from a closed window
    tmux new-session -d -s "$S_PANEL" "cd '$DIR' && ./Start\ Panel.command"
    sleep 2
    echo "Panel: started in the background. You can close this window / quit Terminal now."
  fi
  echo "Open the panel on your phone and press Start (that also starts WebDriverAgent)."
}

stop() {
  curl -s -m 5 -X POST http://127.0.0.1:3100/api/stop >/dev/null 2>&1 && sleep 5
  running "$S_PANEL" && tmux kill-session -t "$S_PANEL" && echo "Panel: stopped"
  cleanup_old_wda
  pkill -f "wda-keepalive.sh" 2>/dev/null
  pkill -f "xcodebuild.*wda-derived" 2>/dev/null || true
  echo "WebDriverAgent: off"
}

status() {
  running "$S_PANEL" && echo "Panel:          running" || echo "Panel:          NOT running (in background)"
  if pgrep -f "xcodebuild.*wda-derived" >/dev/null; then echo "WebDriverAgent: on"; else echo "WebDriverAgent: off"; fi
  curl -s -m 5 http://127.0.0.1:3100/api/status | grep -o '"bot":{"running":[a-z]*' | sed 's/.*"running":/Bot:            running=/'
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status) status ;;
  attach) tmux attach -t "$S_PANEL" ;;
  logs)
    echo "== panel";  tail -5 panel-out.txt 2>/dev/null
    echo "== bot";    tail -10 giveaway-log.txt 2>/dev/null
    echo "== WebDriverAgent"; tail -8 wda-out.txt 2>/dev/null; tail -12 wda-history.log 2>/dev/null ;;
  *) echo "Usage: $0 start|stop|restart|status|attach|logs"; exit 1 ;;
esac
