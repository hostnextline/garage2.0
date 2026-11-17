// The helpers of tests/e2e/plages.test.cjs (« Plages d'arrivée » end to end).
// The first block is COPIED from tests/e2e/app.test.cjs, where these helpers are private (watch, the pictures of a
// failing step, dismissSheets, noErrors, draw, openVin, until, until2, jwtOf, rpcAs): same code, so a failing step leaves
// the same pictures and the same log of what the app asked the server. (The `step` wrapper itself stays in the test
// file, so that the report names that file.)
// The second block is what the window steps need: the windows a screen offers (read from the words of each time), the
// server's own answer, the texts the fake GoHighLevel kept, the rows of the database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./harness.cjs');

const PW = 'Garage-e2e-2026';

/* ---------- copied from app.test.cjs ---------- */
const pages = new Set();
const watch = (page) => {
  pages.add(page); page.on('close', () => pages.delete(page));
  page.netlog = [];
  const t0 = Date.now();
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!/\/(rest|functions|auth)\/v1\//.test(u.pathname)) return;
    let rows = ''; try { const b = await r.json(); rows = Array.isArray(b) ? `rows=${b.length}` : ''; } catch { /* not json */ }
    page.netlog.push(`${Date.now() - t0}ms ${r.request().method()} ${u.pathname.replace(/^.*\/v1\//, '')}${u.search.length > 60 ? u.search.slice(0, 60) + '…' : u.search} ${r.status()} ${rows}`);
  });
  page.on('requestfailed', (r) => page.netlog.push(`${Date.now() - t0}ms FAILED ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page.netlog.push(`${Date.now() - t0}ms console.${m.type()} ${m.text().slice(0, 200)}`); });
  return page;
};
const onFail = async (name) => {
  let i = 0;
  for (const p of pages) {
    const tag = `fail-plages-${name.slice(0, 20).replace(/\W+/g, '-')}-${i++}`;
    try { await h.shot(p, tag); } catch { /* closed */ }
    try { fs.writeFileSync(path.join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
  }
};
const dismissSheets = async (page) => { for (let i = 0; i < 3; i++) { if (await page.locator('[role=dialog]').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
const openVin = async (page) => {
  const sheet = page.getByTestId('car-check');
  for (let i = 0; i < 10 && !(await sheet.isVisible()); i++) await page.waitForTimeout(300);
  if (!(await sheet.isVisible())) await page.getByTestId('step-vin').click({ timeout: 15000 });
  await sheet.waitFor({ timeout: 10000 });
  await page.getByTestId('car-check-skip').waitFor();
};
const noErrors = (page) => assert.deepEqual(page.errors, [], 'no page errors');
const draw = async (page, testid) => {
  const canvas = page.getByTestId(testid).locator('canvas');
  await canvas.hover();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + box.height / 2 + (i % 2 ? -22 : 22));
  await page.mouse.up();
};
const until = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 500)); } return v; };
const until2 = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 500)); } return v; };
const jwtOf = async (email) => (await (await fetch(`${h.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
const rpcAs = async (jwt, name, args) => {
  const r = await fetch(`${h.API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
};

/* ---------- the browser: the outside map services never reach the internet ---------- */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/** OSRM and its backup: a straight road with a bend per leg (the app draws it); map tiles: an empty picture; Photon: nothing */
async function quietWorld(ctx) {
  const osrm = (route) => {
    const u = new URL(route.request().url());
    const pts = u.pathname.split('/driving/')[1].split(';').map((p) => p.split(',').map(Number));
    const legs = pts.slice(1).map((b, i) => { const a = pts[i]; return { distance: 1500, duration: 240, steps: [{ geometry: { coordinates: [a, [(a[0] + b[0]) / 2 + 0.003, (a[1] + b[1]) / 2], b] } }] }; });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 'Ok', routes: [{ distance: 1500 * legs.length, duration: 240 * legs.length, legs }] }) });
  };
  await ctx.route('https://router.project-osrm.org/**', osrm);
  await ctx.route('https://routing.openstreetmap.de/**', osrm);
  await ctx.route(/^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
}
/** the app as it is on the team's phones: opened before, its service worker in charge of the page (what was loaded
    once still opens without signal). A first visit in a browser tab has no worker yet: a screen not opened before
    cannot load without signal there. */
async function appOnPhone(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.getByTestId('app').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  }
}
async function openW(o) {
  const r = await h.open(o);
  watch(r.page);
  await quietWorld(r.ctx);
  // how long each « suggest_windows » took on the network (ms), for the timing lines of the steps
  r.page.sw = [];
  r.page.on('requestfinished', (req) => {
    if (!/\/rpc\/suggest_windows/.test(req.url())) return;
    const tm = req.timing();
    if (tm && tm.responseEnd > 0) r.page.sw.push(Math.round(tm.responseEnd));
  });
  return r;
}

/* ---------- words and minutes ---------- */
/** « 14 h », « 14 h 30 » → minutes of the day */
const minOf = (s) => { const m = /(\d{1,2}) h(?: (\d{2}))?/.exec(s); assert.ok(m, `a time in « ${s} »`); return Number(m[1]) * 60 + Number(m[2] || 0); };
/** minutes → « 14 h », « 14 h 05 » (the app's and the texts' way) */
const clock = (m) => { const hh = Math.floor(m / 60), mm = m % 60; return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`; };
const between = (a, b) => `entre ${clock(a)} et ${clock(b)}`;
/** « mercredi 18 novembre » (the day in the texts) */
const longDay = (d) => { const [y, mo, dd] = d.split('-').map(Number); return new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, dd, 12))); };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* ---------- the database ---------- */
const jobOf = (id) => JSON.parse(h.sql(`select row_to_json(j) from public.jobs j where id = '${id}'`));
/** the booked stops of a day, in the planner's order */
const stopsOf = (day) => JSON.parse(h.sql(`select coalesce(json_agg(x order by x.stop_order nulls last, x.eta_min), '[]') from (select id, customer_id, truck_id, stop_order, eta_min, win_start, win_end, win_flex, status
  from public.jobs where day = '${day}' and deleted_at is null and status in ('booked','en_route','on_site')) x`));
const sentTo = (job, kind) => JSON.parse(h.sql(`select coalesce(json_agg(body order by created_at), '[]') from public.messages where job_id = '${job}' and kind = '${kind}' and status = 'sent'`));

/* ---------- the fake GoHighLevel: the texts it was asked to send ---------- */
/** the texts sent to this first name since the log was cleared (« Bonjour Amira, … ») */
async function textsTo(first, re = null) {
  const log = await h.mockLog();
  return log.filter((l) => l.svc === 'ghl' && l.path === '/conversations/messages' && l.body && l.body.type === 'SMS'
    && typeof l.body.message === 'string' && l.body.message.startsWith(`Bonjour ${first}`) && (!re || re.test(l.body.message))).map((l) => l.body.message);
}

/* ---------- the windows a screen offers ---------- */
/** a time of the calendar in words: « mercredi 18 novembre, arrivée vers 9 h, dit au client : 8 h à 12 h » → its window */
const windowOfLabel = (label) => { const m = /dit au client : (.+?) à (.+)$/.exec(label || ''); assert.ok(m, `the window said in « ${label} »`); return [minOf(m[1]), minOf(m[2])]; };
/** the computer's time grid: the column of the day has its answer (neither the first wait nor a new question) */
async function gridAnswered(page, day, timeout = 60000) {
  // the day is on the page shown (« Jours suivants » until it is)
  for (let i = 0; i < 4 && !(await page.locator(`.pk-col[data-day="${day}"]`).count()); i++) await page.getByTestId('pick-next').click();
  await page.waitForFunction((d) => {
    const c = document.querySelector(`.pk-col[data-day="${d}"]`);
    return !!c && !c.hasAttribute('aria-busy') && !c.classList.contains('is-stale') && !c.classList.contains('is-loading');
  }, day, { timeout });
}
/** the phone's list: the day chosen in the row of days, its times listed (or said full) */
async function listAnswered(page, day, timeout = 60000) {
  for (let i = 0; i < 4 && !(await page.getByTestId(`pick-daychip-${day}`).count()); i++) await page.getByTestId('pick-next').click();
  await page.getByTestId(`pick-daychip-${day}`).click();
  await page.waitForFunction((d) => {
    const c = document.querySelector(`[data-testid="pick-daychip-${d}"]`);
    if (!c || c.classList.contains('is-loading')) return false;
    const times = document.querySelector('[data-testid="pick-times"]');
    return !times || !times.classList.contains('is-stale');
  }, day, { timeout });
}
/** the times a day offers on screen (computer grid or phone list), each with the window its words tell the customer */
async function offeredTimes(page, day, layout) {
  const sel = layout === 'grid' ? `.pk-col[data-day="${day}"] button[data-state="open"]` : '[data-testid="pick-times"] button[data-testid^="pick-time-"]';
  const got = await page.$$eval(sel, (bs) => bs.map((b) => ({ m: Number(b.dataset.m ?? b.dataset.testid.replace('pick-time-', '')), label: b.getAttribute('aria-label') })));
  return got.map((x) => ({ m: x.m, win: windowOfLabel(x.label) }));
}
/** the windows a day offers on screen: their starts, in order */
const offeredStarts = (times) => [...new Set(times.map((x) => x.win[0]))].sort((a, b) => a - b);
/** the server's answer for the same question, asked as the same person */
async function serverWindows(jwt, c, day, duration, exclude = null) {
  const rows = await rpcAs(jwt, 'suggest_windows', { p_lat: c.lat, p_lng: c.lng, p_duration: duration, p_day: day, p_exclude: exclude, p_need: false, p_kind: null });
  return [...new Set(rows.map((r) => r.win_start))].sort((a, b) => a - b);
}
/** chooses the first time of the day whose window starts at `ws` (computer grid or phone list) */
async function pickWindow(page, day, ws, layout) {
  const times = await offeredTimes(page, day, layout);
  const t = times.find((x) => x.win[0] === ws);
  assert.ok(t, `the window ${clock(ws)} is offered on ${day}: ${offeredStarts(times).map(clock).join(', ')}`);
  await page.getByTestId(layout === 'grid' ? `pick-unit-${day}-${t.m}` : `pick-time-${t.m}`).click();
  return t;
}

/* ---------- screens ---------- */
/** the booking screen with the customer and the work chosen, the moment picker in windows mode on screen */
async function bookStart(page, name, services) {
  await page.goto(h.APP + '#/book');
  await page.getByTestId('book-screen').waitFor({ timeout: 15000 });
  await page.getByTestId('customer-search').fill(name);
  await page.getByTestId('customer-option').first().click();
  await page.getByTestId('customer-picked').waitFor();
  for (const s of services) await page.getByTestId(`svc-${s}`).click();
  const t0 = Date.now();
  await page.locator('[data-testid="block-picker"][data-mode="windows"]').waitFor({ timeout: 15000 });
  return t0;
}
/** what the agenda of a day (computer, day view) says of each appointment: its stop number, its arrival, its window */
async function agendaSays(page, day, ids) {
  await page.goto(h.APP + `#/agenda/${day}?view=day`);
  await page.getByTestId('agenda-screen').waitFor();
  const out = {};
  for (const id of ids) {
    const g = page.getByTestId(`grid-job-${id}`);
    await g.waitFor({ timeout: 20000 });
    const label = await g.getAttribute('aria-label');
    const stop = /Arrêt (\d+)/.exec(label);
    const eta = /arrivée prévue à (\d{1,2} h(?: \d{2})?)/.exec(label);
    // (the block itself may write the window short, « 12–16 h », when narrow: its words for a screen reader say it in full)
    const win = /(\d{1,2} h(?: \d{2})?) – (\d{1,2} h(?: \d{2})?)/.exec(label);
    out[id] = { stop: stop ? Number(stop[1]) : null, eta: eta ? minOf(eta[1]) : null, win: win ? [minOf(win[1]), minOf(win[2])] : null, label };
  }
  return out;
}
/** the map of a day: one truck's stops in route order, each with its number and its time (« 12 h – 16 h, vers 12 h 10 ») */
async function mapSays(page, day, truck) {
  await page.goto(h.APP + `#/map?day=${day}`);
  const list = page.locator(`[data-testid="stops-${truck}"]`);
  await list.waitFor({ timeout: 20000 });
  await page.getByTestId('map-status').filter({ hasText: /Mis à jour/ }).waitFor({ timeout: 20000 }).catch(() => undefined);
  return list.locator('button.map-stop').evaluateAll((bs) => bs.map((b) => ({ id: b.dataset.testid.replace(/^stop-/, ''), n: b.querySelector('.map-n')?.textContent?.trim() || '', sub: b.querySelector('.row-sub')?.textContent || '' })));
}

module.exports = {
  PW, h, randomUUID, watch, onFail, appOnPhone, dismissSheets, openVin, noErrors, draw, until, until2, jwtOf, rpcAs, openW,
  minOf, clock, between, longDay, median, jobOf, stopsOf, sentTo, textsTo,
  windowOfLabel, gridAnswered, listAnswered, offeredTimes, offeredStarts, serverWindows, pickWindow, bookStart, agendaSays, mapSays
};
