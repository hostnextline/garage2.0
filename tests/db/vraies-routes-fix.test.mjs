// « Vraies routes » (Part 27), the fixes after the verifiers (verify-on F1–F11, verify-measure F1–F4, the sheets' asks) and the
// lead's decisions of 2026-11-20 15:25. Each test was written first and seen failing for the reason in its name.
// Run: node --test tests/db/vraies-routes-fix.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];                       // home_point() when the settings have none
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const k = (p) => p.join(',');
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
async function roads(h, on) {
  await server(h, `select set_config('garage.roads', 'on', true)`);
  await server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', to_jsonb($1::boolean)) where id = 1`, [on]);
  await server(h, `select set_config('garage.roads', '', true)`);
}
const setBooking = (h, key, json) => server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), $1::text[], $2::jsonb) where id = 1`, [[key], JSON.stringify(json)]);
/** every trip between these places measured, both ways, the three times: fn(from, to, slot) minutes */
async function measure(h, places, fn, km = () => 5) {
  const rows = [];
  for (const a of places) for (const b of places) if (a !== b) for (const s of [0, 1, 2]) rows.push([...a, ...b, s, fn(a, b, s), km(a, b), 'tomtom']);
  return val(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify(rows)]);
}
const book = (h, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
const plan = (h, day, block) => val(h, `select public.plan_block($1::date, $2) v`, [day, block]);
const suggest = (h, at, dur, day, extra = {}) => h.rpc('suggest_blocks', { p_lat: at[0], p_lng: at[1], p_duration: dur, p_from: day, p_days: 1, p_exclude: null, p_limit: 20, ...extra });
const clock = (h, min) => server(h, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
const rowsOf = (h, day) => server(h, `select j.id, j.truck_id, j.block, j.stop_order, j.eta_min, j.travel_min, j.duration_min, j.win_start, j.win_end, j.status
  from public.jobs j join public.blocks() b on b.key = j.block
  where j.day = $1 and j.deleted_at is null and j.status not in ('cancelled', 'no_show') order by j.truck_id, b.pos, j.stop_order nulls last`, [day]);
/** never two stops with the same number on a vehicle's block, never two visits at the same time */
function oneWalk(rows) {
  const by = {};
  for (const r of rows) if (r.truck_id) (by[`${r.truck_id} ${r.block}`] ??= []).push(r);
  for (const [key, list] of Object.entries(by)) {
    const orders = list.map((r) => r.stop_order);
    assert.equal(new Set(orders).size, orders.length, `${key}: two stops with the same number ${JSON.stringify(orders)}`);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].eta_min >= list[i - 1].eta_min + 5 + list[i - 1].duration_min, `${key}: stop #${list[i].stop_order} at ${list[i].eta_min} overlaps the one before (${list[i - 1].eta_min} + ${list[i - 1].duration_min})`);
    }
  }
}
const movePreview = (h, truck, day, block, jobs, asTold) => (asTold === undefined
  ? h.val(`select public.move_preview($1::uuid, $2::date, $3, $4::uuid[]) v`, [truck, day, block, jobs])
  : h.val(`select public.move_preview($1::uuid, $2::date, $3, $4::uuid[], $5) v`, [truck, day, block, jobs, asTold]));
const orderPreview = (h, truck, day, block, jobs) => h.val(`select public.stop_order_preview($1::uuid, $2::date, $3, $4::uuid[]) v`, [truck, day, block, jobs]);
async function owner(h) { const o = await h.person('Hassan', ['owner']); await become(h, o); return o; }
const activity = (h, action) => server(h, `select entity_id::text id, data from public.activity where action = $1 order by id`, [action]);

