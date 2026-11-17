// « Refonte » (Part 26), the planner: each test is a verified finding of the audit of 2026-11-15, red without the
// migration 20261116000200_refonte_planification.sql. Run: node --test tests/db/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';
import { randomUUID } from 'node:crypto';

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
    // in the order of their ids (without an order the rows came back in either order: red once in a while)
    const before = await h.q(`select id, updated_at from public.jobs where id = any($1::uuid[]) order by id`, [[b1, b2]]);
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
    assert.deepEqual(await h.q(`select id, updated_at from public.jobs where id = any($1::uuid[]) order by id`, [[b1, b2]]), before, `${at}: the other truck's rows are not touched`);
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

test('x-dualmode-11: a move kept on a phone in block mode, the same day, takes the window of the block asked (it was thrown away)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion 1', null, { [dow]: DAY }), t2 = await h.truck('Camion 2', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await h.as(owner);
  const a = await book(h, job(c, day, 'am'));                    // the morning, while the garage gave blocks
  await windowsOn(h, owner);
  let ja = await row(h, a.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end], ['day', 480, 720]);
  // a phone still in block mode moves it to the afternoon of the same day (the 5-argument move)
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'pm', p_truck: null });
  assert.notEqual(m.unchanged, true, 'not thrown away');
  assert.deepEqual([m.changed, m.tell, m.window_changed], [false, true, true]);
  ja = await row(h, a.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end, ja.win_flex], ['day', 720, 960, false]);
  inside(ja, 'the afternoon');
  // the same phone gives it the other truck, in the afternoon it shows: the window told stays
  const other = ja.truck_id === t1 ? t2 : t1;
  const k = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'pm', p_truck: other });
  ja = await row(h, a.job_id);
  assert.deepEqual([ja.truck_id, ja.win_start, ja.win_end, k.tell, k.truck_changed], [other, 720, 960, false, true]);
}));

test('x-dualmode-11 (blocks): a window chosen inside the job’s own block on a phone in window mode is kept and to be told', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await h.as(owner);
  const a = await book(h, job(c, day, 'pm'));
  // 13 h – 17 h: the afternoon (arrival around 14 h), the job's own block
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 780, p_win_flex: false });
  assert.notEqual(m.unchanged, true, 'not thrown away');
  assert.deepEqual([m.changed, m.tell, m.window_changed], [false, true, true]);
  let ja = await row(h, a.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end], ['pm', 780, 1020], 'the window told is kept on the job');
  // the block's very hours: nothing is kept on the job
  const m2 = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'day', p_truck: null, p_win_start: 720, p_win_flex: false });
  ja = await row(h, a.job_id);
  assert.deepEqual([ja.block, ja.win_start, ja.win_end, m2.window_changed], ['pm', null, null, true]);
}));

test('x-dualmode-11: a block’s « Ordre des arrêts » kept on a phone keeps the hand order of the day’s other stops', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  const m1 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 1, eta: 500, ws: 480, we: 720 });
  const m2 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 2, eta: 560, ws: 480, we: 720, lat: near2[0], lng: near2[1] });
  const a1 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 3, eta: 760, ws: 720, we: 960 });
  const a2 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 4, eta: 820, ws: 720, we: 960, lat: near2[0], lng: near2[1] });
  await h.as(owner);
  await stopOrder(h, t1, day, 'day', [a2, a1]);                   // the afternoon put in order by hand, in window mode
  // a phone still in block mode puts the morning in order
  assert.equal((await stopOrder(h, t1, day, 'am', [m2, m1])).ok, true);
  const hand = [];
  for (const id of [m2, m1, a2, a1]) hand.push((await row(h, id)).manual_order);
  assert.deepEqual(hand, [1, 2, 3, 4], 'the morning as asked, then the afternoon as it was');
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

/** how many plans were made from the start of the test's transaction (plan_route = the planner) */
async function plans(h, who) {
  return (await server(h, who, `select coalesce((select calls from pg_stat_xact_user_functions where schemaname = 'public' and funcname = 'plan_route'), 0)::int n`))[0].n;
}

test('review 1: a day held on its stored routes: each window offered is planned once (the plan from nothing, thrown away, was made too)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const kmLng = 1 / (111.2 * Math.cos((home.lat * Math.PI) / 180));
  const ca = await h.customer('A', home.lat, home.lng - 2 * kmLng), cb = await h.customer('B', home.lat, home.lng - 1.9 * kmLng);
  const ck = await h.customer('K', home.lat, home.lng + 20 * kmLng);
  await windowsOn(h, owner);
  for (const [cu, dur] of [[ca, 150], [cb, 30], [ck, 60]]) await book(h, { customer_id: cu, day, block: 'day', duration_min: dur, win_start: 480 });
  await server(h, owner, `set local track_functions = 'pl'`);
  const p0 = (await server(h, owner, `select public.plan_block($1::date, 'day') p`, [day]))[0].p;
  assert.equal(p0.seeded, true, 'a plan from nothing would make a promised stop late: the day is held on its stored routes');
  const tried = (await server(h, owner, `select count(distinct w.win_start)::int n from public.day_span() s, generate_series(s.start_min, s.end_min, 15) t(m) cross join lateral public.win_for(t.m) w`))[0].n;
  const n0 = await plans(h, owner);
  const rows = await h.rpc('suggest_windows', { p_lat: home.lat + 0.01, p_lng: home.lng, p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null });
  const n = (await plans(h, owner)) - n0;
  assert.ok(rows.length > 0);
  assert.ok(n <= 2 + tried, `${n} plans for ${tried} windows (the day twice, then each window once)`);
}));

test('review 1: « Peu importe », both vehicles full: the truck is not planned a second time for nothing', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const car = await h.truck('Voiture', null, { [dow]: [[480, 540]] }), truck = await h.truck('Camion', null, { [dow]: [[480, 540]] });
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [car]);
  const c = await h.customer('Jean', ...near);
  await put(h, owner, { customer: c, day, block: 'am', truck: car, order: 1, eta: 490, dur: 50, kind: 'car' });
  await put(h, owner, { customer: c, day, block: 'am', truck, order: 1, eta: 490, dur: 50, kind: 'truck' });
  await server(h, owner, `set local track_functions = 'pl'`);
  const n0 = await plans(h, owner);
  assert.equal((await h.fails(() => book(h, job(c, day, 'am'))))?.hint, 'block_full');
  assert.equal((await plans(h, owner)) - n0, 2, 'the block, then the block with the stop: no vehicle had room, the truck included');
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

test('sql-planner-1 B4: an address found in the background never throws an appointment to « À placer »; closing the hours still does', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: [[480, 720]] });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const at = (km) => [home.lat + km / 111.2, home.lng];
  const ca = await h.customer('A', ...at(1)), cb = await h.customer('B', ...at(1.2));
  const cc = await h.customer('C', null, null);
  await h.as(owner);
  const ids = [];
  for (const cu of [ca, cb, cc]) ids.push((await book(h, job(cu, day, 'am'))).job_id);
  for (const id of ids) assert.equal((await row(h, id)).truck_id, t1);
  // C's address is found 25 km away: the morning no longer holds the three on paper
  await h.as(null);
  await h.q(`update public.customers set lat = $1, lng = $2 where id = $3`, [...at(25), cc]);
  for (const id of ids) assert.equal((await row(h, id)).truck_id, t1, 'nobody thrown to « À placer » by the address found');
  // the truck no longer works that morning: its appointments go to « À placer », as before
  await h.q(`insert into public.truck_days (truck_id, day, ranges) values ($1, $2, '[]')`, [t1, day]);
  for (const id of ids) assert.equal((await row(h, id)).truck_id, null, 'the hours closed: « À placer »');
}));

test('x-dualmode-01 (server side): each window offered says what it adds to the day and whether it is far', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const c = await h.customer('Près', home.lat + 0.01, home.lng);
  await windowsOn(h, owner);
  await book(h, { customer_id: c, day, block: 'day', duration_min: 60, win_start: 600 });
  const far = await h.rpc('suggest_windows', { p_lat: home.lat + 0.4, p_lng: home.lng, p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null });
  assert.ok(far.length > 0);
  for (const x of far) { assert.equal(x.far, 'hop', `44 km from the day's stop: far (${x.hop_min} min)`); assert.ok(x.add_min > 0 && x.stops === 1); }
  const close = await h.rpc('suggest_windows', { p_lat: home.lat + 0.011, p_lng: home.lng, p_duration: 60, p_day: day, p_exclude: null, p_need: false, p_kind: null });
  assert.ok(close.length > 0 && close.every((x) => x.far === null), 'next door: not far');
}));

