// « Refonte » (Part 26), the planner: each test is a verified finding of the audit of 2026-11-15, red without the
// migration 20261116000200_refonte_planification.sql. Run: node --test tests/db/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const DAY = [[480, 1200]];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, DAY]));
const near = [45.5150, -73.6400], near2 = [45.5100, -73.6550], laval = [45.5700, -73.7500];
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
const book = (h, p_job, p_items = []) => h.rpc('book_job', { p_op: uuid(), p_job, p_items });
const job = (customer, day, block, extra = {}) => ({ customer_id: customer, day, block, duration_min: 60, ...extra });
const inside = (j, what = '') => assert.ok(j.eta_min >= j.win_start && j.eta_min <= j.win_end, `${what} arrives inside its window: ${j.eta_min} in ${j.win_start}–${j.win_end}`);
/** asks the server itself (its own building blocks are not open to the app), then goes on as `who` */
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
/** the server's clock for this test only (minutes of today; the change is rolled back with the test) */
async function clock(h, who, min) {
  await server(h, who, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
}
/** a row written as the server writes it (the planner's own fields are protected from the app) */
async function put(h, who, j) {
  const id = uuid();
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  await h.q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min, win_start, win_end, win_flex, arrived_at, finished_at, forced, truck_pinned, needs_machine, vehicle_kind)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 10, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [id, j.customer, j.day, j.block, j.truck ?? null, j.status ?? 'booked', j.dur ?? 30, j.lat ?? near[0], j.lng ?? near[1], j.order ?? null, j.eta ?? null,
     j.ws ?? null, j.we ?? null, j.flex ?? false, j.status === 'on_site' || j.status === 'done' ? new Date() : null, j.status === 'done' ? new Date() : null,
     j.forced ?? false, j.pinned ?? false, j.need ?? false, j.kind ?? null]);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await h.as(who);
  return id;
}
const today = (h) => h.val(`select public.local_today()::text`);
const windowsOn = async (h, who) => { await h.as(who); assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true); };
/** « Ordre des arrêts » (a uuid[] goes as an array, not as JSON) */
const stopOrder = (h, truck, day, block, ids) => h.val(`select public.set_stop_order($1, $2, $3, $4, $5::uuid[])`, [uuid(), truck, day, block, ids]);

/* ------------------------------------------------------------------------------------------------------------------
   The blocks: nobody is thrown to « À placer » by somebody else's gesture
   ------------------------------------------------------------------------------------------------------------------ */

test('sql-planner-1-01 / jobs-b-01: « Ordre des arrêts » in a block already started only changes the order of that truck', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const saleh = await h.person('Saleh', ['mechanic']), adam = await h.person('Adam', ['mechanic']);
  const tA = await h.truck('Camion', saleh, WEEK), tB = await h.truck('Voiture', adam, WEEK);
  const c = await h.customer('Jean', ...near);
  const day = await today(h);
  for (const at of [710, 735]) {           // 11 h 50 (10 minutes left in the morning) and 12 h 15 (the morning is over)
    await h.c.query('savepoint hour');
    await clock(h, owner, at);
    const live = await put(h, owner, { customer: c, day, block: 'am', truck: tA, status: 'on_site', order: 1, eta: 600 });
    const a1 = await put(h, owner, { customer: c, day, block: 'am', truck: tA, order: 2, eta: 640, lat: near2[0], lng: near2[1] });
    const a2 = await put(h, owner, { customer: c, day, block: 'am', truck: tA, order: 3, eta: 690, lat: laval[0], lng: laval[1] });
    const b1 = await put(h, owner, { customer: c, day, block: 'am', truck: tB, order: 1, eta: 620 });
    const b2 = await put(h, owner, { customer: c, day, block: 'am', truck: tB, order: 2, eta: 680 });
    const before = await h.q(`select id, updated_at from public.jobs where id = any($1::uuid[])`, [[b1, b2]]);
    await h.as(saleh);
    const r = await stopOrder(h, tA, day, 'am', [a2, a1]);
    assert.equal(r.ok, true);
    const ja1 = await row(h, a1), ja2 = await row(h, a2), jl = await row(h, live);
    assert.deepEqual([ja1.truck_id, ja2.truck_id], [tA, tA], `${at}: both stay on Saleh's truck`);
    assert.ok(ja2.stop_order < ja1.stop_order, `${at}: the stop put first comes first (${ja2.stop_order} < ${ja1.stop_order})`);
    assert.deepEqual([ja2.manual_order, ja1.manual_order], [1, 2]);
    assert.ok(ja2.stop_order > jl.stop_order, 'after the stop he is at');
    assert.deepEqual([jl.stop_order, jl.eta_min, jl.truck_id], [1, 600, tA], 'the job on site keeps its number and its time');
    assert.ok(ja2.eta_min >= at && ja1.eta_min > ja2.eta_min, `${at}: the arrivals follow the new order, from now (${ja2.eta_min}, ${ja1.eta_min})`);
    await h.as(null);
    assert.deepEqual(await h.q(`select id, updated_at from public.jobs where id = any($1::uuid[])`, [[b1, b2]]), before, `${at}: the other truck's rows are not touched`);
    assert.equal(await h.val(`select count(*)::int from public.jobs where day = $1 and block = 'am' and truck_id is null and deleted_at is null`, [day]), 0, 'nobody in « À placer »');
    // back to the planner's order: the order stays as it is, nobody moves
    await h.as(saleh);
    await stopOrder(h, tA, day, 'am', []);
    assert.deepEqual([(await row(h, a1)).truck_id, (await row(h, a2)).truck_id, (await row(h, a1)).manual_order], [tA, tA, null]);
    assert.ok((await row(h, a2)).stop_order < (await row(h, a1)).stop_order);
    await h.as(null);
    await h.c.query('rollback to savepoint hour');
  }
}));