// ---------- F1: a vehicle kept by the real roads is FULL for a booking or a move by hand (lead, 2026-11-20) ----------
test('F1 — a block kept by the real roads: booking or moving into it is refused like a full block, « quand même » goes at the end, the kept stops stay in every walk', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  const t = await h.truck('Camion 1', null, WEEK);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300], C = [45.5255, -73.6295], D = [45.5245, -73.6305];
  const T = { [k(HOME) + '>' + k(A)]: 80, [k(HOME) + '>' + k(B)]: 90 };
  const mins = (a, b) => T[k(a) + '>' + k(b)] ?? ([B, C, D].includes(a) && [B, C, D].includes(b) ? 5 : 80);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B), cc = await h.customer('C', ...C), cd = await h.customer('D', ...D);
  const ja = (await book(h, ca, day, 'am', 100)).job_id, jb = (await book(h, cb, day, 'am', 100)).job_id;
  const jd = (await book(h, cd, day, 'pm', 15)).job_id;
  await measure(h, [HOME, A, B, C, D], mins);
  const sw = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.deepEqual(sw.kept, [{ day, block: 'am' }]);
  // the morning's plan holds the kept appointment in its vehicle's walk: nobody « over », the vehicle said frozen
  const p = await plan(h, day, 'am');
  assert.deepEqual(p.over, [], 'the kept appointment is in the walk of its vehicle, not left out');
  assert.deepEqual(p.frozen, [t]);
  assert.ok(p.kept.length >= 1 && p.kept.every((x) => [ja, jb].includes(x)));
  assert.deepEqual([p.jobs[ja].order, p.jobs[ja].eta, p.jobs[jb].order, p.jobs[jb].eta], [1, 560, 2, 745]);
  oneWalk(await rowsOf(h, day));
  // a booking by hand: refused as a full block (the app then offers « Réserver quand même »); a move by hand the same
  const e1 = await h.fails(() => book(h, cc, day, 'am', 15));
  assert.equal(e1?.hint, 'block_full', 'before: accepted, C #1 at 9 h 20 beside A #1 at 9 h 20');
  const e2 = await h.fails(() => h.rpc('move_job', { p_op: uuid(), p_job: jd, p_day: day, p_block: 'am', p_truck: null }));
  assert.equal(e2?.hint, 'block_full');
  // « quand même »: at the end, past the hours; the kept stops keep their numbers and times
  const f = await book(h, cc, day, 'am', 15, { force: true });
  assert.equal(f.forced, true);
  const am = (await rowsOf(h, day)).filter((r) => r.block === 'am');
  assert.deepEqual(am.map((r) => [r.id, r.stop_order, r.eta_min]), [[ja, 1, 560], [jb, 2, 745], [f.job_id, 3, 745 + 5 + 100 + 5]]);
  oneWalk(await rowsOf(h, day));
}));

// ---------- F6: the guard is per vehicle: the other vehicles of a kept block keep their room ----------
test('F6 — a kept block: the vehicle that is full stays full, the other vehicle of that block is still offered and booked', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  const t1 = await h.truck('Camion', null, WEEK), t2 = await h.truck('Voiture', null, WEEK);
  await server(h, `update public.trucks set tire_machine = false where id = $1`, [t2]);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300], Q = [45.5000, -73.6600];
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B), cq = await h.customer('Q', ...Q);
  const ja = (await book(h, ca, day, 'am', 100, { vehicle_kind: 'truck' })).job_id, jb = (await book(h, cb, day, 'am', 100, { vehicle_kind: 'truck' })).job_id;
  await measure(h, [HOME, A, B, Q], (a, b) => (a === Q || b === Q ? 5 : 80));
  const sw = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.deepEqual(sw.kept, [{ day, block: 'am' }]);
  const before = (await rowsOf(h, day)).filter((r) => r.truck_id === t1).map((r) => [r.id, r.stop_order, r.eta_min]);
  const p = await plan(h, day, 'am');
  assert.deepEqual(p.frozen, [t1]);
  assert.equal(p.trucks.find((x) => x.id === t2).left, 240, 'the car has its whole morning');
  const am = (await suggest(h, Q, 30, day)).filter((x) => x.block === 'am');
  assert.equal(am.length, 1, 'before: 0 moments in the morning though the car is empty');
  assert.equal(am[0].truck, t2);
  // asked on the full vehicle: « ce camion n'a plus de place »
  const e = await h.fails(() => book(h, cq, day, 'am', 30, { truck_id: t1 }));
  assert.equal(e?.hint, 'truck_full');
  const r = await book(h, cq, day, 'am', 30);
  assert.equal(r.truck_id, t2);
  assert.deepEqual((await rowsOf(h, day)).filter((x) => x.truck_id === t1).map((x) => [x.id, x.stop_order, x.eta_min]), before, 'the kept truck untouched');
  assert.ok([ja, jb].length === 2);
}));

