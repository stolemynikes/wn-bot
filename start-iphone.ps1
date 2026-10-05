# Windows: start WebDriverAgent on a USB-connected iPhone (iOS 17+) via go-ios and forward ports.
# Prereq: WDA already built & installed on the phone from the Mac (see README).
# Usage:  .\start-iphone.ps1 -BundleId com.pepijn.WebDriverAgentRunner.xctrunner
param(
  [string]$BundleId = $(if ($env:WDA_BUNDLE_ID) { $env:WDA_BUNDLE_ID } else { "com.pepijn.WebDriverAgentRunner.xctrunner" })
)

if (-not (Get-Command ios -ErrorAction SilentlyContinue)) { npm install -g go-ios }

Write-Host "Starting tunnel (userspace)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "ios tunnel start --userspace"
Start-Sleep -Seconds 5

Write-Host "Mounting developer disk image..."
ios image auto

$installed = ios apps --list 2>$null | Select-String -SimpleMatch $BundleId
if (-not $installed) {
  Write-Host ""
  Write-Host "WebDriverAgent ($BundleId) is NOT installed on the phone." -ForegroundColor Red
  Write-Host "Build it once from Xcode on the Mac (see README step 1), then run this again."
  $wda = ios apps --list 2>$null | Select-String 'xctrunner'
  if ($wda) { Write-Host "Found a different WDA bundle ID on the phone - set it in the .bat file:`n$wda" -ForegroundColor Yellow }
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "Launching WebDriverAgent ($BundleId)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "ios runwda --bundleid=$BundleId --testrunnerbundleid=$BundleId --xctestconfig=WebDriverAgentRunner.xctest"
Start-Sleep -Seconds 8

Write-Host "Forwarding ports 8100 (API) and 9100 (stream)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "ios forward 8100 8100"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "ios forward 9100 9100"
Start-Sleep -Seconds 2

try {
  $s = Invoke-RestMethod http://localhost:8100/status -TimeoutSec 10
  Write-Host "WDA ready: $($s.value.ready)  (phone IP: $($s.value.ios.ip))" -ForegroundColor Green
  Write-Host "Now run:  node server.js   and open http://localhost:3000"
} catch {
  Write-Host "WDA not reachable yet - check the runwda window for errors." -ForegroundColor Yellow
}
