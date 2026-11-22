// The helpers of tests/e2e/reorganiser.test.cjs (« Réorganiser la journée » and « Envoyer les heures aux clients »,
// Part 28, REARRANGE.md §6.4). Built like deplacer.helpers.cjs: the outside world of each browser is routes.helpers.cjs'
// (fakeWorld: OSRM, tiles, Photon faked; anything else that tries to leave is noted and fails the step), this file adds
// its own pictures of a failing step (fail-reorganiser-*), its own snapshot of the database (each step puts the world
// back as it found it), the sheet's rows as drawn, a drag with the mouse and one with a real finger (the browser's own
// touch events through the DevTools protocol: Playwright's mouse on a phone context is not a finger), and the save.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const d = require('./deplacer.helpers.cjs');
const { x, h, assert } = d;

const PSQL = 'psql -h 127.0.0.1 -p 54332 -U postgres -q -v ON_ERROR_STOP=1';

/* ---------- what a failing step leaves ---------- */
const pages = new Set();
const opened = new Set();
/** a page in its own context, its requests noted (pictures of a failure), the outside world faked */
async function openO(o) {
  const r = await h.open(o);
  const page = r.page;
  pages.add(page); page.on('close', () => pages.delete(page));
  page.netlog = [];
  const t0 = Date.now();
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!/\/(rest|functions|auth)\/v1\//.test(u.pathname)) return;
    page.netlog.push(`${Date.now() - t0}ms ${res.request().method()} ${u.pathname.replace(/^.*\/v1\//, '')} ${res.status()}`);
  });
  page.on('requestfailed', (q) => page.netlog.push(`${Date.now() - t0}ms FAILED ${q.url().slice(0, 120)} ${q.failure()?.errorText}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page.netlog.push(`${Date.now() - t0}ms console.${m.type()} ${m.text().slice(0, 200)}`); });
  r.world = await x.fakeWorld(r.ctx);
  opened.add(r.ctx);
  r.ctx.on('close', () => opened.delete(r.ctx));
  return r;
}
const onFail = async (name) => {
  let i = 0;
  for (const p of pages) {
    const tag = `fail-reorganiser-${name.slice(0, 24).replace(/\W+/g, '-')}-${i++}`;
    try { await h.shot(p, tag); } catch { /* closed */ }
    try { fs.writeFileSync(path.join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
  }
};

/* ---------- the database of this file ---------- */
function snapshot(tag) {
  execSync(`pg_dump -h 127.0.0.1 -p 54332 -U postgres --data-only --schema=public --exclude-table=public.local_migrations -f ${path.join(h.OUT, `reorganiser-${tag}.sql`)}`, { stdio: ['ignore', 'ignore', 'ignore'] });
  fs.writeFileSync(path.join(h.OUT, `reorganiser-${tag}-users.txt`), h.sql('select coalesce(string_agg(id::text, \',\'), \'\') from auth.users'));
}
function putBack(tag) {
  const tables = h.sql(`select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public' and tablename <> 'local_migrations'`);
  const users = fs.readFileSync(path.join(h.OUT, `reorganiser-${tag}-users.txt`), 'utf8').trim();
  execSync(PSQL, { input: `begin; set session_replication_role = replica; truncate ${tables} cascade; \\i ${path.join(h.OUT, `reorganiser-${tag}.sql`)}\n` +
    `delete from auth.users where ${users ? `id not in (${users.split(',').map((u) => `'${u}'`).join(',')})` : 'true'}; commit;`, encoding: 'utf8' });
}
/** the end of every step: its browsers closed, the fake TomTom, OSRM and GoHighLevel back to normal, the world put back */
async function endStep(tag = 'world') {
  for (const c of [...opened]) { try { await c.close(); } catch { /* gone */ } }
  opened.clear();
  try { await x.calm(); await x.control('ghl=ok&ghl_ms=0&ghl_msg_ms=0'); } catch { /* the mocks are down: the next step says it */ }
  putBack(tag);
}

/** every booked stop of the day on a truck, as the database has it, in stop order */
const dayRows = (truck, day) => x.json(`select coalesce(json_agg(json_build_object('id', j.id, 'number', j.number, 'first', c.first_name, 'order', j.stop_order,
    'eta', j.eta_min, 'ws', j.win_start, 'we', j.win_end, 'at', j.arrive_at, 'truck', j.truck_id, 'pinned', j.truck_pinned, 'manual', j.manual_order,
    'told_day', j.told_day, 'told_start', j.told_start, 'told_end', j.told_end, 'told_how', j.told_how, 'hand_at', j.hand_at, 'updated', j.updated_at)
    order by j.stop_order nulls last, j.eta_min), '[]')
  from public.jobs j join public.customers c on c.id = j.customer_id
  where j.truck_id = '${truck}' and j.day = '${day}' and j.deleted_at is null and j.status = 'booked'`);
/** what the phone sends as the basis of a draft (p_was, REARRANGE.md §1.4): every booked / en route / on site job of the day
    on those trucks, its seven values */
const wasOf = (trucks, day) => x.json(`select coalesce(json_object_agg(j.id, json_build_array(j.truck_id, j.block, j.stop_order, j.win_start, j.win_end, j.arrive_at, j.status)), '{}')
  from public.jobs j where j.day = '${day}' and j.deleted_at is null and j.status in ('booked', 'en_route', 'on_site') and j.truck_id in (${trucks.map((t) => `'${t}'`).join(', ')})`);

/* ---------- the sheet « Réorganiser la journée » ---------- */
/** the sheet open on the agenda's day (its day bar's button), and its first answer of the server */
async function openSheet(page, day, previews) {
  await page.goto(h.APP + `#/agenda/${day}?view=day`);
  const b = page.getByTestId('agenda-reorg');
  await b.waitFor({ timeout: 20000 });
  await b.click();
  const sheet = page.getByTestId('dayorder-sheet');
  await sheet.waitFor({ timeout: 15000 });
  if (previews) await x.until(() => previews.filter((a) => a.status === 200 && a.body && a.body.ok).length, (v) => v > 0, 20000);
  return sheet;
}
/** the stops of a truck as the sheet draws them: [job number] in order */
const rowsShown = (page, truck) => page.evaluate((tr) => [...document.querySelectorAll(`[data-testid="dayorder-truck-${tr}"] [data-dayord-row]`)]
  .map((r) => Number((r.getAttribute('data-testid') || '').replace('dayorder-row-', ''))), truck);
/** the centre of an element */
async function centre(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}
/** the ghost on screen (on document.body, never inside the sheet: code F8) contains that point */
async function ghostUnder(page, pt) {
  const g = page.getByTestId('dayorder-ghost');
  if (!(await g.count())) return { ok: false, why: 'no ghost' };
  const b = await g.boundingBox();
  const parent = await g.evaluate((el) => el.parentElement === document.body);
  const ok = !!b && pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
  return { ok: ok && parent, box: b, parent, pt };
}
/** a drag with the mouse, the way a person does it: press on `from` (the grip or the row's main button), move a little,
    move to `to` in steps (`where`: 'top' = above its middle, 'bottom' = below, 'centre'), let go. Answers what the ghost
    did while it moved (under the pointer once, at the half way point). */
async function mouseDrag(page, from, to, where = 'top') {
  const a = await centre(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y + 10, { steps: 3 });
  await page.waitForTimeout(80);
  const b = await to.boundingBox();
  const ty = where === 'top' ? b.y + b.height * 0.25 : where === 'bottom' ? b.y + b.height * 0.75 : b.y + b.height / 2;
  const tx = b.x + b.width / 2;
  const mid = { x: (a.x + tx) / 2, y: (a.y + ty) / 2 };
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  const ghost = await ghostUnder(page, mid);
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.move(tx, ty + 1, { steps: 1 });
  await page.mouse.up();
  return { ghost };
}
/** a finger (Input.dispatchTouchEvent through a DevTools session): down on `from`, moves in small steps to `to`, held
    `hold` ms there, up. Answers what the ghost did half way. */
async function fingerDrag(page, cdp, from, to, { where = 'top', hold = 120 } = {}) {
  const a = await centre(from);
  const b = await to.boundingBox();
  const ty = where === 'top' ? b.y + b.height * 0.25 : where === 'bottom' ? b.y + b.height * 0.75 : b.y + b.height / 2;
  const tx = b.x + b.width / 2;
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [] });
  await touch('touchStart', a);
  await page.waitForTimeout(60);
  const n = 16;
  let ghost = null;
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + ((tx - a.x) * i) / n, y: a.y + ((ty - a.y) * i) / n };
    await touch('touchMove', p);
    await page.waitForTimeout(25);
    if (i === n / 2) ghost = await ghostUnder(page, p);
  }
  await page.waitForTimeout(hold);
  await touch('touchMove', { x: tx, y: ty + 1 });
  await touch('touchEnd', null);
  return { ghost };
}
/** « Enregistrer », then « Enregistrer quand même » when the verdict asks for one more tap (a first tap whose preview was
    not answered yet shows it): the save's answer. A tap on a button that already says « Enregistrer quand même » saves. */
