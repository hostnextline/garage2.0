// « Vraies routes » (Part 27): nothing guessed in an answer. The rush-hour times only when the garage wants them
// (roads_rush), a trip with no road time is « not measured » (drive_known, day_drive, the moments offered say it and are never
// marked far by a guess, never offered online), « near » and « farthest first » by measured minutes, and the place of a new stop
// in the day (rank, route) is the one a booking then really gives. Switch off: the very same answers as before.
// Run: node --test tests/db/vraies-routes-reponses.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];
const A = [45.5150, -73.6400], B = [45.5700, -73.7500], P = [45.4474, -73.4363];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const same = (p, q) => p[0] === q[0] && p[1] === q[1];
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
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
async function measure(h, places, fn, km = (a, b) => 5) {
  const rows = [];
  for (const a of places) for (const b of places) if (a !== b) for (const s of [0, 1, 2]) rows.push([...a, ...b, s, fn(a, b, s), km(a, b), 'tomtom']);
  await val(h, `select public.drive_store($1::jsonb)`, [JSON.stringify(rows)]);
}
const book = (h, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
const suggest = (h, at, dur, day, days = 1) => h.rpc('suggest_blocks', { p_lat: at[0], p_lng: at[1], p_duration: dur, p_from: day, p_days: days, p_exclude: null, p_limit: 20 });
const driveMin = async (h, a, b, tm = null) => Number(await val(h, `select public.drive_min($1, $2, $3, $4, 35, 1.3, 20, $5::int) v`, [...a, ...b, tm]));
const known = (h, a, b) => val(h, `select public.drive_known($1, $2, $3, $4) v`, [...a, ...b]);
/** a truck's day as the server walks it (block after block, the stops in their order) */
const walk = async (h, day, truck) => (await server(h, `select j.id from public.jobs j join public.blocks() b on b.key = j.block
  where j.day = $1 and j.truck_id = $2 and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
  order by b.pos, coalesce(j.stop_order, 9999), coalesce(j.eta_min, 9999)`, [day, truck])).map((r) => r.id);
async function start(h, dow = 4) {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, dow);
  const truck = await h.truck('Camion 1', null, WEEK);
  return { owner, day, truck };
}
const OLD_BLOCK_KEYS = ['add_km', 'add_min', 'block', 'day', 'day_min', 'drive_min', 'far', 'hop_min', 'left', 'near', 'pos', 'stops', 'truck'];
const OLD_WINDOW_KEYS = ['add_km', 'add_min', 'block', 'day', 'day_min', 'drive_min', 'eta', 'far', 'hop_min', 'left', 'near', 'pos', 'stops', 'truck', 'wait_min', 'win_end', 'win_start'];
const NEW_KEYS = ['day_km', 'rank', 'route', 'unmeasured'];
const keys = (o) => Object.keys(o).sort();

test('roads_rush false: the usual hours only (stored rush times left alone), and the coming days planned again', () => tx(async (h) => {
  const { day } = await start(h, 2);
  const ca = await h.customer('A', ...A);
  await roads(h, true);
  await measure(h, [HOME, A], (a, b, s) => (s === 1 ? 70 : 25));
  const r = await book(h, ca, day, 'am', 60);
  assert.equal((await row(h, r.job_id)).eta_min, 480 + 70, 'Tuesday 8 h: the morning rush');
  await server(h, `select set_config('garage.drive_dow', '2', true)`);
  assert.equal(await driveMin(h, HOME, A, 480), 70);
  // the garage says: no rush times. A plain settings save of the owner re-plans the coming days (roads_rush is a plan input)
  await h.q(`update public.settings set booking = jsonb_set(booking, '{roads_rush}', 'false') where id = 1`);
  await server(h, `select set_config('garage.drive_dow', '2', true)`);
  assert.equal(await driveMin(h, HOME, A, 480), 25, 'drive_min obeys roads_rush (review-sql M4)');
  assert.equal((await row(h, r.job_id)).eta_min, 480 + 25, 'planned again with the usual hours');
}));

