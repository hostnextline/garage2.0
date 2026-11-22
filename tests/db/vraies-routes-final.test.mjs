// « Vraies routes » (Part 27), the fixes after the last review (reports/final-*.md of the work folder, 2026-11-21):
//  - final-guess G2: a moment whose trips are not all measured is never RANKED by its guessed minutes (the fixed unknown
//    time): « Meilleur choix », the ★ and « Plutôt … » read the first rows. After the measured ones, by day and block (by the
//    hour for the windows).
//  - final-guess G1: window mode, a window TOLD to the customer is never cut from an arrival that counts the unknown time
//    (a booking or a move with no window said, a flexible appointment locked): it stays « flexible » until measured.
// Each test was written first and seen failing on the migration of before (the reason in its name).
// Run: node --test tests/db/vraies-routes-final.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];                       // home_point() when the settings have none
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
async function switches(h, json) {
  for (const k of ['roads', 'windows']) await server(h, `select set_config('garage.${k}', 'on', true)`);
  await server(h, `update public.settings set booking = coalesce(booking, '{}'::jsonb) || $1::jsonb where id = 1`, [JSON.stringify(json)]);
  for (const k of ['roads', 'windows']) await server(h, `select set_config('garage.${k}', '', true)`);
}
const store = (h, rows, days = null) => val(h, `select public.drive_store($1::jsonb, $2::date[]) v`, [JSON.stringify(rows), days]);
/** both ways, the three times of the day, the same minutes */
const both = (a, b, m, km = 5) => [0, 1, 2].flatMap((s) => [[...a, ...b, s, m, km, 'tomtom'], [...b, ...a, s, m, km, 'tomtom']]);
const book = (h, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
const job = async (h, id) => (await server(h, `select day::text, eta_min, win_start, win_end, win_flex, truck_id from public.jobs where id = $1`, [id]))[0];
async function owner(h) { const o = await h.person('Hassan', ['owner']); await become(h, o); return o; }
const addDays = (h, day, n) => val(h, `select ($1::date + $2::int)::text v`, [day, n]);

// ---------- G2: the order of the moments offered ----------
test('G2 blocks: a moment with a trip not measured is never ranked by its guessed minutes (before: the guess put the far day first)', () => tx(async (h) => {
  const o = await owner(h);
  const d1 = await futureDay(h, 2), d2 = await addDays(h, d1, 1), d3 = await addDays(h, d1, 2);
  await server(h, `delete from public.trucks`);
  const X = [45.5100, -73.6500], Y = [45.5300, -73.6100], Z = [45.6500, -73.5000], P = [45.5320, -73.6080];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const cx = await h.customer('Xavier', ...X), cy = await h.customer('Yves', ...Y), cz = await h.customer('Zoé', ...Z);
  await h.as(o);
  await switches(h, { roads_on: true, max_hop_min: 0, max_day_drive_min: 0 });
  // X is near the start, Z far from it; Y is the day where the new address P really belongs (3 min from it)
  await store(h, [...both(HOME, X, 5), ...both(HOME, Y, 10), ...both(HOME, Z, 40), ...both(X, Y, 12), ...both(X, Z, 38), ...both(Y, Z, 35),
    ...both(P, HOME, 10), ...both(P, Y, 3)]);       // P ↔ X and P ↔ Z are not measured: they count the unknown 20 minutes
  for (const [c, d] of [[cx, d1], [cy, d2], [cz, d3]]) assert.equal((await book(h, c, d, 'am', 60)).ok, true);
  const rows = await h.rpc('suggest_blocks', { p_lat: P[0], p_lng: P[1], p_duration: 60, p_from: d1, p_days: 3, p_exclude: null, p_limit: 60, p_need: false, p_kind: null });
  const am = rows.filter((r) => r.block === 'am').map((r) => ({ day: r.day, add: r.add_min, unm: r.unmeasured }));
  assert.deepEqual(am.map((r) => r.unm > 0), [false, true, true], 'the measured day first: ' + JSON.stringify(am));
  assert.deepEqual(am.map((r) => r.day), [d2, d1, d3], 'then by day, never by the guessed minutes (Z’s day « adds 0 » only by the guess): ' + JSON.stringify(am));
  // every measured row comes before every row with a trip not measured, and those keep the day / block order
  const unm = rows.map((r) => r.unmeasured > 0);
  assert.equal(unm.indexOf(true) === -1 ? rows.length : unm.indexOf(true), unm.filter((x) => !x).length, 'measured rows first');
  const later = rows.filter((r) => r.unmeasured > 0).map((r) => `${r.day} ${r.pos}`);
  assert.deepEqual(later, [...later].sort(), 'the rows not measured in day and block order');
}));

test('G2 windows: the windows of a day whose trips are not measured are ranked by the hour, never by guessed minutes (before: the guessed « 0 min added » first)', () => tx(async (h) => {
  const o = await owner(h);
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const A = [45.5150, -73.6400], B = [45.5600, -73.5600], P = [45.5400, -73.6000];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const ca = await h.customer('Ana', ...A), cb = await h.customer('Bob', ...B);
  await h.as(o);
  await switches(h, { windows_on: true, roads_on: true, max_hop_min: 0, max_day_drive_min: 0 });
  // B is far from the start but near A: by the guess, P « adds nothing » after B (20 + 20 unknown − 60 measured)
  await store(h, [...both(HOME, A, 10), ...both(HOME, B, 60), ...both(A, B, 15)]);   // P is measured with nothing
  assert.equal((await book(h, ca, day, 'day', 60, { win_start: 480 })).ok, true);
  assert.equal((await book(h, cb, day, 'day', 60, { win_start: 840 })).ok, true);
  const rows = await val(h, `select public.suggest_windows_core($1, $2, 60, $3::date) v`, [...P, day]);
  assert.ok(rows.length >= 3, 'windows offered: ' + rows.length);
  assert.ok(rows.every((r) => r.unmeasured > 0), 'P is measured with nothing');
  const starts = rows.map((r) => r.win_start);
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y), 'by the hour: ' + JSON.stringify(rows.map((r) => [r.win_start, r.drive_min, r.wait_min])));
}));