// ---------- F4: the chain walks a later block again from where the block before now ends ----------
test('F4 — after a booking, a later block that no longer fits gets its arrival times walked again from the new end of the block before', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  const t = await h.truck('Camion', null, WEEK);
  const P = [45.5150, -73.6400], N = [45.5700, -73.7500], E = [45.5300, -73.6000];
  const name = (x) => (x === HOME ? 'h' : x === P ? 'p' : x === N ? 'n' : 'e');
  const m = { hp: 10, hn: 100, he: 10, pn: 10, np: 10, pe: 10, ep: 10, ne: 50, en: 50, ph: 10, nh: 50, eh: 10 };
  const cp = await h.customer('P', ...P), cn = await h.customer('N', ...N), ce = await h.customer('E', ...E);
  await measure(h, [HOME, P, N, E], (a, b) => m[name(a) + name(b)]);
  await roads(h, true);
  await book(h, cp, day, 'pm', 60);
  const je = (await book(h, ce, day, 'eve', 190)).job_id;
  assert.equal((await rowsOf(h, day)).find((r) => r.id === je).eta_min, 970);
  await book(h, cn, day, 'pm', 30);
  const e = (await rowsOf(h, day)).find((r) => r.id === je);
  assert.deepEqual([e.truck_id, e.eta_min, e.travel_min], [t, 960 + 50, 55], 'before: E stayed at 16 h 10, counted from P (10 min) while the truck now leaves N (50 min)');
  oneWalk(await rowsOf(h, day));
}));

// ---------- F2: rank / route only where they are exact ----------
test('F2 — blocks mode: a moment says no rank and no route (the booking may re-plan the other blocks); window mode: rank and route are the booking’s, with two vehicles', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 4);
  const t1 = await h.truck('Camion', null, WEEK), t2 = await h.truck('Voiture', null, WEEK);
  await server(h, `update public.trucks set start = '{"label": "S", "lat": 45.53, "lng": -73.62}'::jsonb where id = $1`, [t2]);
  const custs = [[45.5150, -73.6400], [45.5700, -73.7500], [45.5300, -73.6100], [45.4800, -73.5800], [45.5500, -73.7000], [45.5100, -73.5200]];
  const qs = [[45.5400, -73.6700], [45.4900, -73.6000]];
  const places = [HOME, [45.53, -73.62], ...custs, ...qs];
  const mins = (a, b, s) => 6 + Math.round(Math.abs(a[0] - b[0]) * 300 + Math.abs(a[1] - b[1]) * 150) + (s === 1 ? 9 : 0) + (s === 2 ? 5 : 0);
  await measure(h, places, mins);
  await roads(h, true);
  const ids = [];
  for (const [i, at] of custs.entries()) ids.push(await h.customer('C' + i, ...at));
  for (const [i, c] of ids.entries()) await h.fails(() => book(h, c, day, ['am', 'pm', 'eve'][i % 3], 45));
  const rowsB = await suggest(h, qs[0], 30, day);
  assert.ok(rowsB.length > 0);
  for (const r of rowsB) assert.deepEqual([r.rank, r.route, 'rank' in r, 'route' in r], [null, null, true, true], 'before: a rank and a route that the booking did not keep in 39 of 91 cases');
  // window mode: each moment offered, booked in a savepoint: the vehicle, its place and the day's route are the ones said
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  for (let i = 0; i < 2; i++) await server(h, `select public.replan_block_safe($1::date, 'day')`, [day]);
  let n = 0;
  for (const q of qs) {
    const cq = await h.customer('Q', ...q);
    const rows = (await h.rpc('suggest_windows', { p_lat: q[0], p_lng: q[1], p_duration: 30, p_day: day })).slice(0, 5);
    for (const m of rows) {
      assert.equal(m.route[m.rank - 1], 'new');
      await h.c.query('savepoint b');
      const r = await book(h, cq, day, 'day', 30, { win_start: m.win_start });
      const real = (await server(h, `select id from public.jobs where day = $1 and truck_id = $2 and deleted_at is null and status not in ('cancelled','no_show') order by stop_order`, [day, r.truck_id])).map((x) => x.id);
      assert.equal(r.truck_id, m.truck, 'the vehicle said');
      assert.deepEqual(real, m.route.map((x) => (x === 'new' ? r.job_id : x)), 'the route said is the day booked');
      await h.c.query('rollback to savepoint b');
      n++;
    }
  }
  assert.ok(n >= 4, `${n} window moments checked`);
}));

