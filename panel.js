// Control panel for the giveaway bot: start/stop it and see its status from anywhere via Tailscale.
// Usage: node panel.js   then open http://<this PC's Tailscale IP>:3100 on your phone.
// Only listens on localhost and this PC's Tailscale address(es), so it's not reachable from the
// local network or the internet - only from your own Tailscale devices.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const PORT = Number(process.env.PANEL_PORT || 3100);
const DIR = __dirname;
const LOG_FILE = path.join(DIR, 'giveaway-log.txt');
const LOCK_FILE = path.join(DIR, 'giveaway-bot.pid');

const readFirstLine = (f) => { try { return fs.readFileSync(path.join(DIR, f), 'utf8').trim().split(/\r?\n/)[0]; } catch { return ''; } };
const WDA_URLS = [readFirstLine('phone-ip.txt'), readFirstLine('tailscale-ip.txt')]
  .filter(Boolean).map((ip) => `http://${ip}:8100`);

// ---- bot process ------------------------------------------------------------
let child = null;      // bot started by this panel
let startedAt = null;

function lockedPid() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (pid) { process.kill(pid, 0); return pid; }
  } catch {}
  return null;
}

function startBot() {
  if (child || lockedPid()) return 'already running';
  child = fork(path.join(DIR, 'giveaway-bot.js'), [], {
    cwd: DIR,
    env: { ...process.env, WDA_URL: WDA_URLS.join(','), MATCH: process.env.MATCH || 'Giveaway' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], // the bot writes its own log file
  });
  startedAt = Date.now();
  child.on('exit', () => { child = null; startedAt = null; });
  return 'started';
}

function stopBot() {
  if (child) { child.send('stop'); return 'stopping (finishes the current step first)'; }
  const pid = lockedPid();
  if (pid) { process.kill(pid); return 'stopped (it was started outside the panel)'; }
  return 'not running';
}

// ---- status ---------------------------------------------------------------------
async function phoneStatus() {
  for (const url of WDA_URLS) {
    try {
      const s = await fetch(url + '/status', { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
      if (!s.value?.ready) continue;
      const locked = await fetch(url + '/wda/locked', { signal: AbortSignal.timeout(4000) })
        .then((r) => r.json()).then((j) => j.value).catch(() => null);
      return { reachable: true, via: url.includes('//100.') ? 'Tailscale' : 'home Wi-Fi', url, locked };
    } catch {}
  }
  return { reachable: false };
}

function logTail() {
  let lines = [];
  try { lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
  // Stats since the last bot start.
  const lastStart = lines.map((l) => l.includes('Giveaway bot started')).lastIndexOf(true);
  const run = lastStart >= 0 ? lines.slice(lastStart) : [];
  const count = (re) => run.filter((l) => re.test(l)).length;
  return {
    lines: lines.slice(-60),
    stats: { entered: count(/ENTERED/), already: count(/already entered/), skipped: count(/\b(skipped|unconfirmed):/), wins: count(/WIN:/) },
  };
}

async function status() {
  const pid = child?.pid || lockedPid();
  return {
    bot: { running: !!pid, pid, byPanel: !!child, since: startedAt },
    phone: await phoneStatus(),
    ...logTail(),
  };
}

// ---- http ----------------------------------------------------------------------
const page = fs.readFileSync(path.join(DIR, 'public', 'panel.html'));

async function handler(req, res) {
  const send = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
  try {
    if (req.method === 'GET' && req.url === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    if (req.method === 'GET' && req.url === '/api/status') return send(200, await status());
    if (req.method === 'POST' && req.url === '/api/start') return send(200, { result: startBot() });
    if (req.method === 'POST' && req.url === '/api/stop') return send(200, { result: stopBot() });
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: e.message });
  }
}

// Listen on localhost + every Tailscale address (100.64.0.0/10) of this machine.
const isTailscale = (ip) => { const [a, b] = ip.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
const addrs = ['127.0.0.1', ...Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && isTailscale(i.address)).map((i) => i.address)];

for (const host of addrs) {
  http.createServer(handler).listen(PORT, host, () => console.log(`Giveaway panel: http://${host}:${PORT}`));
}
if (addrs.length === 1) console.log('Note: no Tailscale address found on this PC - panel only reachable locally.');
console.log(`Phone addresses: ${WDA_URLS.join(', ') || '(none - add phone-ip.txt / tailscale-ip.txt)'}`);