// ---------- G1: no window told from a guessed arrival ----------
test('G1 book_job, window mode: no window said and a trip not measured → flexible, no window cut from the guess; measured → cut as before (before: 9 h–13 h told from a guessed 9 h 40)', () => tx(async (h) => {
  const o = await owner(h);
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const A = [45.5150, -73.6400], P = [45.4474, -73.4363];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const ca = await h.customer('Ana', ...A), cp = await h.customer('Paul', ...P);
  await h.as(o);
  await switches(h, { windows_on: true, roads_on: true });
  await store(h, both(HOME, A, 15));
  // A, measured, booked with no window said: the window is cut around its measured arrival (as before)
  const ra = await book(h, ca, day, 'day', 60);
  const ja = await job(h, ra.job_id);
  assert.equal(ja.win_flex, false);
  const wa = (await server(h, `select w.win_start, w.win_end from public.win_for($1) w`, [ja.eta_min]))[0];
  assert.deepEqual([ja.win_start, ja.win_end], [wa.win_start, wa.win_end], 'A: its window cut from its measured arrival');
  assert.notEqual(ja.win_start, null);
  // P, not measured (the warm failed): stays flexible, nothing cut from 8 h + 15 + 60 + 20 unknown
  const rp = await book(h, cp, day, 'day', 60);
  const jp = await job(h, rp.job_id);
  assert.deepEqual([jp.win_start, jp.win_end, jp.win_flex], [null, null, true], 'no window told from a guess: ' + JSON.stringify(jp));
  assert.equal(await val(h, `select public.eta_known($1::uuid) v`, [rp.job_id]), false, 'its arrival counts the unknown time');
  assert.deepEqual([rp.win_start, rp.win_end, rp.win_flex], [null, null, true], 'the answer says it too (the app shows « flexible »)');
  // lock_windows_core (18 h the day before, every 10 minutes): nothing cut while it is not measured
  assert.equal((await val(h, `select public.lock_windows_core($1::date) v`, [day])).fixed, 0, 'not while it is not measured');
  assert.equal((await job(h, rp.job_id)).win_start, null);
  // the real times come (the sweep): its window is cut from its real arrival
  await store(h, [...both(A, P, 50), ...both(HOME, P, 45)]);
  assert.equal(await val(h, `select public.eta_known($1::uuid) v`, [rp.job_id]), true);
  const lk = await val(h, `select public.lock_windows_core($1::date) v`, [day]);
  assert.deepEqual(lk.jobs, [rp.job_id], 'fixed once measured');
  const now = await job(h, rp.job_id);
  const want = (await server(h, `select w.win_start, w.win_end from public.win_for($1) w`, [now.eta_min]))[0];
  assert.deepEqual([now.win_start, now.win_end], [want.win_start, want.win_end], 'the window of the real arrival');
}));

