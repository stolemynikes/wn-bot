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
//   BACKLOG=1             at start, also handle messages already in Bark (default: skip them,
//                         only giveaways that arrive after Start are entered)
//   DELAY_OPEN=2-15       random wait (seconds) before tapping the Giveaway tile
//   DELAY_ENTER=1-15      random wait (seconds) before pressing "Enter Giveaway"
//   HUMAN=0               no random waits / tap jitter (fastest)

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
// The average of two random numbers is used, so values near the middle are more common than
// the extremes (closer to how a person reacts). HUMAN=0 turns the pauses off.
const HUMAN = process.env.HUMAN !== '0';
const humanRandom = () => (Math.random() + Math.random()) / 2;
const pause = (min, max) => HUMAN ? wda.sleep((min + humanRandom() * (max - min)) * 1000) : Promise.resolve();
const range = (env, def) => {
  const [a, b] = String(process.env[env] || def).split('-').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? [a, b] : def.split('-').map(Number);
};
const DELAY_OPEN = range('DELAY_OPEN', '2-15');   // before tapping the Giveaway tile
const DELAY_ENTER = range('DELAY_ENTER', '1-15'); // before pressing "Enter Giveaway"

// Tap somewhere inside a rectangle like a finger would: near the middle more often than at the
// edges, never right on the edge, with a varying press time. No movement while pressed: the
// Enter Giveaway panel is a draggable sheet, and a moving press can be taken as a drag, which
// cancels the button tap.
async function humanTapRect(r) {
  if (!HUMAN) return wda.tap(r.x + r.width / 2, r.y + r.height / 2);
  const gauss = () => Math.max(-1, Math.min(1, (Math.random() + Math.random() + Math.random() - 1.5) / 1.5));
  const x = r.x + r.width / 2 + gauss() * r.width * 0.32;
  const y = r.y + r.height / 2 + gauss() * r.height * 0.3;
  const hold = 55 + Math.round(Math.random() * 110);
  return wda.tapAt(x, y, { holdMs: hold });
}
const humanTap = async (elementId) => humanTapRect(await wda.rect(elementId));

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
  let src = await wda.source();
  // Only tap the "Message History" tab if Bark is on another tab (tapping it every round
  // makes the screen flicker for nothing).
  if (!/name="Message History"[^>]*XCUIElementTypeStaticText|XCUIElementTypeStaticText[^>]*name="Message History"/.test(src)
      && !src.includes('whatnot.com')) {
    const historyTab = await wda.tryFind('predicate string', "type == 'XCUIElementTypeButton' AND name == 'Message History'");
    if (historyTab) { await wda.click(historyTab); src = await wda.source(); }
  }
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
    // Buttons in the top part of the screen: shows what might be covering the tile (e.g. a poll's ⓧ).
    const topButtons = src.split('\n').filter((l) => /XCUIElementTypeButton/.test(l) && /y="([0-9]|[1-9]\d|[1-4]\d\d)"/.test(l));
    fs.writeFileSync(base + '.txt', `${msg.title}\n${msg.url}\n\n-- tile area:\n${tileLines.map((l) => l.trim()).join('\n')}\n\n`
      + `-- buttons in the top of the screen:\n${topButtons.map((l) => l.trim()).join('\n')}\n`);
  } catch (e) {
    fs.writeFileSync(base + '.txt', `${msg.title}\n${msg.url}\nerror saving debug: ${e.message}\n`);
  }
  return path.relative(__dirname, base) + '.png';
}

// Close a pop-up/overlay that covers the stream (e.g. a "NEXT BREAK" poll with an ⓧ).
// Only when a poll is actually on screen. Only taps by element NAME, only close/dismiss-style
// buttons, only in the top 40% of the screen (above the chat), and never anything that sounds
// like bidding, buying, paying or voting.
const CLOSE_BUTTON = "type == 'XCUIElementTypeButton' AND ("
  + "name CONTAINS[c] 'close' OR label CONTAINS[c] 'close' OR name CONTAINS[c] 'dismiss' OR label CONTAINS[c] 'dismiss' "
  + "OR name CONTAINS[c] 'xmark' OR name CONTAINS[c] 'x-circle' OR name CONTAINS[c] 'x_circle' OR name ==[c] 'x'"
  + ") AND NOT (name CONTAINS[c] 'bid' OR name CONTAINS[c] 'buy' OR name CONTAINS[c] 'pay' OR name CONTAINS[c] 'purchase' "
  + "OR name CONTAINS[c] 'vote' OR name CONTAINS[c] 'giveaway' OR name CONTAINS[c] 'minimize' OR name CONTAINS[c] 'arrow-down')";