async function saveDay(page, saves) {
  const sheet = page.getByTestId('dayorder-sheet');
  const btn = sheet.getByTestId('dayorder-save');
  const n0 = saves.length;
  const anyway = async () => /quand même/.test(await btn.innerText().catch(() => ''));
  for (let i = 0; i < 2 && saves.length === n0; i++) {
    await btn.waitFor({ timeout: 10000 });
    await x.until(async () => btn.isEnabled().catch(() => false), Boolean, 15000);
    const was = await anyway();
    await btn.click();
    // a save on its way, or (the first tap asked the verdict) the button now says « quand même »
    await x.until(async () => saves.length > n0 || (!was && (await anyway()) && (await btn.isEnabled().catch(() => false))), Boolean, 20000);
    if (was) break;
  }
  await x.until(() => saves.length, (v) => v > n0, 20000);
  return saves[saves.length - 1];
}
/** the row's menu (a tap on the row) and one of its entries: 'first' | 'up' | 'down' | 'back' | 'on-<truck>' */
async function rowMenu(page, number, entry) {
  await page.getByTestId(`dayorder-main-${number}`).click();
  const m = page.getByTestId('dayorder-menu');
  await m.waitFor({ timeout: 10000 });
  await page.waitForTimeout(150);
  await m.getByTestId(`dayorder-menu-${entry}`).click();
  await m.waitFor({ state: 'detached', timeout: 10000 });
}
/** « vers 9 h 40 » as the sheet prints a server's arrival */
const vers = (m) => `vers ${x.clock(m)}`;
/** Part 29: « fixé à 15 h 29 », the hour of a stop dragged (pinned at the hour of its new place), and « avant : vers 10 h »,
    the hour a stop had before the draft (said when the answer moves it) */
