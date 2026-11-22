// « Vraies routes » (Part 27): what to measure, and keeping what was measured (CONTRACT §2.1, §2.5).
// drive_wanted asks only for the trips the planner can drive (the places of a truck that works that day, never one start to
// another), the rush times only for a long trip already measured at the usual hours, the address asked about first;
// drive_store keeps a row at a time (a bad one is left out, never the whole batch), keeps TomTom's time for the one
// « roads_keep_days », stores « no road » ('none'), and plans again every coming day booked at one end of a trip it stored
// (request-flows F3); the month's TomTom ceiling (drive_spend_add) is never passed by two calls at once; roads_switch waits
// only for the usual-hours trips with no time at all (total0); roads_state says where the measuring is.
// Run: node --test tests/db/vraies-routes-mesure.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];                          // home_point() when the settings have none
const A = [45.5150, -73.6400], B = [45.5700, -73.7500], C = [45.5300, -73.6000], P = [45.4474, -73.4363];
const S2 = [45.6000, -73.5500], S3 = [45.4200, -73.4800];         // two trucks' own starts
const DAY = [[480, 1200]];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, DAY]));
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
const asPoint = (p) => (p == null ? null : Array.isArray(p) ? JSON.stringify({ lat: p[0], lng: p[1] }) : JSON.stringify(p));
const W = (h, point, from, days) => val(h, `select public.drive_wanted($1::jsonb, $2::date, $3) v`, [asPoint(point), from, days]);
const store = (h, rows, days = null) => val(h, `select public.drive_store($1::jsonb, $2::date[]) v`, [JSON.stringify(rows), days]);
const pk = (p) => `${p[0]},${p[1]}>${p[2]},${p[3]}#${p[4]}`;
const has = (w, a, b, slot) => w.pairs.some((p) => pk(p) === pk([...a, ...b, slot]));
const same = (x, y) => x[0] === y[0] && x[1] === y[1];
const touches = (p, x) => same([p[0], p[1]], x) || same([p[2], p[3]], x);
const t = async (h, a, b, slot = 0) => (await server(h, `select minutes, km::float8 km, source from public.drive_times
  where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = $5`, [...a, ...b, slot]))[0];
/** a row of drive_times made older (or made a « none » / OSRM row) by the server, as time going by would */
const age = (h, a, b, slot, sql) => server(h, `update public.drive_times set ${sql} where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = $5`, [...a, ...b, slot]);
const setBooking = (h, key, json) => server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), $1::text[], $2::jsonb) where id = 1`, [[key], JSON.stringify(json)]);
const dropBooking = (h, key) => server(h, `update public.settings set booking = booking - $1 where id = 1`, [key]);
const setStart = (h, truck, p) => server(h, `update public.trucks set start = $2::jsonb where id = $1`, [truck, JSON.stringify({ lat: p[0], lng: p[1], label: 'Départ', address: '1 rue Test' })]);
const jsDow = (h, day) => h.val(`select extract(dow from $1::date)::int`, [day]);
const book = (h, customer, day, block = 'am', dur = 60, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
/** the switch flipped by the server itself (what roads_switch does inside), without planning anything */
async function roads(h, on) {
  await server(h, `select set_config('garage.roads', 'on', true)`);
  await server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', to_jsonb($1::boolean)) where id = 1`, [on]);
  await server(h, `select set_config('garage.roads', '', true)`);
}
/** everything the coming days still want, measured: fn(pair) minutes */
async function measureAll(h, fn = () => 10) {
  for (let i = 0; i < 20; i++) {
    const w = await W(h, null, null, 120);
    if (!w.total) return;
    await store(h, w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], typeof fn === 'function' ? fn(p) : fn, 5, 'tomtom']));
  }
  throw new Error('still something to measure');
}
/** the owner and a truck working every day; a coming Thursday */
async function start(h) {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, 4);
  const t1 = await h.truck('Camion 1', null, WEEK);
  return { owner, day, t1 };
}

// ---------- drive_wanted ----------