test('sql-planner-1-02: moving a job out of a block already started (or of yesterday) leaves the others on their truck', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const saleh = await h.person('Saleh', ['mechanic']);
  const tA = await h.truck('Camion', saleh, WEEK);
  const c = await h.customer('Jean', ...near);
  const day = await today(h), tomorrow = await h.val(`select (public.local_today() + 1)::text`), yesterday = await h.val(`select (public.local_today() - 1)::text`);
  await clock(h, owner, 710);
  const live = await put(h, owner, { customer: c, day, block: 'am', truck: tA, status: 'on_site', order: 1, eta: 600 });
  const s2 = await put(h, owner, { customer: c, day, block: 'am', truck: tA, order: 2, eta: 640 });
  const s3 = await put(h, owner, { customer: c, day, block: 'am', truck: tA, order: 3, eta: 680 });
  const s4 = await put(h, owner, { customer: c, day, block: 'am', truck: tA, order: 4, eta: 700 });
  await h.as(owner);
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: s3, p_day: tomorrow, p_block: 'am', p_truck: null });
  assert.equal(m.changed, true); assert.equal(m.tell, true);
  assert.deepEqual(await h.one(`select day::text, block from public.jobs where id = $1`, [s3]), { day: tomorrow, block: 'am' });
  const j2 = await row(h, s2), j4 = await row(h, s4), jl = await row(h, live);
  assert.deepEqual([j2.truck_id, j4.truck_id], [tA, tA], 'the other morning stops keep their truck');
  assert.deepEqual([jl.stop_order, jl.eta_min, j2.stop_order, j4.stop_order], [1, 600, 2, 3], 'the stop on site keeps its number; the hole is closed');
  // a job left over in yesterday's block
  const y1 = await put(h, owner, { customer: c, day: yesterday, block: 'pm', truck: tA, order: 1, eta: 730 });
  const y2 = await put(h, owner, { customer: c, day: yesterday, block: 'pm', truck: tA, order: 2, eta: 800 });
  await h.rpc('move_job', { p_op: uuid(), p_job: y1, p_day: tomorrow, p_block: 'pm', p_truck: null });
  const jy = await row(h, y2);
  assert.deepEqual([jy.truck_id, jy.stop_order, jy.eta_min], [tA, 2, 800], 'yesterday is not touched');
}));