// ---------- F3: today's started blocks get the real arrival times ----------
test('F3 — today, a block already started gets its arrival times written again with the real roads (and back with the estimate)', () => tx(async (h) => {
  await owner(h);
  await h.truck('Camion', null, WEEK);
  const today = await val(h, `select public.local_today()::text v`);
  const A = [45.5150, -73.6400], B = [45.5700, -73.7500], C = [45.5300, -73.6000];
  await clock(h, 400);                                   // 6 h 40: the morning not started yet
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B), cc = await h.customer('C', ...C);
  await book(h, ca, today, 'am', 60); await book(h, cb, today, 'am', 45); await book(h, cc, today, 'pm', 45);
  const est = (await rowsOf(h, today)).filter((r) => r.block === 'am');
  await measure(h, [HOME, A, B, C], () => 90);
  await clock(h, 600);                                   // 10 h: the morning has started
  const sw = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  const am = (await rowsOf(h, today)).filter((r) => r.block === 'am');
  // route_retime of a started block: from now (10 h), from the truck's start (nothing done yet): 90 minutes a leg
  assert.deepEqual(am.map((r) => [r.id, r.stop_order, r.eta_min, r.travel_min]),
    [[est[0].id, 1, 600 + 90, 95], [est[1].id, 2, 600 + 90 + 5 + est[0].duration_min + 90, 95]], 'before: the straight-line times of 6 h 40 stayed');
  assert.ok(sw.late.includes(est[1].id), 'the second now arrives after the morning: said');
  // and back: the estimate's own times (route_retime with the switch off)
  await h.rpc('roads_switch', { p_op: uuid(), p_on: false });
  const back = (await rowsOf(h, today)).filter((r) => r.block === 'am');
  await h.c.query('savepoint r');
  await server(h, `select public.route_retime(truck_id, $1::date, 'am') from public.jobs where day = $1 and block = 'am' and truck_id is not null group by truck_id`, [today]);
  const again = (await rowsOf(h, today)).filter((r) => r.block === 'am');
  await h.c.query('rollback to savepoint r');
  assert.deepEqual(back.map((r) => [r.eta_min, r.travel_min]), again.map((r) => [r.eta_min, r.travel_min]), 'off: the times are the estimate’s');
  assert.notDeepEqual(back.map((r) => r.eta_min), am.map((r) => r.eta_min));
}));

