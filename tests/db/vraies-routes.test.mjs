// « Vraies routes » (Part 27): the planner counts the driving with the times measured on the real roads (drive_times),
// never a straight line. Run: node --test tests/db/vraies-routes.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];                       // home_point() when the settings have none
const A = [45.5150, -73.6400], B = [45.5700, -73.7500], P = [45.4474, -73.4363];
const DAY = [[480, 1200]];
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
/** the following statements run as this person (remembered, so that a question to the server comes back to them) */
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
/** asks the server itself (these building blocks are not open to the app), then goes on as the person of the test */
async function server(h, _who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const estimate = async (h, a, b) => Number((await server(h, null, `select ceil(public.km_between($1, $2, $3, $4) * 1.3 / 35 * 60)::int v`, [...a, ...b]))[0].v);
const driveMin = async (h, a, b, tm = null) => Number((await server(h, null, `select public.drive_min($1, $2, $3, $4, 35, 1.3, 20, $5::int) v`, [...a, ...b, tm]))[0].v);
const store = async (h, rows, days = null) => (await server(h, null, `select public.drive_store($1::jsonb, $2::date[]) v`, [JSON.stringify(rows), days]))[0].v;
const wanted = async (h, point, from, days) => (await server(h, null, `select public.drive_wanted($1::jsonb, $2::date, $3) v`, [point ? JSON.stringify({ lat: point[0], lng: point[1] }) : null, from, days]))[0].v;
const has = (w, a, b, slot) => w.pairs.some((p) => p[0] === a[0] && p[1] === a[1] && p[2] === b[0] && p[3] === b[1] && p[4] === slot);
/** the switch flipped by the server itself (what roads_switch does inside), without planning anything */
async function roads(h, on) {
  await server(h, null, `select set_config('garage.roads', 'on', true)`);
  await server(h, null, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', to_jsonb($1::boolean)) where id = 1`, [on]);
  await server(h, null, `select set_config('garage.roads', '', true)`);
}
/** everything the coming days still want, measured: `minutes` for all, then the rows given on top */
async function measureAll(h, minutes, rows = []) {
  for (let i = 0; i < 20; i++) {
    const w = await wanted(h, null, null, 120);
    if (!w.total) break;
    await store(h, w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], minutes, minutes / 2, 'tomtom']));
  }
  if (rows.length) await store(h, rows);
}
/** the owner and one truck working 8 h – 20 h on a coming Thursday */
async function setup(h) {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const truck = await h.truck('Camion 1', null, { [dow]: DAY });
  await become(h, owner);
  return { owner, day, dow, truck };
}
const book = (h, customer, day, block = 'am') => h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: 60 }, p_items: [] });

test('roads off: drive_min answers the estimate of before, whatever was measured', () => tx(async (h) => {
  assert.equal((await server(h, null, `select public.roads_on() v`))[0].v, false);
  const est = await estimate(h, A, B);
  assert.ok(est > 10, 'a real distance');
  assert.equal(await driveMin(h, A, B), est);
  await store(h, [[...A, ...B, 0, 99, 40, 'tomtom']]);
  assert.equal(await driveMin(h, A, B), est, 'inert while the switch is off');
  assert.equal(await driveMin(h, A, B, 1020), est, 'the hour changes nothing either');
  assert.equal(Number((await server(h, null, `select public.drive_min($1, $2, null, null, 35, 1.3, 20) v`, A))[0].v), 20, 'no position: the fixed time, as before');
  const km = Number((await server(h, null, `select public.drive_km($1, $2, $3, $4, 1.3) v`, [...A, ...B]))[0].v);
  const line = Number((await server(h, null, `select public.km_between($1, $2, $3, $4) * 1.3 v`, [...A, ...B]))[0].v);
  assert.ok(Math.abs(km - line) < 1e-9, 'the km too');
}));

test('a place is about 100 m; the three times of a trip: usual hours, morning rush, evening rush, working days only', () => tx(async (h) => {
  const key = async (lat, lng) => (await server(h, null, `select public.drive_key($1, $2)::text v`, [lat, lng]))[0].v;
  assert.equal(await key(45.50031, -73.65774), await key(45.50039, -73.65781), 'two doors of the same building');
  assert.notEqual(await key(45.5005, -73.6577), await key(45.5025, -73.6577));
  assert.equal(await key(null, -73.6), null);
  const slot = async (dow, tm) => Number((await server(h, null, `select public.drive_slot($1, $2) v`, [dow, tm]))[0].v);
  assert.equal(await slot(2, 389), 0); assert.equal(await slot(2, 390), 1); assert.equal(await slot(2, 569), 1); assert.equal(await slot(2, 570), 0);
  assert.equal(await slot(2, 899), 0); assert.equal(await slot(2, 900), 2); assert.equal(await slot(2, 1109), 2); assert.equal(await slot(2, 1110), 0);
  assert.equal(await slot(5, 480), 1, 'Friday is a working day');
  assert.equal(await slot(6, 480), 0, 'Saturday'); assert.equal(await slot(7, 1020), 0, 'Sunday');
  assert.equal(await slot(null, 480), 0, 'no day said: the usual hours'); assert.equal(await slot(2, null), 0, 'no hour said');
}));

