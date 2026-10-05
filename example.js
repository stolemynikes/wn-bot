// Example automation: open Settings, tap "General", go back home.
// Run: node example.js   (WDA must be running; set WDA_URL if not on localhost)
const wda = require('./wda');

(async () => {
  console.log('WDA status:', (await wda.status()).ready ? 'ready' : 'not ready');
  await wda.launchApp('com.apple.Preferences');
  await wda.sleep(1500);
  const general = await wda.find('accessibility id', 'General');
  await wda.click(general);
  console.log('Opened Settings > General');
  await wda.sleep(1500);
  require('fs').writeFileSync('screenshot.png', await wda.screenshot());
  console.log('Saved screenshot.png');
  await wda.home();
})().catch(e => { console.error(e.message); process.exit(1); });