// ---------- F11: a window made late by an automatic re-plan is written down ----------
test('F11 — window mode, switch on: an appointment made late by an automatic re-plan (a position found, a measure) gets an activity « window_late »', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  await h.truck('Camion', null, WEEK);
  await h.rpc('windows_switch', { p_op: uuid(), p_on: true });
  const A = [45.5150, -73.6400], B = [45.6500, -73.4500];
  await measure(h, [HOME, A, B], (a, b) => (a === B || b === B ? 150 : 20));
  await roads(h, true);
  const ca = await h.customer('A', ...A);
  const cb = await h.customer('B', null, null);           // address not found yet: the unknown time (20)
  const ra = await book(h, ca, day, 'day', 60, { win_start: 540 });     // 9 h – 13 h
  await book(h, cb, day, 'day', 60, { win_start: 480 });                // 8 h – 12 h
  assert.deepEqual(await activity(h, 'window_late'), []);
  await server(h, `update public.customers set lat = $2, lng = $3 where id = $1`, [cb, ...B]);   // the locator finds B: 150 min away
  const a = (await rowsOf(h, day)).find((r) => r.id === ra.job_id);
  assert.ok(a.eta_min > a.win_end, 'A is now late (the re-plan places it late rather than in « À placer »)');
  const act = await activity(h, 'window_late');
  assert.deepEqual(act.map((x) => x.id), [ra.job_id], 'before: said to nobody');
  assert.deepEqual([act[0].data.day, act[0].data.eta, act[0].data.win_end], [day, a.eta_min, a.win_end]);
  // a measure that makes it later still does not write it twice; one that makes another late writes that one
  await measure(h, [HOME, A, B], (a1, b1) => (a1 === B || b1 === B ? 160 : 20));
  assert.equal((await activity(h, 'window_late')).length, 1);
}));

test('F11 — the switch and drive_store: each appointment their re-plan makes late gets « window_late »; switch off: no such row', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  await h.truck('Camion 1', null, WEEK);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300];
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am', 100); const rb = await book(h, cb, day, 'am', 100);
  await measure(h, [HOME, A, B], () => 80);
  const on = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.deepEqual(on.late, [rb.job_id]);
  assert.deepEqual((await activity(h, 'window_late')).map((x) => x.id), [rb.job_id]);
  await h.rpc('roads_switch', { p_op: uuid(), p_on: false });
  await server(h, `select public.replan_block_safe($1::date, 'am')`, [day]);
  assert.equal((await activity(h, 'window_late')).length, 1, 'off: nothing new written');
}));

// ---------- F7, F8, F9 ----------
test('F7 — a measured trip without km: the day’s km is not known (null), never a 0 counted', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 6);
  const t = await h.truck('Camion', null, WEEK);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300];
  await book(h, await h.customer('A', ...A), day, 'am', 60); await book(h, await h.customer('B', ...B), day, 'am', 60);
  await measure(h, [HOME, A, B], () => 20, () => 10);
  await roads(h, true);
  assert.equal((await val(h, `select public.day_drive($1::date, $2::uuid) v`, [day, t])).km, 30);
  await server(h, `update public.drive_times set km = null where a = public.drive_key($1, $2) and b = public.drive_key($3, $4)`, [...A, ...B]);
  const d = await val(h, `select public.day_drive($1::date, $2::uuid) v`, [day, t]);
  assert.deepEqual([d.km, d.unmeasured, d.min], [null, 0, 60], 'before: km 20 (a leg counted 0 km)');
}));

test('F8 — a moment far for a fact (a measured hop over the limit) is said far even when another trip of the day is not measured', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 6);
  await h.truck('Camion', null, WEEK);
  const A = [45.5150, -73.6400], Q = [45.4474, -73.4363];
  await book(h, await h.customer('A', ...A), day, 'am', 60);
  const rows = [[...HOME, ...A, 0, 15, 8, 'tomtom'], [...A, ...HOME, 0, 15, 8, 'tomtom'],
    [...A, ...Q, 0, 90, 60, 'tomtom'], [...Q, ...A, 0, 90, 60, 'tomtom'], [...HOME, ...Q, 0, 25, 20, 'tomtom']];   // Q → home not measured
  await val(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify(rows)]);
  await roads(h, true);
  const am = (await suggest(h, Q, 30, day)).find((x) => x.block === 'am');
  assert.deepEqual([am.far, am.hop_min, am.unmeasured], ['hop', 90, 1], 'before: far null');
  // the hop over the limit only through the unknown time (A → Q not measured counts unknown_min, 50; the day 115 over 105
  // only through two such trips): not known
  await server(h, `delete from public.drive_times where a = public.drive_key($1, $2) and b = public.drive_key($3, $4)`, [...A, ...Q]);
  await setBooking(h, 'unknown_min', 50);
  const am2 = (await suggest(h, Q, 30, day)).find((x) => x.block === 'am');
  assert.deepEqual([am2.far, am2.hop_min, am2.unmeasured, am2.day_min], [null, 50, 2, 115]);
}));

