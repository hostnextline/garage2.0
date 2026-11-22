// The helpers of tests/e2e/deplacer.test.cjs (« Déplacer à l'heure choisie », the exact move: STATE.md 2026-11-21 20:00
// and 20:25). The outside world of each browser is routes.helpers.cjs' (fakeWorld: OSRM, tiles, Photon faked; anything
// else that tries to leave is noted and fails the step); this file adds its own pictures of a failing step
// (fail-deplacer-*), its own snapshot of the database (each step puts the world back as it found it), the day of one
// truck as the database has it, the question on screen, and a drag of an appointment on the agenda's hour grid.
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const x = require('./routes.helpers.cjs');
const { h } = x;

const PSQL = 'psql -h 127.0.0.1 -p 54332 -U postgres -q -v ON_ERROR_STOP=1';

/* ---------- what a failing step leaves (as plages.helpers.cjs, this file's own names) ---------- */
const pages = new Set();
const opened = new Set();
/** a page in its own context, its requests noted (pictures of a failure), the outside world faked */
async function openD(o) {
  const r = await h.open(o);
  const page = r.page;
  pages.add(page); page.on('close', () => pages.delete(page));
  page.netlog = [];
  const t0 = Date.now();
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!/\/(rest|functions|auth)\/v1\//.test(u.pathname)) return;
    let rows = ''; try { const b = await res.json(); rows = Array.isArray(b) ? `rows=${b.length}` : ''; } catch { /* not json */ }
    page.netlog.push(`${Date.now() - t0}ms ${res.request().method()} ${u.pathname.replace(/^.*\/v1\//, '')} ${res.status()} ${rows}`);
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
    const tag = `fail-deplacer-${name.slice(0, 24).replace(/\W+/g, '-')}-${i++}`;
    try { await h.shot(p, tag); } catch { /* closed */ }
    try { fs.writeFileSync(path.join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
  }
};

/* ---------- the database of this file ---------- */
function snapshot(tag) {
  execSync(`pg_dump -h 127.0.0.1 -p 54332 -U postgres --data-only --schema=public --exclude-table=public.local_migrations -f ${path.join(h.OUT, `deplacer-${tag}.sql`)}`, { stdio: ['ignore', 'ignore', 'ignore'] });
  fs.writeFileSync(path.join(h.OUT, `deplacer-${tag}-users.txt`), h.sql('select coalesce(string_agg(id::text, \',\'), \'\') from auth.users'));
}
function putBack(tag) {
  const tables = h.sql(`select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public' and tablename <> 'local_migrations'`);
  const users = fs.readFileSync(path.join(h.OUT, `deplacer-${tag}-users.txt`), 'utf8').trim();
  execSync(PSQL, { input: `begin; set session_replication_role = replica; truncate ${tables} cascade; \\i ${path.join(h.OUT, `deplacer-${tag}.sql`)}\n` +
    `delete from auth.users where ${users ? `id not in (${users.split(',').map((u) => `'${u}'`).join(',')})` : 'true'}; commit;`, encoding: 'utf8' });
}
/** the end of every step: its browsers closed, the fake TomTom and OSRM back to normal, the world put back */
async function endStep(tag = 'world') {
  for (const c of [...opened]) { try { await c.close(); } catch { /* gone */ } }
  opened.clear();
  try { await x.calm(); } catch { /* the mocks are down: the next step says it */ }
  putBack(tag);
}

/** the booked stops of one truck's day as the database has them, in stop order: what the steps read before and after */
const dayOf = (truck, day) => x.json(`select coalesce(json_agg(json_build_object('id', j.id, 'first', c.first_name, 'order', j.stop_order, 'eta', j.eta_min,
    'ws', j.win_start, 'we', j.win_end, 'at', j.arrive_at, 'truck', j.truck_id, 'pinned', j.truck_pinned, 'measured', j.eta_measured, 'updated', j.updated_at)
    order by j.stop_order nulls last, j.eta_min), '[]')
  from public.jobs j join public.customers c on c.id = j.customer_id
  where j.truck_id = '${truck}' and j.day = '${day}' and j.deleted_at is null and j.status = 'booked'`);
/** the same, without the minute pinned and the time written: order and times only */
const orderAndTimes = (list) => list.map((s) => `${s.first} #${s.order} ${s.eta}`);
const winFor = (m) => x.json(`select json_build_array(win_start, win_end) from public.win_for(${m})`);

/* ---------- the question on screen (ui/ask.tsx: a sheet with « ask-ok » and the other answer) ---------- */
/** the question shown now: its title, its words, its two answers; waits until its buttons take taps (they ignore taps for
    400 ms after they appear) */
async function question(page, timeout = 20000) {
  const ok = page.getByTestId('ask-ok');
  await ok.waitFor({ timeout });
  const sheet = page.locator('[role=dialog]', { has: ok });
  await page.waitForTimeout(450);
  const title = x.flat(await sheet.locator('h2, h3, [id$="-t"]').first().innerText().catch(() => ''));
  const text = x.flat(await sheet.locator('p.muted').first().innerText().catch(() => ''));
  const buttons = (await sheet.locator('button').allInnerTexts()).map(x.flat).filter(Boolean);
  return {
    title, text, all: x.flat(await sheet.innerText()), buttons,
    yes: async () => { await ok.click(); await ok.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined); },
    no: async (name) => {
      const b = name ? sheet.getByRole('button', { name, exact: true }) : sheet.locator('button:not([data-testid="ask-ok"])').last();
      await b.click();
      await ok.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
    }
  };
}
/** every answer of the question on screen lies whole inside the screen's width (a phone: « Déplacer quand même » was cut
    at the right edge before the sheet's footer could take a second line) */
