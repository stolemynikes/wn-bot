// Minimal WebDriverAgent HTTP client (no dependencies, Node 18+).
// WDA_URL defaults to http://localhost:8100 (USB port-forward); use http://<phone-ip>:8100 over Wi-Fi.
// WDA_URL may list several addresses, comma-separated (e.g. home Wi-Fi first, then Tailscale):
// the first one that answers is used, and on a connection failure the list is tried again.

const WDA_URLS = (process.env.WDA_URL || 'http://localhost:8100')
  .split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
let base = WDA_URLS[0];

// Pick the first address that answers /status.
async function pickUrl() {
  for (const url of WDA_URLS) {
    try {
      const res = await fetch(url + '/status', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        if (url !== base) console.log(`[wda] switched to ${url}`);
        base = url;
        return url;
      }
    } catch {}
  }
  throw new Error('WDA not reachable at ' + WDA_URLS.join(', '));
}

// fetch against the current address; if the phone can't be reached there, switch address and retry once.
async function wdaFetch(path, opts = {}) {
  const go = () => fetch(base + path, { signal: AbortSignal.timeout(90000), ...opts });
  try {
    return await go();
  } catch (e) {
    if (WDA_URLS.length < 2) throw e;
    await pickUrl();
    return go();
  }
}

let sessionId = null;
// Capabilities for new sessions. A session tied to an app (bundleId) reads that app's screen
// while it's in front, even when another app's floating mini-player is on top.
let sessionCaps = {};

function readPasscodeFile() {
  try { return require('fs').readFileSync(require('path').join(__dirname, 'passcode.txt'), 'utf8').trim(); }
  catch { return ''; }
}

