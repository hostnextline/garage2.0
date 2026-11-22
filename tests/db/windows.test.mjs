// « Plages d'arrivée » (Part 25): 4-hour arrival windows instead of the blocks. Run: node --test tests/db/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const DAY = [[480, 1200]];
const near = [45.5150, -73.6400], near2 = [45.5100, -73.6550], laval = [45.5700, -73.7500];
const job = (customer, day, extra = {}) => ({ customer_id: customer, day, block: 'day', duration_min: 60, ...extra });
const book = (h, p_job) => h.rpc('book_job', { p_op: uuid(), p_job, p_items: [] });
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
/** asks the server itself (its own building blocks are not open to the app), then goes on as `who` */
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
const winFor = async (h, who, eta) => { const r = (await server(h, who, `select * from public.win_for($1)`, [eta]))[0]; return [r.win_start, r.win_end]; };
const windowsOn = async (h, who) => (await server(h, who, `select public.windows_on() v`))[0].v;
const blocks = (h, who) => server(h, who, `select key, start_min, end_min, pos from public.blocks() order by pos`);
const stopOrder = (h, truck, day, ids) => h.q(`select public.set_stop_order($1, $2, $3, 'day', $4::uuid[])`, [uuid(), truck, day, ids]);
const inside = (j, what = '') => assert.ok(j.eta_min >= j.win_start && j.eta_min <= j.win_end, `${what} arrives inside its window: ${j.eta_min} in ${j.win_start}–${j.win_end}`);
/** the owner, one truck (or more) working 8 h – 20 h on a coming day, the windows switched on */
async function setup(h, { trucks = 1, hours = DAY, on = true } = {}) {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const ids = [];
  for (let i = 0; i < trucks; i++) ids.push(await h.truck('Camion ' + (i + 1), null, { [dow]: hours }));
  await h.as(owner);
  if (on) assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  return { owner, day, dow, trucks: ids };
}

test('windows off: the blocks are the three of before, a booking has no window, and « day » is refused', () => tx(async (h) => {
  const { day, owner } = await setup(h, { on: false });
  assert.equal(await windowsOn(h, owner), false);
  assert.deepEqual((await blocks(h, owner)).map((r) => r.key), ['am', 'pm', 'eve']);
  const c = await h.customer('Jean', ...near);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c, day, block: 'am', duration_min: 60, win_start: 600, win_flex: true }, p_items: [] });
  const j = await row(h, r.job_id);
  assert.equal(j.block, 'am');
  assert.equal(j.win_start, null); assert.equal(j.win_end, null); assert.equal(j.win_flex, false);
  assert.equal('win_start' in r, false, 'the answer is the one of before');
  const e = await h.fails(() => book(h, job(c, day)));
  assert.equal(e?.hint, 'bad_block', 'no « day » block while the windows are off');
  const s = await h.rpc('suggest_blocks', { p_lat: near[0], p_lng: near[1], p_duration: 60, p_from: day, p_days: 1, p_exclude: null, p_limit: 6 });
  assert.ok(s.length >= 1);
  assert.equal('win_start' in s[0], false); assert.equal('eta' in s[0], false);
  assert.deepEqual(await h.rpc('suggest_windows', { p_lat: near[0], p_lng: near[1], p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null }), []);
  // the old move (5 arguments) is the same as before
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: r.job_id, p_day: day, p_block: 'pm', p_truck: null });
  assert.equal(m.changed, true);
  assert.equal((await row(h, r.job_id)).block, 'pm');
  const m7 = await h.rpc('move_job', { p_op: uuid(), p_job: r.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 600, p_win_flex: false });
  assert.equal((await row(h, r.job_id)).block, 'am', 'a move kept on a phone in window mode: the block of its window (Part 26)'); void m7;
}));

test('the window for an estimated arrival: 1 h before, 3 h after, inside the day', () => tx(async (h) => {
  const w = async (eta) => { const r = await h.one(`select * from public.win_for($1)`, [eta]); return [r.win_start, r.win_end]; };
  assert.deepEqual(await w(900), [840, 1080], '15:00 → 14–18');
  assert.deepEqual(await w(480), [480, 720], '8:00 → 8–12 (never before the day starts)');
  assert.deepEqual(await w(1170), [960, 1200], '19:30 → 16–20 (never after the day ends)');
  assert.deepEqual(await w(920), [840, 1080], '15:20 → 14–18');
  assert.deepEqual(await w(940), [900, 1140], '15:40 → 15–19');
  assert.deepEqual(await h.one(`select * from public.day_span()`), { start_min: 480, end_min: 1200 });
}));

