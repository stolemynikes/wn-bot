# Setup and troubleshooting on the Mac (instructions for Claude on the Mac)

You are helping set up and debug the **giveaway bot + control panel** on this Mac. The user wants
everything to run on this Mac (it's always on) and to control it from their iPhone over Tailscale,
including when they're away from home.

## How it fits together
```
iPhone (WebDriverAgent on :8100) <-- HTTP --  giveaway-bot.js (Node, on this Mac)
                                                     ^
                                                     | fork + IPC "stop"
                                              panel.js (Node, :3100, in a Terminal window)
                                                     ^
                                          user's phone browser over Tailscale
```
- **WebDriverAgent (WDA)** runs on the iPhone as an XCUITest. It is started from this Mac with
  `xcodebuild` (see `wda-keepalive.sh`). Since iOS 17 it only keeps running while this Mac stays
  connected to the phone (USB or same network; for remote use, see `MAC-WORKAROUNDS.md` / RoamRun).
- **giveaway-bot.js**:
  - reads Bark's Message History on the iPhone (session tied to `me.fin.bark`);
  - for each new "🎁 Giveaway — host 🎁" message, opens the Whatnot `/live/` link, taps the
    Giveaway tile, presses **Enter Giveaway** and confirms the `check-circle` icon;
  - only logs "🏆 You won" messages, and ignores "⚠️ Watcher …" / "🔄 Watcher …" messages.
- **panel.js** is a small web page with Start/Stop, status and the log. It listens only on
  127.0.0.1 and this Mac's Tailscale address(es), port 3100.
- **wda.js** is the dependency-free WDA client. `WDA_URL` can list several addresses
  (home Wi-Fi first, then Tailscale); it switches automatically.

Devices (Tailscale):
- iPhone 14 Pro Max: `100.91.246.93`, home Wi-Fi `192.168.2.161`
  (UDID `00008120-001818A92683C01E`, iOS 26.6.2)
- This Mac: `pepijns-macbook-pro`, `100.105.229.26`
- Windows PC: `100.104.187.83`. The bot/panel there are **stopped**; only this Mac should run the bot.

## Rules
- **Run only one bot.** Two bots (or this bot plus something else creating WDA sessions) steal each
  other's session. The `giveaway-bot.pid` lock only protects within one machine.
- **Never commit** `passcode.txt`, `phone-ip.txt`, `tailscale-ip.txt`, logs, `debug/`, `bot-out.txt`
  (they're in `.gitignore`). Never put the real passcode in any tracked file.
- The bot must only tap elements by name (gift icon `giveaway`, tile text `Giveaway`,
  `Enter Giveaway`). **Never add coordinate taps near the bottom of a Whatnot stream**: that's
  where the **Bid** button is.

## Setup
1. **Repo location:** currently `~/Dev/wn-bot` (fine). Avoid Desktop/Documents/Downloads/iCloud
   folders; macOS privacy protection makes those awkward for background processes.
2. **Node 18+:** `brew install node`, then `node -v`.
3. **Local files** (not in git). Ask the user for the passcode; don't guess it:
   ```
   printf '%s' 'PASSCODE' > passcode.txt
   printf '%s' '192.168.2.161' > phone-ip.txt
   printf '%s' '100.91.246.93' > tailscale-ip.txt
   chmod 600 passcode.txt
   ```
4. **WebDriverAgent running:** `curl -s http://192.168.2.161:8100/status` should show
   `"ready" : true`. If not, start it:
   ```
   chmod +x *.sh *.command
   WDA_DIR=~/WebDriverAgent ./wda-keepalive.sh 00008120-001818A92683C01E
   ```
   (Run it in its own Terminal window; it rebuilds/restarts WDA whenever it stops.)
5. **Panel always on:** `./install-panel-mac.sh`.
   - It adds `Start Panel.command` as a **Login Item** and opens it now. The panel runs in a
     Terminal window titled "Giveaway Panel" and restarts itself if it stops. Leave that window open.
   - **Why not a hidden launchd service?** macOS 15+ **Local Network privacy** silently blocks a
     launchd-started `node` from talking to devices on the network. The phone's panel page then
     says "server stopped responding", and the bot can't reach the iPhone. Terminal has the
     Local Network permission, and the panel + bot inherit it. (Verified on this Mac:
     launchd = no response; `node panel.js` in Terminal = works.)
   - Check: System Settings → Privacy & Security → **Local Network** → Terminal is on.
   - If macOS asks whether `node` may accept incoming connections: **Allow**.
6. **Check:**
   - On the Mac, `curl -s http://127.0.0.1:3100/api/status` should return JSON.
   - From the phone, open `http://100.105.229.26:3100`, then Share → Add to Home Screen.

## Troubleshooting: "pressing Start in the panel does nothing"
Work through these in order and report what you find.

1. **Is the panel the new version and running?**
   ```
   git pull
   lsof -iTCP:3100 -sTCP:LISTEN     # which process serves the panel?
   ```
   - Panel started by launchd (old install), or the page says "server stopped responding": it's
     **Local Network privacy**. Run `./install-panel-mac.sh` (removes the launchd agent, uses the
     Terminal login item).
   - After `git pull`, restart the panel: close the "Giveaway Panel" Terminal window and
     double-click `Start Panel.command`.
   - `EADDRINUSE`: another panel is already on :3100. Find it with `lsof -i :3100` and stop it.
2. **What does the panel say?** Call the API directly:
   ```
   curl -s -X POST http://127.0.0.1:3100/api/start; echo
   sleep 5; curl -s http://127.0.0.1:3100/api/status | python3 -m json.tool | head -40
   ```
   - `result`:
     - `"already running"` with no bot visible: delete a stale `giveaway-bot.pid`.
     - `"cannot start: phone-ip.txt…"`: the local files are missing.
   - `bot.lastExit`: the exit code and the bot's last output (also in `bot-out.txt`). That's the
     real error.
3. **Run the bot by hand** to see errors directly:
   ```
   WDA_URL=http://192.168.2.161:8100,http://100.91.246.93:8100 node giveaway-bot.js
   ```
   Stop it with Ctrl+C. Read-only test:
   `DRY_RUN=1 WDA_URL=... node giveaway-bot.js` lists how the current Bark messages are classified.
4. **Typical bot errors:**
   - `WDA not reachable at …`: WDA isn't running (Setup step 4) or the phone is off the network.
   - `Not authorized for performing UI testing action (XCTDaemonErrorDomain Code=41)`: the WDA app
     still answers `/status`, but the xcodebuild/Xcode test session that launched it has ended or lost
     its connection, so iOS revoked UI-testing rights. Check `pgrep -fl xcodebuild`, then stop and
     start WDA again (`wda-keepalive.sh` or Xcode Cmd+U) with the phone unlocked. If it persists:
     iPhone Settings → Developer → **Enable UI Automation** on, and the developer certificate trusted.
   - `Could not create WDA session … unlocked`: the phone is locked and the passcode is wrong or
     missing. Check `passcode.txt`.
   - `expected to read Bark but got "Whatnot"`: the session isn't tied to Bark. The bot handles this
     with `useApp`/`ensureApp`; make sure the code is up to date (`git pull`).
5. **Bot can't reach the iPhone, but `curl` from Terminal can:** same Local Network privacy issue.
   The bot must be started by a panel that runs in Terminal (or run by hand in Terminal).

## Useful commands
- Panel log: `tail -f panel-out.txt panel-err.txt`
- Bot log: `tail -f giveaway-log.txt` (entries, wins, skips) and `bot-out.txt` (console/crashes)
- Elements on the phone's current screen: `WDA_URL=http://192.168.2.161:8100 node dump.js [filter]`
- Remove the panel service: `./install-panel-mac.sh uninstall`
- Skipped giveaways save a screenshot + tile elements to `debug/`.

## Report back
When something is fixed or changed, commit and push (without secrets) so the Windows side stays in sync:
```
git add -A && git status   # check: no passcode/ip files
git commit -m "…" && git push
```