test('F9 — roads_rush written as "false", 0 or "0" means no; a trip with no road keeps no rush time', () => tx(async (h) => {
  await owner(h);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300];
  await measure(h, [A, B], (a, b, s) => (s === 0 ? 30 : s === 1 ? 61 : 72));
  await roads(h, true);
  await server(h, `select set_config('garage.drive_dow', '5', true)`);
  const at8 = () => val(h, `select public.drive_min($1, $2, $3, $4, 35, 1.3, 20, 480) v`, [...A, ...B]);
  assert.equal(await at8(), 61);
  for (const no of [false, 'false', 0, '0', 'FALSE']) {
    await setBooking(h, 'roads_rush', no);
    assert.equal(await at8(), 30, `roads_rush ${JSON.stringify(no)}: the usual hours`);
    assert.equal(await val(h, `select public.roads_rush() v`), false);
  }
  for (const yes of [true, 'true', 1]) { await setBooking(h, 'roads_rush', yes); assert.equal(await at8(), 61, `roads_rush ${JSON.stringify(yes)}`); }
  // slot 0 now « no road »: the old rush rows no longer answer
  await server(h, `update public.drive_times set minutes = null, km = null, source = 'none' where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = 0`, [...A, ...B]);
  assert.equal(await at8(), 20, 'before: 61 (a rush time of a trip that has no road)');
  assert.equal(await val(h, `select public.drive_min($1, $2, $3, $4, 35, 1.3, 20, 960) v`, [...A, ...B]), 20);
}));

// ---------- F10: move_preview takes its locks in the planner's order ----------
test('F10 — move_preview locks the blocks of its list in order (day, then morning → evening): no deadlock with a re-plan', async () => {
  const s2 = await pool.connect();
  try {
    await tx(async (h) => {
      await h.q(`set local lock_timeout = '8s'`);
      await owner(h);
      const day = await futureDay(h, 4);
      const t1 = await h.truck('Camion', null, WEEK), t2 = await h.truck('Voiture', null, WEEK);
      const ca = await h.customer('A', 45.5150, -73.6400), ce = await h.customer('E', 45.5300, -73.6000);
      await h.as(null); await h.q(`select set_config('garage.rpc', 'on', true)`);
      const ja = (await h.q(`insert into public.jobs (customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min) values ($1, $2, 'am', $3, 'booked', 45, 45.515, -73.64, 1, 500, 20) returning id`, [ca, day, t1]))[0].id;
      const je = (await h.q(`insert into public.jobs (customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min) values ($1, $2, 'eve', $3, 'booked', 45, 45.53, -73.60, 1, 980, 20) returning id`, [ce, day, t1]))[0].id;
      await h.q(`select set_config('garage.rpc', '', true)`); await h.as(h.me);
      await s2.query('begin'); await s2.query(`set local lock_timeout = '8s'`);
      await s2.query(`select public.lock_block($1::date, 'am')`, [day]);            // a re-plan holds the morning…
      const p = h.c.query(`select public.move_preview($1::uuid, $2::date, null, $3::uuid[]) v`, [t2, day, [je, ja]]).then((r) => r.rows[0].v, (e) => e);
      await new Promise((r) => setTimeout(r, 600));
      const got = await s2.query(`select public.lock_block($1::date, 'eve')`, [day]).then(() => 'got eve', (e) => `${e.code} ${e.message}`);   // …then wants the evening
      await s2.query('rollback');
      const res = await p;
      assert.equal(got, 'got eve', 'before: 40P01 deadlock detected');
      assert.ok(!(res instanceof Error), String(res?.message));
      assert.deepEqual(res.refused, []);
    });
  } finally { await s2.query('rollback').catch(() => {}); s2.release(); }
});