test('sql-planner-1 B7: the last morning stop cancelled, the afternoon is planned again from where the truck now leaves', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const cx = await h.customer('Loin', home.lat + 0.2, home.lng), cy = await h.customer('Près', home.lat + 0.01, home.lng);
  await h.as(owner);
  const x = await book(h, job(cx, day, 'am'));
  const y = await book(h, job(cy, day, 'pm'));
  const before = (await row(h, y.job_id)).travel_min;
  await h.rpc('job_step', { p_op: uuid(), p_job: x.job_id, p_action: 'cancel', p_data: {} });
  const after = (await row(h, y.job_id)).travel_min;
  assert.ok(after < before, `the afternoon leaves from the start again, not from the cancelled customer (${before} → ${after})`);
}));

test('sql-planner-2-06: a vehicle that loses the tire machine: its coming tire work goes to a vehicle that has it; its history is not rewritten', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const v1 = await h.truck('Voiture', null, { [dow]: DAY }), v2 = await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  const tire = await put(h, owner, { customer: c, day, block: 'am', truck: v1, order: 1, eta: 500, need: true, kind: 'truck', pinned: true });
  const old = await put(h, owner, { customer: c, day: await h.val(`select (public.local_today() - 3)::text`), block: 'am', truck: v1, status: 'done', order: 1, eta: 500, kind: 'truck' });
  await h.as(null);
  const stamp = (await row(h, old)).updated_at;
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [v1]);
  assert.equal((await row(h, tire)).truck_id, v2, 'the tire work goes to the vehicle with the machine');
  const jo = await row(h, old);
  assert.deepEqual([jo.vehicle_kind, jo.updated_at], ['truck', stamp], 'a job already done is not rewritten');
}));

test('sql-planner-2 B6: tire work that finds no room on the truck stays on the car, and the agenda is told (needs_truck)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const car = await h.truck('Voiture', null, { [dow]: DAY }), truck = await h.truck('Camion', null, { [dow]: [[480, 560]] });
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [car]);
  const c = await h.customer('Jean', ...near);
  await put(h, owner, { customer: c, day, block: 'am', truck, order: 1, eta: 490, dur: 40, need: true, kind: 'truck' });
  const j = await put(h, owner, { customer: c, day, block: 'am', truck: car, order: 1, eta: 500, dur: 60, kind: 'car' });
  await h.as(null);
  await h.q(`insert into public.job_items (job_id, kind, description, qty, unit_cents, status) values ($1, 'service', 'Montage de pneus', 1, 0, 'planned')`, [j]);
  const jj = await row(h, j);
  assert.deepEqual([jj.needs_machine, jj.truck_id], [true, car], 'no room on the truck: it stays on the car, nobody in « À placer »');
  const said = () => h.q(`select data from public.activity where entity = 'job' and entity_id = $1 and action = 'needs_truck'`, [j]);
  assert.deepEqual((await said()).map((x) => x.data.truck_id), [car]);
  await h.q(`select public.replan_block($1::date, 'am')`, [day]);
  assert.equal((await said()).length, 1, 'said once');
}));

test('sql-windows-04: window mode, a job booked « quand même » is not sent behind every stop of the day when it fits', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  await windowsOn(h, owner);
  // a morning job booked « quand même » (8 h – 12 h after the switch), an afternoon and an evening appointment, a day with room
  const f = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 3, eta: 1000, ws: 480, we: 720, forced: true, dur: 60 });
  await book(h, { customer_id: c2, day, block: 'day', duration_min: 60, win_start: 720 });
  await book(h, { customer_id: c, day, block: 'day', duration_min: 60, win_start: 960 });
  await server(h, owner, `select public.replan_block($1::date, 'day')`, [day]);
  const jf = await row(h, f);
  assert.ok(jf.eta_min <= 720, `the forced morning job is in the morning: ${jf.eta_min}`);
  assert.equal(jf.stop_order, 1);
}));

