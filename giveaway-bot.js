// Whatnot giveaway bot.
// Keeps watching Bark's Message History for new giveaway messages and, for each one in order:
//   open the Whatnot link -> wait for the Giveaway tile -> tap it -> press "Enter Giveaway".
//
// Usage:   node giveaway-bot.js            (Ctrl+C to stop)
// Options (env vars):
//   MATCH=Giveaway        only enter "🎁 ..." messages whose first line contains this text
//   DRY_RUN=1             just show how the current Bark messages are classified, then exit
//   TILE_TIMEOUT=60       seconds to wait for the Giveaway tile before skipping
//   POLL=3                seconds between Bark checks when idle
//   BACKLOG=1             on first run, also handle the messages already in Bark (default: skip them)

const fs = require('fs');
const path = require('path');
const wda = require('./wda');

const BARK = 'me.fin.bark';
const MATCH = (process.env.MATCH || 'Giveaway').toLowerCase();
const TILE_TIMEOUT = Number(process.env.TILE_TIMEOUT || 60) * 1000;
const POLL = Number(process.env.POLL || 3) * 1000;
const SEEN_FILE = path.join(__dirname, 'giveaway-seen.json');
const LOG_FILE = path.join(__dirname, 'giveaway-log.txt');

// Whatnot elements (found with dump.js)
const TILE = "type == 'XCUIElementTypeStaticText' AND name == 'Giveaway'";      // the "Giveaway / N Entries" tile
const GIFT_ICON = "type == 'XCUIElementTypeImage' AND name == 'giveaway'";      // gift icon = not entered yet
const CHECK_ICON = "type == 'XCUIElementTypeImage' AND name == 'check-circle'"; // checkmark = entered
const ENTER_BUTTON = "type == 'XCUIElementTypeButton' AND name == 'Enter Giveaway'";

// Random pause between min and max seconds, so timings aren't identical every time.
// HUMAN=0 turns the pauses off.
const HUMAN = process.env.HUMAN !== '0';
const pause = (min, max) => HUMAN ? wda.sleep((min + Math.random() * (max - min)) * 1000) : Promise.resolve();

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ---- remembered messages -------------------------------------------------
let seen = new Set();
const firstRun = !fs.existsSync(SEEN_FILE);
if (!firstRun) seen = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')));
function markSeen(key) {
  seen.add(key);
  const list = [...seen].slice(-2000);
  seen = new Set(list);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(list));
}

// ---- Bark ----------------------------------------------------------------
const decode = (s) => s
  .replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Message kinds, decided by the first line:
//   "🎁 Giveaway — host 🎁"  + /live/ link  -> 'giveaway' (enter it)
//   "🏆 You won — host! 🏆"                 -> 'win' (log only, never enter)
//   anything else ("⚠️ Watcher can't reach Chrome", "⚠️ Watcher may be blind",
//   "🔄 Watcher auto-restarted", ...)       -> 'ignore'
function classify(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  const url = (text.match(/https:\/\/www\.whatnot\.com\/\S+/) || [])[0] || '';
  let kind = 'ignore';
  if (first.includes('🏆') || /you won/i.test(first)) kind = 'win';
  else if (first.startsWith('🎁') && first.toLowerCase().includes(MATCH) && url.includes('/live/')) kind = 'giveaway';
  return { kind, title: `${first} ${(lines[1] || '').match(/#\d+/) || ''}`.trim(), url };
}
if (process.env.TEST_CLASSIFY) { module.exports = { classify }; return; }

// Returns Bark messages from the history, oldest first: { key, kind, title, url }
async function readBark() {
  await wda.activateApp(BARK);
  const historyTab = await wda.tryFind('predicate string', "type == 'XCUIElementTypeButton' AND name == 'Message History'");
  if (historyTab) await wda.click(historyTab);
  const src = await wda.source();
  const app = (src.match(/XCUIElementTypeApplication[^>]*? name="([^"]*)"/) || [])[1];
  if (app !== 'Bark') throw new Error(`expected to read Bark but got "${app}"`);
  const messages = [];
  for (const m of src.matchAll(/<XCUIElementTypeOther[^>]*? name="([^"]*whatnot\.com[^"]*)"/g)) {
    const text = decode(m[1]);
    messages.push({ key: text, ...classify(text) });
  }
  // Bark lists newest first; also drop duplicates of the same message.
  const unique = [...new Map(messages.map((m) => [m.key, m])).values()];
  return unique.reverse();
}