test('the plan inputs: roads on, the speed and the detour plan nothing and roads_rush re-plans; off, as before', () => tx(async (h) => {
  const pi = (b) => val(h, `select public.plan_inputs($1::jsonb) v`, [JSON.stringify(b)]);
  const base = { speed_kmh: 35, detour: 1.3, stop_min: 5, unknown_min: 20 };
  assert.deepEqual(await pi(base), { lat: null, lng: null, speed: 35, detour: 1.3, stop: 5, unknown: 20, min_block: null, blocks: null }, 'off: the keys of before');
  assert.notDeepEqual(await pi(base), await pi({ ...base, speed_kmh: 40 }));
  assert.deepEqual(await pi(base), await pi({ ...base, roads_rush: false }), 'off: roads_rush plans nothing');
  await roads(h, true);
  assert.deepEqual(await pi(base), await pi({ ...base, speed_kmh: 40, detour: 1.5 }), 'on: speed and detour are not used');
  assert.notDeepEqual(await pi(base), await pi({ ...base, roads_rush: false }));
  assert.deepEqual(await pi(base), await pi({ ...base, roads_rush: true }), 'not said = true');
  assert.notDeepEqual(await pi(base), await pi({ ...base, stop_min: 10 }), 'the stop time still re-plans');
}));

test('drive_known: a usual-hours time measured, or the same place; a « none » row (no road) is not measured', () => tx(async (h) => {
  assert.equal(await known(h, A, B), false);
  assert.equal(await known(h, A, [A[0] + 0.0002, A[1] + 0.0002]), true, 'the same place');
  assert.equal(await val(h, `select public.drive_known($1, $2, null, null) v`, A), false, 'no position: nothing measured');
  await val(h, `select public.drive_store($1::jsonb)`, [JSON.stringify([[...A, ...B, 2, 44, 25, 'tomtom']])]);
  assert.equal(await known(h, A, B), false, 'a rush time alone is not the usual hours');
  await val(h, `select public.drive_store($1::jsonb)`, [JSON.stringify([[...A, ...B, 0, 31, 22.4, 'tomtom']])]);
  assert.equal(await known(h, A, B), true);
  assert.equal(await known(h, B, A), false, 'the way back is another trip');
  // a pair with no road at all (TomTom and OSRM said so): minutes null, source 'none' — never counted as a time
  await roads(h, true);
  await server(h, `alter table public.drive_times alter column minutes drop not null`);
  await server(h, `insert into public.drive_times (a, b, slot, minutes, km, source) values (public.drive_key($1, $2), public.drive_key($3, $4), 0, null, null, 'none')`, [...B, ...A]);
  assert.equal(await known(h, B, A), false);
  assert.equal(await driveMin(h, B, A), 20, 'counted as not measured (booking.unknown_min)');
  assert.equal(await val(h, `select public.drive_km($1, $2, $3, $4, 1.3) v`, [...B, ...A]), null);
}));

test('switch off: the moments offered have the very same keys as before (blocks and windows)', () => tx(async (h) => {
  const { day } = await start(h);
  const ca = await h.customer('A', ...A);
  await book(h, ca, day, 'am', 60);
  await measure(h, [HOME, A, P], () => 15);                         // measured, but the switch is off
  const s = await suggest(h, P, 30, day);
  assert.ok(s.length >= 2);
  for (const x of s) assert.deepEqual(keys(x), OLD_BLOCK_KEYS);
  // roads on: the same plus unmeasured, day_km, rank, route
  await roads(h, true);
  for (const x of await suggest(h, P, 30, day)) assert.deepEqual(keys(x), [...OLD_BLOCK_KEYS, ...NEW_KEYS].sort());
  await roads(h, false);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const w = await h.rpc('suggest_windows', { p_lat: P[0], p_lng: P[1], p_duration: 30, p_day: day });
  assert.ok(w.length >= 2);
  for (const x of w) assert.deepEqual(keys(x), OLD_WINDOW_KEYS);
  for (const x of await suggest(h, P, 30, day)) assert.deepEqual(keys(x), [...OLD_BLOCK_KEYS, 'eta', 'wait_min', 'win_end', 'win_start'].sort());
  await roads(h, true);
  for (const x of await h.rpc('suggest_windows', { p_lat: P[0], p_lng: P[1], p_duration: 30, p_day: day })) assert.deepEqual(keys(x), [...OLD_WINDOW_KEYS, ...NEW_KEYS].sort());
}));