/* ------------------------------------------------------------------------------------------------------------------
   Two real connections (committed data, deleted at the end)
   ------------------------------------------------------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p.then(() => 'done', () => 'failed'), sleep(ms).then(() => 'waiting')]);

test('booking-a-08, two connections: the same estimate booked on two devices at the same instant makes one appointment', async () => {
  const c = await pool.connect();
  const opened = [];
  const start = (await c.query(`select clock_timestamp() as t`)).rows[0].t;
  const owner = randomUUID(), truck = randomUUID(), cust = randomUUID();
  let quote = null;
  try {
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Hassan Conc', 'Hassan', '{owner}', '{}', $2)`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.trucks (id, name, active, sort) values ($1, 'Camion Conc', true, 0)`, [truck]);
    for (let d = 0; d < 7; d++) await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [truck, d, JSON.stringify(DAY)]);
    await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'Conc', 'Test', '5145550000', $2, $3, '1 rue Test')`, [cust, ...near]);
    quote = (await c.query(`insert into public.quotes (customer_id, status) values ($1, 'accepted') returning id`, [cust])).rows[0].id;
    const day = (await c.query(`select (public.local_today() + 30)::text d`)).rows[0].d;
    const open = async () => {
      const k = await pool.connect(); opened.push(k);
      await k.query('begin');
      await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' }), owner]);
      await k.query('set local role authenticated');
      return k;
    };
    const sql = `select public.book_job(p_op => $1, p_job => $2::jsonb, p_items => '[]'::jsonb) as r`;
    const payload = (block) => JSON.stringify({ customer_id: cust, day, block, duration_min: 60, quote_id: quote });
    const k1 = await open(), k2 = await open();
    const r1 = (await k1.query(sql, [randomUUID(), payload('am')])).rows[0].r;
    assert.equal(r1.ok, true);
    const p2 = k2.query(sql, [randomUUID(), payload('pm')]);
    assert.equal(await within(p2, 400), 'waiting', 'the second device waits for the first');
    await k1.query('commit');
    const e = await p2.then(() => null, (x) => x);
    assert.equal(e?.hint, 'quote_done', 'then it is told the estimate is already booked');
    await k2.query('rollback');
    assert.equal((await c.query(`select count(*)::int n from public.jobs where quote_id = $1 and deleted_at is null`, [quote])).rows[0].n, 1);
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    await c.query(`select set_config('garage.rpc', 'on', false)`);
    if (quote) {
      await c.query(`update public.quotes set job_id = null where id = $1`, [quote]);
      await c.query(`delete from public.job_items where job_id in (select id from public.jobs where quote_id = $1)`, [quote]);
      await c.query(`delete from public.jobs where quote_id = $1`, [quote]);
      await c.query(`delete from public.quotes where id = $1`, [quote]);
    }
    await c.query(`delete from public.jobs where customer_id = $1`, [cust]);
    await c.query(`delete from public.customers where id = $1`, [cust]);
    await c.query(`delete from public.truck_week where truck_id = $1`, [truck]);
    await c.query(`delete from public.trucks where id = $1`, [truck]);
    await c.query(`delete from public.op_log where at >= $1`, [start]);
    await c.query(`delete from public.activity where at >= $1`, [start]);
    await c.query(`delete from auth.users where id = $1`, [owner]);
    await c.query(`select set_config('garage.rpc', '', false)`);
    c.release();
  }
});

test('sql-windows-09: window mode, today, an appointment that no longer fits still holds its time on its truck', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = [[480, 1020]];     // the truck ends at 17 h
  const t1 = await h.truck('Camion', null, week);
  const c = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  await windowsOn(h, owner);
  await clock(h, owner, 900);                                                // 15 h, running late
  const j1 = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 1, eta: 905, ws: 840, we: 1080, dur: 60 });
  const j2 = await put(h, owner, { customer: c2, day, block: 'day', truck: t1, order: 2, eta: 970, ws: 900, we: 1140, dur: 120 });
  await h.as(owner);
  const e = await h.fails(() => book(h, { customer_id: c, day, block: 'day', duration_min: 30, lat: near[0] + 0.001, lng: near[1] }));
  assert.ok(e && ['block_full', 'window_full'].includes(e.hint), 'the 30 minutes left are J2\'s: refused (' + (e?.hint ?? 'booked') + ')');
  assert.deepEqual([(await row(h, j1)).truck_id, (await row(h, j2)).truck_id], [t1, t1], 'both stay on the truck');
}));

test('sql-windows-09: window mode, today, a flexible appointment that no longer fits counts as late on its truck (no window to be late for)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = [[480, 1020]];
  const t1 = await h.truck('Camion', null, week);
  const c = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2);
  await windowsOn(h, owner);
  await clock(h, owner, 900);
  await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 1, eta: 905, ws: 840, we: 1080, dur: 60 });
  const j2 = await put(h, owner, { customer: c2, day, block: 'day', truck: t1, order: 2, eta: 970, flex: true, dur: 120 });
  const p = (await server(h, owner, `select public.plan_block($1::date, 'day') p`, [day]))[0].p;
  assert.equal(p.jobs[j2]?.truck, t1, 'it stays on its truck');
  assert.ok(!p.over.includes(j2));
  assert.ok(p.late.includes(j2), 'late: a booking that pushes it past the hours is seen');
}));

test('sql-planner-1 B6: block mode, hours with a hole inside the block are not planned as one stretch', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: [[480, 570], [630, 720]] });      // 8 h – 9 h 30, then 10 h 30 – 12 h
  const c1 = await h.customer('A', ...near), c2 = await h.customer('B', ...near2);
  await h.as(owner);
  const a = await book(h, job(c1, day, 'am'));
  const b = await book(h, job(c2, day, 'am'));
  for (const id of [a.job_id, b.job_id]) {
    const j = await row(h, id);
    assert.ok(j.eta_min + 60 <= 570 || j.eta_min >= 630, `nobody during the hole: ${j.eta_min}`);
  }
}));

test('sql-planner-1 B6: a block already started, « Ordre des arrêts »: the times walked again respect the hole in the hours', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = [[480, 570], [630, 720]];   // 8 h – 9 h 30, then 10 h 30 – 12 h
  const t1 = await h.truck('Camion', null, week);
  const c = await h.customer('Jean', ...near);
  await clock(h, owner, 540);                                      // 9 h: the morning has started
  const s1 = await put(h, owner, { customer: c, day, block: 'am', truck: t1, order: 1, eta: 545, dur: 30 });
  const s2 = await put(h, owner, { customer: c, day, block: 'am', truck: t1, order: 2, eta: 585, dur: 30, lat: near2[0], lng: near2[1] });
  await h.as(owner);
  assert.equal((await stopOrder(h, t1, day, 'am', [s2, s1])).ok, true);
  for (const id of [s2, s1]) {
    const j = await row(h, id);
    assert.equal(j.truck_id, t1);
    assert.ok(j.eta_min + 35 <= 570 || j.eta_min >= 630, `not planned into the hole: ${j.eta_min}`);
  }
  assert.ok((await row(h, s2)).eta_min < (await row(h, s1)).eta_min, 'in the order asked');
}));

test('sql-planner-1 B11 / sql-windows-13, two connections: two devices moving the same appointment at once: the second is told it just moved', async () => {
  const c = await pool.connect();
  const opened = [];
  const start = (await c.query(`select clock_timestamp() as t`)).rows[0].t;
  const owner = randomUUID(), truck = randomUUID(), cust = randomUUID();
  try {
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Hassan Conc', 'Hassan', '{owner}', '{}', $2)`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.trucks (id, name, active, sort) values ($1, 'Camion Conc', true, 0)`, [truck]);
    for (let d = 0; d < 7; d++) await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [truck, d, JSON.stringify(DAY)]);
    await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'Conc', 'Test', '5145550000', $2, $3, '1 rue Test')`, [cust, ...near]);
    const days = (await c.query(`select (public.local_today() + 30)::text d1, (public.local_today() + 31)::text d2, (public.local_today() + 32)::text d3`)).rows[0];
    const open = async () => {
      const k = await pool.connect(); opened.push(k);
      await k.query('begin');
      await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' }), owner]);
      await k.query('set local role authenticated');
      return k;
    };
    const k0 = await open();
    const id = (await k0.query(`select public.book_job(p_op => $1, p_job => $2::jsonb) as r`, [randomUUID(), JSON.stringify({ customer_id: cust, day: days.d1, block: 'am', duration_min: 60 })])).rows[0].r.job_id;
    await k0.query('commit');
    const move = `select public.move_job(p_op => $1, p_job => $2, p_day => $3::date, p_block => 'am', p_truck => null) as r`;
    const k1 = await open(), k2 = await open();
    assert.equal((await k1.query(move, [randomUUID(), id, days.d2])).rows[0].r.changed, true);
    const p2 = k2.query(move, [randomUUID(), id, days.d3]);
    assert.equal(await within(p2, 400), 'waiting', 'the second device waits for the first');
    await k1.query('commit');
    const e = await p2.then(() => null, (x) => x);
    assert.equal(e?.hint, 'changed', 'then it is told the appointment just moved');
    await k2.query('rollback');
    assert.equal((await c.query(`select day::text from public.jobs where id = $1`, [id])).rows[0].day, days.d2, 'where the first device put it');
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    await c.query(`select set_config('garage.rpc', 'on', false)`);
    await c.query(`delete from public.job_items where job_id in (select id from public.jobs where customer_id = $1)`, [cust]);
    await c.query(`delete from public.jobs where customer_id = $1`, [cust]);
    await c.query(`delete from public.customers where id = $1`, [cust]);
    await c.query(`delete from public.truck_week where truck_id = $1`, [truck]);
    await c.query(`delete from public.trucks where id = $1`, [truck]);
    await c.query(`delete from public.op_log where at >= $1`, [start]);
    await c.query(`delete from public.activity where at >= $1`, [start]);
    await c.query(`delete from auth.users where id = $1`, [owner]);
    await c.query(`select set_config('garage.rpc', '', false)`);
    c.release();
  }
});

/* ------------------------------------------------------------------------------------------------------------------
   job_step, asked by the money rules (Part 26 « argent »: requests/srv-argent.md)
   ------------------------------------------------------------------------------------------------------------------ */

/** a job on Saleh's truck, on site, with one line of work */
async function onSite(h) {
  const owner = await h.person('Hassan', ['owner']), saleh = await h.person('Saleh', ['mechanic']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', saleh, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await h.as(owner);
  const id = (await book(h, job(c, day, 'am'), [{ description: 'Freins avant', unit_cents: 20000, qty: 1 }])).job_id;
  await h.as(saleh);
  for (const a of ['leave', 'arrive']) await h.rpc('job_step', { p_op: uuid(), p_job: id, p_action: a, p_data: {} });
  return { owner, saleh, id };
}
const step = (h, id, action, data = {}) => h.rpc('job_step', { p_op: uuid(), p_job: id, p_action: action, p_data: data });
const finishedInvoice = async (h, id) => {
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: id, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  return inv;
};

test('sql-money-29 (asked by « argent »): the amount lost of a cancellation takes a discount off, whatever sign it was written with', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await h.as(owner);
  const r = await book(h, job(c, day, 'am'), [{ description: 'Freins avant', unit_cents: 20000, qty: 1 }]);
  await h.as(null);
  await h.q(`insert into public.job_items (job_id, kind, description, qty, unit_cents, status)
    values ($1, 'discount', 'Rabais fidélité', 1, 2500, 'planned'), ($1, 'discount', 'Rabais', 2, -500, 'planned')`, [r.job_id]);
  await h.as(owner);
  await step(h, r.job_id, 'cancel');
  assert.equal((await row(h, r.job_id)).lost_cents, 20000 - 2500 - 1000, 'a discount written positive took off nothing: it was added');
}));

test('sql-money-31 (asked by « argent »): « payer plus tard » given by the office holds when the job is finished again', () => tx(async (h) => {
  const { owner, saleh, id } = await onSite(h);
  await finishedInvoice(h, id);
  await h.as(owner);
  await step(h, id, 'finish', { pay_later: true, reason: 'Paie au mois' });
  await step(h, id, 'back');                                         // « Défaire »: back on site
  assert.equal((await row(h, id)).status, 'on_site');
  await h.as(saleh);
  assert.equal((await step(h, id, 'finish')).ok, true, 'the mechanic finishes again: the office already said « plus tard »');
  assert.deepEqual([(await row(h, id)).status, (await row(h, id)).pay_later], ['done', true]);
}));

