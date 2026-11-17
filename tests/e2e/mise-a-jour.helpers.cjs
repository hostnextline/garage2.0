// The update of a real phone (tests/e2e/mise-a-jour.test.cjs): yesterday's app and the rebuilt one, built for the same local
// server and served ONE AFTER THE OTHER at the same address (a phone's storage belongs to an address), to browsers that keep
// their profile on disk (IndexedDB, localStorage, the installed service worker), like a phone.
//   - buildOld(): the LIVE app (the reference folder, read only) is COPIED into a scratch folder, its packages linked, built there
//   - buildNew(): this copy, built like the harness does (the build of a test never writes in the source folder)
//   - site: one small web server at the app's address; site.serve(dir) switches what it serves (« the new version is published »)
//   - signal: the app reaches the server through a switch: on = every request goes to the server, off = the connection drops
//     (the files of the app still come: a weak signal, or the server unreachable). Every request is noted (which, when, answer).
//   - phone(name): a browser with its own profile on disk; closing it and opening it again keeps everything, as a phone does.
// Copied from tests/e2e/app.test.cjs (kept private there): the failure pictures (watch / step), dismissSheets, noErrors, until,
// draw, blockNow, openVin, jwtOf / rpcAs.
const { test } = require('node:test');
const { chromium, devices } = require('playwright');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const h = require('./harness.cjs');

const APP_PORT = Number(new URL(h.APP).port);
const API_PORT = Number(new URL(h.API).port);
/** the switch in front of the server: next to the app's port (lane A 4176, lane B 4276) */
const SIGNAL_PORT = APP_PORT + 3;
const SIGNAL = `http://127.0.0.1:${SIGNAL_PORT}`;
/** the live app (commit acf46c3), never written */
const OLD_SRC = process.env.MAJ_OLD_SRC || '/Users/hassan/garage2.0-refonte';
/** where the old app is copied and built, and where the phones keep their profiles (one folder per lane: its app port) */
const MAJ_ROOT = process.env.MAJ_DIR || '/private/tmp/claude-501/-Users-hassan/cf4f02b8-8e97-461a-b869-3d36fa2329c9/scratchpad/wave2/e2e/maj';
const MAJ = path.join(MAJ_ROOT, `lane-${APP_PORT}`);
const DIST_OLD = path.join(MAJ, 'dist-old');
const DIST_NEW = path.join(h.ROOT, 'tests/out/dist-maj-new');
fs.mkdirSync(MAJ, { recursive: true });

/* ---------- the two builds ---------- */
// the published app says which version it is and since when an important one exists (deploy.yml): the rebuilt app is
// published as an important update (« [important] »), so yesterday's app shows its notice
const OLD_BUILT = '2026-11-15T21:00:00.000Z';
function envFor(version, builtAt, importantSince) {
  return { ...process.env, VITE_SUPABASE_URL: SIGNAL, VITE_SUPABASE_KEY: h.K.anon, VITE_REALTIME: 'off', VITE_APP_VERSION: version,
    VITE_BUILT_AT: builtAt, APP_IMPORTANT_SINCE: importantSince || '', APP_NOTES: version === 'e2e-new' ? 'La nouvelle app (refonte)' : 'Plages d’arrivée' };
}
/** the live app: copied without its packages (they are linked one by one, so that Vite's temporary files stay in the copy).
    Without the reference folder (another computer), the same commit is taken from a repository's history (MAJ_OLD_REPO). */