test('roads on: the time measured for the hour, else for the usual hours; not measured: the fixed time, never the straight line', () => tx(async (h) => {
  await roads(h, true);
  const est = await estimate(h, A, B);
  assert.equal(await driveMin(h, A, B), 20, 'not measured yet: booking.unknown_min');
  assert.notEqual(est, 20, 'and that is not the straight line');
  await store(h, [[...A, ...B, 0, 31, 22.4, 'tomtom'], [...A, ...B, 2, 44, 25.4, 'tomtom']]);
  assert.equal(await driveMin(h, A, B), 31);
  assert.equal(await driveMin(h, B, A), 20, 'the road back is another trip');
  assert.equal(await driveMin(h, A, B, 1020), 31, 'no day of the week said: the usual hours');
  await server(h, null, `select set_config('garage.drive_dow', '2', true)`);
  assert.equal(await driveMin(h, A, B, 1020), 44, 'Tuesday 17 h: the evening rush');
  assert.equal(await driveMin(h, A, B, 480), 31, 'Tuesday 8 h, the morning rush not measured: the usual hours');
  assert.equal(await driveMin(h, A, B, 720), 31, 'noon');
  await server(h, null, `select set_config('garage.drive_dow', '6', true)`);
  assert.equal(await driveMin(h, A, B, 1020), 31, 'Saturday 17 h: no rush');
  assert.equal(await driveMin(h, A, [A[0] + 0.0002, A[1] + 0.0002]), 0, 'the same place');
  assert.equal(Number((await server(h, null, `select public.drive_km($1, $2, $3, $4, 1.3) v`, [...A, ...B]))[0].v), 22.4, 'the km of the road');
  assert.equal((await server(h, null, `select public.drive_km($1, $2, $3, $4, 1.3) v`, [...B, ...A]))[0].v, null, 'no km guessed');
}));

test('what is missing: the trips of the day’s places both ways, the usual hours first, then the rush times of the long ones; the address asked about', () => tx(async (h) => {
  const { day } = await setup(h);
  const ca = await h.customer('Jean', ...A), cb = await h.customer('Paul', ...B);
  await book(h, ca, day); await book(h, cb, day, 'pm');
  const trips = [[HOME, A], [A, HOME], [HOME, B], [B, HOME], [A, B], [B, A]];
  let w = await wanted(h, null, day, 1);
  for (const [x, y] of trips) { assert.ok(has(w, x, y, 0), `${x} → ${y}`); assert.equal(has(w, x, y, 1), false, 'a rush time only after its usual-hours time'); }
  assert.deepEqual([w.total, w.total0], [6, 6]);
  assert.deepEqual(w.days, [day], 'that day was planned with trips missing');
  assert.equal(has(w, P, A, 0), false);
  // measured at 15 minutes (roads_rush_min): now the morning and evening rush of a working day
  await store(h, w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], 15, 7, 'tomtom']));
  w = await wanted(h, null, day, 1);
  for (const [x, y] of trips) for (const s of [1, 2]) assert.ok(has(w, x, y, s), `${x} → ${y} slot ${s}`);
  assert.deepEqual([w.total, w.total0, w.days], [12, 0, []]);
  // the usual hours only when the garage says so
  await server(h, null, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_rush}', 'false') where id = 1`);
  assert.equal((await wanted(h, null, day, 1)).total, 0);
  await server(h, null, `update public.settings set booking = booking - 'roads_rush' where id = 1`);
  // everything measured: nothing left, and that day no longer waits for a new plan
  await measureAll(h, 15);
  w = await wanted(h, null, day, 1);
  assert.equal(w.total, 0); assert.deepEqual(w.pairs, []); assert.deepEqual(w.days, []);
  // a new address: its usual-hours trips to and from each place of the day, nothing else; the day itself has nothing missing
  w = await wanted(h, P, day, 1);
  for (const x of [HOME, A, B]) { assert.ok(has(w, P, x, 0)); assert.ok(has(w, x, P, 0)); }
  assert.equal(w.total, 6);
  assert.deepEqual(w.days, [], 'the address is not booked yet: no day to plan again');
  // a day no truck works: no start, nothing to measure for the address
  const sat = await futureDay(h, 6);
  assert.equal((await wanted(h, P, sat, 1)).total, 0);
  // a cancelled appointment is not a place of the day
  const cc = await h.customer('Luc', 45.60, -73.55);
  const r = await book(h, cc, day, 'eve');
  assert.ok(has(await wanted(h, null, day, 1), [45.60, -73.55], HOME, 0));
  await server(h, null, `select set_config('garage.rpc', 'on', true)`);
  await server(h, null, `update public.jobs set status = 'cancelled' where id = $1`, [r.job_id]);
  assert.equal((await wanted(h, null, day, 1)).total, 0);
}));