test('« Terminer quand même » (asked by « argent »): the office’s word reaches the guard of work not on the invoice, a mechanic’s does not', () => tx(async (h) => {
  const { owner, saleh, id } = await onSite(h);
  const inv = await finishedInvoice(h, id);
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [inv]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: total, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  await h.as(null);
  // the guard of Part 26 « argent » (jobs_unbilled_guard, another branch): a stand-in with its rule while it is not here
  if (!(await h.val(`select count(*)::int from pg_trigger where tgrelid = 'public.jobs'::regclass and tgname = 'jobs_unbilled_guard'`))) {
    await h.q(`create function public.test_unbilled_guard() returns trigger language plpgsql as $$
      begin
        if coalesce(current_setting('garage.unbilled_ok', true), '') <> 'on' and exists (select 1 from public.job_items i where i.job_id = new.id
             and i.deleted_at is null and i.status in ('planned','done','approved') and i.description = 'Travail oublié') then
          perform public.fail('unbilled', 'Un travail n’est pas sur la facture.');
        end if;
        return new;
      end $$`);
    await h.q(`create trigger jobs_unbilled_guard before update of status on public.jobs for each row
      when (new.status = 'done' and old.status is distinct from 'done') execute function public.test_unbilled_guard()`);
  }
  // work added once the invoice is paid: on no line of it
  await h.q(`insert into public.job_items (job_id, kind, description, qty, unit_cents, status) values ($1, 'service', 'Travail oublié', 1, 5000, 'planned')`, [id]);
  await h.as(saleh);
  assert.equal((await h.fails(() => step(h, id, 'finish', { unbilled_ok: true })))?.hint, 'unbilled', 'a mechanic cannot let it go');
  await h.as(owner);
  assert.equal((await h.fails(() => step(h, id, 'finish')))?.hint, 'unbilled', 'nothing said: refused');
  assert.equal((await step(h, id, 'finish', { unbilled_ok: true })).ok, true, 'the office’s « Terminer quand même »');
  assert.equal((await row(h, id)).status, 'done');
  assert.equal(await h.val(`select coalesce(current_setting('garage.unbilled_ok', true), '')`), '', 'the word holds for that job only');
}));

/* ------------------------------------------------------------------------------------------------------------------
   Round 2
   ------------------------------------------------------------------------------------------------------------------ */

test('R110: « Routes partagées » that is not a yes / no (« oui » written by hand) never breaks a mechanic’s rows', () => tx(async (h) => {
  const saleh = await h.person('Saleh', ['mechanic']);
  const tA = await h.truck('Camion', saleh, WEEK), tB = await h.truck('Voiture', null, WEEK);
  const c = await h.customer('Jean', ...near);
  const day = await futureDay(h);
  const mine = await put(h, null, { customer: c, day, block: 'am', truck: tA, order: 1, eta: 500 });
  await put(h, null, { customer: c, day, block: 'am', truck: tB, order: 1, eta: 500 });
  const shared = (v) => server(h, saleh, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{shared_routes}', $1::jsonb) where id = 1`, [JSON.stringify(v)]);
  const seen = async () => (await h.q(`select id from public.jobs where day = $1 order by id`, [day])).map((r) => r.id);
  await shared('oui');
  assert.deepEqual(await seen(), [mine], 'not a yes: his own truck only, and no error');
  assert.deepEqual(await h.val(`select public.my_truck_ids()`), [tA]);
  for (const v of [true, 'true', 1]) {
    await shared(v);
    assert.equal((await seen()).length, 2, `${JSON.stringify(v)}: every vehicle`);
  }
  for (const v of [false, 'non', 0, null, ['x']]) {
    await shared(v);
    assert.deepEqual(await seen(), [mine], `${JSON.stringify(v)}: his own`);
  }
}));

test('R96: a job step needs a job the caller sees (« Réserver » without « Agenda » no longer acts on another truck’s job)', () => tx(async (h) => {
  const office = await h.person('Bureau', ['office']);
  const saleh = await h.person('Saleh', ['mechanic'], { rights: { book: true } }), adam = await h.person('Adam', ['mechanic']);
  const tA = await h.truck('Camion', saleh, WEEK), tB = await h.truck('Voiture', adam, WEEK);
  const c = await h.customer('Jean', ...near);
  const day = await futureDay(h);
  const other = await put(h, null, { customer: c, day, block: 'am', truck: tB, order: 1, eta: 500 });
  const his = await put(h, null, { customer: c, day, block: 'pm', truck: tB, order: 1, eta: 800 });
  await server(h, saleh, `update public.jobs set created_by = $1 where id = $2`, [saleh, his]);
  await h.as(saleh);
  assert.equal(await h.val(`select public.can('book')`), true, 'he may book');
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: other, p_action: 'leave', p_data: {} })))?.hint, 'not_allowed', 'another truck’s job he does not see');
  assert.equal((await row(h, other)), undefined, 'he does not see it');
  assert.equal((await h.rpc('job_step', { p_op: uuid(), p_job: his, p_action: 'leave', p_data: {} })).ok, true, 'a job he booked himself');
  // a mechanic without « Réserver »: a job « À placer » (no truck) or booked by nobody is not his either (it was let
  // through: the rule answered NULL, not « no »)
  const loose = await put(h, null, { customer: c, day, block: 'eve', truck: null });
  await h.as(adam);
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: loose, p_action: 'leave', p_data: {} })))?.hint, 'not_allowed', 'a job « À placer »');
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: his, p_action: 'back', p_data: {} })))?.hint, undefined, 'his own truck’s job: yes');
  await h.as(office);
  assert.equal((await h.rpc('job_step', { p_op: uuid(), p_job: other, p_action: 'leave', p_data: {} })).ok, true, 'the office (Agenda)');
}));

test('R185 / x-time-06: « ce jour-là » or « quelques semaines » on a day already past is refused; no number of weeks is one week', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const t1 = await h.truck('Camion', null, WEEK);
  const day = await today(h), yesterday = await h.val(`select (public.local_today() - 1)::text`);
  const week = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[600, 900]]]));
  await h.as(owner);
  const hours = (mode, from, weeks, op = uuid()) => h.rpc('apply_hours', { p_op: op, p_truck: t1, p_mode: mode, p_week: week, p_from: from, p_weeks: weeks });
  for (const mode of ['day', 'weeks']) {
    assert.equal((await h.fails(() => hours(mode, yesterday, 1)))?.hint, 'past', `${mode} from yesterday`);
  }
  assert.equal(await h.val(`select count(*)::int from public.truck_days where truck_id = $1 and deleted_at is null`, [t1]), 0, 'today was not changed instead');
  const r = await hours('weeks', day, null);
  assert.equal(r.changed, 7, 'no number of weeks: one week (it was 52)');
  assert.equal((await hours('always', yesterday, null)).ok, true, '« en permanence » still starts today');
  const op = uuid();
  const a = await hours('day', day, 1, op), b = await hours('day', day, 1, op);
  assert.deepEqual(b, a, 'the same change sent twice answers the same');
}));

