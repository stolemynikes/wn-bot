#!/usr/bin/env bash
# macOS: run the giveaway panel in the background with tmux, so no Terminal window has to stay open.
# Start it once from Terminal; it keeps Terminal's Local Network permission after you close the window.
#
#   ./panel-bg.sh start    start in the background (needs: brew install tmux)
#   ./panel-bg.sh stop     stop panel (and the bot it started)
#   ./panel-bg.sh status   is it running?
#   ./panel-bg.sh attach   look at the panel's console (detach again with Ctrl+B, then D)
set -uo pipefail
cd "$(dirname "$0")"
SESSION="wn-panel"

command -v tmux >/dev/null || { echo "tmux not found. Install it first: brew install tmux"; exit 1; }

case "${1:-status}" in
  start)
    if tmux has-session -t "$SESSION" 2>/dev/null; then echo "Already running (./panel-bg.sh attach to look)."; exit 0; fi
    if lsof -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port 3100 is already in use - close the 'Giveaway Panel' Terminal window first."; exit 1
    fi
    tmux new-session -d -s "$SESSION" "./Start\ Panel.command"
    sleep 2
    echo "Panel started in the background. You can close this Terminal window."
    ;;
  stop)
    # Ask the panel to stop the bot cleanly first, then end the session.
    curl -s -X POST http://127.0.0.1:3100/api/stop >/dev/null 2>&1 && sleep 3
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "Panel stopped." || echo "Not running."
    ;;
  status)
    if tmux has-session -t "$SESSION" 2>/dev/null; then echo "Panel running in tmux session '$SESSION'."; else echo "Panel not running in the background."; fi
    curl -s -m 5 http://127.0.0.1:3100/api/status | head -c 200; echo
    ;;
  attach)
    tmux attach -t "$SESSION"
    ;;
  *)
    echo "Usage: $0 start|stop|status|attach"; exit 1
    ;;
esac