async function answersOnScreen(page) {
  const width = page.viewportSize().width;
  const sheet = page.locator('[role=dialog]', { has: page.getByTestId('ask-ok') });
  const boxes = await sheet.locator('.sheet-foot button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { text: b.innerText.trim(), left: Math.round(r.left), right: Math.round(r.right), sw: b.scrollWidth, cw: b.clientWidth }; }));
  return { width, boxes, ok: boxes.length > 0 && boxes.every((b) => b.left >= 0 && b.right <= width && b.sw <= b.cw + 1) };
}
/** no question on screen within that time */
async function noQuestion(page, ms = 1500) {
  try { await page.getByTestId('ask-ok').waitFor({ timeout: ms }); return false; } catch { return true; }
}

/* ---------- the agenda's hour grid (« Plages d'arrivée », a computer, the day view) ---------- */
/** the day view of the agenda, tall enough for the whole day's grid (8 h – 20 h) to be on screen at once */
async function agendaDay(page, day) {
  await page.setViewportSize({ width: 1366, height: 1500 });
  await page.goto(h.APP + `#/agenda/${day}?view=day`);
  await page.getByTestId('grid-day').waitFor({ timeout: 20000 });
}
/** drags an appointment's block to the unit of `minute` in the column of `truck` (the browser's own drag and drop: the
    grid reads the pointer's height in the column), the way a person does it: press, move a little, move there, let go */
async function dragTo(page, jobId, day, minute, truck) {
  const src = page.getByTestId(`grid-job-${jobId}`);
  const dst = page.getByTestId(`grid-unit-${day}-${minute}-${truck}`);
  await src.waitFor({ timeout: 20000 });
  await src.scrollIntoViewIfNeeded();
  const a = await src.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(10, a.height / 2));
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(10, a.height / 2) + 6, { steps: 3 });
  await page.waitForTimeout(150);
  await dst.scrollIntoViewIfNeeded();
  const b = await dst.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
}
/** what the grid's block of an appointment says for a screen reader: its stop, its arrival, its window */
async function gridSays(page, jobId) {
  const label = await page.getByTestId(`grid-job-${jobId}`).getAttribute('aria-label');
  const eta = /arrivée prévue à (\d{1,2} h(?: \d{2})?)/.exec(label || '');
  const win = /(\d{1,2} h(?: \d{2})?) – (\d{1,2} h(?: \d{2})?)/.exec(label || '');
  const min = (s) => { const m = /(\d{1,2}) h(?: (\d{2}))?/.exec(s); return Number(m[1]) * 60 + Number(m[2] || 0); };
  return { label, eta: eta ? min(eta[1]) : null, win: win ? [min(win[1]), min(win[2])] : null };
}
/** the top of an appointment's block on the grid, in pixels from its column's top (A3: it must not jump) */
const blockTop = (page, jobId) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="grid-job-${id}"]`);
  const col = el && el.closest('.agenda-grid-col');
  return el && col ? Math.round(el.getBoundingClientRect().top - col.getBoundingClientRect().top) : null;
}, jobId);

/* ---------- the texts the fake GoHighLevel was asked to send ---------- */
async function textsTo(first, re = null) {
  const log = await h.mockLog();
  return log.filter((l) => l.svc === 'ghl' && l.path === '/conversations/messages' && l.body && l.body.type === 'SMS'
    && typeof l.body.message === 'string' && l.body.message.startsWith(`Bonjour ${first}`) && (!re || re.test(l.body.message))).map((l) => l.body.message);
}

module.exports = { x, h, assert, openD, onFail, snapshot, putBack, endStep, dayOf, orderAndTimes, winFor, question, answersOnScreen, noQuestion, agendaDay, dragTo, gridSays, blockTop, textsTo };