test('sql-windows-14 / sql-planner-1-22, two connections: the same booking sent twice at the same instant makes one appointment and answers twice the same', async () => {
  const c = await pool.connect();
  const opened = [];
  const start = (await c.query(`select clock_timestamp() as t`)).rows[0].t;
  const owner = randomUUID(), truck = randomUUID(), cust = randomUUID();
  try {
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Hassan Twice', 'Hassan', '{owner}', '{}', $2)`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.trucks (id, name, active, sort) values ($1, 'Camion Twice', true, 0)`, [truck]);
    for (let d = 0; d < 7; d++) await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [truck, d, JSON.stringify(DAY)]);
    await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'Twice', 'Test', '5145550000', $2, $3, '1 rue Test')`, [cust, ...near]);
    const day = (await c.query(`select (public.local_today() + 31)::text d`)).rows[0].d;
    const open = async () => {
      const k = await pool.connect(); opened.push(k);
      await k.query('begin');
      await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' }), owner]);
      await k.query('set local role authenticated');
      return k;
    };
    const sql = `select public.book_job(p_op => $1, p_job => $2::jsonb, p_items => '[]'::jsonb) as r`;
    const op = randomUUID(), id = randomUUID();
    const payload = JSON.stringify({ id, customer_id: cust, day, block: 'am', duration_min: 60 });
    const k1 = await open(), k2 = await open();
    const r1 = (await k1.query(sql, [op, payload])).rows[0].r;
    assert.equal(r1.ok, true);
    const p2 = k2.query(sql, [op, payload]);
    assert.equal(await within(p2, 400), 'waiting', 'the copy waits for the first');
    await k1.query('commit');
    const r2 = (await p2).rows[0].r;
    await k2.query('commit');
    assert.deepEqual(r2, r1, 'the copy gets the answer of the first (it was a raw « duplicate key »)');
    assert.equal((await c.query(`select count(*)::int n from public.jobs where id = $1`, [id])).rows[0].n, 1);
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    await c.query(`select set_config('garage.rpc', 'on', false)`);
    await c.query(`delete from public.job_items where job_id in (select id from public.jobs where customer_id = $1)`, [cust]);
    await c.query(`delete from public.jobs where customer_id = $1`, [cust]);
    await c.query(`delete from public.customers where id = $1`, [cust]);
    await c.query(`delete from public.truck_week where truck_id = $1`, [truck]);
    await c.query(`delete from public.trucks where id = $1`, [truck]);
    await c.query(`delete from public.op_log where at >= $1`, [start]);
    await c.query(`delete from public.activity where at >= $1`, [start]);
    await c.query(`delete from public.staff where id = $1`, [owner]);
    await c.query(`delete from auth.users where id = $1`, [owner]);
    await c.query(`select set_config('garage.rpc', '', false)`);
    c.release();
  }
});

test('sql-windows-22: window mode, today, a job on the way whose truck is past its hours keeps its number and its time', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const t1 = await h.truck('Camion', null, WEEK);
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  await clock(h, owner, 900);                                   // 15 h
  const done = await put(h, owner, { customer: c, day, block: 'day', truck: t1, status: 'done', order: 1, eta: 600 });
  const way = await put(h, owner, { customer: c, day, block: 'day', truck: t1, status: 'en_route', order: 2, eta: 905, ws: 840, we: 1080 });
  const next = await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 3, eta: 980, ws: 900, we: 1140, lat: near2[0], lng: near2[1] });
  // its day ended at 14 h 50 (hours written earlier, not by this operation: no re-plan of an hours change), then a re-plan
  await server(h, owner, `set local session_replication_role = replica`);
  await server(h, owner, `insert into public.truck_days (truck_id, day, ranges, updated_at) values ($1, $2::date, '[[480, 890]]', now() - interval '1 day')`, [t1, day]);
  await server(h, owner, `set local session_replication_role = origin`);
  await server(h, owner, `select public.replan_block($1::date, 'day')`, [day]);
  const jw = await row(h, way), jn = await row(h, next);
  assert.deepEqual([jw.truck_id, jw.stop_order, jw.eta_min], [t1, 2, 905], 'the job on the way keeps its truck, number and time');
  assert.equal(jn.truck_id, t1, 'the next one stays on its truck (a day already started)');
  assert.equal((await row(h, done)).stop_order, 1);
}));

test('sql-planner-1-06: a booking never takes the place of an appointment that a fresh plan of its block no longer fits', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: DAY });
  const home = await h.one(`select lat, lng from public.home_point()`);
  const kmLng = 1 / (111.2 * Math.cos((home.lat * Math.PI) / 180));
  const ca = await h.customer('A', home.lat, home.lng + 6 * kmLng), cb = await h.customer('B', home.lat, home.lng + 3 * kmLng);
  const cc = await h.customer('C', home.lat, home.lng + 0.5 * kmLng);
  // what is stored: A and B on the truck (a re-plan skipped by the chain left them so); a fresh plan fits A only
  const a = await put(h, owner, { customer: ca, day, block: 'am', truck: t1, order: 1, eta: 500, dur: 180, lat: home.lat, lng: home.lng + 6 * kmLng });
  const b = await put(h, owner, { customer: cb, day, block: 'am', truck: t1, order: 2, eta: 690, dur: 60, lat: home.lat, lng: home.lng + 3 * kmLng });
  const p0 = (await server(h, owner, `select public.plan_block($1::date, 'am') p`, [day]))[0].p;
  assert.deepEqual(p0.over, [b], 'a fresh plan of the morning no longer fits B');
  await h.as(owner);
  const r = await book(h, job(cc, day, 'am', { duration_min: 15 }));
  assert.equal(r.ok, true, 'a small booking that fits');
  assert.deepEqual([(await row(h, a)).truck_id, (await row(h, b)).truck_id], [t1, t1], 'B keeps its truck (it was thrown to « À placer »)');
}));

test('sql-windows-12 / x-dualmode-24, two connections: a booking sent while the owner switches to the windows waits, then is made in the new mode', async () => {
  const c = await pool.connect();
  const opened = [];
  const start = (await c.query(`select clock_timestamp() as t`)).rows[0].t;
  const owner = randomUUID(), truck = randomUUID(), cust = randomUUID();
  const was = (await c.query(`select booking from public.settings where id = 1`)).rows[0].booking;
  try {
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Hassan Switch', 'Hassan', '{owner}', '{}', $2)`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.trucks (id, name, active, sort) values ($1, 'Camion Switch', true, 0)`, [truck]);
    for (let d = 0; d < 7; d++) await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [truck, d, JSON.stringify(DAY)]);
    await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'Switch', 'Test', '5145550000', $2, $3, '1 rue Test')`, [cust, ...near]);
    const day = (await c.query(`select (public.local_today() + 32)::text d`)).rows[0].d;
    const open = async () => {
      const k = await pool.connect(); opened.push(k);
      await k.query('begin');
      await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' }), owner]);
      await k.query('set local role authenticated');
      return k;
    };
    const k1 = await open(), k2 = await open();
    assert.equal((await k1.query(`select public.windows_switch($1, true) r`, [randomUUID()])).rows[0].r.ok, true, 'the switch, not yet committed');
    const id = randomUUID();
    const p2 = k2.query(`select public.book_job(p_op => $1, p_job => $2::jsonb, p_items => '[]'::jsonb) as r`,
      [randomUUID(), JSON.stringify({ id, customer_id: cust, day, block: 'pm', duration_min: 60 })]);
    assert.equal(await within(p2, 400), 'waiting', 'the booking (a block, from a phone still in block mode) waits for the switch');
    await k1.query('commit');
    const r2 = (await p2).rows[0].r;
    await k2.query('commit');
    assert.equal(r2.ok, true);
    const j = (await c.query(`select block, win_start, win_end from public.jobs where id = $1`, [id])).rows[0];
    assert.deepEqual([j.block, j.win_start, j.win_end], ['day', 720, 960], 'made in the new mode: the window of the afternoon (it stayed « pm », never planned again)');
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    await c.query(`select set_config('garage.rpc', 'on', false), set_config('garage.windows', 'on', false)`);
    await c.query(`update public.settings set booking = $1 where id = 1`, [was]);
    await c.query(`delete from public.job_items where job_id in (select id from public.jobs where customer_id = $1)`, [cust]);
    await c.query(`delete from public.jobs where customer_id = $1`, [cust]);
    await c.query(`delete from public.customers where id = $1`, [cust]);
    await c.query(`delete from public.truck_week where truck_id = $1`, [truck]);
    await c.query(`delete from public.trucks where id = $1`, [truck]);
    await c.query(`delete from public.op_log where at >= $1`, [start]);
    await c.query(`delete from public.activity where at >= $1`, [start]);
    await c.query(`delete from public.staff where id = $1`, [owner]);
    await c.query(`delete from auth.users where id = $1`, [owner]);
    await c.query(`select set_config('garage.rpc', '', false), set_config('garage.windows', '', false)`);
    c.release();
  }
});