test('sql-planner-1-03: a longer job is refused when ANOTHER appointment would lose its place for it', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: [[480, 720]] });
  const far = await h.customer('Loin', ...laval), close = await h.customer('Proche', ...near);
  await h.as(owner);
  const a = await book(h, job(far, day, 'am', { duration_min: 90 }));
  const b = await book(h, job(close, day, 'am', { duration_min: 90 }));
  assert.deepEqual([(await row(h, a.job_id)).truck_id, (await row(h, b.job_id)).truck_id], [t1, t1]);
  for (const id of [a.job_id, b.job_id]) {
    const e = await h.fails(() => h.rpc('set_job_duration', { p_op: uuid(), p_job: id, p_duration: 180 }));
    assert.equal(e?.hint, 'block_full', 'the morning cannot hold 180 + 90 minutes');
    assert.deepEqual([(await row(h, a.job_id)).duration_min, (await row(h, b.job_id)).duration_min], [90, 90]);
    assert.deepEqual([(await row(h, a.job_id)).truck_id, (await row(h, b.job_id)).truck_id], [t1, t1], 'nobody lost a place');
  }
  // a length that fits passes, a shorter one always
  assert.equal((await h.rpc('set_job_duration', { p_op: uuid(), p_job: a.job_id, p_duration: 100 })).ok, true);
  assert.equal((await row(h, a.job_id)).duration_min, 100);
  assert.equal((await h.rpc('set_job_duration', { p_op: uuid(), p_job: b.job_id, p_duration: 30 })).ok, true);
  assert.deepEqual([(await row(h, a.job_id)).truck_id, (await row(h, b.job_id)).truck_id], [t1, t1]);
}));

test('sql-planner-1 B8: a job « À placer » is nobody’s own, and no truck is not « my truck »', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const saleh = await h.person('Saleh', ['mechanic']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const tA = await h.truck('Camion', saleh, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  const lost = await put(h, owner, { customer: c, day, block: 'am', truck: null });
  await h.as(saleh);
  assert.equal((await h.fails(() => h.rpc('move_job', { p_op: uuid(), p_job: lost, p_day: day, p_block: 'pm', p_truck: tA })))?.hint, 'not_allowed');
  assert.equal((await h.fails(() => h.rpc('set_job_duration', { p_op: uuid(), p_job: lost, p_duration: 120 })))?.hint, 'not_allowed');
  assert.equal((await h.fails(() => stopOrder(h, null, day, 'am', [])))?.hint, 'not_allowed');
  await h.as(null);
  assert.equal((await row(h, lost)).duration_min, 30);
}));

test('sql-planner-1 B9: « réservé quand même » ends when the job is moved to a moment where it fits', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await h.as(owner);
  for (let i = 0; i < 3; i++) await book(h, job(c, day, 'am'));
  const f = await book(h, job(c, day, 'am', { force: true }));
  assert.equal(f.forced, true);
  await h.rpc('move_job', { p_op: uuid(), p_job: f.job_id, p_day: day, p_block: 'eve', p_truck: null });
  assert.equal((await row(h, f.job_id)).forced, false);
}));

/* ------------------------------------------------------------------------------------------------------------------
   What a move really changed (agenda-01)
   ------------------------------------------------------------------------------------------------------------------ */

test('agenda-01: move_job says what really changed: a new window the same day is to be told, the truck alone is not', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const day2 = await h.val(`select ($1::date + 7)::text`, [day]);
  const t1 = await h.truck('Camion 1', null, { [dow]: DAY }), t2 = await h.truck('Camion 2', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  const a = await book(h, { customer_id: c, day, block: 'day', duration_min: 60, win_start: 480 });
  const told = () => server(h, owner, `update public.jobs set confirm_sent_at = now() where id = $1`, [a.job_id]);
  await told();
  // another window, the same day
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 840, p_win_flex: false });
  assert.deepEqual([m.changed, m.tell, m.window_changed, m.truck_changed], [false, true, true, false]);
  assert.deepEqual([m.was.win_start, m.was.win_end, m.now.win_start, m.now.win_end], [480, 720, 840, 1080]);
  // the same again
  const u = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 840, p_win_flex: false });
  assert.deepEqual([u.unchanged, u.changed, u.tell], [true, false, false]);
  // the other truck, the same window: nothing to tell the customer
  await told();
  const other = (await row(h, a.job_id)).truck_id === t1 ? t2 : t1;
  const k = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: other, p_win_start: 840, p_win_flex: false });
  assert.deepEqual([k.changed, k.tell, k.window_changed, k.truck_changed], [false, false, false, true]);
  assert.ok((await row(h, a.job_id)).confirm_sent_at, 'the confirmation stays sent');
  // a window fixed → flexible, the same day: what was told is no longer true
  const f = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: null, p_win_flex: true });
  assert.deepEqual([f.changed, f.tell, f.window_changed, f.now.win_start, f.now.win_flex], [false, true, true, null, true]);
  assert.equal((await row(h, a.job_id)).confirm_sent_at, null, 'to be told again');
  // another day
  const d = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day2, p_block: 'day', p_truck: null, p_win_start: 600, p_win_flex: false });
  assert.deepEqual([d.changed, d.tell, d.now.day, d.now.win_start], [true, true, day2, 600]);
}));

