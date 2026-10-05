# iphone-control

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
2. `brew install node`, then `chmod +x *.sh && ./install-panel-mac.sh`.
   The panel now starts automatically at login and restarts itself if it crashes.
3. On your phone, open `http://<Mac Tailscale IP>:3100` in Safari, then
   Share → **Add to Home Screen** to get an app icon.
4. Run only one bot at a time. Don't also run it on the Windows PC.

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