const fixe = (m) => `fixé à ${x.clock(m)}`;
const avant = (m) => `avant : vers ${x.clock(m)}`;
/** the lines under a stop's hours as the sheet draws them (its notes), in order */
const notesOf = (page, number) => page.evaluate((n) => [...document.querySelectorAll(`[data-testid="dayorder-note-${n}"]`)].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()), number);
/** what the fake GoHighLevel was asked to send since its log was cleared: every SMS */
async function allTexts() {
  const log = await h.mockLog();
  return log.filter((l) => l.svc === 'ghl' && l.path === '/conversations/messages' && l.body && l.body.type === 'SMS').map((l) => l.body.message);
}

/* ---------- the map of the sheet (Part 30, K4) ---------- */
/** each pin of the sheet's map as drawn, by its id (a job id, 'home', 'start-<truck>'): its number, its colour (the
    truck's), its label and its small line, done (the check), marked (bigger) */
const mapPins = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid="dayorder-map"] [data-mk]')].map((e) => [e.getAttribute('data-mk'), {
  n: e.querySelector('.mv-num') ? (e.querySelector('.mv-num').textContent || '').trim() : null, c: e.style.getPropertyValue('--c').trim(),
  label: e.querySelector('.mv-label b') ? e.querySelector('.mv-label b').textContent : null, sub: e.querySelector('.mv-label small') ? e.querySelector('.mv-label small').textContent : null,
  done: e.classList.contains('is-done'), marked: e.classList.contains('is-active') }])));
/** the numbers of these jobs' pins, in that order (null: no pin) */
const pinNumbers = async (page, ids) => { const p = await mapPins(page); return ids.map((id) => (p[id] ? Number(p[id].n) : null)); };
/** the roads drawn on the sheet's map: for each line, its number of points (a road by the streets has more than two) */
const mapRoads = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="dayorder-map"] path.mv-line')].map((el) => (el.getAttribute('d') || '').split(/[ML]/).filter((v) => v.trim()).length));
/** the pins of the team's Carte for that day (#/map?day=…): the colour of each job's pin */
async function carteColours(page, day, ids) {
  await page.goto(h.APP + `#/map?day=${day}`);
  await page.locator(`[data-mk="${ids[0]}"]`).first().waitFor({ timeout: 20000 });
  return page.evaluate((list) => list.map((id) => { const e = document.querySelector(`.mv [data-mk="${id}"]`); return e ? e.style.getPropertyValue('--c').trim() : null; }), ids);
}

module.exports = { x, h, d, assert, openO, onFail, snapshot, putBack, endStep, dayRows, wasOf, openSheet, rowsShown, centre, ghostUnder, mouseDrag, fingerDrag, saveDay, rowMenu, vers, fixe, avant, notesOf, allTexts,
  mapPins, pinNumbers, mapRoads, carteColours };
