# Keeping WebDriverAgent running (Mac → iPhone → Windows)

Keep this as it is:

* The Mac stays on and awake. If the Mac goes to sleep, the test stops. In a terminal on the Mac, `caffeinate -d` keeps it awake while it runs.
* Xcode stays open and the test keeps running. Don't press Stop.
* The connection between the iPhone and the Mac stays up. Leave the cable in. To unplug it, first tick "Connect via network" (Step 6), then press Cmd+U once more while both devices are on Wi-Fi.
* The iPhone doesn't lock. Set Settings → Display & Brightness → Auto-Lock → Never. A locked iPhone can make commands fail.

From the Windows PC:

* Make sure the PC is on the same network.
* To check, open `http://192.168.2.161:8100/status` in a browser. If you see `"ready" : true`, it works.
* In Appium on Windows, use `appium:webDriverAgentUrl: "http://192.168.2.161:8100"` and `appium:usePrebuiltWDA: true`.
* Appium on Windows can't install apps on the iPhone or build WebDriverAgent itself. It can only use the copy that's already running on the iPhone.