test('keeping what was measured: a TomTom time is not replaced by an OSRM one; a bad row is left out', () => tx(async (h) => {
  const t = async (a, b, slot = 0) => (await server(h, null, `select minutes, km::float8 km, source from public.drive_times where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = $5`, [...a, ...b, slot]))[0];
  assert.equal((await store(h, [[...A, ...B, 0, 31, 22.4, 'tomtom'], [...B, ...A, 0, 36, 23, 'osrm']])).stored, 2);
  assert.deepEqual(await t(A, B), { minutes: 31, km: 22.4, source: 'tomtom' });
  await store(h, [[...A, ...B, 0, 25, 20, 'osrm'], [...B, ...A, 0, 33, 23.5, 'tomtom']]);
  assert.deepEqual(await t(A, B), { minutes: 31, km: 22.4, source: 'tomtom' }, 'OSRM knows no traffic: TomTom’s stays');
  assert.deepEqual(await t(B, A), { minutes: 33, km: 23.5, source: 'tomtom' }, 'TomTom replaces OSRM');
  await store(h, [[...A, ...B, 0, 29, 22, 'tomtom']]);
  assert.equal((await t(A, B)).minutes, 29, 'a newer TomTom time replaces the old one');
  const r = await store(h, [[...A, ...A, 0, 5, 1, 'tomtom'], [null, null, ...B, 0, 5, 1, 'tomtom'], [...A, ...P, 7, 5, 1, 'tomtom'], [...A, ...P, 0, -3, 1, 'tomtom']]);
  assert.equal(r.stored, 0, 'the same place, no position, a slot that does not exist, a time below zero');
  assert.equal(await t(A, P), undefined);
  // not open to the app
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  for (const sql of [`select public.drive_store('[]'::jsonb)`, `select public.drive_wanted(null, null, 1)`, `select * from public.drive_times`, `select public.drive_min(1, 2, 3, 4, 35, 1.3, 20)`]) {
    assert.match(String((await h.fails(() => h.q(sql)))?.message), /permission denied/, sql);
  }
}));

test('the switch: the owner only, refused while a trip is not measured, then the coming days planned with the real times; and back', () => tx(async (h) => {
  const mech = await h.person('Saleh', ['mechanic']);
  const { owner, day } = await setup(h);
  const ca = await h.customer('Jean', ...A);
  const r = await book(h, ca, day);
  const est = await estimate(h, HOME, A);
  let j = await row(h, r.job_id);
  assert.equal(j.eta_min, 480 + est, 'the estimate of before');
  assert.equal(j.travel_min, est + 5);
  await become(h, mech);
  assert.equal((await h.fails(() => h.rpc('roads_switch', { p_op: uuid(), p_on: true })))?.hint, 'not_allowed');
  await become(h, owner);
  const cold = await h.fails(() => h.rpc('roads_switch', { p_op: uuid(), p_on: true }));
  assert.equal(cold?.hint, 'roads_cold', 'a trip of the coming days is not measured yet');
  assert.equal((await server(h, owner, `select public.roads_on() v`))[0].v, false);
  // measured: 33 min at the usual hours, 47 in the morning rush (the truck leaves at 8 h on a Thursday)
  await measureAll(h, 15, [[...HOME, ...A, 0, 33, 9.1, 'tomtom'], [...HOME, ...A, 1, 47, 9.1, 'tomtom']]);
  const op = uuid();
  const on = await h.rpc('roads_switch', { p_op: op, p_on: true });
  assert.equal(on.ok, true); assert.equal(on.on, true); assert.ok(on.planned >= 1);
  assert.deepEqual(await h.rpc('roads_switch', { p_op: op, p_on: true }), on, 'the same operation sent twice: the same answer');
  assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).unchanged, true);
  j = await row(h, r.job_id);
  assert.equal(j.eta_min, 480 + 47, 'the real road, at the hour the truck leaves');
  assert.equal(j.travel_min, 47 + 5);
  assert.equal((await h.one(`select data from public.activity where action = 'roads_switch' order by id desc limit 1`)).data.on, true);
  // a plain settings save never flips it
  await h.q(`update public.settings set booking = booking - 'roads_on' where id = 1`);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{roads_on}', 'false') where id = 1`);
  assert.equal((await server(h, owner, `select public.roads_on() v`))[0].v, true);
  // a new measure of a trip of a day already planned: that day is planned again
  await store(h, [[...HOME, ...A, 1, 52, 9.1, 'tomtom']], [day]);
  assert.equal((await row(h, r.job_id)).eta_min, 480 + 52);
  // and back to the estimate
  const off = await h.rpc('roads_switch', { p_op: uuid(), p_on: false });
  assert.equal(off.on, false);
  j = await row(h, r.job_id);
  assert.equal(j.eta_min, 480 + est); assert.equal(j.travel_min, est + 5);
}));