/* ------------------------------------------------------------------------------------------------------------------
   Booking: the other mode, « Peu importe », an estimate booked once
   ------------------------------------------------------------------------------------------------------------------ */

test('x-dualmode-11: a booking kept on a phone in the other mode is converted, not refused', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  await h.as(owner);
  // blocks: a window chosen while the garage gave windows → the block of its arrival; what was told stays on the job
  const a = await book(h, { customer_id: c, day, block: 'day', duration_min: 60, win_start: 660 });
  let ja = await row(h, a.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end], ['pm', 660, 900], '11 h – 15 h: arrival around 12 h → the afternoon');
  assert.ok(ja.truck_id);
  const b = await book(h, { customer_id: c2, day, block: 'day', duration_min: 60, win_start: 480 });
  ja = await row(h, b.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end], ['am', null, null], 'the hours of a block: the block itself');
  // nothing chosen in window mode has no block to go to: still refused
  assert.equal((await h.fails(() => book(h, { customer_id: c2, day, block: 'day', duration_min: 60 })))?.hint, 'bad_block');
  // windows: a block chosen while the garage gave blocks → the window of its hours
  await windowsOn(h, owner);
  const e = await book(h, { customer_id: c2, day, block: 'eve', duration_min: 60 });
  const je = await row(h, e.job_id);
  assert.deepEqual([je.block, je.win_start, je.win_end, je.win_flex], ['day', 960, 1200, false]);
  inside(je, 'the evening job');
}));

test('sql-planner-2-01: « Peu importe » goes on the truck when the car\'s own appointments fill it', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const car = await h.truck('Voiture', null, { [dow]: [[480, 720]] });
  const truck = await h.truck('Camion', null, { [dow]: [[480, 720]] });
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [car]);
  const home = await h.one(`select lat, lng from public.home_point()`);
  const at = (km) => [home.lat + km / 111.2, home.lng];
  const cs = [];
  for (const km of [1, 5, 6, 8]) cs.push(await h.customer('Km' + km, ...at(km)));
  await h.as(owner);
  const ids = [];
  for (const cu of cs.slice(0, 3)) ids.push((await book(h, job(cu, day, 'am'))).job_id);
  for (const id of ids) assert.equal((await row(h, id)).truck_id, car, 'the car first');
  const x = await book(h, job(cs[3], day, 'am'));
  assert.equal(x.ok, true);
  assert.equal(x.forced, false);
  assert.equal(x.truck_id, truck, 'on the truck, which is empty');
  for (const id of ids) assert.equal((await row(h, id)).truck_id, car, 'the car keeps its appointments');
}));

test('booking-a-08: an estimate already booked is not booked again', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  const q = await h.val(`insert into public.quotes (customer_id, status) values ($1, 'accepted') returning id`, [c]);
  await h.as(owner);
  const a = await book(h, job(c, day, 'am', { quote_id: q }));
  assert.equal(await h.val(`select job_id from public.quotes where id = $1`, [q]), a.job_id);
  const e = await h.fails(() => book(h, job(c, day, 'pm', { quote_id: q })));
  assert.equal(e?.hint, 'quote_done');
  assert.equal(await h.val(`select count(*)::int from public.jobs where quote_id = $1`, [q]), 1);
  // its appointment cancelled: the estimate may be booked again
  await h.rpc('job_step', { p_op: uuid(), p_job: a.job_id, p_action: 'cancel', p_data: {} });
  const b = await book(h, job(c, day, 'pm', { quote_id: q }));
  assert.equal(await h.val(`select job_id from public.quotes where id = $1`, [q]), b.job_id);
}));

/* ------------------------------------------------------------------------------------------------------------------
   « Plages d'arrivée »: the flexible appointments (x-dualmode-02, sql-windows-06)
   ------------------------------------------------------------------------------------------------------------------ */