test('sql-windows-25: with the arrival windows, a refusal speaks of the day and the window, not of a « bloc »', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion', null, { [dow]: [[480, 540]] }), t2 = await h.truck('Voiture', null, { [dow]: DAY });
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  await put(h, owner, { customer: c, day, block: 'day', truck: t1, order: 1, eta: 490, dur: 50, ws: 480, we: 720 });
  const e1 = await h.fails(() => book(h, { customer_id: c, day, block: 'day', duration_min: 60, truck_id: t1 }));
  assert.equal(e1?.hint, 'truck_full');
  assert.match(e1.message, /ce jour-là/); assert.doesNotMatch(e1.message, /bloc/);
  const j = await book(h, { customer_id: c, day, block: 'day', duration_min: 30, truck_id: t2 });
  const e2 = await h.fails(() => h.rpc('move_job', { p_op: uuid(), p_job: j.job_id, p_day: day, p_block: 'day', p_truck: t1, p_win_start: null, p_win_flex: null }));
  assert.equal(e2?.hint, 'truck_full');
  assert.match(e2.message, /ce jour-là/);
  const e3 = await h.fails(() => book(h, { customer_id: c, day: null, block: 'day', duration_min: 30 }));
  assert.equal(e3?.hint, 'bad_block');
  assert.doesNotMatch(e3.message, /bloc/);
}));

test('plages-01: window mode, a vehicle closed for the rest of today (Horaires, or switched off): its appointments go to « À placer »; a vehicle whose day simply ended keeps its late one', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const tA = await h.truck('Camion', null, WEEK), tC = await h.truck('Voiture', null, Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 600]]])));
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  await clock(h, owner, 660);                                   // 11 h
  const j1 = await put(h, owner, { customer: c, day, block: 'day', truck: tA, order: 1, eta: 780, ws: 720, we: 960 });
  const j2 = await put(h, owner, { customer: c, day, block: 'day', truck: tA, order: 2, eta: 900, ws: 840, we: 1080, lat: near2[0], lng: near2[1] });
  const c1 = await put(h, owner, { customer: c, day, block: 'day', truck: tC, order: 1, eta: 590, ws: 480, we: 720 });   // late: its day ended at 10 h
  const way = await put(h, owner, { customer: c, day, block: 'day', truck: tA, status: 'en_route', order: 3, eta: 670, ws: 600, we: 840 });
  // the vehicles and their usual week were set up long ago (not by the operation below)
  await server(h, owner, `set local session_replication_role = replica`);
  await server(h, owner, `update public.trucks set updated_at = now() - interval '30 days' where id = any($1::uuid[])`, [[tA, tC]]);
  await server(h, owner, `update public.truck_week set updated_at = now() - interval '30 days' where truck_id = any($1::uuid[])`, [[tA, tC]]);
  await server(h, owner, `set local session_replication_role = origin`);
  const dow = await h.val(`select extract(dow from public.local_today())::int`);
  for (const how of ['hours', 'off']) {
    await h.c.query('savepoint closing');
    await h.as(owner);
    if (how === 'hours') {
      // 11 h: Saleh is sick, the owner sets today to 8 h – 11 h for his truck
      assert.equal((await h.rpc('apply_hours', { p_op: uuid(), p_truck: tA, p_mode: 'day', p_week: { [dow]: [[480, 660]] }, p_from: day, p_weeks: 1 })).ok, true);
    } else {
      await server(h, owner, `update public.trucks set active = false where id = $1`, [tA]);
    }
    const a1 = await row(h, j1), a2 = await row(h, j2);
    assert.deepEqual([a1.truck_id, a1.stop_order, a1.eta_min, a2.truck_id, a2.stop_order], [null, null, null, null, null], `${how}: the closed vehicle's customers are in « À placer » (they stayed on it, 13 h and 15 h)`);
    const k = await row(h, c1);
    assert.deepEqual([k.truck_id, k.eta_min], [tC, 590], `${how}: the vehicle whose day ended keeps its late customer`);
    const w = await row(h, way);
    assert.deepEqual([w.truck_id, w.stop_order, w.eta_min], [tA, 3, 670], `${how}: the job already on the way keeps its truck, number and time`);
    await h.as(null);
    await h.c.query('rollback to savepoint closing');
  }
}));

test('plages-02: back to the blocks, a flexible appointment is to call (told « la veille »), every one to call is to confirm again; back to the windows it is flexible again', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h, 4, 3);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion', null, { [dow]: DAY });
  const c1 = await h.customer('Jean', ...near), c2 = await h.customer('Paul', ...near2), c3 = await h.customer('Luc', ...laval);
  await windowsOn(h, owner);
  const f = await book(h, { customer_id: c1, day, block: 'day', duration_min: 60, win_flex: true });
  const w = await book(h, { customer_id: c2, day, block: 'day', duration_min: 60, win_start: 600 });       // 10 h – 14 h
  const a = await book(h, { customer_id: c3, day, block: 'day', duration_min: 60, win_start: 480 });       // 8 h – 12 h = the morning
  assert.deepEqual([(await row(h, f.job_id)).win_flex, (await row(h, f.job_id)).win_start], [true, null], 'flexible, its window not fixed yet');
  await server(h, owner, `update public.jobs set confirm_sent_at = now() where id = any($1::uuid[])`, [[f.job_id, w.job_id, a.job_id]]);
  const off = await h.rpc('windows_switch', { p_op: uuid(), p_on: false });
  const calls = Object.fromEntries(off.to_call.map((x) => [x.job_id, x.reason]));
  assert.equal(calls[f.job_id], 'flexible', 'the flexible customer is to call (it was left out)');
  assert.equal(calls[a.job_id], undefined, 'a window that is its block’s hours: nothing to tell');
  const jf = await row(h, f.job_id);
  assert.ok(['am', 'pm', 'eve'].includes(jf.block));
  assert.equal(jf.confirm_sent_at, null, 'to confirm again: « Aujourd’hui » lists it');
  for (const id of Object.keys(calls)) assert.equal((await row(h, id)).confirm_sent_at, null, 'every one to call is to confirm again');
  assert.ok((await row(h, a.job_id)).confirm_sent_at, 'the others keep their confirmation');
  const on = await h.rpc('windows_switch', { p_op: uuid(), p_on: true });
  assert.equal(on.ok, true);
  const jf2 = await row(h, f.job_id);
  assert.deepEqual([jf2.block, jf2.win_start, jf2.win_end, jf2.win_flex], ['day', null, null, true], 'flexible again (it got the block’s 4 hours, never told)');
  assert.deepEqual([(await row(h, a.job_id)).win_start, (await row(h, a.job_id)).win_flex], [480, false], 'the others as before');
}));