test('roads on: the moments offered count the real driving of the day (« Garde-route »), with the km of the road', () => tx(async (h) => {
  const { owner, day } = await setup(h);
  const ca = await h.customer('Jean', ...A);
  await book(h, ca, day);
  // the address asked about: 10 minutes from the start, 50 from Jean (a bridge): far in fact, near as the crow flies
  const near = [45.5160, -73.6380];
  await measureAll(h, 12);
  const w = await wanted(h, near, day, 1);
  await store(h, w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], 50, 30, 'tomtom']));
  await store(h, [[...HOME, ...near, 0, 10, 4, 'tomtom'], [...near, ...HOME, 0, 10, 4, 'tomtom'], [...HOME, ...near, 1, 10, 4, 'tomtom'], [...near, ...HOME, 1, 10, 4, 'tomtom']]);
  assert.equal((await wanted(h, near, day, 1)).total0, 0, 'every usual-hours trip has a time (the rush times of the long ones are still asked)');
  await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  const s = await h.rpc('suggest_blocks', { p_lat: near[0], p_lng: near[1], p_duration: 60, p_from: day, p_days: 1, p_exclude: null, p_limit: 6 });
  const am = s.find((x) => x.block === 'am');
  assert.ok(am, 'the morning is offered');
  assert.equal(am.hop_min, 50, 'the drive between this customer and the one beside: the real one');
  assert.equal(am.far, 'hop', 'over the 35 minutes of « Garde-route »: far, though 300 m away as the crow flies');
  assert.equal(Number(am.add_km), 28, 'the km of the road: start → address 4, address → Jean 30, Jean → start 6, less the 12 of the day before it');
  void owner;
}));

// merge-main (2026-11-21): main's owner rule O-43 / S120 (refonte-argent and refonte-terrain « S120 » check main's files):
// no migration ever sends a DROP, a DELETE or a TRUNCATE to the live database. Part 27 goes to live too: it makes its trigger
// with « create or replace » and drops nothing; and it can be applied again (twice) with the same trigger, still guarding.
test('Part 27 sends no DROP, DELETE or TRUNCATE to the live database, and applied again (twice) it keeps its one trigger, still on (S120)', () => tx(async (h) => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261119000200_vraies_routes.sql', import.meta.url), 'utf8');
  // what the migration itself runs: the bodies of its functions ($$ … $$) are only stored, its comments are words
  const sent = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(sent, /\b(drop|truncate|delete)\b/i, 'no statement that removes something');
  assert.doesNotMatch(sent, /\bcreate\s+trigger\b/i, 'a trigger is made with « create or replace » (a plain create needs a drop first)');
  assert.equal(sent.match(/\bcreate\s+or\s+replace\s+trigger\b/gi)?.length, 1);
  await h.as(null); await h.c.query('reset role');
  const triggers = () => h.q(`select t.tgname as name, t.tgenabled as on, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname = 'settings' order by 1`);
  const forms = () => h.q(`select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('move_preview', 'roads_replan', 'move_job', 'drive_min') order by 1`);
  const built = await triggers(), sigs = await forms();
  assert.match(built.find((t) => t.name === 'settings_roads_guard')?.def ?? '', /BEFORE UPDATE OF booking ON public\.settings FOR EACH ROW EXECUTE FUNCTION settings_roads_guard\(\)/);
  await h.c.query(sql);
  assert.deepEqual(await triggers(), built, 'applied a second time');
  await h.c.query(sql);
  assert.deepEqual(await triggers(), built, 'and a third');
  assert.deepEqual(await forms(), sigs, 'the same forms of the functions, none more');
  // and the guard still holds: a plain save of the settings never flips the switch
  await h.c.query(`update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', 'true') where id = 1`);
  assert.equal((await h.one(`select coalesce((booking->>'roads_on')::boolean, false) v from public.settings where id = 1`)).v, false);
}));
