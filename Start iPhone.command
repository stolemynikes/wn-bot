#!/usr/bin/env bash
# macOS: double-click in Finder to launch WDA + the remote-control UI.
cd "$(dirname "$0")"
export WDA_DIR="${WDA_DIR:-$HOME/WebDriverAgent}"
chmod +x ./start-iphone.sh
./start-iphone.sh