test('x-dualmode-02: the flexible windows are fixed without pg_cron by any member of the team, today too, and who is still to be told is listed', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']), office = await h.person('Bureau', ['office']), mech = await h.person('Saleh', ['mechanic']);
  const day = await today(h), tomorrow = await h.val(`select (public.local_today() + 1)::text`);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = DAY;
  const t1 = await h.truck('Camion', mech, week);
  const c1 = await h.customer('Flex demain', ...near), c2 = await h.customer('Flex aujourd’hui', ...near2), c3 = await h.customer('Perdu', ...laval);
  await windowsOn(h, owner);
  await clock(h, owner, 600);                                  // 10 h: tomorrow is not locked yet
  const f = await book(h, { customer_id: c1, day: tomorrow, block: 'day', duration_min: 60, win_flex: true });
  assert.equal((await row(h, f.job_id)).win_start, null);
  // a flexible job of today still without its window (booked before the switch, say), and one « À placer » tomorrow
  const ft = await put(h, owner, { customer: c2, day, block: 'day', truck: t1, order: 1, eta: 700, flex: true });
  const lost = await put(h, owner, { customer: c3, day: tomorrow, block: 'day', truck: null, flex: true, dur: 720 });   // longer than the truck's day: no room
  // nobody signed in may not call it; a mechanic may (it only does what is due)
  await h.as(mech);
  let r = await h.rpc('lock_windows_due', {});
  assert.deepEqual(r.jobs, [ft], 'today: fixed at once; tomorrow: not before the lock hour');
  assert.equal((await row(h, f.job_id)).win_start, null);
  await h.as(owner);
  inside(await row(h, ft), 'today\'s flexible job');
  // 18 h 30: tomorrow's is due
  await clock(h, owner, 1110);
  await h.as(mech);
  r = await h.rpc('lock_windows_due', {});
  assert.deepEqual(r.jobs, [f.job_id]);
  assert.ok(r.untold.includes(f.job_id) && r.untold.includes(ft), 'both are still to be told');
  await h.as(owner);
  const jf = await row(h, f.job_id);
  assert.ok(jf.win_start !== null); inside(jf, 'tomorrow\'s flexible job');
  assert.equal((await row(h, lost)).win_start, null, 'the one « À placer » has no arrival: no window');
  // again: nothing to do; once its text is sent it is no longer listed
  await h.as(mech);
  assert.equal((await h.rpc('lock_windows_due', {})).fixed, 0);
  await server(h, owner, `insert into public.messages (job_id, kind, status, body) values ($1, 'window', 'sent', 'Plage confirmée')`, [f.job_id]);
  await h.as(mech);
  assert.deepEqual((await h.rpc('lock_windows_due', {})).untold, [ft]);
  // the button of Réglages (tomorrow) also covers today
  await h.as(owner);
  await server(h, owner, `update public.jobs set win_start = null, win_end = null where id = $1`, [ft]);
  await h.as(office);
  const l = await h.rpc('lock_windows', { p_op: uuid(), p_day: tomorrow });
  assert.deepEqual(l.jobs, [ft], 'today\'s flexible job fixed by the evening button');
  assert.ok(l.untold.includes(ft));
}));

test('x-dualmode-02: lock_windows_due is not open to someone who is not on the team', () => tx(async (h) => {
  const stranger = await h.person('Inconnu', ['mechanic']);
  await h.q(`delete from public.staff where id = $1`, [stranger]);
  await h.as(stranger);
  const e = await h.fails(() => h.rpc('lock_windows_due', {}));
  assert.ok(e && (e.hint === 'not_allowed' || /permission/.test(e.message)), 'refused: ' + e?.message);
}));