test('a moment whose trips are not measured says so: unmeasured, no km, never « far » by a guess, never offered online', () => tx(async (h) => {
  const { day } = await start(h);
  const ca = await h.customer('A', ...A);
  await book(h, ca, day, 'am', 60);
  await roads(h, true);
  await measure(h, [HOME, A], () => 12);                            // the day measured; the new address not yet
  await setBooking(h, 'unknown_min', 60);                           // a « not measured » leg counts 60: over the 35 of « Garde-route »
  await server(h, `update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": true}'::jsonb) where id = 1`);
  const svc = await val(h, `insert into public.services (name_fr, price_cents, duration_min, active) values ('Vidange TEST', 7999, 30, true) returning id`);
  const near = [HOME[0] + 0.01, HOME[1] + 0.01];
  let am = (await suggest(h, near, 30, day)).find((x) => x.block === 'am');
  assert.ok(am, 'offered to the team (never blocks a booking)');
  assert.ok(am.unmeasured >= 2, 'its trips to and from the new address');
  assert.equal(am.hop_min, 60, 'the placeholder of a trip not measured');
  assert.equal(am.far, null, 'never « far » by a guess (before: far « hop » from the 60 minutes)');
  assert.equal(am.add_km, null); assert.equal(am.day_km, null);
  assert.deepEqual([am.rank, am.route], [null, null], 'blocks mode: no place said (lead F2; window mode: vraies-routes-fix « F2 »)');
  assert.deepEqual(await val(h, `select public.web_suggest($1, $2, $3::uuid[], $4::date, 1, 6) v`, [...near, [svc], day]), [], 'online: nothing not measured');
  // measured: 50 minutes each way between the address and A (a bridge): now far for a fact
  await measure(h, [HOME, A, near], (a, b) => ((same(a, near) && same(b, A)) || (same(a, A) && same(b, near)) ? 50 : 10), () => 7);
  am = (await suggest(h, near, 30, day)).find((x) => x.block === 'am');
  assert.deepEqual([am.unmeasured, am.far, am.hop_min], [0, 'hop', 50]);
  assert.equal(Number(am.day_km), 21, 'start → A 7, A → address 7, address → start 7');
  // online: that day every moment is far for a fact (A is 50 minutes away); the next day, empty, is offered (measured, not far)
  assert.deepEqual(await val(h, `select public.web_suggest($1, $2, $3::uuid[], $4::date, 1, 6) v`, [...near, [svc], day]), []);
  const web = await val(h, `select public.web_suggest($1, $2, $3::uuid[], $4::date, 2, 6) v`, [...near, [svc], day]);
  assert.ok(web.length >= 1 && web.every((x) => x.unmeasured === 0 && x.far === null && x.day !== day), 'online: the measured moments that are not far');
  // window mode: web_windows drops the moments not measured too
  await roads(h, false);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  await roads(h, true);
  const other = [HOME[0] - 0.01, HOME[1] + 0.02];
  assert.deepEqual(await val(h, `select public.web_windows($1, $2, $3::uuid[], $4::date) v`, [...other, [svc], day]), []);
  const ww = await val(h, `select public.web_windows($1, $2, $3::uuid[], $4::date) v`, [...near, [svc], day]);
  assert.ok(ww.length >= 1 && ww.every((x) => x.unmeasured === 0));
}));