// Save a screenshot + the elements around the Giveaway tile, to see why a giveaway was skipped.
async function saveDebug(msg) {
  const dir = path.join(__dirname, 'debug');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, new Date().toISOString().replace(/[:.]/g, '-'));
  try {
    fs.writeFileSync(base + '.png', await wda.screenshot());
    const src = await wda.source();
    const tileLines = src.split('\n').filter((l) => /x="3[3-9]\d"|x="4[01]\d"/.test(l) && /y="(1[5-9]\d|2[0-5]\d)"/.test(l));
    fs.writeFileSync(base + '.txt', `${msg.title}\n${msg.url}\n\n${tileLines.map((l) => l.trim()).join('\n')}\n`);
  } catch (e) {
    fs.writeFileSync(base + '.txt', `${msg.title}\n${msg.url}\nerror saving debug: ${e.message}\n`);
  }
  return path.relative(__dirname, base) + '.png';
}

// ---- Whatnot -------------------------------------------------------------
// Whatnot stays open between giveaways. Its floating mini-player over Bark doesn't matter:
// the session is tied to Bark (so Bark's screen is read) and links are opened directly.
async function enterGiveaway(msg, attempt = 1) {
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  await wda.openUrl(msg.url);

  // Wait for the tile; things can be in the way for a while. On a retry the giveaway may
  // already be over (the tile disappears then), so don't wait as long.
  const timeout = attempt > 1 ? Math.min(TILE_TIMEOUT, 15000) : TILE_TIMEOUT;
  const tile = await wda.waitFor('predicate string', TILE, { timeout, interval: 700 });
  if (!tile) return `skipped: no Giveaway tile after ${timeout / 1000}s${attempt > 1 ? ' (giveaway probably ended)' : ''}`;

  // The tile's icon can load a moment after the tile itself: gift = enter, checkmark = done.
  let gift = null;
  for (let i = 0; i < 3 && !gift; i++) {
    gift = await wda.tryFind('predicate string', GIFT_ICON);
    if (gift) break;
    if (await wda.tryFind('predicate string', CHECK_ICON)) return `already entered (checkmark) ${secs()}`;
    await wda.sleep(500);
  }
  await pause(0.4, 1.5);
  if (gift) {
    await wda.click(gift);
  } else {
    // On busy streams the small icon often can't be found in time, but the tile's "Giveaway"
    // text can: tapping the tile there opens the same Enter Giveaway panel.
    const text = await wda.tryFind('predicate string', TILE);
    if (!text) return `skipped: Giveaway tile disappeared ${secs()}`;
    const r = await wda.rect(text);
    await wda.tap(r.x + r.width / 2, r.y + r.height / 2);
  }

  const enter = await wda.waitFor('predicate string', ENTER_BUTTON, { timeout: 8000, interval: 400 });
  if (!enter) {
    if (await wda.tryFind('predicate string', CHECK_ICON)) return `already entered (checkmark) ${secs()}`;
    const file = await saveDebug(msg);
    return `skipped: "Enter Giveaway" button did not appear ${secs()} (saved ${file})`;
  }
  await pause(0.3, 1.2);
  await wda.click(enter);

  // Confirm: the gift icon turns into a checkmark once entered.
  const check = await wda.waitFor('predicate string', CHECK_ICON, { timeout: 6000, interval: 400 });
  if (check) return `ENTERED ${secs()}`;
  const file = await saveDebug(msg);
  // "unconfirmed" counts as failed, so it's retried: the retry sees the checkmark if it did work.
  return `unconfirmed: pressed Enter Giveaway, but no checkmark ${secs()} (saved ${file})`;
}

// ---- main loop -----------------------------------------------------------
const MAX_ATTEMPTS = 2;
const attempts = new Map(); // message key -> tries so far
let errorStreak = 0;        // consecutive failed rounds
let stopping = false;
function requestStop(how) {
  if (stopping) process.exit(0);
  stopping = true;
  log(`Stopping after the current step... (${how})`);
}
process.on('SIGINT', () => requestStop('Ctrl+C again to quit now'));
// The control panel (panel.js) starts the bot as a child process and stops it with a message.
process.on('message', (m) => { if (m === 'stop') requestStop('requested from control panel'); });