// ---------- verify-measure F1–F4 ----------
test('VM-F1 — a measuring setting that is not a sensible number is read as its default or clamped, never an error', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  await h.truck('Camion', null, WEEK);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300];
  await book(h, await h.customer('A', ...A), day, 'am', 60); await book(h, await h.customer('B', ...B), day, 'am', 60);
  await measure(h, [HOME, A, B], () => 10);
  const total = async () => (await val(h, `select public.drive_wanted(null, null, 14) v`)).total;
  assert.equal(await total(), 0);
  for (const v of [0, -1, 'abc', null, '30']) {
    await setBooking(h, 'roads_keep_days', v);
    assert.equal(await total(), 0, `roads_keep_days ${JSON.stringify(v)}: nothing asked again (before: 0 → every trip, "abc" → 22P02)`);
  }
  for (const v of ['abc', -5]) { await setBooking(h, 'roads_rush_min', v); await total(); }
  await setBooking(h, 'roads_month_tx', 1e10);
  const s = await val(h, `select public.drive_spend_add(0) v`);
  assert.equal(s.cap, 2147483647, 'before: integer out of range');
  await setBooking(h, 'roads_month_tx', 'abc');
  assert.equal((await val(h, `select public.drive_spend_add(0) v`)).cap, 10000);
  assert.equal((await val(h, `select public.roads_state() v`)).month.cap, 10000);
}));

test('VM-F2 — drive_wanted: a point too big or too small for a number is left out, and a day far in the future is not an error', () => tx(async (h) => {
  await owner(h);
  await h.truck('Camion', null, WEEK);
  for (const p of ['{"lat": 1e400, "lng": 0}', '{"lat": 45.5, "lng": 1e-400}', '{"lat": -1e400, "lng": 1e400}']) {
    const w = await val(h, `select public.drive_wanted($1::jsonb, null, 3) v`, [p]);
    assert.equal(w.pairs.filter((x) => x[5]).length, 0, p);
  }
  const far = await val(h, `select public.drive_wanted(null, '5874897-12-25'::date, 14) v`);
  assert.equal(typeof far.total, 'number');
}));

test('VM-F3 — « no road » never replaces a real time, even an old one; the old row is not asked again at once', () => tx(async (h) => {
  await owner(h);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300];
  await val(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify([[...A, ...B, 0, 25, 12, 'tomtom'], [...B, ...A, 0, 26, 12, 'osrm']])]);
  await server(h, `update public.drive_times set at = now() - interval '121 days' where a in (public.drive_key($1, $2), public.drive_key($3, $4))`, [...A, ...B]);
  const s = await val(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify([[...A, ...B, 0, null, null, 'none'], [...B, ...A, 0, null, null, 'none']])]);
  assert.equal(s.ok, true);
  const rows = await server(h, `select source, minutes, km::float, at > now() - interval '1 minute' fresh from public.drive_times
    where a in (public.drive_key($1, $2), public.drive_key($3, $4)) order by minutes`, [...A, ...B]);
  assert.deepEqual(rows.map((r) => [r.source, r.minutes, r.km, r.fresh]), [['tomtom', 25, 12, true], ['osrm', 26, 12, true]], 'before: both became « none »');
}));