test('x-dualmode-03 / x-time-02: the windows offered are the ones the calendar asks for, whatever « avant » and the first hour', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: [[420, 1260]] });
  await windowsOn(h, owner);
  const shapes = [
    { before: 30, after: 210, round: 60, blocks: null },
    { before: 45, after: 195, round: 60, blocks: null },
    { before: 50, after: 190, round: 15, blocks: null },
    { before: 60, after: 180, round: 60, blocks: [[450, 720], [720, 960], [960, 1200]] },   // the day from 7 h 30
  ];
  for (const s of shapes) {
    const blocks = (s.blocks || [[480, 720], [720, 960], [960, 1200]]).map(([a, b], i) => ({ key: ['am', 'pm', 'eve'][i], start: a, end: b }));
    await server(h, owner, `update public.settings set booking = booking || $1::jsonb where id = 1`,
      [JSON.stringify({ win_before_min: s.before, win_after_min: s.after, win_round_min: s.round, blocks })]);
    const rows = await h.rpc('suggest_windows', { p_lat: near[0], p_lng: near[1], p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null });
    const offered = new Set(rows.map((x) => x.win_start));
    const span = await server(h, owner, `select start_min, end_min from public.day_span()`);
    const asked = await server(h, owner, `select distinct w.win_start from generate_series($1::int, $2::int, 15) t(m) cross join lateral public.win_for(t.m) w order by 1`, [span[0].start_min, span[0].end_min]);
    const missing = asked.map((x) => x.win_start).filter((w) => !offered.has(w));
    assert.deepEqual(missing, [], `avant ${s.before}, arrondi ${s.round}, day from ${span[0].start_min}: every window the calendar asks for is offered on an empty day`);
  }
}));

test('sql-planner-2-01: « Peu importe »: the suggestions offer the block where only the truck has room', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const car = await h.truck('Voiture', null, { [dow]: [[480, 720]] });
  const truck = await h.truck('Camion', null, { [dow]: [[480, 720]] });
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [car]);
  const home = await h.one(`select lat, lng from public.home_point()`);
  const at = (km) => [home.lat + km / 111.2, home.lng];
  const cs = [];
  for (const km of [1, 5, 6]) cs.push(await h.customer('Km' + km, ...at(km)));
  await h.as(owner);
  for (const cu of cs) assert.equal((await book(h, job(cu, day, 'am'))).truck_id, car);
  const s = await h.rpc('suggest_blocks', { p_lat: at(8)[0], p_lng: at(8)[1], p_duration: 60, p_from: day, p_days: 1, p_exclude: null, p_limit: 6, p_need: false, p_kind: null });
  const am = s.find((x) => x.block === 'am');
  assert.ok(am, 'the morning is offered');
  assert.equal(am.truck, truck);
}));

test('sql-windows-01 / x-dualmode-10: back to the blocks, a job goes to the block of its arrival, keeps what it was told and is listed to call', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c1 = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  await windowsOn(h, owner);
  const a = await book(h, { customer_id: c1, day, block: 'day', duration_min: 235, win_start: 480 });
  const b = await book(h, { customer_id: c2, day, block: 'day', duration_min: 60, win_start: 660 });
  const jb0 = await row(h, b.job_id);
  assert.ok(jb0.eta_min >= 720, `B arrives after noon (${jb0.eta_min})`); inside(jb0, 'B');
  const off = await h.rpc('windows_switch', { p_op: uuid(), p_on: false });
  const ja = await row(h, a.job_id), jb = await row(h, b.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end], ['am', null, null], 'a window that is a block: that block');
  assert.deepEqual([jb.block, jb.win_start, jb.win_end], ['pm', 660, 900], '11 h – 15 h arriving at 12 h 20: the afternoon, the window kept');
  assert.deepEqual(off.to_call.map((x) => x.job_id), [b.job_id], 'whom to call');
  assert.equal(off.converted, 2);
  assert.equal(await server(h, owner, `select count(*)::int n from public.activity where entity_id = $1 and action = 'window_to_block'`, [b.job_id]).then((r) => r[0].n), 1);
  const on = await h.rpc('windows_switch', { p_op: uuid(), p_on: true });
  assert.equal(on.ok, true);
  const jb2 = await row(h, b.job_id), ja2 = await row(h, a.job_id);
  assert.deepEqual([jb2.block, jb2.win_start, jb2.win_end], ['day', 660, 900], 'the window told comes back');
  assert.deepEqual([ja2.win_start, ja2.win_end], [480, 720]);
}));

/* ------------------------------------------------------------------------------------------------------------------
   « My vehicle », work on the spot, the steps of a job
   ------------------------------------------------------------------------------------------------------------------ */