test('drive_wanted: the start of each truck that works that day, the day’s appointments and the point; never start ↔ start', () => tx(async (h) => {
  const { day } = await start(h);
  const dow = await jsDow(h, day);
  const t2 = await h.truck('Voiture', null, { [dow]: DAY });              // works that day, from its own start
  const t3 = await h.truck('Camion 3', null, { [(dow + 2) % 7]: DAY });  // does not work that day
  await setStart(h, t2, S2); await setStart(h, t3, S3);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am'); await book(h, cb, day, 'pm');
  let w = await W(h, null, day, 1);
  const want = [[HOME, A], [A, HOME], [HOME, B], [B, HOME], [S2, A], [A, S2], [S2, B], [B, S2], [A, B], [B, A]];
  assert.deepEqual(w.pairs.map(pk).sort(), want.map(([x, y]) => pk([...x, ...y, 0])).sort(), 'each start ↔ each stop, stop ↔ stop, the usual hours only (nothing measured yet)');
  assert.equal(has(w, HOME, S2, 0) || has(w, S2, HOME, 0), false, 'never one start to another');
  assert.equal(w.pairs.some((p) => touches(p, S3)), false, 'a truck that does not work that day brings no place');
  // (join-server, the lead's decision of 2026-11-20: a 7th element says why the pair is listed; nothing measured: 'new')
  assert.ok(w.pairs.every((p) => p.length === 7 && p[5] === false && p[6] === 'new'), 'no pair touches a point asked about');
  assert.deepEqual([w.total, w.total0, w.days], [10, 10, [day]]);
  // the address asked about: its trips to and from every start and stop of the day, first
  w = await W(h, P, day, 1);
  assert.deepEqual([w.total, w.total0], [18, 18]);
  assert.ok(w.pairs.slice(0, 8).every((p) => p[5] === true && touches(p, P)), 'the point’s 8 trips first, marked extra');
  assert.ok(w.pairs.slice(8).every((p) => p[5] === false && !touches(p, P)));
  for (const x of [HOME, S2, A, B]) { assert.ok(has(w, P, x, 0)); assert.ok(has(w, x, P, 0)); }
  assert.deepEqual(w.days, [day], 'the point is not booked: it does not make a day to plan again');
  // a cancelled appointment is not a place of the day
  const cc = await h.customer('C', ...C);
  const r = await book(h, cc, day, 'eve');
  assert.ok(has(await W(h, null, day, 1), C, HOME, 0));
  await server(h, `select set_config('garage.rpc', 'on', true)`);
  await server(h, `update public.jobs set status = 'cancelled' where id = $1`, [r.job_id]);
  assert.equal(has(await W(h, null, day, 1), C, HOME, 0), false);
}));

test('drive_wanted: the rush times only on a working day, with roads_rush, for a trip of roads_rush_min minutes or more at the usual hours', () => tx(async (h) => {
  const { day } = await start(h);
  const sat = await futureDay(h, 6);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am'); await book(h, cb, day, 'pm');
  await book(h, ca, sat, 'am'); await book(h, cb, sat, 'pm');
  const slot0 = [[HOME, A, 20], [A, HOME, 14], [HOME, B, 15], [B, HOME, 30], [A, B, 9], [B, A, 40]];
  await store(h, slot0.map(([x, y, m]) => [...x, ...y, 0, m, 5, 'tomtom']));
  let w = await W(h, null, day, 1);
  const long = [[HOME, A], [HOME, B], [B, HOME], [B, A]];
  assert.deepEqual(w.pairs.map(pk).sort(), long.flatMap(([x, y]) => [1, 2].map((s) => pk([...x, ...y, s]))).sort(),
    'Thursday: the morning and evening rush of the trips of 15 minutes or more, after their usual-hours time');
  assert.deepEqual([w.total, w.total0, w.days], [8, 0, []], 'the usual hours are all there: no day waits for a plan, nothing blocks the switch');
  assert.equal((await W(h, null, sat, 1)).total, 0, 'Saturday: no rush');
  await setBooking(h, 'roads_rush_min', 25);
  w = await W(h, null, day, 1);
  assert.deepEqual(w.pairs.map(pk).sort(), [[B, HOME], [B, A]].flatMap(([x, y]) => [1, 2].map((s) => pk([...x, ...y, s]))).sort(), 'roads_rush_min 25');
  await dropBooking(h, 'roads_rush_min');
  await setBooking(h, 'roads_rush', false);
  assert.equal((await W(h, null, day, 1)).total, 0, 'roads_rush false: the usual hours only');
  await dropBooking(h, 'roads_rush');
  // « no road » never replaces a real time, even an old one: it only gets the new date (fix-sql, verify-measure F3; the
  // lead's « 'none' never replaces a real time », 2026-11-19)
  await age(h, B, A, 0, `at = now() - interval '121 days'`);
  assert.equal((await store(h, [[...B, ...A, 0, null, null, 'none']])).stored, 1, 'the old row gets the new date');
  assert.deepEqual(await t(h, B, A), { minutes: 40, km: 5, source: 'tomtom' }, 'its time stays');
  // a trip with no road (« none »): no rush time either
  await server(h, `delete from public.drive_times where a = public.drive_key($1, $2) and b = public.drive_key($3, $4)`, [...B, ...A]);
  assert.equal((await store(h, [[...B, ...A, 0, null, null, 'none']])).stored, 1);
  w = await W(h, null, day, 1);
  assert.equal(has(w, B, A, 1) || has(w, B, A, 2) || has(w, B, A, 0), false, '« none » a day old: left alone, and no rush asked');
  assert.equal(w.total, 6);
}));