test('the switch: a coming morning job becomes a job of the day with 8–12, and comes back; only the owner; safe twice', () => tx(async (h) => {
  const mech = await h.person('Saleh', ['mechanic']);
  const { owner, day } = await setup(h, { on: false });
  const c = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  const a = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c, day, block: 'am', duration_min: 60 }, p_items: [] });
  const p = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c2, day, block: 'pm', duration_min: 60 }, p_items: [] });
  await h.as(mech);
  assert.equal((await h.fails(() => h.rpc('windows_switch', { p_op: uuid(), p_on: true })))?.hint, 'not_allowed');
  await h.as(owner);
  // a plain settings save never flips the switch
  await h.q(`update public.settings set booking = booking || '{"windows_on": true}' where id = 1`);
  assert.equal(await windowsOn(h, owner), false);
  const on = await h.rpc('windows_switch', { p_op: uuid(), p_on: true });
  assert.equal(on.ok, true);
  assert.ok(on.converted >= 2);
  assert.equal(await windowsOn(h, owner), true);
  assert.deepEqual(await blocks(h, owner), [{ key: 'day', start_min: 480, end_min: 1200, pos: 1 }]);
  let ja = await row(h, a.job_id), jp = await row(h, p.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end, ja.win_flex], ['day', 480, 720, false]);
  assert.deepEqual([jp.block, jp.win_start, jp.win_end], ['day', 720, 960]);
  assert.ok(ja.truck_id && jp.truck_id, 'both still on a truck');
  inside(ja, 'the morning job'); inside(jp, 'the afternoon job');
  assert.deepEqual([ja.stop_order, jp.stop_order], [1, 2], 'one route for the day');
  const again = await h.rpc('windows_switch', { p_op: uuid(), p_on: true });
  assert.equal(again.converted, 0); assert.equal(again.unchanged, true);
  // a block is refused now, with words that say why
  const e = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c, day, block: 'am', duration_min: 60 }, p_items: [] });
  assert.deepEqual([(await row(h, e.job_id)).block, (await row(h, e.job_id)).win_start], ['day', 480], 'a block kept on a phone: the window of its hours (Part 26)');
  await h.rpc('job_step', { p_op: uuid(), p_job: e.job_id, p_action: 'cancel', p_data: {} });
  const off = await h.rpc('windows_switch', { p_op: uuid(), p_on: false });
  assert.ok(off.converted >= 2);
  ja = await row(h, a.job_id); jp = await row(h, p.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end, ja.win_flex], ['am', null, null, false]);
  assert.equal(jp.block, 'pm');
  assert.ok(ja.truck_id && jp.truck_id);
  assert.deepEqual((await blocks(h, owner)).map((r) => r.key), ['am', 'pm', 'eve']);
}));

test('a booking with a window is planned inside it; nothing said: the window is cut around the planned arrival', () => tx(async (h) => {
  const { day, trucks, owner } = await setup(h);
  const c1 = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  const r = await book(h, job(c1, day, { win_start: 840 }));
  assert.equal(r.truck_id, trucks[0]);
  assert.deepEqual([r.win_start, r.win_end, r.win_flex], [840, 1080, false]);
  const j = await row(h, r.job_id);
  assert.deepEqual([j.block, j.win_start, j.win_end], ['day', 840, 1080]);
  assert.equal(j.eta_min, 840, 'the truck waits for the window to open');
  // nothing said: planned first, then told
  const r2 = await book(h, { customer_id: c2, day, duration_min: 60 });
  const j2 = await row(h, r2.job_id);
  assert.equal(j2.block, 'day');
  assert.equal(j2.win_flex, false);
  assert.deepEqual([j2.win_start, j2.win_end], await winFor(h, owner, j2.eta_min));
  inside(j2, 'the second'); inside(await row(h, r.job_id), 'the first');
  // a window outside the day
  assert.equal((await h.fails(() => book(h, job(c2, day, { win_start: 1000 }))))?.hint, 'bad_window');
}));