let screenHeight = null;
const TOP = 0.4; // polls sit high up; the chat starts at about 55% of the screen

// A poll is recognised by its text (e.g. "NEXT BREAK" above the 500/250 options).
// POLL_TEXT can override the words (comma-separated).
const POLL_WORDS = (process.env.POLL_TEXT || 'next break,poll,vote').split(',').map((w) => w.trim()).filter(Boolean);
const POLL_TEXT = "type == 'XCUIElementTypeStaticText' AND ("
  + POLL_WORDS.map((w) => `name CONTAINS[c] '${w.replace(/'/g, "\\'")}'`).join(' OR ') + ')';

async function findPoll() {
  if (!screenHeight) screenHeight = (await wda.windowSize().catch(() => ({ height: 932 }))).height;
  for (const id of await wda.findAll('predicate string', POLL_TEXT)) {
    const r = await wda.rect(id).catch(() => null);
    if (r && r.width > 0 && r.y < screenHeight * TOP) return (await wda.attr(id, 'name').catch(() => '')) || 'poll';
  }
  return null;
}

async function dismissOverlay() {
  const poll = await findPoll();
  if (!poll) return null; // nothing to close: just keep waiting for the tile
  log(`   poll detected ("${poll}") - closing it`);
  for (const id of await wda.findAll('predicate string', CLOSE_BUTTON)) {
    const r = await wda.rect(id).catch(() => null);
    if (!r || r.width === 0 || r.y > screenHeight * TOP) continue;
    const name = await wda.attr(id, 'name').catch(() => '?');
    await wda.click(id).catch(() => {});
    return name;
  }
  log('   poll detected but no close button found (see debug/ after a skip)');
  return null;
}