test('drive_wanted: missing = no row, older than roads_keep_days, an OSRM row a day old, a « none » row a week old; in that order after the point', () => tx(async (h) => {
  const { day } = await start(h);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am'); await book(h, cb, day, 'pm');
  const slot0 = [[HOME, A, 10], [A, HOME, 10], [HOME, B, 20], [B, HOME, 10], [A, B, 10], [B, A, 10]];
  await store(h, slot0.map(([x, y, m]) => [...x, ...y, 0, m, 5, 'tomtom']));
  assert.deepEqual((await W(h, null, day, 1)).pairs.map(pk).sort(), [pk([...HOME, ...B, 1]), pk([...HOME, ...B, 2])]);
  await age(h, HOME, A, 0, `at = now() - interval '121 days'`);                                          // too old
  await age(h, A, HOME, 0, `source = 'osrm', at = now() - interval '25 hours'`);                         // OSRM, ask TomTom again
  await age(h, B, A, 0, `source = 'osrm', at = now() - interval '2 hours'`);                             // OSRM of today: fine
  await age(h, A, B, 0, `source = 'none', minutes = null, km = null, at = now() - interval '6 days'`);    // no road, 6 days: left alone
  await age(h, B, HOME, 0, `source = 'none', minutes = null, km = null, at = now() - interval '8 days'`); // no road, 8 days: again
  let w = await W(h, P, day, 1);
  const got = w.pairs.map(pk);
  assert.equal(w.total, 11);
  assert.ok(w.pairs.slice(0, 6).every((p) => p[4] === 0 && p[5] === true), 'the point’s usual-hours trips first');
  assert.deepEqual(got.slice(6, 8).sort(), [pk([...HOME, ...A, 0]), pk([...B, ...HOME, 0])].sort(), 'then the other usual-hours trips missing');
  assert.deepEqual(got.slice(8, 9), [pk([...A, ...HOME, 0])], 'then the OSRM rows to ask TomTom again');
  assert.deepEqual(got.slice(9).sort(), [pk([...HOME, ...B, 1]), pk([...HOME, ...B, 2])], 'then the rush times');
  assert.equal(w.total0, 6, 'total0: the usual-hours trips with no row at all (the point’s)');
  assert.deepEqual(w.days, [day], 'a usual-hours trip between places already there is missing');
  // the one roads_keep_days: 30 → a TomTom time of 60 days is asked again
  await age(h, HOME, B, 0, `at = now() - interval '60 days'`);
  assert.equal(has(await W(h, null, day, 1), HOME, B, 0), false, '60 days < 120');
  await setBooking(h, 'roads_keep_days', 30);
  assert.ok(has(await W(h, null, day, 1), HOME, B, 0), '60 days > 30');
}));