test('a new booking never pushes a promised stop out of its window: refused (window_full), or on the other truck', () => tx(async (h) => {
  const { day, dow, trucks, owner } = await setup(h);
  const ca = await h.customer('A', ...near), cb = await h.customer('B', ...laval), cc = await h.customer('C', ...near2);
  const a = await book(h, job(ca, day, { win_start: 480, duration_min: 180 }));
  const b = await book(h, job(cb, day, { win_start: 480, duration_min: 240 }));
  let ja = await row(h, a.job_id), jb = await row(h, b.job_id);
  inside(ja, 'A'); inside(jb, 'B');
  assert.ok(ja.stop_order < jb.stop_order, 'the long one last: the only order that reaches both before noon');
  // a third stop for the morning cannot be reached before noon without making A or B late
  const e = await h.fails(() => book(h, job(cc, day, { win_start: 480 })));
  assert.equal(e?.hint, 'window_full');
  assert.match(e.message, /plage/);
  ja = await row(h, a.job_id); jb = await row(h, b.job_id);
  inside(ja, 'A'); inside(jb, 'B');
  // with a second truck that morning, it goes there; A and B keep their promise
  await h.as(null);
  const t2 = await h.truck('Camion 2', null, { [dow]: DAY });
  await h.as(owner);
  const c = await book(h, job(cc, day, { win_start: 480 }));
  assert.equal(c.truck_id, t2);
  const jc = await row(h, c.job_id);
  inside(jc, 'C'); inside(await row(h, a.job_id), 'A'); inside(await row(h, b.job_id), 'B');
  // later in the day the first truck still has room: a window in the afternoon is taken
  const d = await book(h, job(cc, day, { win_start: 840, truck_id: trucks[0] }));
  inside(await row(h, d.job_id), 'D'); inside(await row(h, a.job_id), 'A'); inside(await row(h, b.job_id), 'B');
}));

test('the moments offered carry the arrival and the window; the windows of a day: many when it is empty, fewer when it is busy', () => tx(async (h) => {
  const { day } = await setup(h);
  const s = await h.rpc('suggest_blocks', { p_lat: near[0], p_lng: near[1], p_duration: 60, p_from: day, p_days: 1, p_exclude: null, p_limit: 6 });
  assert.equal(s.length, 1, 'one row per day');
  assert.equal(s[0].block, 'day'); assert.equal(s[0].day, day);
  assert.ok(s[0].eta >= 480 && s[0].eta < 520);
  assert.deepEqual([s[0].win_start, s[0].win_end], [480, 720]);
  const args = { p_lat: near2[0], p_lng: near2[1], p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null };
  const empty = await h.rpc('suggest_windows', args);
  assert.deepEqual(empty.map((x) => x.win_start).sort((a, b) => a - b), [480, 540, 600, 660, 720, 780, 840, 900, 960], 'every hour from 8–12 to 16–20');
  assert.equal(empty[0].win_start, 480, 'the one with no waiting first');
  for (const x of empty) {
    assert.equal(x.block, 'day'); assert.equal(x.win_end, x.win_start + 240);
    assert.ok(x.eta >= x.win_start && x.eta <= x.win_end);
  }
  // three long jobs with promised windows: morning, afternoon, evening
  const cs = [await h.customer('A', ...near), await h.customer('B', near[0] + 0.002, near[1]), await h.customer('C', near[0] + 0.004, near[1])];
  const ids = [];
  for (const [i, ws] of [480, 720, 960].entries()) ids.push((await book(h, job(cs[i], day, { win_start: ws, duration_min: 200 }))).job_id);
  const busy = await h.rpc('suggest_windows', args);
  assert.ok(busy.length < empty.length, `fewer windows on a busy day: ${busy.length} < ${empty.length}`);
  // each window offered can really be booked, and nobody is made late
  if (busy.length) {
    const r = await book(h, { customer_id: cs[0], day, duration_min: 60, lat: near2[0], lng: near2[1], win_start: busy[0].win_start });
    inside(await row(h, r.job_id), 'the new one');
    for (const id of ids) inside(await row(h, id), 'a promised one');
  }
  // a window no longer offered is refused
  const gone = [480, 540, 600, 660, 720, 780, 840, 900, 960].find((w) => !busy.some((x) => x.win_start === w));
  const e = await h.fails(() => book(h, { customer_id: cs[1], day, duration_min: 60, lat: near2[0], lng: near2[1], win_start: gone }));
  assert.ok(['window_full', 'block_full'].includes(e?.hint), 'refused: ' + e?.hint);
}));