test('G1 move_job, window mode: moved to another day with no window said and a trip not measured → flexible (before: a window cut from the guess)', () => tx(async (h) => {
  const o = await owner(h);
  const d1 = await futureDay(h, 2), d2 = await addDays(h, d1, 1);
  await server(h, `delete from public.trucks`);
  const P = [45.4474, -73.4363];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const cp = await h.customer('Paul', ...P);
  await h.as(o);
  await switches(h, { windows_on: true, roads_on: true });
  const rp = await book(h, cp, d1, 'day', 60, { win_start: 600 });           // a window chosen by a person: kept as chosen
  assert.equal((await job(h, rp.job_id)).win_start, 600);
  const mv = await h.rpc('move_job', { p_op: uuid(), p_job: rp.job_id, p_day: d2, p_block: 'day', p_truck: null, p_win_start: null, p_win_flex: false });
  assert.equal(mv.ok, true);
  const jp = await job(h, rp.job_id);
  assert.deepEqual([jp.day, jp.win_start, jp.win_end, jp.win_flex], [d2, null, null, true], 'flexible on the new day: ' + JSON.stringify(jp));
  assert.equal(mv.tell, true, 'the customer is told again (the window they had is gone)');
  // the switch off: the same move cuts a window as before
  await switches(h, { roads_on: false });
  const mv2 = await h.rpc('move_job', { p_op: uuid(), p_job: rp.job_id, p_day: d1, p_block: 'day', p_truck: null, p_win_start: null, p_win_flex: false });
  assert.equal(mv2.ok, true);
  const j2 = await job(h, rp.job_id);
  assert.notEqual(j2.win_start, null, 'switch off: the window of the estimate, as before');
}));