test('drive_wanted: from today on, 1 … horizon_days days, and a point that is not a position is left out', () => tx(async (h) => {
  await start(h);
  const today = await h.val(`select public.local_today()::text`);
  const at = (n) => h.val(`select (public.local_today() + $1::int)::text`, [n]);
  const put = async (p, day) => {
    const c = await h.customer('X', ...p);
    await server(h, `insert into public.jobs (customer_id, day, block, duration_min, status) values ($1, $2::date, 'am', 30, 'booked')`, [c, day]);
  };
  const D = [45.4800, -73.5800], E = [45.5500, -73.7000], F = [45.5900, -73.6200];
  await put(A, await at(-1)); await put(B, await at(1)); await put(C, await at(4)); await put(P, await at(6)); await put(D, await at(13)); await put(E, await at(14));
  let w = await W(h, null, await at(-1), 2);
  assert.equal(w.pairs.some((p) => touches(p, A)), false, 'yesterday is not asked (from: today)');
  assert.ok(has(w, HOME, B, 0), 'today and tomorrow');
  assert.ok(has(await W(h, null, await at(1), 0), B, HOME, 0), '0 days: one');
  w = await W(h, null, null, null);
  assert.ok(has(w, HOME, D, 0), 'nothing said: 14 days (the 13th)'); assert.equal(has(w, HOME, E, 0), false, 'not the 15th');
  await setBooking(h, 'horizon_days', 5);
  w = await W(h, null, today, 1000);
  assert.ok(has(w, HOME, C, 0)); assert.equal(has(w, HOME, P, 0), false, 'at most horizon_days days');
  for (const bad of [{ lat: null, lng: -73.6 }, { lat: 'x', lng: 1 }, { lat: 1e300, lng: 0 }, { lat: 45.5 }, 'oui', {}]) {
    w = await W(h, bad, today, 5);
    assert.ok(w.pairs.every((p) => p[5] === false), JSON.stringify(bad) + ': no trip for it, and no error');
  }
  void F;
}));

test('drive_wanted: at most 3000 pairs, the point’s first; total says all', () => tx(async (h) => {
  const { day } = await start(h);
  await server(h, `insert into public.customers (id, first_name, last_name, phone, lat, lng, address)
    select gen_random_uuid(), 'Cap' || g, 'T', '5145550000', 45.40 + g * 0.004, -73.80 + g * 0.006, 'x' from generate_series(1, 60) g`);
  await server(h, `insert into public.jobs (customer_id, day, block, duration_min, status)
    select c.id, $1::date, 'am', 20, 'booked' from public.customers c where c.first_name like 'Cap%' and c.last_name = 'T'`, [day]);
  const w = await W(h, P, day, 1);
  // 60 stops and the start: 60 × 59 + 2 × 60 = 3660 trips, and the point’s 2 × 61
  assert.deepEqual([w.total, w.total0, w.pairs.length], [3782, 3782, 3000]);
  assert.ok(w.pairs.slice(0, 122).every((p) => p[5] === true) && w.pairs.slice(122).every((p) => p[5] === false));
}));

// ---------- drive_store ----------