test('« near » by measured minutes (near_min) with the switch on; by km (near_km) off', () => tx(async (h) => {
  const { day } = await start(h);
  const J1 = [P[0] + 0.005, P[1]], J3 = [P[0], P[1] + 0.02], J2 = [P[0] + 0.07, P[1]];   // ~0.6 km, ~1.6 km, ~8 km from P
  for (const [i, at] of [J1, J2, J3].entries()) await book(h, await h.customer('J' + i, ...at), day, 'am', 15);
  const near = async () => (await suggest(h, P, 15, day)).find((x) => x.block === 'am').near;
  assert.equal(await near(), 2, 'off: J1 and J3 within 5 km as the crow flies');
  await roads(h, true);
  await measure(h, [HOME, P, J1, J2, J3], (a, b) => {
    if (same(a, P) && same(b, J2)) return 8;                       // 8 km but 8 minutes one way (the highway)
    if ((same(a, P) || same(b, P)) && (same(a, J1) || same(b, J1) || same(a, J3) || same(b, J3))) return 40;   // across the river
    return 15;
  });
  assert.equal(await near(), 1, 'on: J2 only (8 minutes of real driving, near_min 10)');
  await setBooking(h, 'near_min', 5);
  assert.equal(await near(), 0);
}));

test('« farthest first » by measured minutes from the trucks’ starts (on), by km (off)', () => tx(async (h) => {
  const { owner, day, truck } = await start(h, 6);                  // a Saturday: no rush
  const far = [45.6000, -73.5500], close = [45.5050, -73.6500];   // far as the crow flies but 5 minutes; close but 50 minutes
  const cf = await h.customer('Loin', ...far), cc = await h.customer('Proche', ...close);
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  const put = async (c, at, order) => { const id = uuid(); await h.q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min)
    values ($1, $2, $3, 'am', $4, 'booked', 90, $5, $6, $7, 500, 10)`, [id, c, day, truck, ...at, order]); return id; };
  const jf = await put(cf, far, 1), jc = await put(cc, close, 2);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await become(h, owner);
  await roads(h, true);
  await measure(h, [HOME, far, close], (a, b) => (same(a, close) || same(b, close) ? 50 : 5));
  // only one of the two fits: the one placed first keeps the morning
  const p = await val(h, `select public.plan_block($1::date, 'am') v`, [day]);
  // (fix-sql, lead's F1: the one left over stays on its vehicle, frozen; `kept` says which one the plan from scratch left out)
  assert.deepEqual([p.kept, p.over, p.frozen], [[jf], [], [truck]], 'the 50-minute one first, the 5-minute one (far as the crow flies) left over');
  void jc;
}));

// fix-sql (lead's F2 decision, 2026-11-20): in blocks mode a booking runs apply_plan's chain, which may re-plan the other
// blocks of the day (verify-on F2: 39 of 91 moments said another place); rank and route are said only in window mode,
// where they are exact (vraies-routes-fix « F2 », two vehicles). This test now checks they are not said in blocks mode.
test('rank and route: blocks mode says no place (null); the booking still goes where the plan put it', () => tx(async (h) => {
  const { day, truck } = await start(h, 4);
  const C = [45.5300, -73.6100], D = [45.4800, -73.5800], Q = [45.5400, -73.6700];
  const places = [HOME, A, B, C, D, Q];
  for (const [i, at, block] of [[0, A, 'am'], [1, B, 'am'], [2, C, 'pm'], [3, D, 'pm']]) await book(h, await h.customer('C' + i, ...at), day, block, 40);
  await roads(h, true);
  // distinct times (the rush a little longer), so the order is not a tie
  await measure(h, places, (a, b, s) => 8 + Math.round(Math.abs(a[0] - b[0]) * 300 + Math.abs(a[1] - b[1]) * 150) + (s === 1 ? 7 : 0) + (s === 2 ? 4 : 0));
  await server(h, `select public.replan_block_safe($1::date, 'am'), public.replan_block_safe($1::date, 'pm')`, [day]);
  const cq = await h.customer('Q', ...Q);
  const rows = await suggest(h, Q, 30, day);
  for (const block of ['am', 'pm']) {
    const m = rows.find((x) => x.block === block);
    assert.ok(m, block + ' offered');
    assert.equal(m.unmeasured, 0);
    assert.deepEqual([m.rank, m.route, 'rank' in m, 'route' in m], [null, null, true, true], 'the keys stay, nothing said');
    await h.c.query('savepoint b');
    const r = await book(h, cq, day, block, 30);
    const real = await walk(h, day, truck);
    assert.ok(real.includes(r.job_id), `${block}: booked on the vehicle of the day`);
    await h.c.query('rollback to savepoint b');
  }
}));