test('sql-planner-2-02 / booking-a-13: with « Routes partagées », work on the spot goes on the vehicle I drive, never an arbitrary one', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const saleh = await h.person('Saleh', ['mechanic']), adam = await h.person('Adam', ['mechanic']);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = DAY;
  const tA = await h.truck('Camion', null, week);
  const tB = await h.truck('Voiture', adam, week);
  await h.q(`update public.trucks set sort = 1 where id = $1`, [tB]);
  await h.q(`update public.settings set booking = booking || '{"shared_routes": true}'::jsonb where id = 1`);
  const c = await h.customer('Jean', ...near);
  await h.as(adam);
  const w = await h.rpc('walk_in', { p_op: uuid(), p_job: { customer_id: c, duration_min: 30 }, p_items: [] });
  assert.equal((await row(h, w.job_id)).truck_id, tB, 'the vehicle Adam drives');
  await h.as(saleh);
  assert.equal((await h.fails(() => h.rpc('walk_in', { p_op: uuid(), p_job: { customer_id: c, duration_min: 30 }, p_items: [] })))?.hint, 'no_truck', 'Saleh drives none: it must be said');
  const w2 = await h.rpc('walk_in', { p_op: uuid(), p_job: { customer_id: c, duration_min: 30, truck_id: tA }, p_items: [] });
  assert.equal((await row(h, w2.job_id)).truck_id, tA);
  const ids = await h.val(`select public.my_truck_ids()`);
  assert.deepEqual(ids, [tA, tB], 'in the order of Horaires');
  void owner;
}));

test('sql-planner-1 B4: a cancellation never throws another appointment to « À placer »; putting it back must fit', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: [[480, 720]] });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const at = (km) => [home.lat + km / 111.2, home.lng];
  const c = await h.customer('Jean', ...at(1));
  // a morning already over its time (hours cut after it was planned): five stops on the truck
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await put(h, owner, { customer: c, day, block: 'am', truck: t1, order: i + 1, eta: 480 + 70 * i, dur: 60, lat: at(1 + i)[0], lng: at(1 + i)[1] }));
  const small = await put(h, owner, { customer: c, day, block: 'am', truck: t1, order: 5, eta: 760, dur: 15 });
  await h.as(owner);
  await h.rpc('job_step', { p_op: uuid(), p_job: small, p_action: 'cancel', p_data: {} });
  await h.as(null);
  for (const id of ids) assert.equal((await row(h, id)).truck_id, t1, 'still on the truck after the cancellation');
  // put back, a stop that would push another one out: refused
  await h.q(`delete from public.jobs where id = any($1::uuid[])`, [ids]);
  const ca = await h.customer('A', ...at(10)), cb = await h.customer('B', ...at(3)), cc = await h.customer('C', ...at(1));
  await h.as(owner);
  const a = await book(h, job(ca, day, 'am', { duration_min: 90 }));
  const b = await book(h, job(cb, day, 'am', { duration_min: 90 }));
  await h.rpc('job_step', { p_op: uuid(), p_job: b.job_id, p_action: 'cancel', p_data: {} });
  const cj = await book(h, job(cc, day, 'am', { duration_min: 90 }));
  const e = await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: b.job_id, p_action: 'reopen', p_data: {} }));
  assert.equal(e?.hint, 'block_full');
  assert.deepEqual([(await row(h, a.job_id)).truck_id, (await row(h, cj.job_id)).truck_id], [t1, t1], 'nobody lost a place');
}));

/* ------------------------------------------------------------------------------------------------------------------
   « Plages d'arrivée »: the plan of the day
   ------------------------------------------------------------------------------------------------------------------ */

test('sql-windows-02: a later re-plan never makes late a stop its stored route reaches in its window', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const kmLng = 1 / (111.2 * Math.cos((home.lat * Math.PI) / 180));
  const ca = await h.customer('A', home.lat, home.lng - 2 * kmLng), cb = await h.customer('B', home.lat, home.lng - 1.9 * kmLng);
  const ck = await h.customer('K', home.lat, home.lng + 20 * kmLng), cx = await h.customer('X', home.lat + 0.01, home.lng);
  await windowsOn(h, owner);
  const a = await book(h, { customer_id: ca, day, block: 'day', duration_min: 150, win_start: 480 });
  const b = await book(h, { customer_id: cb, day, block: 'day', duration_min: 30, win_start: 480 });
  const k = await book(h, { customer_id: ck, day, block: 'day', duration_min: 60, win_start: 480 });
  const ids = [a.job_id, b.job_id, k.job_id];
  for (const id of ids) inside(await row(h, id), 'booked');
  // the plan made again (as a cancellation, a position found or the evening's lock would)
  await server(h, owner, `select public.replan_block($1::date, 'day')`, [day]);
  for (const id of ids) inside(await row(h, id), 'after a re-plan');
  // another booking that day, in the afternoon
  await book(h, { customer_id: cx, day, block: 'day', duration_min: 60, win_start: 840 });
  for (const id of ids) inside(await row(h, id), 'after another booking');
}));