test('VM-F4 — drive_store leaves out an OSRM rush time, an absurd km, and a position no number can hold (the others are kept)', () => tx(async (h) => {
  await owner(h);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300], C = [45.5300, -73.6100];
  const raw = `[[${A}, ${B}, 1, 30, 5, "osrm"], [${A}, ${C}, 0, 30, 100000, "tomtom"], [1e400, 0, ${B}, 0, 30, 5, "tomtom"], [${A}, 1e-400, 0, 0, 30, 5, "tomtom"], [${B}, ${C}, 0, 12, 3, "tomtom"]]`;
  const s = await val(h, `select public.drive_store($1::jsonb) v`, [raw]);
  assert.equal(s.stored, 1, 'only the good row (before: 22003, the whole batch lost)');
  assert.equal(Number(await val(h, `select count(*) v from public.drive_times where a = public.drive_key($1, $2)`, A)), 0);
}));

// ---------- the sheets' asks: what move_preview and stop_order_preview say ----------
test('move_preview says why each refused job is refused, and previews the very move « Changer de camion » sends (5 arguments)', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 3);
  const t1 = await h.truck('Camion', null, WEEK), t2 = await h.truck('Voiture', null, WEEK);
  await server(h, `update public.trucks set tire_machine = false where id = $1`, [t2]);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300];
  const ra = await book(h, await h.customer('A', ...A), day, 'am', 60, { vehicle_kind: 'truck' });
  await server(h, `update public.jobs set needs_machine = true where id = $1`, [ra.job_id]);
  const rb = await book(h, await h.customer('B', ...B), day, 'am', 60, { vehicle_kind: 'truck' });
  const p = await movePreview(h, t2, day, 'am', [ra.job_id, rb.job_id]);
  assert.deepEqual(p.refused, [ra.job_id]);
  assert.deepEqual(p.refused_why, { [ra.job_id]: 'needs_truck' });
  // the 5-argument move (the window kept as move_job keeps it) is what the preview gives with p_as_told
  const told = await movePreview(h, t2, day, 'am', [rb.job_id], true);
  await h.c.query('savepoint m');
  await h.rpc('move_job', { p_op: uuid(), p_job: rb.job_id, p_day: day, p_block: 'am', p_truck: t2 });
  const real = await server(h, `select id, eta_min from public.jobs where day = $1 and truck_id = $2 order by stop_order`, [day, t2]);
  await h.c.query('rollback to savepoint m');
  assert.deepEqual(told.order, real.map((r) => r.id));
  assert.deepEqual(told.eta, Object.fromEntries(real.map((r) => [r.id, r.eta_min])));
  assert.deepEqual(told.refused_why, {});
}));

test('stop_order_preview says for each stop whether its time is sure (every trip of the day up to it measured); off: not said', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 6);
  const t = await h.truck('Camion', null, WEEK);
  const A = [45.5150, -73.6400], B = [45.5250, -73.6300], C = [45.5300, -73.6100];
  const ja = (await book(h, await h.customer('A', ...A), day, 'am', 30)).job_id;
  const jb = (await book(h, await h.customer('B', ...B), day, 'am', 30)).job_id;
  const jc = (await book(h, await h.customer('C', ...C), day, 'am', 30)).job_id;
  const off = await orderPreview(h, t, day, 'am', [ja, jb, jc]);
  assert.deepEqual(off.map((x) => x.measured), [null, null, null]);
  // every trip measured but B → C
  const rows = [];
  for (const a of [HOME, A, B, C]) for (const b of [HOME, A, B, C]) if (a !== b && !(a === B && b === C)) rows.push([...a, ...b, 0, 10, 4, 'tomtom']);
  await val(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify(rows)]);
  await roads(h, true);
  const on = await orderPreview(h, t, day, 'am', [ja, jb, jc]);
  assert.deepEqual(on.map((x) => [x.id, x.measured]), [[ja, true], [jb, true], [jc, false]]);
  const on2 = await orderPreview(h, t, day, 'am', [jb, jc, ja]);
  assert.deepEqual(on2.map((x) => [x.id, x.measured]), [[jb, true], [jc, false], [ja, false]]);
}));