test('drive_store: each row checked on its own (a bad one is left out, never the batch); « none » has no minutes; no source is no row', () => tx(async (h) => {
  assert.deepEqual(await val(h, `select public.drive_store('{"a": 1}'::jsonb) v`), { ok: true, stored: 0, planned: 0, kept: [], late: [] }, 'not a list');
  const r = await store(h, [
    [...A, ...B, 0, 31, 22.4, 'tomtom'],                 // good
    [...B, ...A, 0, 33.2, null, 'osrm'],                  // good: no km, minutes rounded up
    [...A, ...C, 0, 12, 4, 'none'],                       // good: no road (its minutes are not kept)
    'x', { a: 1 },                                        // not a row
    ['x', A[1], ...B, 0, 5, 1, 'tomtom'],                 // a position that is not a number
    [1e300, A[1], ...B, 0, 5, 1, 'tomtom'],               // not a position on Earth
    [...A, ...P, 7, 5, 1, 'tomtom'],                      // no such time of the day
    [...A, ...P, 0, -3, 1, 'tomtom'],                     // below zero
    [...A, ...P, 0, 2000, 1, 'tomtom'],                   // more than a day: kept as « no road » (final-money F4: never paid again at every call)
    [...A, ...P, 0, 5, -5, 'tomtom'],                     // km below zero
    [...A, ...P, 0, 5, 1, 'line'],                        // a straight line is never a road
    [...A, ...P, 0, 5, 1],                                // no source: not taken as TomTom
    [...A, ...P, 0, null, 1, 'tomtom'],                   // TomTom with no time
    [...A, ...A, 0, 5, 1, 'tomtom']                       // the same place
  ]);
  assert.equal(r.stored, 4);
  assert.deepEqual(await t(h, A, B), { minutes: 31, km: 22.4, source: 'tomtom' });
  assert.deepEqual(await t(h, B, A), { minutes: 34, km: null, source: 'osrm' });
  assert.deepEqual(await t(h, A, C), { minutes: null, km: null, source: 'none' });
  assert.deepEqual(await t(h, A, P), { minutes: null, km: null, source: 'none' }, 'the day-long trip: « no road », asked again after 7 days');
  // the table itself refuses what drive_store leaves out
  for (const sql of [`insert into public.drive_times (a, b, slot, minutes, km, source) values (1, 2, 0, 5, 1, 'line')`,
    `insert into public.drive_times (a, b, slot, minutes, km, source) values (1, 2, 0, null, 1, 'tomtom')`,
    `insert into public.drive_times (a, b, slot, minutes, km, source) values (1, 2, 0, 5, null, 'none')`,
    `insert into public.drive_times (a, b, slot, minutes, km, source) values (1, 2, 0, 5, -1, 'osrm')`]) {
    assert.match(String((await h.fails(() => server(h, sql)))?.message), /violates check constraint/, sql);
  }
}));

test('drive_store keeps TomTom’s time for the one roads_keep_days (review-sql M5); a real time replaces « none », never the reverse', () => tx(async (h) => {
  await store(h, [[...A, ...B, 0, 31, 22, 'tomtom'], [...B, ...A, 0, 36, 23, 'osrm']]);
  assert.equal((await store(h, [[...A, ...B, 0, 25, 20, 'osrm']])).stored, 0, 'a fresh TomTom time stays');
  assert.equal((await store(h, [[...A, ...B, 0, null, null, 'none'], [...B, ...A, 0, null, null, 'none']])).stored, 0, '« no road » never replaces a fresh time');
  await setBooking(h, 'roads_keep_days', 30);
  await age(h, A, B, 0, `at = now() - interval '60 days'`);
  assert.equal((await store(h, [[...A, ...B, 0, 25, 20, 'osrm']])).stored, 1, 'older than roads_keep_days (30): the OSRM time is taken (before: refused for 120 days, asked forever)');
  assert.deepEqual(await t(h, A, B), { minutes: 25, km: 20, source: 'osrm' });
  await store(h, [[...C, ...P, 0, null, null, 'none']]);
  assert.equal((await store(h, [[...C, ...P, 0, 40, 30, 'osrm']])).stored, 1, 'a real time replaces « none »');
  assert.deepEqual(await t(h, C, P), { minutes: 40, km: 30, source: 'osrm' });
  assert.equal((await store(h, [[...C, ...P, 0, 38, 30, 'tomtom']])).stored, 1, 'TomTom replaces OSRM');
}));