// Only one bot at a time: two would fight over the phone.
const LOCK_FILE = path.join(__dirname, 'giveaway-bot.pid');
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (pid && pid !== process.pid) { process.kill(pid, 0); return false; } // throws if not running
  } catch {}
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on('exit', () => { try { if (fs.readFileSync(LOCK_FILE, 'utf8') == process.pid) fs.unlinkSync(LOCK_FILE); } catch {} });
  return true;
}

// Connect to the phone; keeps retrying (e.g. WebDriverAgent not running yet) until it works or we stop.
async function connect() {
  for (let i = 0; !stopping; i++) {
    try {
      const via = await wda.pickUrl();
      // Session tied to Bark: reads Bark while it's in front, and whatever app is in front otherwise.
      // (Opening Bark needs the phone unlocked.)
      await wda.unlockWithPasscode();
      await wda.useApp(BARK);
      // Live video never goes idle; don't let WDA wait for that before each command.
      // Also throttle the screen stream (only used by the control page) so it doesn't slow the phone.
      await wda.settings({ waitForIdleTimeout: 0, animationCoolOffTimeout: 0, mjpegServerFramerate: 2, mjpegScalingFactor: 25 });
      log(`Connected via ${via}`);
      return true;
    } catch (e) {
      if (i % 6 === 0) log(`Can't reach the phone yet: ${e.message.slice(0, 120)} (retrying every 10s)`);
      await wda.sleep(10000);
    }
  }
  return false;
}

(async () => {
  if (!process.env.DRY_RUN && !takeLock()) {
    log('Another giveaway bot is already running - not starting a second one.');
    process.exit(1);
  }
  log(`Giveaway bot started. WDA addresses: ${wda.WDA_URLS.join(', ')}  match: "${MATCH}"`);
  if (!(await connect())) { log('Stopped.'); process.exit(0); }

  if (process.env.DRY_RUN) {
    for (const m of await readBark()) log(`[${m.kind}] ${m.title}  ${m.url.slice(0, 60)}`);
    return;
  }

  if (firstRun && !process.env.BACKLOG) {
    await wda.unlockWithPasscode();
    const existing = await readBark();
    existing.forEach((m) => markSeen(m.key));
    log(`First run: ${existing.length} existing Bark messages marked as done (set BACKLOG=1 to handle them).`);
  }

  while (!stopping) {
    try {
      const unlocked = await wda.unlockWithPasscode();
      if (unlocked !== 'already unlocked') log(`Phone was locked -> ${unlocked}`);
      await wda.ensureApp();
      await wda.settings({ waitForIdleTimeout: 0, animationCoolOffTimeout: 0 });
      if (errorStreak) { log(`Phone reachable again (via ${wda.WDA_URL}).`); errorStreak = 0; }

      const todo = (await readBark()).filter((m) => !seen.has(m.key));
      if (todo.length) log(`${todo.length} new message(s)`);
      for (const msg of todo) {
        if (stopping) break;
        if (msg.kind === 'win') {
          log(`🏆 WIN: ${msg.title}  ${msg.url}`);
          markSeen(msg.key);
          continue;
        }
        if (msg.kind === 'ignore') {
          log(`   (ignored: ${msg.title})`);
          markSeen(msg.key);
          continue;
        }
        const attempt = (attempts.get(msg.key) || 0) + 1;
        attempts.set(msg.key, attempt);
        log(`-> ${msg.title}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`);
        let result;
        try { result = await enterGiveaway(msg, attempt); } catch (e) { result = 'error: ' + e.message.slice(0, 150); }
        log(`   ${result}`);
        // Skips/errors are often timing (streams arriving close together): leave them unseen so the
        // next round tries again, up to MAX_ATTEMPTS.
        const failed = /^(skipped|error|unconfirmed)/.test(result);
        if (!failed || attempt >= MAX_ATTEMPTS) { markSeen(msg.key); attempts.delete(msg.key); }
        await pause(1, 4);
      }
      if (!todo.length) await (HUMAN ? pause(POLL / 1000 - 1.5, POLL / 1000 + 1.5) : wda.sleep(POLL));
    } catch (e) {
      // Log the first error, then once a minute while it keeps failing (e.g. phone unreachable).
      if (errorStreak % 12 === 0) log('Error: ' + e.message.slice(0, 200) + ' (retrying every 5s)');
      errorStreak++;
      await wda.sleep(5000);
    }
  }
  log('Stopped.');
  process.exit(0);
})();
