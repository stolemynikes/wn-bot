# wn-bot

## 📖 Simple guide (no technical knowledge needed)

### What does this do?
A robot that enters **Whatnot giveaways** for you, on your iPhone.

1. You get a message in the **Bark** app: "🎁 Giveaway — streamer name".
2. The robot sees it, opens that stream in **Whatnot**, taps the **Giveaway** box and presses
   **Enter Giveaway**.
3. It checks that it worked (a ✓ checkmark appears) and moves on to the next one.

It **skips**:
- 🏆 "You won" messages. Those only get noted, so you can see where you won.
- ⚠️ "Watcher …" messages. Those are just status messages, not giveaways.

It **never** taps "Bid" or buys anything. It only presses the giveaway button.

### What needs to be on for it to work?
Think of it as three pieces that all have to be switched on:

| Piece | Where | What it does |
|---|---|---|
| 1. **The iPhone** | Your phone | Does the actual tapping. Bark and Whatnot must be logged in. |
| 2. **WDA keep-alive** | Mac, in the background | The "remote control connection" from the Mac to the iPhone. |
| 3. **Panel** | Mac, in the background | The control panel you open on your phone. |

**Switching pieces 2 and 3 on** (once, and again after a Mac restart). Open Terminal/iTerm,
unlock your iPhone, and type:
```
cd ~/Dev/wn-bot
./bg.sh start
```
Wait until it says **"WebDriverAgent is running"**. After that you can **close or quit
Terminal/iTerm**: everything keeps running in the background. The Mac must stay on.

Other commands (in Terminal, from `~/Dev/wn-bot`):
- `./bg.sh status`: is everything running?
- `./bg.sh restart`: restart everything (solves most problems)
- `./bg.sh stop`: switch everything off

(First time only: `brew install tmux`.)

### Every day: starting and stopping
1. On your phone, open the panel: **http://100.105.229.26:3100**
   (tip: in Safari, Share → **Add to Home Screen** gives you an app icon).
2. Press **Start**: the robot starts working.
3. Press **Stop**: it stops after finishing what it's doing.

What you see in the panel:
- **Bot: running**: the robot is on.
- **Phone: reachable**: the Mac can reach your iPhone.
- **The numbers**: how many giveaways it entered, how many were already entered, how many were
  skipped, and how many 🏆 wins.
- **Log**: what it's doing right now. Green = entered, gold = win, orange = a problem.

It's normal for it to be quiet for a while: it only does something when a new 🎁 message
arrives in Bark.

**Note:** while the robot is running, it uses your iPhone's screen. It switches between Bark and
Whatnot by itself, so you can't really use your phone at the same time. Press **Stop** if you
need your phone.

### Something isn't working: what to do
Work through this list from top to bottom:

**The panel won't load on my phone**
- Is **Tailscale** on, on your phone? (Tailscale app → "Connected")
- Is the **Mac** on and awake?
- Check on the Mac: `cd ~/Dev/wn-bot && ./bg.sh status`. Panel not running? Run `./bg.sh start`.

**The panel says "Phone: not reachable"**
- On the Mac, with your iPhone **unlocked**: `cd ~/Dev/wn-bot && ./bg.sh restart`
- Are you **away from home**? Then it doesn't work yet (see "Away from home" below).

**The log says "Not authorized for performing UI testing action"**
- The connection to the iPhone got "stuck". Fix:
  1. Restart your **iPhone** and unlock it.
  2. On the Mac: `cd ~/Dev/wn-bot && ./bg.sh restart`
  3. In the panel: **Stop**, then **Start**.

**It doesn't enter anything**
- Is there a **new** 🎁 message in Bark? Old messages are skipped on purpose.
- Look at the log: "skipped" means the giveaway was already over or didn't load in time.
  That happens sometimes.

**Still stuck?** Restart everything, in this order:
1. On the Mac: `cd ~/Dev/wn-bot && ./bg.sh stop`
2. Restart the iPhone and unlock it (preferably plugged into the Mac).
3. On the Mac: `./bg.sh start` and wait for "WebDriverAgent is running".
4. In the panel on your phone: **Start**.

### Once a week: renewing the "permission slip"
The robot runs on the iPhone with a kind of permission slip from Apple. With a free Apple
account, that slip is only valid for **7 days**. If it suddenly stops working after a week and
restarting doesn't help:
1. Plug your iPhone into the Mac.
2. Open **Xcode**, then **WebDriverAgent** (in the `WebDriverAgent` folder in your home folder).
3. At the top, choose **WebDriverAgentRunner** and your iPhone, then press **Cmd+U**.
4. Once it's running, press the **stop button ■** in Xcode, then in Terminal:
   `cd ~/Dev/wn-bot && ./bg.sh stop && FORCE_BUILD=1 ./bg.sh start`
   (`FORCE_BUILD=1` makes it build fresh with the new signature).