test('F3 — booked while its address was not measured: once its trips are stored, its arrival time is the real one', () => tx(async (h) => {
  const { owner, day } = await start(h);
  const wed = await futureDay(h, 3);
  const ca = await h.customer('A', ...A);
  await book(h, ca, day, 'am');
  await measureAll(h, () => 10);
  assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).on, true);
  // a new address, booked before « drive » measured it: its trips count the fixed 20 minutes
  const cc = await h.customer('C', ...C);
  const r = await book(h, cc, wed, 'am');
  assert.equal((await row(h, r.job_id)).eta_min, 480 + 20, 'booked on the « position inconnue » time');
  // « drive » stores its trips afterwards, without naming a day: the day booked at one end of them is planned again
  const s = await store(h, [[...HOME, ...C, 0, 33, 9, 'tomtom'], [...HOME, ...C, 1, 47, 9, 'tomtom'], [...C, ...HOME, 0, 35, 9, 'tomtom']]);
  assert.deepEqual([s.ok, s.stored, s.planned, s.kept, s.late], [true, 3, 1, [], []], 'one block planned again: Wednesday morning (Thursday’s A is not at an end of these trips)');
  const j = await row(h, r.job_id);
  assert.deepEqual([j.eta_min, j.travel_min], [480 + 47, 47 + 5], 'Wednesday 8 h: the morning rush of the real road');
  // the trips of an address not booked yet (« drive » measures them while the screen waits) touch Thursday's A but are not
  // driven that day: nothing is planned again for them
  const n = await store(h, [[...P, ...A, 0, 25, 9, 'tomtom'], [...A, ...P, 0, 26, 9, 'tomtom']]);
  assert.deepEqual([n.stored, n.planned], [2, 0]);
  void owner;
}));

test('drive_store plans the days given even with no row, from today on, each day once; switch off: nothing planned', () => tx(async (h) => {
  const { day } = await start(h);
  const ca = await h.customer('A', ...A);
  await book(h, ca, day, 'am'); await book(h, ca, day, 'pm');
  const yesterday = await h.val(`select (public.local_today() - 1)::text`);
  assert.equal((await store(h, [], [day])).planned, 0, 'switch off: the estimate plans as before');
  await roads(h, true);
  const s = await store(h, [], [day, day, yesterday]);
  assert.deepEqual([s.ok, s.stored, s.planned], [true, 0, 2], 'two blocks of that day, once; yesterday left alone');
}));

// ---------- the month's ceiling ----------

test('drive_spend_add: adds while the month stays under roads_month_tx, else nothing; 0 only reads', () => tx(async (h) => {
  const r0 = await val(h, `select public.drive_spend_add(0) v`);
  const month = await h.val(`select date_trunc('month', public.local_today())::date::text`);
  assert.equal(r0.month, month);
  assert.equal(r0.cap, 10000, 'the default ceiling');
  const n0 = Number(await val(h, `select coalesce((select requests from public.drive_spend where month = $1::date), 0) v`, [month]));
  await setBooking(h, 'roads_month_tx', r0.tx + 100);
  const add = (n) => val(h, `select public.drive_spend_add($1) v`, [n]);
  assert.deepEqual(await add(60), { ok: true, month, tx: r0.tx + 60, cap: r0.tx + 100 });
  assert.deepEqual(await add(50), { ok: false, month, tx: r0.tx + 60, cap: r0.tx + 100 }, 'it would pass the ceiling: nothing added');
  assert.deepEqual(await add(40), { ok: true, month, tx: r0.tx + 100, cap: r0.tx + 100 }, 'up to the ceiling itself');
  assert.equal((await add(1)).ok, false);
  assert.deepEqual(await add(0), { ok: false, month, tx: r0.tx + 100, cap: r0.tx + 100 }, '0 reads: no room left');
  assert.equal(Number(await val(h, `select requests from public.drive_spend where month = $1::date`, [month])), n0 + 2, 'the requests charged');
  // the server's alone
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  for (const sql of [`select public.drive_spend_add(0)`, `select * from public.drive_spend`, `select public.roads_state()`]) {
    assert.match(String((await h.fails(() => h.q(sql)))?.message), /permission denied/, sql);
  }
}));