test('srv-planif-r2-1: window mode, a vehicle whose day simply ended keeps its late customer when its start, its usual week or its hours of the day are written again; one the hours close for the rest of the day does not', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await today(h);
  const dow = await h.val(`select extract(dow from public.local_today())::int`);
  const tC = await h.truck('Voiture', null, Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1020]]])));   // 8 h – 17 h
  const c = await h.customer('Jean', ...near);
  await windowsOn(h, owner);
  // the vehicle and its usual week were set up long ago (not by the operations below)
  await server(h, owner, `set local session_replication_role = replica`);
  await server(h, owner, `update public.trucks set updated_at = now() - interval '30 days' where id = $1`, [tC]);
  await server(h, owner, `update public.truck_week set updated_at = now() - interval '30 days' where truck_id = $1`, [tC]);
  await server(h, owner, `set local session_replication_role = origin`);
  /** today's own hours of the Voiture, written this morning (no re-plan) */
  const dayHours = async (ranges) => {
    await server(h, owner, `set local session_replication_role = replica`);
    await server(h, owner, `insert into public.truck_days (truck_id, day, ranges, updated_at) values ($1, $2, $3, now() - interval '10 hours')`, [tC, day, JSON.stringify(ranges)]);
    await server(h, owner, `set local session_replication_role = origin`);
  };
  await clock(h, owner, 1080);                                  // 18 h: the Voiture's day ended at 17 h
  const late = await put(h, owner, { customer: c, day, block: 'day', truck: tC, order: 1, eta: 1000, ws: 900, we: 1140 });   // the mechanic runs late
  for (const how of ['start', 'week', 'revert']) {
    await h.c.query('savepoint again');
    if (how === 'start') {
      // « Départ de ce camion » (for tomorrow): the trucks row changes, its hours do not
      await h.as(owner);
      assert.equal((await h.rpc('set_truck_start', { p_op: uuid(), p_truck: tC, p_start: { label: 'Chez Adam', address: '1 rue Test', lat: near2[0], lng: near2[1] } })).ok, true);
    } else if (how === 'week') {
      // « En permanence » this evening: the usual day of today ends at 16 h from now on (it had already ended at 17 h)
      await h.as(owner);
      assert.equal((await h.rpc('apply_hours', { p_op: uuid(), p_truck: tC, p_mode: 'always', p_week: { [dow]: [[480, 960]] }, p_from: day, p_weeks: 1 })).ok, true);
      assert.deepEqual(await h.val(`select public.truck_ranges($1, public.local_today())`, [tC]), [[480, 960]], 'the new usual week counts today');
    } else {
      // today's own hours (8 h – 17 h 30) taken off this evening: « Revenir à l'horaire », a plain table write
      await dayHours([[480, 1050]]);
      await h.as(owner);
      await h.q(`update public.truck_days set deleted_at = now() where truck_id = $1 and day = $2`, [tC, day]);
      assert.deepEqual(await h.val(`select public.truck_ranges($1, public.local_today())`, [tC]), [[480, 1020]], 'back to the usual day');
    }
    const k = await row(h, late);
    assert.deepEqual([k.truck_id, k.stop_order, k.eta_min], [tC, 1, 1000], `${how}: the vehicle whose day ended keeps its late customer (truck, number, time)`);
    await h.as(null);
    await h.c.query('rollback to savepoint again');
  }
  // 11 h: Adam is sick, the Voiture stops at 11 h: the customer he is late for (10 h 30) goes to « À placer » with the next one
  await h.c.query('savepoint sick');
  await clock(h, owner, 660);
  const was = await put(h, owner, { customer: c, day, block: 'day', truck: tC, order: 1, eta: 630, ws: 540, we: 780 });
  const next = await put(h, owner, { customer: c, day, block: 'day', truck: tC, order: 2, eta: 780, ws: 720, we: 960, lat: near2[0], lng: near2[1] });
  await h.as(owner);
  assert.equal((await h.rpc('apply_hours', { p_op: uuid(), p_truck: tC, p_mode: 'day', p_week: { [dow]: [[480, 660]] }, p_from: day, p_weeks: 1 })).ok, true);
  for (const [id, what] of [[was, 'the late one (10 h 30)'], [next, 'the next one (13 h)']]) {
    const j = await row(h, id);
    assert.deepEqual([j.truck_id, j.stop_order, j.eta_min], [null, null, null], `${what} is in « À placer »`);
  }
  await h.as(null);
  await h.c.query('rollback to savepoint sick');
  // 18 h, the Voiture was to work until 20 h today: its hours set to end at 17 h 30 close it by this very change
  await dayHours([[480, 1200]]);
  await h.as(owner);
  assert.equal((await h.rpc('apply_hours', { p_op: uuid(), p_truck: tC, p_mode: 'day', p_week: { [dow]: [[480, 1050]] }, p_from: day, p_weeks: 1 })).ok, true);
  const k = await row(h, late);
  assert.deepEqual([k.truck_id, k.stop_order, k.eta_min], [null, null, null], 'a vehicle closed by the change of its hours sends its customer to « À placer »');
}));

/** the live text of functions of earlier migrations ([file, name] pairs, the first definition of that name in that
 *  file), made again in the schema live_ref (the planner as it runs on live): their calls of each other go to live_ref */
async function liveRef(h, list) {
  const { readFileSync } = await import('node:fs');
  await h.q(`create schema if not exists live_ref`);
  const names = list.map(([, n]) => n);
  for (const [file, name] of list) {
    const src = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8');
    const at = src.indexOf(`create or replace function public.${name}(`);
    assert.ok(at >= 0, `${name} in ${file}`);
    const open = src.indexOf('$$', at), close = src.indexOf('$$', open + 2);
    let body = src.slice(at, close + 2);
    for (const n of names) body = body.replaceAll(`public.${n}(`, `live_ref.${n}(`);
    await h.q(body);
  }
  // the Part 17 form of route_improve (no next block), as in 20261106000400_truck_start.sql
  if (names.includes('route_improve')) {
    await h.q(`create or replace function live_ref.route_improve(p_ids jsonb, p_fixed int, p_pts jsonb, p_hlat double precision, p_hlng double precision,
      p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric) returns jsonb language sql immutable set search_path = public, extensions as $$
      select live_ref.route_improve(p_ids, p_fixed, p_pts, p_hlat, p_hlng, null::double precision, null::double precision, p_speed, p_detour, p_unknown, p_stop) $$`);
  }
}
const LIVE_PLANNER = [['20261106000400_truck_start.sql', 'route_improve'], ['20261115000100_fenetres.sql', 'plan_block'], ['20261115000100_fenetres.sql', 'suggest_windows_core']];

/** a day of window mode with `n` appointments around the Centrale (always the same ones for the same seed), each booked
 *  at a window of the day's lattice (the next one when it is full) */
async function windowDay(h, owner, day, n, seed) {
  const home = await h.one(`select lat, lng from public.home_point()`);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const starts = [480, 540, 600, 660, 720, 780, 840, 900, 960];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const c = await h.customer(`C${seed}-${i}`, home.lat + (rnd() - 0.5) * 0.14, home.lng + (rnd() - 0.5) * 0.2);
    const dur = [45, 60, 90][Math.floor(rnd() * 3)];
    const first = Math.floor(rnd() * starts.length);
    for (let k = 0; k < starts.length; k++) {
      const ws = starts[(first + k) % starts.length];
      await h.as(owner);
      const e = await h.fails(async () => { ids.push((await book(h, { customer_id: c, day, block: 'day', duration_min: dur, win_start: ws })).job_id); });
      if (!e) break;
      assert.ok(['window_full', 'block_full'].includes(e.hint), `booked or full: ${e.message}`);
    }
  }
  return ids;
}
const pick = (rows) => rows.map((r) => ({ win_start: r.win_start, truck: r.truck, eta: r.eta, drive_min: r.drive_min, wait_min: r.wait_min, left: r.left }));

test('round 2, speed: route_improve gives exactly the order of before on 150 routes (positions missing, stops fixed, a next block or none)', () => tx(async (h) => {
  await liveRef(h, [['20261106000400_truck_start.sql', 'route_improve']]);
  const home = await h.one(`select lat, lng from public.home_point()`);
  let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  let changed = 0;
  for (let t = 0; t < 150; t++) {
    const n = 2 + Math.floor(rnd() * 8), f = Math.floor(rnd() * 3);
    const ids = [], pts = {};
    for (let i = 0; i < n; i++) {
      const id = `s${t}-${i}`;
      ids.push(id);
      const r = rnd();
      if (r < 0.08) continue;                                         // not in the points at all
      pts[id] = r < 0.16 ? { dur: 30 } : { lat: home.lat + (rnd() - 0.5) * 0.2, lng: home.lng + (rnd() - 0.5) * 0.3, dur: 30 };
    }
    const start = rnd() < 0.1 ? [null, null] : [home.lat + (rnd() - 0.5) * 0.1, home.lng + (rnd() - 0.5) * 0.1];
    const end = rnd() < 0.5 ? [null, null] : [home.lat + (rnd() - 0.5) * 0.2, home.lng + (rnd() - 0.5) * 0.2];
    const args = [JSON.stringify(ids), f, JSON.stringify(pts), ...start, ...end, 35, 1.3, 20, 5];
    const sql = (schema) => `select ${schema}.route_improve($1::jsonb, $2::int, $3::jsonb, $4::float8, $5::float8, $6::float8, $7::float8, $8::numeric, $9::numeric, $10::numeric, $11::numeric) r`;
    const neu = (await h.one(sql('public'), args)).r, old = (await h.one(sql('live_ref'), args)).r;
    assert.deepEqual(neu, old, `route ${t} (${n} stops, ${f} fixed)`);
    if (JSON.stringify(neu) !== JSON.stringify(ids)) changed++;
    if (end[0] === null) {
      const nine = `($1::jsonb, $2::int, $3::jsonb, $4::float8, $5::float8, $6::numeric, $7::numeric, $8::numeric, $9::numeric) r`, a9 = [...args.slice(0, 5), ...args.slice(7)];
      assert.deepEqual((await h.one(`select public.route_improve${nine}`, a9)).r, (await h.one(`select live_ref.route_improve${nine}`, a9)).r, `route ${t}, the Part 17 form`);
    }
  }
  assert.ok(changed > 40, `many routes were put in a better order (${changed} of 150): the test compares real work`);
}));

