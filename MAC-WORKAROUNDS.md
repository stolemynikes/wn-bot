# Keep WebDriverAgent running when the iPhone is away from home (over Tailscale)

## Context (for Claude on the Mac)
- iPhone 14 Pro Max (UDID `00008120-001818A92683C01E`), iOS 26.6.2, Developer Mode on.
  It's already paired with this Mac.
- WebDriverAgent (appium/WebDriverAgent, in `~/WebDriverAgent`) is started from this Mac with
  `xcodebuild … test`. A giveaway bot on a Windows PC controls the phone through WDA on port 8100.
- Tailscale is on all three devices:
  - iPhone `100.91.246.93`
  - Mac `pepijns-macbook-pro` `100.105.229.26`
  - Windows PC `100.104.187.83`
- **Problem:** as soon as the iPhone leaves the home network, WDA stops. The phone still answers
  over Tailscale, but port 8100 refuses the connection.
  - Cause: since iOS 17, WDA only keeps running while the Mac keeps its CoreDevice / testmanagerd
    connection to the phone.
  - CoreDevice finds the phone through Bonjour/mDNS (`_remotepairing._tcp`), and that multicast
    traffic doesn't cross Tailscale.
- **Goal:** keep WDA running (or have it restart on its own) when the iPhone is on another
  network, through Tailscale.

## Option A (recommended): RoamRun
https://github.com/mh-mobile/RoamRun
- A menu-bar app plus CLI. It re-publishes the iPhone's Bonjour record (`_remotepairing._tcp`)
  pointing at the Mac itself, and relays the traffic over Tailscale. Pairing and encryption stay
  end-to-end, as Apple designed it.
- According to the README it supports **XCUITest (`xcodebuild test -destination id=<udid>`) and
  WebDriverAgent (verified, but slower than local Wi-Fi)**.
- Requirements: macOS 13+ on **Apple Silicon** (not Intel), Xcode 15+, iOS 17.4+, Tailscale on
  both, phone paired once, Developer Mode on.
- Install: `brew install --cask mh-mobile/tap/roamrun`
- Useful CLI:
  - `roamrun devices`
  - `roamrun up <name> -d` (in the background)
  - `roamrun status <name>`
  - `roamrun doctor`
- Caveats from the README:
  - The bridge has to be **set up while the iPhone is on Wi-Fi** (any Wi-Fi network, not
    necessarily home). Under Settings › Network, "Keep debugging on cellular" keeps an existing
    session going on mobile data. A *new* session needs Wi-Fi again.
  - Expect about 2+ s per tap over slow links; it's faster with a direct Tailscale connection
    than through a DERP relay.
  - Tailscale on iOS can pause when the phone sleeps, so keep the screen on/unlocked.
  - After the iPhone restarts, it may need one USB connection to re-mount the developer disk image.
  - It relies on Apple's private CoreDevice protocols, so a future iOS/Xcode update can break it.

## Option B: iPhone Tailnet Bridge (same idea, open source)
https://github.com/ahmadtawakol/iphone-tailnet-bridge
(fork with socat: https://github.com/Viaaaron/iphone-tailnet-bridge)
- Captures the real CoreDevice Bonjour records while the phone is at home, re-publishes them on the
  Mac once the phone is remote, and relays TCP/UDP over the tailnet.
- Install:
  - `git clone https://github.com/ahmadtawakol/iphone-tailnet-bridge.git`
  - `cd iphone-tailnet-bridge`
  - `bash scripts/install.sh`
  - Then choose "Add iPhone" **while the phone is still on home Wi-Fi**.
- The README doesn't explicitly say whether `xcodebuild test` / UI tests work; it only mentions
  `devicectl`.

## Option C: pymobiledevice3 tunnel by address (experimental)
https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/ios17-tunnels.md
- `pymobiledevice3 remote start-tunnel` / `lockdown start-tunnel` creates the iOS 17+ tunnel, and
  commands accept `--rsd HOST PORT` or `--tunnel UDID@HOST`.
- Wi-Fi discovery normally uses Bonjour too. Whether a tunnel can be set up *directly to the
  Tailscale IP* is unclear. It would also need WDA to be started through that tunnel (e.g.
  `pymobiledevice3 developer dvt xcuitest <bundle-id>` or go-ios `ios runwda`) instead of
  through Xcode.

## Suggested test plan
1. Install RoamRun (option A) and add the iPhone while it's on home Wi-Fi.
2. Start WDA through the bridge, the way we already do or with the keep-alive script:
   ```
   WDA_DIR=~/WebDriverAgent ./wda-keepalive.sh 00008120-001818A92683C01E
   ```
   (`wda-keepalive.sh` is in the iphone-control folder; it builds once, then keeps running
   `test-without-building` and restarts WDA when it stops.)
3. Check from the Windows PC: `http://100.91.246.93:8100/status` should give `"ready": true`.
4. Switch the iPhone to another Wi-Fi network (e.g. a hotspot) with Tailscale on, and check whether
   `/status` keeps answering. Then test mobile data with "Keep debugging on cellular".
5. Report: does WDA keep running? How fast is a tap? Does it come back by itself after a dropout?

## Sources
- RoamRun: https://github.com/mh-mobile/RoamRun
- iPhone Tailnet Bridge: https://github.com/ahmadtawakol/iphone-tailnet-bridge
- pymobiledevice3 iOS 17 tunnels: https://github.com/doronz88/pymobiledevice3/blob/master/docs/guides/ios17-tunnels.md
- WDA on iOS 17 needs the Mac connected (USB or network): https://discuss.appium.io/t/unable-to-launch-ios-webdriver-agent-manually-on-ios-17-x-devices/41492
