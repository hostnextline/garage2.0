// « Vraies routes » (Part 27): planning the coming days again with the real times (roads_replan, used by roads_switch and
// drive_store). A block whose new plan would throw a placed appointment to « À placer » is KEPT, but its arrival times are
// written again with the real times, and the answer says which blocks were kept and who is now late (review-sql H2, « e4 »,
// « e8 »). Run: node --test tests/db/vraies-routes-replan.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const A = [45.5150, -73.6400], B = [45.5250, -73.6300];           // near the start: a short estimate
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
const wanted = (h, days = 120) => val(h, `select public.drive_wanted(null, null, $1) v`, [days]);
const store = (h, rows, days = null) => val(h, `select public.drive_store($1::jsonb, $2::date[]) v`, [JSON.stringify(rows), days]);
/** everything the coming days still want, measured: fn(pair) minutes */
async function measureAll(h, fn) {
  for (let i = 0; i < 20; i++) {
    const w = await wanted(h);
    if (!w.total) return;
    await store(h, w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], fn(p), 5, 'tomtom']));
  }
}
const book = (h, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
const lastSwitch = (h) => h.one(`select data from public.activity where action = 'roads_switch' order by id desc limit 1`).then((r) => r.data);

test('e4 — ON when the real roads no longer fit a booked block: the block is kept, its arrivals written again, and the late ones said', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, 2);
  const truck = await h.truck('Camion 1', null, WEEK);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am', 100);
  await book(h, cb, day, 'am', 100);
  const [first, second] = (await h.q(`select id from public.jobs where day = $1 and block = 'am' order by stop_order`, [day])).map((r) => r.id);
  // every trip of the coming days measured at 80 minutes: the two no longer fit in the morning
  await measureAll(h, () => 80);
  const on = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.equal(on.ok, true); assert.equal(on.on, true);
  assert.deepEqual(on.kept, [{ day, block: 'am' }], 'the morning is kept as it was: nobody thrown to « À placer »');
  const j1 = await row(h, first), j2 = await row(h, second);
  assert.ok(j1.truck_id && j2.truck_id, 'both stay placed');
  assert.deepEqual([j1.eta_min, j1.travel_min, j2.eta_min, j2.travel_min], [480 + 80, 85, 665 + 80, 85], 'the arrival times are the real ones (before: the estimate stayed)');
  assert.deepEqual(on.late, [second], 'the second now arrives at 12 h 25, after the morning told to the customer');
  const act = await lastSwitch(h);
  assert.deepEqual([act.on, act.kept, act.late], [true, [{ day, block: 'am' }], [second]], 'the activity says the same');
  // the plan no longer claims room that is not there, and no moment is offered in that morning
  const p = await val(h, `select public.plan_block($1::date, 'am') v`, [day]);
  // (fix-sql, lead's F1 decision of 2026-11-20: the kept appointments stay in the walk of their vehicle, which is full)
  assert.deepEqual([p.over, p.frozen], [[], [truck]]);
  assert.deepEqual([p.jobs[first].eta, p.jobs[second].eta], [560, 745], 'the plan walks them as they are written');
  const s = await h.rpc('suggest_blocks', { p_lat: A[0] + 0.0001, p_lng: A[1] + 0.0001, p_duration: 15, p_from: day, p_days: 1, p_exclude: null, p_limit: 9 });
  assert.equal(s.some((x) => x.block === 'am'), false, 'a full morning on the real roads offers nothing');
  // and back: the estimate again, nobody late any more
  const off = await h.rpc('roads_switch', { p_op: uuid(), p_on: false });
  assert.deepEqual([off.on, off.late], [false, []]);
  assert.ok(Array.isArray(off.kept));
}));

test('e8 — window mode: a promised window missed with the real times is said (late), never silently', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, 2);
  await h.truck('Camion 1', null, WEEK);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  const r = await book(h, ca, day, 'day', 60, { win_start: 480 });
  let j = await row(h, r.job_id);
  assert.ok(j.eta_min <= j.win_end, 'booked inside its window with the estimate');
  // every trip of the day measured (B's address too: it is booked below): 5 h in the morning rush, so the window is missed
  await measureAll(h, (p) => (p[4] === 1 ? 300 : 30));
  await store(h, [B, await h.one(`select lat, lng from public.home_point()`).then((x) => [x.lat, x.lng]), A].flatMap((x, i, all) => all.filter((y) => y !== x)
    .flatMap((y) => [0, 1, 2].map((s) => [...x, ...y, s, s === 1 ? 300 : 30, 5, 'tomtom']))));
  const on = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  j = await row(h, r.job_id);
  assert.ok(j.truck_id, 'still placed');
  assert.equal(j.eta_min, 480 + 300);
  assert.ok(j.eta_min > j.win_end);
  assert.deepEqual(on.late, [r.job_id], 'the appointment to call is in the answer');
  assert.deepEqual((await lastSwitch(h)).late, [r.job_id]);
  // a new booking in that window is refused on the real roads (the day has room later)
  assert.equal((await h.fails(() => book(h, cb, day, 'day', 30, { win_start: 480 })))?.hint, 'window_full');
}));

test('the switch twice: « unchanged » answers the same shape; drive_store re-plans and passes kept and late on', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, 4);
  await h.truck('Camion 1', null, WEEK);
  const ca = await h.customer('A', ...A);
  const r = await book(h, ca, day, 'am', 60);
  await measureAll(h, () => 20);
  await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  const again = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.deepEqual(again, { ok: true, unchanged: true, on: true, planned: 0, kept: [], late: [] });
  // a slower time measured for the trip of that morning (Thursday 8 h: the morning rush)
  const home = await h.one(`select lat, lng from public.home_point()`);
  const s = await store(h, [[home.lat, home.lng, ...A, 1, 47, 9, 'tomtom']], [day]);
  assert.equal(s.ok, true); assert.equal(s.stored, 1); assert.ok(s.planned >= 1);
  assert.deepEqual([s.kept, s.late], [[], []]);
  assert.equal((await row(h, r.job_id)).eta_min, 480 + 47);
}));