const OLD_COMMIT = process.env.MAJ_OLD_COMMIT || 'acf46c3';
function buildOld() {
  const folder = fs.existsSync(path.join(OLD_SRC, 'package.json'));
  const repo = process.env.MAJ_OLD_REPO || (folder ? OLD_SRC : h.ROOT);
  const head = (() => { try { return execSync(`git -C ${repo} rev-parse ${OLD_COMMIT}^{commit}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } })();
  // the folder itself when it is exactly that commit (rsync, as the brief of this test asks), else the commit from the history
  const fromFolder = folder && !!head && execSync(`git -C ${OLD_SRC} rev-parse HEAD`, { encoding: 'utf8' }).trim() === head
    // (GIT_OPTIONAL_LOCKS=0: « status » would otherwise refresh the reference's index, a write)
    && execSync(`git -C ${OLD_SRC} status --porcelain --untracked-files=no`, { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim() === '';
  if (!head) throw new Error(`yesterday's app is neither at ${OLD_SRC} (MAJ_OLD_SRC) nor in the history of ${repo} (MAJ_OLD_REPO, commit ${OLD_COMMIT})`);
  const stamp = JSON.stringify({ head, url: SIGNAL, key: h.K.anon, built: OLD_BUILT });
  const stampFile = path.join(DIST_OLD, '.maj-stamp');
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp && fs.existsSync(path.join(DIST_OLD, 'sw.js'))) return { head, cached: true };
  const src = path.join(MAJ, 'old-src');
  fs.mkdirSync(src, { recursive: true });
  if (fromFolder) execSync(`rsync -a --delete --exclude '/.git' --exclude '/node_modules' --exclude '/dist' --exclude '/tests/out' --exclude '__scan__' --exclude '.DS_Store' ${OLD_SRC}/ ${src}/`);
  else { fs.rmSync(src, { recursive: true, force: true }); fs.mkdirSync(src); execSync(`git -C ${repo} archive ${head} | tar -x -C ${src}`); }
  const mods = fs.realpathSync(path.join(fromFolder ? OLD_SRC : h.ROOT, 'node_modules'));
  const nm = path.join(src, 'node_modules');
  fs.rmSync(nm, { recursive: true, force: true });
  fs.mkdirSync(nm);
  for (const e of fs.readdirSync(mods)) fs.symlinkSync(path.join(mods, e), path.join(nm, e));
  execSync(`npx vite build --outDir ${DIST_OLD} --emptyOutDir`, { cwd: src, stdio: 'pipe', env: envFor('e2e-old', OLD_BUILT, OLD_BUILT) });
  fs.writeFileSync(stampFile, stamp);
  return { head, cached: false };
}
/** the files a build is made from: when none changed since the last run, the build is kept (a build takes a minute) */
function sourceHash(root, parts) {
  const hash = require('node:crypto').createHash('sha256');
  const walk = (p) => {
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) if (e !== 'node_modules' && e !== '__scan__' && e !== '.DS_Store') walk(path.join(p, e)); return; }
    hash.update(path.relative(root, p)); hash.update(fs.readFileSync(p));
  };
  for (const x of parts) walk(path.join(root, x));
  return hash.digest('hex');
}
/** this copy (the rebuilt app): a newer version than yesterday's, marked important (kept when its sources did not change) */
function buildNew() {
  const stamp = JSON.stringify({ src: sourceHash(h.ROOT, ['src', 'public', 'index.html', 'client.html', 'vite.config.ts', 'package-lock.json', 'tsconfig.json']), url: SIGNAL, key: h.K.anon });
  const stampFile = path.join(DIST_NEW, '.maj-stamp');
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp && fs.existsSync(path.join(DIST_NEW, 'sw.js'))) return { cached: true };
  const now = new Date().toISOString();
  execSync(`npx vite build --outDir ${DIST_NEW} --emptyOutDir`, { cwd: h.ROOT, stdio: 'pipe', env: envFor('e2e-new', now, now) });
  fs.writeFileSync(stampFile, stamp);
  return { cached: false };
}
/** the main script of a build (its name changes with its content): which app a page runs */
function mainScript(dir) {
  const m = /<script type="module" crossorigin src="\.?\/?(assets\/index-[^"]+\.js)"/.exec(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  if (!m) throw new Error(`no main script in ${dir}/index.html`);
  return m[1];
}
/** which of the two apps this page runs: 'old', 'new' or what it found */
async function whichApp(page) {
  const src = await page.evaluate(() => [...document.querySelectorAll('script[type=module]')].map((s) => s.getAttribute('src') || '').join(' '));
  if (src.includes(mainScript(DIST_OLD))) return 'old';
  if (src.includes(mainScript(DIST_NEW))) return 'new';
  return `unknown (${src})`;
}

