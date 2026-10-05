// Remote-control web UI for an iPhone running WebDriverAgent.
// Usage: node server.js   then open http://localhost:3000
// Env: WDA_URL (default http://localhost:8100), MJPEG_URL (default: WDA host on port 9100), PORT (default 3000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const wda = require('./wda');

const PORT = Number(process.env.PORT || 3000);
const MJPEG_URL = process.env.MJPEG_URL || wda.WDA_URL.replace(/:\d+$/, ':9100');

// Auto-unlock: before an action, unlock with the passcode if the phone is locked.
// The lock state is re-checked at most every 3s so taps stay fast; concurrent callers share one unlock.
let lastUnlockedCheck = 0;
let unlocking = null;
async function ensureUnlocked() {
  if (Date.now() - lastUnlockedCheck < 3000) return;
  if (!unlocking) {
    unlocking = (async () => {
      if (await wda.isLocked()) console.log('Phone locked -> ' + await wda.unlockWithPasscode());
      lastUnlockedCheck = Date.now();
    })().finally(() => { unlocking = null; });
  }
  return unlocking;
}
const unlocked = (fn) => async (args) => { await ensureUnlocked(); return fn(args); };

const api = {
  config: async () => ({ mjpegUrl: MJPEG_URL, wdaUrl: wda.WDA_URL }),
  size: () => wda.windowSize(),
  tap: unlocked(({ x, y }) => wda.tap(x, y)),
  swipe: unlocked(({ x1, y1, x2, y2, ms }) => wda.swipe(x1, y1, x2, y2, ms)),
  keys: unlocked(({ text }) => wda.type(text)),
  home: unlocked(() => wda.home()),
  lock: async () => { lastUnlockedCheck = 0; return wda.lock(); },
  unlock: async () => { lastUnlockedCheck = 0; return wda.unlockWithPasscode(); },
  button: ({ name }) => wda.pressButton(name),
  quality: ({ scale, fps }) => wda.settings({ mjpegScalingFactor: scale, mjpegServerFramerate: fps }),
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const fn = api[url.pathname.slice(5)];
    if (!fn) return res.writeHead(404).end();
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const out = await fn(body ? JSON.parse(body) : {});
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out ?? null));
    } catch (e) {
      console.error(e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, html) => {
    if (err) return res.writeHead(500).end(String(err));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
}).listen(PORT, '127.0.0.1', () => { // localhost only: this server can unlock the phone
  console.log(`iPhone control UI: http://localhost:${PORT}`);
  console.log(`WDA: ${wda.WDA_URL}   stream: ${MJPEG_URL}`);
});