// ---------- round 5 (the lead's decisions of 2026-11-21 00:50): the flag on the appointment, the measuring's money ----------
const setBooking = (h, key, json) => server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), $1::text[], $2::jsonb) where id = 1`, [[key], JSON.stringify(json)]);
const flags = async (h, ids) => (await server(h, `select id, eta_min, eta_measured from public.jobs where id = any($1::uuid[])`, [ids]))
  .reduce((o, r) => ({ ...o, [r.id]: r.eta_measured }), {});
const W = (h, point, from, days) => val(h, `select public.drive_wanted($1::jsonb, $2::date, $3) v`, [point && JSON.stringify({ lat: point[0], lng: point[1] }), from, days]);
const has = (w, a, b, slot) => w.pairs.find((p) => p[0] === a[0] && p[1] === a[1] && p[2] === b[0] && p[3] === b[1] && p[4] === slot);
const row = async (h, a, b, slot = 0) => (await server(h, `select minutes, km::float8 km, source, tt_none_at is not null tt_none from public.drive_times
  where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = $5`, [...a, ...b, slot]))[0];

test('G1 flag (decision 2): jobs.eta_measured is written with each arrival — true when every trip of the vehicle’s day up to it is measured, false after a trip that is not, null off (before: no such column)', () => tx(async (h) => {
  const o = await owner(h);
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const A = [45.5150, -73.6400], P = [45.4474, -73.4363], Q = [45.5300, -73.6100];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const ca = await h.customer('Ana', ...A), cp = await h.customer('Paul', ...P), cq = await h.customer('Quinn', ...Q);
  await h.as(o);
  await switches(h, { roads_on: true });
  await store(h, [...both(HOME, A, 15), ...both(HOME, Q, 12), ...both(A, Q, 9)]);     // P is measured with nothing
  const ja = (await book(h, ca, day, 'am', 60)).job_id, jp = (await book(h, cp, day, 'pm', 60)).job_id, jq = (await book(h, cq, day, 'eve', 30)).job_id;
  assert.deepEqual(await flags(h, [ja, jp, jq]), { [ja]: true, [jp]: false, [jq]: false },
    'A measured; P after a trip not measured; Q after P (every trip of the day up to it)');
  // the sweep measures P: drive_store plans the day again and the flags follow the arrivals it writes
  await store(h, [...both(A, P, 50), ...both(HOME, P, 45), ...both(P, Q, 40)]);
  assert.deepEqual(await flags(h, [ja, jp, jq]), { [ja]: true, [jp]: true, [jq]: true }, 'measured: true with the real arrivals');
  // the switch off (roads_switch): nothing says « measured » or not
  const off = await h.rpc('roads_switch', { p_op: uuid(), p_on: false });
  assert.equal(off.ok, true);
  assert.deepEqual(await flags(h, [ja, jp, jq]), { [ja]: null, [jp]: null, [jq]: null }, 'off: null');
  // and the planner of the switch off never writes it
  assert.equal((await book(h, ca, day, 'am', 30)).ok, true);
  assert.equal(Number(await val(h, `select count(*) v from public.jobs where eta_measured is not null`)), 0);
  // the flag is the planner's, like eta_min: no « update » activity for it
  assert.equal(Number(await val(h, `select count(*) v from public.activity where entity = 'job' and action = 'update' and data ? 'eta_measured'`)), 0);
}));

test('G1 late (decision 2b): an arrival counted with the unknown time is never judged late (window_late, « clients à rappeler »); once measured, it is (before: late from the guess)', () => tx(async (h) => {
  const o = await owner(h);
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const P = [45.4474, -73.4363];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const cp = await h.customer('Paul', ...P);
  await h.as(o);
  await switches(h, { roads_on: true, unknown_min: 300 });              // a trip not measured counts 300 minutes
  const jp = (await book(h, cp, day, 'am', 30, { force: true })).job_id;   // « Réserver quand même »: placed, after 12 h
  const j = await job(h, jp);
  assert.ok(j.eta_min > 720, 'the guessed arrival is after the block: ' + j.eta_min);
  assert.equal((await flags(h, [jp]))[jp], false);
  assert.deepEqual(await val(h, `select public.roads_late_ids($1::date[]) v`, [[day]]), {}, 'not judged late from a guess');
  assert.deepEqual(await val(h, `select public.roads_late_note($1::date[], '{}'::jsonb, 'roads') v`, [[day]]), [], 'nobody to call for a guess');
  // measured: 4 h 40 each way (a far address): late for a fact, said once
  const r = await store(h, both(HOME, P, 280));
  assert.equal((await flags(h, [jp]))[jp], true);
  assert.deepEqual(r.late, [jp], 'late from the real arrival: ' + JSON.stringify(r));
  assert.equal(Number(await val(h, `select count(*) v from public.activity where action = 'window_late' and entity_id = $1`, [jp])), 1);
}));

test('money F8: roads_keep_days and roads_rush_min are the owner’s, like the two ceilings (before: the office could make every trip asked again every day)', () => tx(async (h) => {
  const office = await h.person('Bureau', ['office'], { rights: { settings: true } });
  const o = await owner(h);
  await setBooking(h, 'roads_keep_days', 120);
  await become(h, office);
  await h.q(`update public.settings set booking = booking || '{"roads_keep_days": 1, "roads_rush_min": 0, "near_min": 12}'::jsonb where id = 1`);
  let b = (await server(h, `select booking from public.settings where id = 1`))[0].booking;
  assert.deepEqual([b.roads_keep_days, 'roads_rush_min' in b, b.near_min], [120, false, 12], 'the office: kept as they were, the rest saved');
  await become(h, o);
  await h.q(`update public.settings set booking = booking || '{"roads_keep_days": 60, "roads_rush_min": 20}'::jsonb where id = 1`);
  b = (await server(h, `select booking from public.settings where id = 1`))[0].booking;
  assert.deepEqual([b.roads_keep_days, b.roads_rush_min], [60, 20], 'the owner: saved');
}));

test('money F3: TomTom said « no road » and OSRM gave the time — TomTom is asked again after 7 days, not every day (before: 18 transactions a day for such a stop)', () => tx(async (h) => {
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const P = [45.4474, -73.4363];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const cp = await h.customer('Paul', ...P);
  await server(h, `insert into public.jobs (customer_id, day, block, duration_min, status) values ($1, $2::date, 'am', 30, 'booked')`, [cp, day]);
  // P → home: TomTom « no road », OSRM 40 min (the 9th element); home → P: OSRM only (TomTom could not be used)
  await store(h, [[...P, ...HOME, 0, 40, 30, 'osrm', true], [...HOME, ...P, 0, 42, 31, 'osrm']]);
  assert.deepEqual(await row(h, P, HOME), { minutes: 40, km: 30, source: 'osrm', tt_none: true });
  assert.equal((await row(h, HOME, P)).tt_none, false);
  await server(h, `update public.drive_times set at = now() - interval '2 days', tt_none_at = case when tt_none_at is not null then now() - interval '2 days' end`);
  let w = await W(h, null, day, 1);
  assert.equal(has(w, P, HOME, 0), undefined, 'two days old, TomTom said no road: not asked again');
  assert.equal(has(w, HOME, P, 0)?.[6], 'osrm', 'the other one (TomTom never asked): asked to TomTom a day later, as before');
  await server(h, `update public.drive_times set at = now() - interval '8 days', tt_none_at = now() - interval '8 days' where tt_none_at is not null`);
  w = await W(h, null, day, 1);
  assert.equal(has(w, P, HOME, 0)?.[6], 'osrm', 'after 7 days: TomTom again');
  // a TomTom time forgets it
  await store(h, [[...P, ...HOME, 0, 38, 29, 'tomtom']]);
  assert.deepEqual(await row(h, P, HOME), { minutes: 38, km: 29, source: 'tomtom', tt_none: false });
}));

test('money F4: a trip answered with more than a day of driving is kept as « no road » (asked again after 7 days), never left out and paid again at every call', () => tx(async (h) => {
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const V = [49.2827, -123.1207];                                     // an address taken in the wrong province
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const cv = await h.customer('Vancouver', ...V);
  await server(h, `insert into public.jobs (customer_id, day, block, duration_min, status) values ($1, $2::date, 'am', 30, 'booked')`, [cv, day]);
  assert.ok(has(await W(h, null, day, 1), HOME, V, 0), 'asked');
  const r = await store(h, [[...HOME, ...V, 0, 2700, 4500, 'tomtom'], [...V, ...HOME, 0, 2690, 4500, 'osrm']]);
  assert.equal(r.stored, 2);
  assert.deepEqual(await row(h, HOME, V), { minutes: null, km: null, source: 'none', tt_none: false });
  const w = await W(h, null, day, 1);
  assert.equal(has(w, HOME, V, 0), undefined, 'not asked again at the next call');
  assert.equal(w.total0, 0, 'roads_cold does not wait for it');
}));

test('money F5: the times are kept when the re-plan fails (a lock, an error); the answer names the days to plan again', () => tx(async (h) => {
  const o = await owner(h);
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const P = [45.4474, -73.4363];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const cp = await h.customer('Paul', ...P);
  await h.as(o);
  await switches(h, { roads_on: true });
  await book(h, cp, day, 'am', 30);
  await server(h, `create or replace function public.roads_replan(p_days date[]) returns jsonb language plpgsql as $$
    begin raise exception 'canceling statement due to lock timeout'; end $$`);
  const r = await store(h, both(HOME, P, 45));
  assert.equal(r.stored, 6, 'kept: ' + JSON.stringify(r));
  assert.deepEqual(r.replan, [day]);
  assert.match(r.replan_error, /lock timeout/);
  assert.equal((await row(h, HOME, P)).minutes, 45);
}));

test('security F2: drive_prune deletes the trips older than 30 days with an end that is no place of the coming days, and only those', () => tx(async (h) => {
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  const A = [45.5150, -73.6400], T = [45.6000, -73.5500], U = [45.4800, -73.5800];
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  const ca = await h.customer('Ana', ...A);
  await server(h, `insert into public.jobs (customer_id, day, block, duration_min, status) values ($1, $2::date, 'am', 30, 'booked')`, [ca, day]);
  await server(h, `delete from public.drive_times`);
  // A booked ahead; T an address typed and never booked; U typed too, but measured last week
  await store(h, [...both(HOME, A, 15), ...both(HOME, T, 20), ...both(A, T, 18), ...both(HOME, U, 25)]);
  await server(h, `update public.drive_times set at = now() - interval '40 days'
                   where not (a = public.drive_key($1, $2) or b = public.drive_key($1, $2))`, U);
  const n = await val(h, `select public.drive_prune() v`);
  assert.equal(n, 12, 'T’s trips (home ↔ T, A ↔ T, the three times)');
  const left = await server(h, `select count(*) filter (where a = public.drive_key($1, $2) or b = public.drive_key($1, $2))::int t,
    count(*) filter (where a = public.drive_key($3, $4) or b = public.drive_key($3, $4))::int u, count(*)::int n from public.drive_times`, [...T, ...U]);
  assert.deepEqual(left[0], { t: 0, u: 6, n: 12 }, 'home ↔ A kept (a coming appointment), U kept (younger than 30 days)');
}));

test('critic W1: web_unmeasured says how many moments the public page left out because a trip is not measured (0 off)', () => tx(async (h) => {
  const o = await owner(h);
  const day = await futureDay(h, 2);
  await server(h, `delete from public.trucks`);
  await h.as(null);
  await h.truck('Camion', null, WEEK);
  await h.as(o);
  await server(h, `update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": true}'::jsonb) where id = 1`);
  const svc = await val(h, `insert into public.services (name_fr, price_cents, duration_min, active) values ('Vidange TEST', 7999, 30, true) returning id`);
  const near = [HOME[0] + 0.01, HOME[1] + 0.01];
  const count = () => val(h, `select public.web_unmeasured($1, $2, $3::uuid[], $4::date, 1) v`, [...near, [svc], day]);
  assert.equal(await count(), 0, 'switch off: 0');
  await switches(h, { roads_on: true });
  assert.deepEqual(await val(h, `select public.web_suggest($1, $2, $3::uuid[], $4::date, 1, 6) v`, [...near, [svc], day]), []);
  assert.ok(await count() > 0, 'not offered because not measured');
  await store(h, both(HOME, near, 6));
  assert.equal(await count(), 0, 'measured: nothing left out for that reason');
  assert.ok((await val(h, `select public.web_suggest($1, $2, $3::uuid[], $4::date, 1, 6) v`, [...near, [svc], day])).length > 0);
}));