test('a flexible job has no window until lock_windows fixes it from the planned arrival; later bookings respect it', () => tx(async (h) => {
  const office = await h.person('Bureau', ['office']), mech = await h.person('Saleh', ['mechanic']);
  const { day, owner } = await setup(h);
  const cf = await h.customer('Flex', ...laval), c1 = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  const f = await book(h, job(cf, day, { win_flex: true }));
  let jf = await row(h, f.job_id);
  assert.deepEqual([jf.block, jf.win_start, jf.win_end, jf.win_flex], ['day', null, null, true]);
  assert.ok(jf.truck_id && jf.eta_min >= 480, 'planned all the same');
  // a promised window goes around it freely
  const a = await book(h, job(c1, day, { win_start: 480, duration_min: 120 }));
  inside(await row(h, a.job_id), 'A');
  await h.as(mech);
  assert.equal((await h.fails(() => h.rpc('lock_windows', { p_op: uuid(), p_day: day })))?.hint, 'not_allowed');
  await h.as(office);
  const op = uuid();
  const l = await h.rpc('lock_windows', { p_op: op, p_day: day });
  assert.equal(l.fixed, 1);
  assert.deepEqual(l.jobs, [f.job_id]);
  jf = await row(h, f.job_id);
  assert.equal(jf.win_flex, true, 'still says how it was booked');
  assert.deepEqual([jf.win_start, jf.win_end], await winFor(h, office, jf.eta_min));
  inside(jf, 'the flexible one');
  assert.equal((await server(h, office, `select count(*)::int n from public.activity where entity_id = $1 and action = 'window_fixed'`, [f.job_id]))[0].n, 1);
  assert.deepEqual(await h.rpc('lock_windows', { p_op: op, p_day: day }), l, 'the same call again answers the same');
  assert.equal((await h.rpc('lock_windows', { p_op: uuid(), p_day: day })).fixed, 0, 'nothing left to fix');
  // later bookings keep it inside
  await h.as(owner);
  const promised = { s: jf.win_start, e: jf.win_end };
  for (const [c, ws] of [[c2, 600], [c1, 840], [c2, 960]]) {
    await h.fails(() => book(h, job(c, day, { win_start: ws, duration_min: 90 })));
    jf = await row(h, f.job_id);
    assert.deepEqual([jf.win_start, jf.win_end], [promised.s, promised.e], 'the promise does not change');
    inside(jf, 'the flexible one, after another booking');
    inside(await row(h, a.job_id), 'A');
  }
}));

test('moving a job in window mode: a new window, flexible, another day; a block is refused', () => tx(async (h) => {
  const { day, dow, owner } = await setup(h);
  const day2 = await h.val(`select ($1::date + 7)::text`, [day]);
  const c1 = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  const a = await book(h, job(c1, day, { win_start: 480 }));
  const b = await book(h, job(c2, day, { win_start: 480 }));
  await server(h, owner, `update public.jobs set confirm_sent_at = now() where id = any($1::uuid[])`, [[a.job_id, b.job_id]]);
  // a new window the same day
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 840, p_win_flex: false });
  assert.equal(m.ok, true); assert.equal(m.changed, false, 'same day');
  let ja = await row(h, a.job_id);
  assert.deepEqual([ja.win_start, ja.win_end, ja.win_flex], [840, 1080, false]);
  inside(ja, 'A'); inside(await row(h, b.job_id), 'B');
  assert.equal(ja.confirm_sent_at, null, 'a new window: the customer is told again');
  assert.ok((await row(h, b.job_id)).confirm_sent_at, 'the other customer is not');
  // the same again: nothing to do
  assert.equal((await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 840, p_win_flex: false })).unchanged, true);
  // the old call (5 arguments), same day: what the customer was told stays
  assert.equal((await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null })).unchanged, true);
  assert.equal((await row(h, a.job_id)).win_start, 840);
  // flexible
  await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: null, p_win_flex: true });
  ja = await row(h, a.job_id);
  assert.deepEqual([ja.win_start, ja.win_end, ja.win_flex], [null, null, true]);
  // another day (the same weekday, so the truck works), with a window
  const m2 = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day2, p_block: 'day', p_truck: null, p_win_start: 600, p_win_flex: false });
  assert.equal(m2.changed, true);
  ja = await row(h, a.job_id);
  assert.deepEqual([ja.win_start, ja.win_end, ja.win_flex], [600, 840, false]);
  assert.equal(await h.val(`select day::text from public.jobs where id = $1`, [a.job_id]), day2);
  inside(ja, 'A, moved');
  // the old call to another day: a window cut around the planned arrival
  await h.rpc('move_job', { p_op: uuid(), p_job: b.job_id, p_day: day2, p_block: 'day', p_truck: null });
  const jb = await row(h, b.job_id);
  assert.deepEqual([jb.win_start, jb.win_end], await winFor(h, owner, jb.eta_min));
  assert.equal(jb.win_flex, false);
  inside(await row(h, a.job_id), 'A');
  // a block is refused
  const e = await h.rpc('move_job', { p_op: uuid(), p_job: b.job_id, p_day: day, p_block: 'pm', p_truck: null });
  assert.deepEqual([(await row(h, b.job_id)).block, (await row(h, b.job_id)).win_start], ['day', 720], 'a block kept on a phone: the window of its hours (Part 26)'); void e;
  void dow;
}));

