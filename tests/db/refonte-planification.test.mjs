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