test('sql-windows-03 / x-dualmode-06: window mode, a day already started: the stops left are numbered after the ones done', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = DAY;
  const t1 = await h.truck('Camion', null, week);
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  await clock(h, owner, 780);                                   // 13 h
  const d1 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, status: 'done', order: 1, eta: 500 });
  const d2 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, status: 'done', order: 2, eta: 600 });
  const s3 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 3, eta: 840, ws: 780, we: 1020 });
  const s4 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 4, eta: 900, ws: 840, we: 1080, lat: near2[0], lng: near2[1] });
  const s5 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 5, eta: 960, ws: 900, we: 1140 });
  await server(h, owner, `update public.jobs set finished_at = now() - interval '2 hours' where id = $1`, [d1]);
  await h.as(owner);
  await h.rpc('job_step', { p_op: uuid(), p_job: s5, p_action: 'cancel', p_data: {} });
  const nums = [];
  for (const id of [d1, d2, s3, s4]) nums.push((await row(h, id)).stop_order);
  assert.deepEqual(nums.slice(0, 2), [1, 2], 'the stops done keep 1 and 2');
  assert.deepEqual(nums.slice(2).sort(), [3, 4], `the stops left come after them: ${nums}`);
}));

test('sql-windows-05 / x-dualmode-08: window mode, a truck with a break in its hours is not planned during the break', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: [[480, 720], [960, 1200]] });        // 8 h – 12 h, then 16 h – 20 h
  const cs = [];
  for (let i = 0; i < 6; i++) cs.push(await h.customer('C' + i, near[0] + 0.002 * i, near[1]));
  await windowsOn(h, owner);
  const ids = [];
  for (const cu of cs) {
    const r = await h.fails(() => book(h, { customer_id: cu, day, block: 'day', duration_min: 60 }));
    if (!r) ids.push((await h.one(`select id from public.jobs where customer_id = $1 and day = $2`, [cu, day])).id);
  }
  assert.ok(ids.length >= 5, `the two stretches hold the appointments (${ids.length})`);
  for (const id of ids) {
    const j = await row(h, id);
    assert.ok(j.eta_min + 60 <= 720 || j.eta_min >= 960, `nobody during the break: ${j.eta_min}`);
  }
  // the windows offered: none the truck can only reach during the break, the evening ones are offered
  const w = await h.rpc('suggest_windows', { p_lat: near2[0], p_lng: near2[1], p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null });
  for (const x of w) assert.ok(x.eta + 60 <= 720 || x.eta >= 960, `offered arrival ${x.eta}`);
  // a lunch hour: 8 h – 12 h and 13 h – 18 h, the day is sold until 18 h
  await h.as(null);
  const day2 = await h.val(`select ($1::date + 7)::text`, [day]);
  await h.q(`update public.truck_week set ranges = $1 where dow = $2`, [JSON.stringify([[480, 720], [780, 1080]]), dow]);
  await h.as(owner);
  const lunch = [];
  for (let i = 0; i < 7; i++) {
    const cu = cs[i % cs.length];
    const e = await h.fails(() => book(h, { customer_id: cu, day: day2, block: 'day', duration_min: 60 }));
    if (e) break;
  }
  for (const j of await h.q(`select eta_min, duration_min from public.jobs where day = $1 and status = 'booked'`, [day2])) {
    lunch.push(j.eta_min);
    assert.ok(j.eta_min + 60 <= 720 || j.eta_min >= 780, `nobody during lunch: ${j.eta_min}`);
    assert.ok(j.eta_min + 60 <= 1080, `inside the hours: ${j.eta_min}`);
  }
  assert.ok(lunch.length >= 7, `the 9 worked hours hold 7 appointments of an hour (${lunch.length})`);
}));