/* ---------- the web server at the app's address ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
const site = {
  root: null, server: null, asked: [],
  serve(dir) { this.root = dir; },
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        this.asked.push({ at: Date.now(), path: u.pathname, root: this.root === DIST_OLD ? 'old' : 'new' });
        let p = decodeURIComponent(u.pathname);
        if (p.endsWith('/')) p += 'index.html';
        let f = path.join(this.root, p);
        if (!f.startsWith(this.root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
          if (req.headers['sec-fetch-mode'] !== 'navigate') { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
          f = path.join(this.root, 'index.html');
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        fs.createReadStream(f).pipe(res);
      });
      this.server.on('error', reject);
      this.server.listen(APP_PORT, '127.0.0.1', resolve);
    });
  },
  stop() { return new Promise((r) => { if (!this.server) return r(); this.server.closeAllConnections?.(); this.server.close(() => r()); this.server = null; }); }
};

/* ---------- the signal: between the app and the server ---------- */
const signal = {
  on: true, server: null, log: [],
  set(on) { this.on = on; },
  /** the requests seen since `from` (an index in the log) */
  since(from) { return this.log.slice(from); },
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const u = new URL(req.url, 'http://x');
          const entry = { at: Date.now(), method: req.method, path: u.pathname, status: 0 };
          if (req.method !== 'OPTIONS' && /\/rest\/v1\/rpc\//.test(u.pathname)) {
            try { const b = JSON.parse(body.toString() || '{}'); entry.rpc = u.pathname.split('/').pop(); entry.op = b.p_op; entry.args = b; } catch { /* not json */ }
          } else if (req.method === 'POST' || req.method === 'PATCH') {
            const byQuery = (u.searchParams.get('id') || '').replace(/^eq\./, '');
            try { const b = JSON.parse(body.toString() || '{}'); entry.id = (Array.isArray(b) ? b[0]?.id : b.id) || byQuery || undefined; } catch { entry.id = byQuery || undefined; }
          }
          this.log.push(entry);
          if (!this.on) { entry.status = 'dropped'; req.socket.destroy(); return; }
          const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}`, 'content-length': String(body.length) };
          const up = http.request({ host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers }, (r) => {
            entry.status = r.statusCode;
            res.writeHead(r.statusCode || 502, r.headers);
            r.pipe(res);
          });
          up.on('error', () => { entry.status = 'error'; try { res.writeHead(502); res.end(); } catch { /* gone */ } });
          up.end(body);
        });
      });
      this.server.on('error', reject);
      this.server.listen(SIGNAL_PORT, '127.0.0.1', resolve);
    });
  },
  stop() { return new Promise((r) => { if (!this.server) return r(); this.server.closeAllConnections?.(); this.server.close(() => r()); this.server = null; }); }
};

/* ---------- phones that keep their profile ---------- */
const pages = new Set();
/** what the app asked the server, to understand a failure (written next to its picture) — as in app.test.cjs */
const watch = (page) => {
  pages.add(page); page.on('close', () => pages.delete(page));
  page.netlog = [];
  const t0 = Date.now();
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!/\/(rest|functions|auth)\/v1\//.test(u.pathname)) return;
    page.netlog.push(`${Date.now() - t0}ms ${r.request().method()} ${u.pathname.replace(/^.*\/v1\//, '')}${u.search.length > 60 ? u.search.slice(0, 60) + '…' : u.search} ${r.status()}`);
  });
  page.on('requestfailed', (r) => page.netlog.push(`${Date.now() - t0}ms FAILED ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page.netlog.push(`${Date.now() - t0}ms console.${m.type()} ${m.text().slice(0, 200)}`); });
  return page;
};
const errorsOf = (page) => {
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // without signal the browser says « Failed to load resource » / ERR_…: that is the point, not an error of the app
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tile\.openstreetmap|ERR_|Failed to fetch|NetworkError|Load failed/.test(m.text())) page.errors.push(m.text()); });
  return page;
};
const phones = new Map();
/** a phone (or the office's computer) that keeps everything on disk; `fresh` empties its profile first */
async function phone(name, { kind = 'phone', scheme = 'light', locale = 'fr-CA', offline = false, fresh = false } = {}) {
  // a step that failed may have left it open: one browser per profile
  if (phones.has(name)) await putAway(phones.get(name));
  const dir = path.join(MAJ, 'profiles', name);
  if (fresh) fs.rmSync(dir, { recursive: true, force: true });
  const { defaultBrowserType: _b, ...iphone } = devices['iPhone 13'];
  void _b;
  const base = kind === 'phone' ? iphone : { viewport: { width: 1366, height: 860 } };
  const ctx = await chromium.launchPersistentContext(dir, { ...base, locale, colorScheme: scheme, timezoneId: 'America/Toronto', reducedMotion: 'reduce',
    permissions: ['geolocation'], geolocation: { latitude: 45.5005, longitude: -73.6577 }, offline });
  const page = errorsOf(watch(ctx.pages()[0] || await ctx.newPage()));
  const p = { name, ctx, page, offline };
  phones.set(name, p);
  return p;
}
/** the person puts the phone away: the app is closed (the profile stays on disk) */
async function putAway(p) { phones.delete(p.name); try { await p.ctx.close(); } catch { /* already gone */ } }
async function closePhones() { for (const p of [...phones.values()]) { try { await p.ctx.close(); } catch { /* gone */ } } phones.clear(); }

/** the phone's own copy, read in the page: the outbox (big pictures cut), the meta keys, how many rows each store holds */
async function readDevice(page, uid) {
  return page.evaluate(async (uid) => {
    const name = `his-garage-${uid}`;
    if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === name)) return null;
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const ask = (store, what) => new Promise((res, rej) => { const q = db.transaction(store, 'readonly').objectStore(store)[what](); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const outbox = (await ask('outbox', 'getAll')).map((e) => JSON.parse(JSON.stringify(e, (k, v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 40) + `…(${v.length})` : v))));
    const counts = {};
    for (const s of db.objectStoreNames) if (s !== 'outbox' && s !== 'meta') counts[s] = await ask(s, 'count');
    const meta = (await ask('meta', 'getAllKeys')).map(String).sort();
    const out = { version: db.version, stores: [...db.objectStoreNames].sort(), outbox, meta, counts };
    db.close();
    return out;
  }, uid);
}
/** what the person reads in the sync sheet (the frame's « Synchronisation »): the waiting changes and the refused ones */
async function syncSheet(page) {
  const chip = page.getByTestId('sync-chip');
  await chip.waitFor({ timeout: 15000 });
  const chipText = (await chip.innerText()).trim();
  await chip.click();
  const sheet = page.getByTestId('sync-sheet');
  await sheet.waitFor();
  // the rows come from the phone's copy, read when the sheet opens
  await page.waitForFunction(() => document.querySelector('[data-testid="sync-sheet"] h3'), null, { timeout: 10000 }).catch(() => undefined);
  const text = await sheet.innerText();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
  return { chip: chipText, text };
}

/* ---------- copied from app.test.cjs (private there) ---------- */
const until = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 500)); } return v; };
const until2 = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 500)); } return v; };
const dismissSheets = async (page) => { for (let i = 0; i < 3; i++) { if (await page.locator('[role=dialog]').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
const noErrors = (page) => require('node:assert/strict').deepEqual(page.errors, [], 'no page errors');
const draw = async (page, testid) => {
  const canvas = page.getByTestId(testid).locator('canvas');
  await canvas.hover();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + box.height / 2 + (i % 2 ? -22 : 22));
  await page.mouse.up();
};
const blockNow = () => h.sql(`select case when public.now_min() < 720 then 'am' when public.now_min() < 960 then 'pm' else 'eve' end`);
/** « Le NIV de l’auto » once on site: the sheet opens by itself after « Je suis arrivé » (a little later without signal); else the red button */
const openVin = async (page) => {
  const sheet = page.getByTestId('car-check');
  if (!(await sheet.waitFor({ timeout: 10000 }).then(() => true, () => false))) await page.getByTestId('step-vin').click({ timeout: 15000 });
  await sheet.waitFor({ timeout: 10000 });
};
const jwtOf = async (email, pw) => (await (await fetch(`${h.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
const rpcAs = async (jwt, name, args) => {
  const r = await fetch(`${h.API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(d)}`);
  return d;
};
/** a step: a failing one leaves a picture of every open page and what it asked the server (tests/out/fail-*) */
const step = (name, fn) => test(name, async () => {
  try { await fn(); }
  catch (e) {
    let i = 0;
    for (const p of pages) {
      const tag = `fail-maj-${name.slice(0, 20).replace(/\W+/g, '-')}-${i++}`;
      try { await h.shot(p, tag); } catch { /* closed */ }
      try { fs.writeFileSync(path.join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
    }
    try { fs.writeFileSync(path.join(h.OUT, `fail-maj-${name.slice(0, 20).replace(/\W+/g, '-')}-signal.json`), JSON.stringify(signal.log.slice(-200), null, 1)); } catch { /* ignore */ }
    throw e;
  }
});
/** a step kept for when its bug is fixed: it asserts the right behaviour and does not run (« BUG … » / « WAITS … » beside it) */
step.skip = (name, fn) => test.skip(name, fn);

module.exports = { APP_PORT, SIGNAL, SIGNAL_PORT, MAJ, DIST_OLD, DIST_NEW, OLD_SRC, buildOld, buildNew, mainScript, whichApp, site, signal, phone, putAway, closePhones,
  readDevice, syncSheet, watch, errorsOf, until, until2, dismissSheets, noErrors, draw, blockNow, openVin, jwtOf, rpcAs, step };