async function call(method, path, body) {
  const res = await wdaFetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.value && json.value.error)) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${json.value?.message || json.value?.error || 'error'}`);
    err.wdaError = json.value?.error;
    throw err;
  }
  return json.value;
}

async function createSession(caps) {
  const res = await wdaFetch('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities: { alwaysMatch: caps } }),
  }).then(r => r.json());
  const id = res.sessionId || res.value?.sessionId;
  if (!id) throw new Error('Could not create WDA session: ' + (res.value?.message || JSON.stringify(res)).slice(0, 200));
  return id;
}

let boundTo = null; // bundleId the current session is tied to (null = plain session)

async function newSession() {
  try {
    sessionId = await createSession(sessionCaps);
    boundTo = sessionCaps.bundleId || null;
  } catch (e) {
    // A session tied to an app can't be made while the phone is locked (the app can't be opened).
    // Fall back to a plain session so unlocking still works; ensureApp() re-ties it afterwards.
    if (!sessionCaps.bundleId) throw e;
    sessionId = await createSession({});
    boundTo = null;
  }
  return sessionId;
}

// Make sure the session is tied to the app from useApp() (e.g. after a fallback while locked).
async function ensureApp() {
  if (sessionCaps.bundleId && boundTo !== sessionCaps.bundleId) {
    sessionId = await createSession(sessionCaps);
    boundTo = sessionCaps.bundleId;
  }
}

async function session() {
  if (sessionId) return sessionId;
  if (!sessionCaps.bundleId) {
    const status = await wdaFetch('/status').then(r => r.json());
    if (status.sessionId) return (sessionId = status.sessionId);
  }
  return newSession();
}

// Start a session tied to an app (without restarting it if it's already running).
async function useApp(bundleId) {
  sessionCaps = { bundleId, forceAppLaunch: false, shouldWaitForQuiescence: false };
  sessionId = await createSession(sessionCaps);
  boundTo = bundleId;
  return sessionId;
}

// Run a session-scoped call; recreate the session once if WDA dropped it.
async function s(method, path, body) {
  try {
    return await call(method, `/session/${await session()}${path}`, body);
  } catch (e) {
    if (e.wdaError !== 'invalid session id') throw e;
    sessionId = null;
    return call(method, `/session/${await session()}${path}`, body);
  }
}

const finger = (actions) => ({
  actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions }],
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const isLocked = () => call('GET', '/wda/locked');

// WDA's native locator names differ from Appium's ("-ios predicate string" -> "predicate string").
const locator = (using) => using.replace(/^-ios /, '');
const elementId = (el) => el.ELEMENT || el['element-6066-11e4-a52e-4f735466cecf'];

// Find a passcode keypad key (XCUIElementTypeKey named "0"-"9"); null if not on screen.
const findKey = (digit) =>
  s('POST', '/element', { using: 'predicate string', value: `type == 'XCUIElementTypeKey' AND name == '${digit}'` })
    .then(elementId)
    .catch(() => null);

// Wake the phone, let Face ID try, press Home once more to get the keypad, then type the passcode.
// Keys are found and clicked one by one: batching the taps as raw coordinates was tried and
// registered wrong digits while the keypad animated in (each wrong entry is a failed attempt).
async function unlockWithPasscode(passcode) {
  if (!(await isLocked())) return 'already unlocked';
  if (!passcode) throw new Error('Phone is locked and no passcode is configured');
  // Set DEBUG_UNLOCK=1 to print how long each step takes.
  const t0 = Date.now();
  const lap = process.env.DEBUG_UNLOCK ? (m) => console.log(`  [unlock ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`) : () => {};

  // Lock-screen animations make WDA wait several seconds per command; skip that during unlock.
  await s('POST', '/appium/settings', { settings: { waitForIdleTimeout: 0, animationCoolOffTimeout: 0 } });
  lap('settings');
  try {
    // Wake with a Home press. (WDA's /wda/unlock blocks WDA for ~15s at the passcode prompt.)
    await s('POST', '/wda/pressButton', { name: 'home' });
    lap('home 1');

    const digits = [...String(passcode)];
    let first = null;
    for (let i = 0; i < 12 && !first; i++) {
      await sleep(300);
      first = await findKey(digits[0]);
      lap('look for keypad -> ' + (first ? 'found' : 'not yet'));
      if (first) break;
      if (!(await isLocked())) return 'unlocked (Face ID)';
      // After Face ID fails, one more Home press brings up the digits.
      if (i === 0 || i === 7) { await s('POST', '/wda/pressButton', { name: 'home' }); lap('home again'); }
    }
    if (!first) throw new Error('Passcode keypad did not appear');

    await s('POST', `/element/${first}/click`);
    lap('pressed digit 1');
    for (const [n, digit] of digits.slice(1).entries()) {
      const key = await findKey(digit);
      if (!key) throw new Error(`Passcode key ${digit} not found`);
      await s('POST', `/element/${key}/click`);
      lap(`pressed digit ${n + 2}`);
    }

    for (let i = 0; i < 10; i++) {
      await sleep(250);
      if (!(await isLocked())) { lap('unlocked'); return 'unlocked (passcode)'; }
    }
    throw new Error('Passcode entered but phone is still locked');
  } finally {
    await s('POST', '/appium/settings', { settings: { waitForIdleTimeout: 10, animationCoolOffTimeout: 2 } }).catch(() => {});
  }
}

module.exports = {
  get WDA_URL() { return base; }, // the address currently in use
  WDA_URLS,
  pickUrl,
  call,
  status: () => call('GET', '/status'),
  windowSize: () => s('GET', '/window/size'),
  tap: (x, y) => s('POST', '/actions', finger([
    { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: 50 },
    { type: 'pointerUp', button: 0 },
  ])),
  // Tap with a chosen press time and a tiny finger drift while pressed (more like a real finger).
  tapAt: (x, y, { holdMs = 50, driftX = 0, driftY = 0 } = {}) => s('POST', '/actions', finger([
    { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: Math.round(holdMs / 2), x: Math.round(x + driftX), y: Math.round(y + driftY) },
    { type: 'pause', duration: Math.round(holdMs / 2) },
    { type: 'pointerUp', button: 0 },
  ])),
  swipe: (x1, y1, x2, y2, ms = 250) => s('POST', '/actions', finger([
    { type: 'pointerMove', duration: 0, x: Math.round(x1), y: Math.round(y1) },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: ms, x: Math.round(x2), y: Math.round(y2) },
    { type: 'pointerUp', button: 0 },
  ])),
  type: (text) => s('POST', '/wda/keys', { value: [...text] }),
  home: () => call('POST', '/wda/homescreen'),
  lock: () => call('POST', '/wda/lock'),
  unlock: () => call('POST', '/wda/unlock'),
  isLocked,
  // Passcode comes from the argument, the PHONE_PASSCODE env var, or passcode.txt next to this file.
  unlockWithPasscode: (passcode = process.env.PHONE_PASSCODE || readPasscodeFile()) => unlockWithPasscode(passcode),
  pressButton: (name) => s('POST', '/wda/pressButton', { name }), // volumeUp | volumeDown
  launchApp: (bundleId) => s('POST', '/wda/apps/launch', { bundleId }),
  activateApp: (bundleId) => s('POST', '/wda/apps/activate', { bundleId }),
  terminateApp: (bundleId) => s('POST', '/wda/apps/terminate', { bundleId }),
  useApp,
  ensureApp,
  // Open a URL on the phone, like tapping a link (universal links open in their app, e.g. Whatnot).
  openUrl: (url) => s('POST', '/url', { url }),
  // using: 'accessibility id' | 'class name' | 'xpath' | '-ios predicate string' | '-ios class chain'
  find: (using, value) => s('POST', '/element', { using: locator(using), value }).then(elementId),
  // All matching element ids (empty array if none).
  findAll: (using, value) => s('POST', '/elements', { using: locator(using), value })
    .then((els) => (els || []).map(elementId)).catch(() => []),
  // Like find, but returns null instead of throwing when the element isn't there.
  tryFind: (using, value) => s('POST', '/element', { using: locator(using), value }).then(elementId).catch(() => null),
  // Keep looking for an element until it shows up; returns its id, or null after `timeout` ms.
  waitFor: async (using, value, { timeout = 10000, interval = 500 } = {}) => {
    const end = Date.now() + timeout;
    do {
      const el = await s('POST', '/element', { using: locator(using), value }).then(elementId).catch(() => null);
      if (el) return el;
      await sleep(interval);
    } while (Date.now() < end);
    return null;
  },
  click: (elementId) => s('POST', `/element/${elementId}/click`),
  rect: (elementId) => s('GET', `/element/${elementId}/rect`), // { x, y, width, height }
  attr: (elementId, name) => s('GET', `/element/${elementId}/attribute/${name}`),
  screenshot: () => call('GET', '/screenshot').then(b64 => Buffer.from(b64, 'base64')),
  source: () => s('GET', '/source'),
  settings: (settings) => s('POST', '/appium/settings', { settings }),
  sleep,
};