test('window mode, the same day: booked after the day started, planned from now; a window already over is refused', async (t) => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  // the server's clock at 10 h for this test only (rolled back with it): run late in the evening, the truck's day was
  // nearly over and « Remettre à l'agenda » no longer fitted (R95, red between 22 h 50 and 23 h)
  await h.q(`create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select 600 $$`);
  const now = await h.val(`select public.now_min()`);
  assert.equal(now, 600); void t;
  // a day that runs from midnight to midnight, so « today » is open whatever the hour of the test
  await h.q(`update public.settings set booking = booking || '{"blocks":[{"key":"am","start":0,"end":480},{"key":"pm","start":480,"end":960},{"key":"eve","start":960,"end":1440}]}'::jsonb where id = 1`);
  const today = await h.val(`select public.local_today()::text`);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = [[0, 1440]];
  const t1 = await h.truck('Camion', null, week);
  const c = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  await h.as(owner);
  await h.rpc('windows_switch', { p_op: uuid(), p_on: true });
  assert.equal((await server(h, owner, `select public.block_open(public.local_today(), 'day') v`))[0].v, true, 'the day has started and is still open');
  const r = await book(h, { customer_id: c, day: today, duration_min: 15 });
  assert.equal(r.truck_id, t1);
  const j = await row(h, r.job_id);
  assert.equal(j.block, 'day');
  assert.ok(j.eta_min >= now, `planned from now: ${j.eta_min} >= ${now}`);
  inside(j, 'today\'s job');
  // a flexible job for today gets its window at once
  const f = await book(h, { customer_id: c2, day: today, duration_min: 15, win_flex: true });
  const jf = await row(h, f.job_id);
  assert.equal(jf.win_flex, true);
  assert.ok(jf.win_start !== null, 'today is already locked');
  inside(jf, 'the flexible job of today'); inside(await row(h, r.job_id), 'the first');
  if (now > 250) {
    const e = await h.fails(() => book(h, { customer_id: c2, day: today, duration_min: 15, win_start: 0 }));
    assert.equal(e?.hint, 'window_full', 'midnight–4 h is over');
  }
  // work on the spot is a job of the day
  const w = await h.rpc('walk_in', { p_op: uuid(), p_job: { customer_id: c2, truck_id: t1, duration_min: 15 }, p_items: [] });
  assert.equal((await row(h, w.job_id)).block, 'day');
  // cancelled then put back while the day is not over
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'cancel', p_data: {} });
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'reopen', p_data: {} });
  assert.equal((await row(h, r.job_id)).status, 'booked');
  // the scheduler's routine finds nothing left to fix
  await h.as(null);
  assert.equal((await h.one(`select public.lock_windows_due() r`)).r.fixed, 0);
  // the truck's day ends now: a plan made from « now » has no truck left. The owner closed it for the rest of the day
  // (its hours changed now): its appointment goes to « À placer », as Horaires says (round 2, plages-01: it stayed on
  // the closed truck with its old time). A truck whose day simply ended keeps its late appointment: refonte-planification
  // « plages-01 ».
  if (now >= 10) {
    await h.q(`insert into public.truck_days (truck_id, day, ranges) values ($1, public.local_today(), $2)`, [t1, JSON.stringify([[0, now - 5]])]);
    const kept = await row(h, r.job_id);
    assert.equal(kept.status, 'booked');
    assert.equal(kept.truck_id, null, 'the truck closed by the owner: « À placer » (it was kept on the closed truck)');
  }
}));