test('drive_spend_add: two calls at the same time never both pass the ceiling (two connections)', async () => {
  // The only test of this folder that writes for real: the second connection must see the first one's spend once it is
  // committed. It is put back at the end (the database tests run one command at a time on the stack's lock).
  const c1 = await pool.connect(), c2 = await pool.connect();
  let committed = false, month = null, before = null, k1 = 0;
  try {
    month = (await c1.query(`select date_trunc('month', public.local_today())::date::text m`)).rows[0].m;
    before = (await c1.query(`select tx, requests from public.drive_spend where month = $1::date`, [month])).rows[0] || null;
    const r0 = (await c1.query(`select public.drive_spend_add(0) v`)).rows[0].v;
    k1 = r0.cap - r0.tx;                                            // the first fills the month exactly
    assert.ok(k1 > 0, 'room left this month on the test database');
    await c1.query('begin');
    await c2.query('begin');
    assert.equal((await c1.query(`select public.drive_spend_add($1) v`, [k1])).rows[0].v.ok, true);
    const second = c2.query(`select public.drive_spend_add(1) v`);   // waits for the first (its row is locked)
    second.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const waiting = (await pool.query(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and query like 'select public.drive_spend_add(1)%'`)).rows[0].n;
    assert.equal(waiting, 1, 'the second call waits for the first');
    await c1.query('commit'); committed = true;
    const r2 = (await second).rows[0].v;
    assert.deepEqual([r2.ok, r2.tx], [false, r0.cap], 'it saw the first call’s spend and added nothing');
    await c2.query('commit');
  } finally {
    await c1.query('rollback').catch(() => {});
    await c2.query('rollback').catch(() => {});
    let now = before;
    if (committed) {
      if (before) await c1.query(`update public.drive_spend set tx = tx - $2, requests = requests - 1 where month = $1::date`, [month, k1]);
      else await c1.query(`delete from public.drive_spend where month = $1::date`, [month]);
      now = (await c1.query(`select tx, requests from public.drive_spend where month = $1::date`, [month])).rows[0] || null;
    }
    c1.release(); c2.release();
    assert.deepEqual(now, before, 'put back as it was');
  }
});

// ---------- the switch and the state ----------

test('roads_switch: ON waits only for usual-hours trips with no time at all (total0), never for a rush time or an old row', () => tx(async (h) => {
  const { day } = await start(h);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am'); await book(h, cb, day, 'pm');
  await store(h, [[...HOME, ...A, 0, 30, 9, 'tomtom'], [...A, ...HOME, 0, 30, 9, 'tomtom'], [...HOME, ...B, 0, 30, 9, 'tomtom'], [...B, ...HOME, 0, 30, 9, 'tomtom'], [...A, ...B, 0, 30, 9, 'tomtom']]);
  const cold = await h.fails(() => h.rpc('roads_switch', { p_op: uuid(), p_on: true }));
  assert.equal(cold?.hint, 'roads_cold');
  assert.match(cold.message, /Il reste 1 trajets/, 'one usual-hours trip has no time: B → A');
  await store(h, [[...B, ...A, 0, null, null, 'none']]);
  await age(h, HOME, A, 0, `at = now() - interval '200 days'`);
  await age(h, A, HOME, 0, `source = 'osrm', at = now() - interval '3 days'`);
  const w = await W(h, null, null, 120);
  assert.ok(w.total > 0 && w.total0 === 0, 'rush times, an old row and an OSRM row are still asked, but every trip has a time or « no road »');
  const on = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.deepEqual([on.ok, on.on], [true, true]);
}));

test('roads_state: the switch, what is left, the month’s spend and the rows kept', () => tx(async (h) => {
  const { day } = await start(h);
  const ca = await h.customer('A', ...A);
  await book(h, ca, day, 'am');
  await store(h, [[...HOME, ...A, 0, 30, 9, 'tomtom'], [...A, ...HOME, 0, 31, 9, 'osrm']]);
  const s = await val(h, `select public.roads_state() v`);
  const w = await W(h, null, null, 120);
  const rows = Object.fromEntries((await server(h, `select source, count(*)::int n from public.drive_times group by source`)).map((r) => [r.source, r.n]));
  const month = await val(h, `select public.drive_spend_add(0) v`);
  assert.deepEqual(s, { on: false, left: w.total, left0: w.total0, month: { month: month.month, tx: month.tx, cap: month.cap },
    rows: { tomtom: rows.tomtom ?? 0, osrm: rows.osrm ?? 0, none: rows.none ?? 0 } });
  assert.ok(s.left >= 2, 'HOME → A at rush hours');
}));