You **don't** need to reinstall anything for normal use. Starting reuses the existing build.

(With a paid Apple Developer account, $99/year, the slip lasts a full year.)

### Away from home
For now it only works while your iPhone is on your **home Wi-Fi**. As soon as you leave home,
the Mac loses its connection to the iPhone and the robot stops. When you get home, it starts
again by itself (as long as `./bg.sh` is running on the Mac). A fix for "away from home" is
being tested with **RoamRun** (see `MAC-WORKAROUNDS.md`).

### Important rules
- Run the robot on **one** computer only (the Mac). Never on the Windows PC at the same time.
- Never share `passcode.txt` and never put it on GitHub. It contains your iPhone passcode.
- The robot unlocks your phone itself with that passcode. If you change your passcode, also
  update it on the Mac:
  ```
  cd ~/Dev/wn-bot && printf '%s' 'NEW CODE' > passcode.txt
  ```

---

# Technical documentation

Control an iPhone from Windows or macOS through [WebDriverAgent](https://github.com/appium/WebDriverAgent) (WDA). It gives you:
- a live remote-control web UI (click to tap, drag to swipe, type, Home/Lock/Volume buttons);
- a small JS automation client (`wda.js`).

No npm dependencies; you only need Node 18+.

## 1. One-time setup on the Mac (build & sign WDA)
1. On the iPhone: **Settings > Privacy & Security > Developer Mode** → On (the phone reboots).
2. Get the source: `git clone https://github.com/appium/WebDriverAgent ~/WebDriverAgent` and open `WebDriverAgent.xcodeproj`.
3. Sign in with your Apple ID: **Xcode > Settings > Accounts**.
4. For the targets **WebDriverAgentLib** and **WebDriverAgentRunner**, in Signing & Capabilities:
   - pick your Team;
   - set a unique bundle ID, e.g. `com.pepijn.WebDriverAgentRunner`.
5. Plug in the iPhone, select it as the destination, and run **Product > Test** on the `WebDriverAgentRunner` scheme.
6. On the phone, trust the certificate: **Settings > General > VPN & Device Management**. Then run Test again.
7. Check the Xcode log for `ServerURLHere->http://<phone-ip>:8100<-`. If it's there, WDA is installed.
8. Optional, for no cable: in **Xcode > Window > Devices and Simulators**, select the phone and tick **Connect via network**.

The free Apple ID signature expires after **7 days**; when it does, repeat step 5. A paid developer account lasts 1 year.

## Giveaway bot + control panel (from anywhere via Tailscale)
- **Panel:** `Giveaway Panel.bat` on the PC, then open **http://100.104.187.83:3100** on your phone.
  It has Start/Stop, shows the status (bot, phone, locked) and the log.
  It only listens on localhost and the Tailscale address; a firewall rule
  "Giveaway Panel (Tailscale only)" allows port 3100 on the Tailscale network only.
- **Bot:** `giveaway-bot.js` (or `Giveaway Bot.bat`). It tries home Wi-Fi (`phone-ip.txt`)
  first, then Tailscale (`tailscale-ip.txt`).
- **WebDriverAgent:** has to be running. When the phone leaves home, the Xcode test on the Mac
  stops. On the Mac, `./wda-keepalive.sh` restarts it automatically as soon as the phone is
  reachable again.

### Running everything on the Mac (always on)
1. In the repo folder, create the files that are deliberately not in git:
   ```
   echo YOUR_PASSCODE > passcode.txt   # your iPhone passcode (never commit this)
   echo 192.168.2.161 > phone-ip.txt   # iPhone on home Wi-Fi
   echo 100.91.246.93 > tailscale-ip.txt
   ```
2. `brew install node`, then `chmod +x *.sh *.command && ./install-panel-mac.sh`.
   The panel runs in a Terminal window ("Start Panel.command") that opens at login and restarts
   the panel if it crashes. It deliberately doesn't use a hidden launchd service: macOS
   Local Network privacy blocks those from reaching the iPhone/Tailscale.
3. On your phone, open `http://<Mac Tailscale IP>:3100` in Safari, then
   Share → **Add to Home Screen** to get an app icon.
4. Run only one bot at a time. Don't also run it on the Windows PC.

### Starting by hand on the Mac (if the panel isn't running)
Is the panel running? On the Mac:
```
curl -s http://127.0.0.1:3100/api/status | head -c 100
```
No response means it isn't running. Start it one of these ways:
- **Double-click** `Start Panel.command` in Finder (`~/Dev/wn-bot`). A Terminal window titled
  "Giveaway Panel" opens; leave it open.
- **Or in Terminal:**
  ```
  cd ~/Dev/wn-bot
  ./"Start Panel.command"      # keeps restarting the panel; Ctrl+C to stop
  ```
- **Or just the panel once** (no auto-restart): `cd ~/Dev/wn-bot && node panel.js`

The bot itself is started from the panel (Start on your phone). To run it by hand without the
panel, e.g. to see errors directly:
```
cd ~/Dev/wn-bot
WDA_URL=http://192.168.2.161:8100,http://100.91.246.93:8100 node giveaway-bot.js
```
Ctrl+C stops it after the current step (press twice to stop immediately).

Panel opens but the phone isn't reachable? WebDriverAgent isn't running. Check with
`curl -s http://192.168.2.161:8100/status`, and start it with
`WDA_DIR=~/WebDriverAgent ./wda-keepalive.sh` (in its own Terminal window).

Stuck? Look at `panel-out.txt`, `bot-out.txt` and `giveaway-log.txt` in the repo folder.

### Keeping it running without an open Terminal window (tmux) — test first
**Why not a normal background service?** macOS (15+) blocks launchd services from reaching
devices on your network (Local Network privacy). The panel then gives "server stopped responding".

**What works around it:** tmux, a program that keeps a Terminal session running in the
background after you close the window. Because you start it *from* Terminal, it should keep
Terminal's network permission. This hasn't been tested on this Mac yet.

```
brew install tmux                # once
cd ~/Dev/wn-bot
./panel-bg.sh start              # start in the background, then you can close Terminal
./panel-bg.sh status             # is it running?
./panel-bg.sh attach             # look at the console (back out with Ctrl+B, then D)
./panel-bg.sh stop               # stop panel + bot
```

**Testing it:**
1. Close the "Giveaway Panel" window if it's open.
2. Run `./panel-bg.sh start`, then quit Terminal completely (Cmd+Q).
3. Open the panel on your phone and press Start. If the bot shows "Connected via …", it works.
4. Doesn't work (panel doesn't load or the phone isn't reachable)? Then go back to the Terminal
   window: `./panel-bg.sh stop` and double-click `Start Panel.command`.

**After a Mac restart** tmux doesn't start by itself. The Login Item from `install-panel-mac.sh`
then opens the Terminal window again. If you'd rather use tmux, remove that Login Item
(`./install-panel-mac.sh uninstall`) and run `./panel-bg.sh start` once after each restart.
Use only one of the two at a time: both want port 3100.

## Quick start (double-click)
- **Start iPhone (USB).bat**: on Windows with the phone plugged in. Starts WDA and the UI and opens the browser. If your bundle ID is different, edit the one at the top of the file.
- **Start iPhone (Wi-Fi).bat**: on Windows when WDA is already running on the phone. It asks for the phone's IP the first time and remembers it in `phone-ip.txt`.
- **Run Script.bat**: drag an automation `.js` file onto it to run that script.
- **Start iPhone.command**: on the Mac, double-click it in Finder. The first time, run `chmod +x "Start iPhone.command"` so macOS will run it.

## 2a. Run from the Mac (the phone doesn't need to be on the Windows PC)
```bash
cd iphone-control
chmod +x start-iphone.sh
WDA_DIR=~/WebDriverAgent ./start-iphone.sh
```
The script launches WDA with `xcodebuild`, works over USB or Wi-Fi, starts the UI and opens http://localhost:3000.

## 2b. Run from Windows (phone on USB)
```powershell
cd E:\dev\iphone-control
.\start-iphone.ps1 -BundleId com.pepijn.WebDriverAgentRunner.xctrunner
node server.js        # then open http://localhost:3000
```
This uses [go-ios](https://github.com/danielpaulus/go-ios): it starts the tunnel, mounts the developer image, launches WDA and forwards ports 8100 and 9100.

## 2c. Control from any machine over Wi-Fi
While WDA is running, started from either machine, it listens on the phone's own IP. Any computer on the same network can then run the UI:
```powershell
$env:WDA_URL="http://<phone-ip>:8100"; node server.js
```
```bash
WDA_URL=http://<phone-ip>:8100 node server.js
```

## Automation
```js
const wda = require('./wda');
await wda.launchApp('com.apple.Preferences');
await wda.click(await wda.find('accessibility id', 'General'));
await wda.swipe(200, 600, 200, 200);
await wda.type('hello');
```
Try it with `node example.js`.

If you want full Appium later, install Appium with the XCUITest driver on the Mac. It reuses the same WDA.

## Troubleshooting
- **`ios tunnel` fails on Windows:** install or update the **Apple Devices** app (or iTunes). Or run the tunnel from an admin terminal without `--userspace`.
- **Laggy stream:** pick a lower quality in the UI.
- **WDA stopped after an iOS update or after 7 days:** re-run Test from Xcode on the Mac.