test('the order by hand, the length and a cancellation still work on a day of windows', () => tx(async (h) => {
  const { day, trucks } = await setup(h);
  const c1 = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2), c3 = await h.customer('Luc', ...laval);
  const a = await book(h, job(c1, day, { win_start: 480 }));
  const b = await book(h, job(c2, day, { win_start: 840 }));
  const c = await book(h, job(c3, day, { win_flex: true }));
  // by hand: the afternoon one first (allowed: it is then outside its window, the app shows « Hors plage »)
  await stopOrder(h, trucks[0], day, [b.job_id]);
  let jb = await row(h, b.job_id);
  assert.equal(jb.stop_order, 1);
  assert.ok(jb.eta_min < jb.win_start, 'no waiting for a stop put first by hand');
  inside(await row(h, a.job_id), 'A');
  await stopOrder(h, trucks[0], day, []);
  jb = await row(h, b.job_id);
  inside(jb, 'B, back to the planner');
  // a longer job keeps its window
  await h.rpc('set_job_duration', { p_op: uuid(), p_job: a.job_id, p_duration: 120 });
  inside(await row(h, a.job_id), 'A, longer'); inside(await row(h, b.job_id), 'B');
  // a cancellation plans the day again
  await h.rpc('job_step', { p_op: uuid(), p_job: a.job_id, p_action: 'cancel', p_data: {} });
  inside(await row(h, b.job_id), 'B, after a cancellation');
  assert.ok((await row(h, c.job_id)).truck_id);
  const o = await h.rpc('blocks_overview', { p_from: day, p_to: day });
  assert.equal(o.length, 1); assert.equal(o[0].block, 'day');
}));

test('the online booking in window mode: the windows offered, a window booked, a window no longer free', () => tx(async (h) => {
  const { day, owner } = await setup(h);
  await h.as(null);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": true}'::jsonb) where id = 1`);
  const svc = await h.val(`insert into public.services (name_fr, price_cents, duration_min, active) values ('Vidange TEST', 7999, 180, true) returning id`);
  const home = await h.one(`select lat, lng from public.home_point()`);
  const at = [home.lat + 0.01, home.lng + 0.01];
  const s = await h.val(`select public.web_suggest($1, $2, $3::uuid[], $4::date, 1, 6)`, [at[0], at[1], [svc], day]);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].block, s[0].win_start, s[0].win_end], ['day', 480, 720]);
  const w = await h.val(`select public.web_windows($1, $2, $3::uuid[], $4::date)`, [at[0], at[1], [svc], day]);
  assert.ok(w.length >= 5 && w.every((x) => x.win_end === x.win_start + 240));
  const p = (phone, extra) => ({ first_name: 'Web', last_name: 'Test', phone, lang: 'fr', address: '10 rue du Test', lat: at[0], lng: at[1],
    services: [svc], day, block: 'day', ...extra });
  const web = (x) => h.val(`select public.web_book($1::jsonb)`, [JSON.stringify(x)]);
  const a = await web(p('5145550101', { win_start: 480 }));
  assert.deepEqual([a.ok, a.block, a.win_start, a.win_end, a.win_flex], [true, 'day', 480, 720, false]);
  inside(await row(h, a.job_id), 'the online booking');
  // nothing chosen: the window is cut around the planned arrival
  const b = await web(p('5145550102', {}));
  const jb = await row(h, b.job_id);
  assert.deepEqual([b.win_start, b.win_end], [jb.win_start, jb.win_end]);
  assert.ok(jb.win_start !== null); inside(jb, 'the second'); inside(await row(h, a.job_id), 'the first');
  // two 3-hour jobs already: a third cannot be reached before noon
  const e = await h.fails(() => web(p('5145550103', { win_start: 480 })));
  assert.equal(e?.hint, 'window_full');
  assert.equal((await h.fails(() => web(p('5145550104', { block: 'am' }))))?.hint, 'bad_block');
  void owner;
}));