test('round 2, speed: one walk of a route (route_cost) answers what route_min, route_min_to and route_walk_in answered, on 300 routes', () => tx(async (h) => {
  const home = await h.one(`select lat, lng from public.home_point()`);
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const seen = { fail: 0, wait: 0 };
  for (let t = 0; t < 300; t++) {
    const n = Math.floor(rnd() * 8), f = Math.floor(rnd() * 3);
    const ids = [], pts = {};
    const point = (id) => {
      const r = rnd();
      if (r < 0.06) return;                                            // not in the points
      const p = r < 0.12 ? { dur: 20 } : { lat: home.lat + (rnd() - 0.5) * 0.2, lng: home.lng + (rnd() - 0.5) * 0.3, dur: [15, 30, 60][Math.floor(rnd() * 3)] };
      if (rnd() < 0.6) { const ws = 480 + 60 * Math.floor(rnd() * 9); Object.assign(p, { ws, we: ws + 240 }); }
      if (rnd() < 0.1) p.late = true;
      pts[id] = p;
    };
    for (let i = 0; i < n; i++) { ids.push(`s${t}-${i}`); point(ids[i]); }
    const add = rnd() < 0.8 ? `x${t}` : null;
    if (add) point(add);
    const at = Math.floor(rnd() * (n + 1));
    const start = rnd() < 0.1 ? [null, null] : [home.lat + (rnd() - 0.5) * 0.1, home.lng + (rnd() - 0.5) * 0.1];
    const end = rnd() < 0.5 ? [null, null] : [home.lat + (rnd() - 0.5) * 0.2, home.lng + (rnd() - 0.5) * 0.2];
    const ranges = rnd() < 0.3 ? [[480, 720], [780, 1200]] : rnd() < 0.5 ? [[480, 1200]] : null;
    const windows = rnd() < 0.7, walk = rnd() < 0.85, from = 480 + Math.floor(rnd() * 300);
    const route = add ? [...ids.slice(0, at), add, ...ids.slice(at)] : ids;
    const r = await h.one(`select public.route_cost($1::jsonb, $2::text, $3::int, $4::jsonb, $5::int, $6::float8, $7::float8, $8::float8, $9::float8, 35, 1.3, 20, 5, $10::int, $11::jsonb, $12::boolean, $13::boolean) c,
        public.route_min($14::jsonb, $4::jsonb, $6::float8, $7::float8, 35, 1.3, 20, 5) a,
        public.route_min_to($14::jsonb, $4::jsonb, $6::float8, $7::float8, $8::float8, $9::float8, 35, 1.3, 20, 5) b,
        case when $13::boolean then public.route_walk_in($14::jsonb, $4::jsonb, $5::int, $6::float8, $7::float8, 35, 1.3, 20, 5, $10::int, $11::jsonb, $12::boolean) else 0 end w`,
      [JSON.stringify(ids), add, at, JSON.stringify(pts), from, ...start, ...end, f, ranges && JSON.stringify(ranges), windows, walk, JSON.stringify(route)]);
    assert.deepEqual(r.c, [r.a, r.b, r.w], `route ${t}: ${route.length} stops, the new one at ${add ? at : '-'}, ${f} fixed`);
    if (r.w < 0) seen.fail++; else if (r.w > 0) seen.wait++;
  }
  assert.ok(seen.fail > 20 && seen.wait > 20, `routes that do not hold (${seen.fail}) and routes that wait (${seen.wait}) were both compared`);
}));

test('round 2, speed: in block mode the plans are the plans live makes (each block, with and without a new stop)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const car = await h.truck('Voiture', null, WEEK);
  await h.truck('Camion', null, WEEK);
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [car]);
  const day = await futureDay(h);
  const home = await h.one(`select lat, lng from public.home_point()`);
  let s = 11;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  await h.as(owner);
  for (let i = 0; i < 12; i++) {
    const c = await h.customer(`B${i}`, home.lat + (rnd() - 0.5) * 0.14, home.lng + (rnd() - 0.5) * 0.2);
    await h.fails(() => book(h, job(c, day, ['am', 'pm', 'eve'][i % 3], { duration_min: [45, 60, 90][Math.floor(rnd() * 3)] })));
  }
  await h.as(null);
  await liveRef(h, LIVE_PLANNER);
  let compared = 0;
  for (const block of ['am', 'pm', 'eve']) {
    for (const extra of [null, { id: uuid(), lat: home.lat + 0.02, lng: home.lng - 0.03, dur: 60 }, { id: uuid(), lat: home.lat - 0.04, lng: home.lng + 0.02, dur: 90, kind: 'truck' }]) {
      const q = (schema) => h.one(`select ${schema}.plan_block($1::date, $2, $3::jsonb, null) p`, [day, block, extra && JSON.stringify(extra)]);
      const neu = (await q('public')).p, old = (await q('live_ref')).p;
      assert.deepEqual(neu, old, `${block}${extra ? ', with a new stop' : ''}`);
      compared += Object.keys(neu.jobs).length;
    }
  }
  assert.ok(compared >= 20, `${compared} stops compared`);
}));

test('round 2, speed: suggest_windows offers the windows live offers, as fast or faster (several days and loads; prints the timing)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const week = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, DAY]));
  const car = await h.truck('Voiture', null, week);
  await h.truck('Camion', null, week);
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [car]);
  await windowsOn(h, owner);
  const loads = [4, 8, 12];
  const days = [];
  for (let i = 0; i < loads.length; i++) {
    const day = await h.val(`select (public.local_today() + $1::int)::text`, [3 + i]);
    const ids = await windowDay(h, owner, day, loads[i], 7 + i);
    days.push({ day, n: ids.length });
  }
  await h.as(null);
  await liveRef(h, LIVE_PLANNER);
  await h.q(`set local track_functions = 'pl'`);
  const home = await h.one(`select lat, lng from public.home_point()`);
  const asks = [[home.lat + 0.03, home.lng - 0.05, 60, false, null], [home.lat - 0.02, home.lng + 0.04, 90, true, null]];
  const calls = async (schema, fn) => Number(await h.val(`select coalesce((select calls from pg_stat_xact_user_functions where schemaname = $1 and funcname = $2), 0)`, [schema, fn]));
  let tNew = 0, tOld = 0, pNew = 0, pOld = 0;
  const lines = [];
  for (const d of days) {
    for (const [lat, lng, dur, need, kind] of asks) {
      const args = [lat, lng, dur, d.day, null, need, kind];
      const sql = (schema) => `select ${schema}.suggest_windows_core($1, $2, $3, $4::date, $5::uuid, $6, $7) r`;
      const c0 = await calls('public', 'plan_route'), o0 = await calls('live_ref', 'plan_block');
      let t = performance.now();
      const neu = (await h.one(sql('public'), args)).r;
      const a = performance.now() - t;
      t = performance.now();
      const old = (await h.one(sql('live_ref'), args)).r;
      const b = performance.now() - t;
      const pn = (await calls('public', 'plan_route')) - c0, po = (await calls('live_ref', 'plan_block')) - o0;
      tNew += a; tOld += b; pNew += pn; pOld += po;
      lines.push(`${d.day} ${String(d.n).padStart(2)} rdv  new ${a.toFixed(0).padStart(5)} ms ${String(pn).padStart(3)} plans  live ${b.toFixed(0).padStart(5)} ms ${String(po).padStart(3)} plans  ${neu.length}/${old.length} windows`);
      assert.deepEqual(pick(neu), pick(old), `${d.day}, ${d.n} appointments: the same windows as live`);
    }
  }
  console.log(['suggest_windows, new vs live:', ...lines, `total new ${tNew.toFixed(0)} ms (${pNew} plans), live ${tOld.toFixed(0)} ms (${pOld} plans)`].join('\n'));
  assert.ok(pNew <= pOld, `no more plans than live (${pNew} for ${pOld})`);
  assert.ok(tNew < tOld, `faster than live in all (${tNew.toFixed(0)} ms for ${tOld.toFixed(0)} ms; it was slower: the same plans, each one dearer)`);
}));