// ---- Whatnot -------------------------------------------------------------
// Whatnot stays open between giveaways. Its floating mini-player over Bark doesn't matter:
// the session is tied to Bark (so Bark's screen is read) and links are opened directly.
async function enterGiveaway(msg, attempt = 1) {
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  await wda.openUrl(msg.url);

  // Wait for the tile; things can be in the way for a while (e.g. a "NEXT BREAK" poll covering
  // it). On a retry the giveaway may already be over (the tile disappears then), so don't wait as long.
  const timeout = attempt > 1 ? Math.min(TILE_TIMEOUT, 15000) : TILE_TIMEOUT;
  let tile = null;
  let lastDismiss = 0;
  while (Date.now() - t0 < timeout) {
    tile = await wda.tryFind('predicate string', TILE);
    if (tile) break;
    // After 5s without a tile, check for a poll covering it and close only that (every 4s at most).
    if (Date.now() - t0 > 5000 && Date.now() - lastDismiss > 4000) {
      lastDismiss = Date.now();
      const closed = await dismissOverlay();
      if (closed) log(`   closed the poll ("${closed}")`);
    }
    await wda.sleep(700);
  }
  if (!tile) {
    const file = await saveDebug(msg);
    return `skipped: no Giveaway tile after ${timeout / 1000}s${attempt > 1 ? ' (giveaway probably ended)' : ''} (saved ${file})`;
  }

  // The tile's icon can load a moment after the tile itself: gift = enter, checkmark = done.
  let gift = null;
  for (let i = 0; i < 3 && !gift; i++) {
    gift = await wda.tryFind('predicate string', GIFT_ICON);
    if (gift) break;
    if (await wda.tryFind('predicate string', CHECK_ICON)) return `already entered (checkmark) ${secs()}`;
    await wda.sleep(500);
  }

  // Wait like a person would, then tap somewhere on the tile (not always the same pixel).
  await pause(...DELAY_OPEN);
  // Open the Enter Giveaway panel: first a human-like tap somewhere on the gift icon; if the panel
  // doesn't appear within 3s, fall back to a plain element click on the icon (the proven method),
  // then on the tile text.
  const openTile = async () => {
    const text = await wda.tryFind('predicate string', TILE);
    if (!text) return false;
    if (await wda.tryFind('predicate string', CHECK_ICON)) return 'entered';
    const icon = await wda.tryFind('predicate string', GIFT_ICON);
    if (icon) await humanTap(icon); else await humanTap(text);
    if (await wda.waitFor('predicate string', ENTER_BUTTON, { timeout: 3000, interval: 300 })) return true;
    const icon2 = await wda.tryFind('predicate string', GIFT_ICON);
    if (icon2) {
      await wda.click(icon2);
      if (await wda.waitFor('predicate string', ENTER_BUTTON, { timeout: 3000, interval: 300 })) {
        log('   (human tap did not open the panel; plain tap on the icon did)');
        return true;
      }
    }
    const text2 = await wda.tryFind('predicate string', TILE);
    if (text2) {
      await wda.click(text2);
      if (await wda.waitFor('predicate string', ENTER_BUTTON, { timeout: 3000, interval: 300 })) {
        log('   (opened the panel via the tile text)');
        return true;
      }
    }
    return 'no-panel';
  };
  const opened = await openTile();
  if (opened === 'entered') return `already entered (checkmark) ${secs()}`;
  if (!opened) return `skipped: Giveaway tile disappeared ${secs()}`;

  let enter = opened === true ? await wda.tryFind('predicate string', ENTER_BUTTON) : null;
  if (!enter) {
    if (await wda.tryFind('predicate string', CHECK_ICON)) return `already entered (checkmark) ${secs()}`;
    const file = await saveDebug(msg);
    return `skipped: "Enter Giveaway" button did not appear ${secs()} (saved ${file})`;
  }
  await pause(...DELAY_ENTER);
  // The panel may have closed while waiting: look again, reopen the tile once if needed.
  enter = await wda.tryFind('predicate string', ENTER_BUTTON);
  if (!enter) {
    const again = await openTile();
    if (again === 'entered') return `already entered (checkmark) ${secs()}`;
    enter = again === true ? await wda.tryFind('predicate string', ENTER_BUTTON) : null;
    if (!enter) return `skipped: "Enter Giveaway" panel closed while waiting ${secs()}`;
    await pause(0.5, 2);
  }
  await humanTap(enter);

  // Confirm: the gift icon turns into a checkmark once entered. If the human-like tap didn't
  // register (Enter button still there, no checkmark), press it the plain way once.
  let check = await wda.waitFor('predicate string', CHECK_ICON, { timeout: 4000, interval: 400 });
  if (!check) {
    const stillThere = await wda.tryFind('predicate string', ENTER_BUTTON);
    if (stillThere) {
      await wda.click(stillThere);
      check = await wda.waitFor('predicate string', CHECK_ICON, { timeout: 5000, interval: 400 });
      if (check) log('   (human tap on Enter did not register; plain tap did)');
    }
  }
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
      if (i % 6 === 0) {
        log(i === 0 && /not reachable/.test(e.message)
          ? 'Waiting for WebDriverAgent to start on the iPhone (can take up to a minute)...'
          : `Can't reach the phone yet: ${e.message.slice(0, 120)} (retrying every 10s)`);
        if (/Code=41|Not authorized for performing UI testing/.test(e.message))
          log('   -> WebDriverAgent is running but iOS no longer lets it control the screen. Restart WDA on the Mac '
            + '(wda-keepalive.sh or Xcode Cmd+U); check iPhone Settings > Developer > Enable UI Automation.');
      }
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

  // Every start: everything already in Bark counts as done, so only giveaways that arrive after
  // Start are entered (not the ones that came in while the bot was off).
  if (!process.env.BACKLOG) {
    await wda.unlockWithPasscode();
    const existing = await readBark();
    const fresh = existing.filter((m) => !seen.has(m.key)).length;
    existing.forEach((m) => markSeen(m.key));
    log(`Ready: ${existing.length} messages already in Bark are skipped${fresh ? ` (${fresh} arrived while the bot was off)` : ''}. `
      + `Waiting for new giveaways... (delays: open ${DELAY_OPEN.join('-')}s, enter ${DELAY_ENTER.join('-')}s)`);
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
