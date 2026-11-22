// « Vraies routes » (Part 27), the server's joins of round 4 (the lead's decisions of 2026-11-20 19:20; join-server.md):
// the two TomTom ceilings are the owner's numbers (settings_roads_guard); drive_wanted says why each pair is listed (7th
// element) and lists no rush-hour time for an address that is not a place of the day yet (fn M3); it says when the address
// is already a place of those days (point_place: its trips are the sweep's too, the function « drive » measures them under
// the common lease); day_drive counts today's legs from where and when the truck really is; web_book / web_suggest in a block
// with a frozen vehicle. Each test was written first and seen failing for the reason in its name.
// Run: node --test tests/db/vraies-routes-join.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];                       // home_point() when the settings have none
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const A = [45.5150, -73.6400], B = [45.5250, -73.6300], C = [45.5300, -73.6000], D = [45.5260, -73.6290], P = [45.4474, -73.4363];
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
async function roads(h, on) {
  await server(h, `select set_config('garage.roads', 'on', true)`);
  await server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', to_jsonb($1::boolean)) where id = 1`, [on]);
  await server(h, `select set_config('garage.roads', '', true)`);
}
const setBooking = (h, key, json) => server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), $1::text[], $2::jsonb) where id = 1`, [[key], JSON.stringify(json)]);
const asPoint = (p) => (p == null ? null : JSON.stringify({ lat: p[0], lng: p[1] }));
const W = (h, point, from, days) => val(h, `select public.drive_wanted($1::jsonb, $2::date, $3) v`, [asPoint(point), from, days]);
const store = (h, rows, days = null) => val(h, `select public.drive_store($1::jsonb, $2::date[]) v`, [JSON.stringify(rows), days]);
const age = (h, a, b, slot, sql) => server(h, `update public.drive_times set ${sql} where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = $5`, [...a, ...b, slot]);
const pk = (p) => `${p[0]},${p[1]}>${p[2]},${p[3]}#${p[4]}`;
const same = (x, y) => x[0] === y[0] && x[1] === y[1];
const touches = (p, x) => same([p[0], p[1]], x) || same([p[2], p[3]], x);
const book = (h, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
/** every trip between these places measured, both ways, the three times: fn(from, to, slot) minutes */
async function measure(h, places, fn, km = () => 5) {
  const rows = [];
  for (const a of places) for (const b of places) if (a !== b) for (const s of [0, 1, 2]) rows.push([...a, ...b, s, fn(a, b, s), km(a, b), 'tomtom']);
  return store(h, rows);
}
const clock = (h, min) => server(h, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
/** « today » made a chosen day for this transaction only (rolled back): a working day whatever day the tests run on */
const today = (h, day) => server(h, `create or replace function public.local_today() returns date language sql stable as $$ select '${day}'::date $$`);
async function owner(h) { const o = await h.person('Hassan', ['owner']); await become(h, o); return o; }
const booking = async (h) => (await server(h, `select booking from public.settings where id = 1`))[0].booking;

// ---------- 1. the two TomTom ceilings are the owner's numbers (settings R2; the lead's H2 decision) ----------
test('roads_month_tx and roads_web_tx: a save by the office keeps them as they were (1 000 000 typed: the old value stays); the owner’s save and the server’s pass', () => tx(async (h) => {
  const office = await h.person('Bureau', ['office'], { rights: { settings: true } });
  const o = await owner(h);
  await setBooking(h, 'roads_month_tx', 5000);
  await setBooking(h, 'roads_web_tx', 800);
  // the office saves the panel with both ceilings at 1 000 000 (and another number of the panel): the ceilings stay, the rest is saved
  await become(h, office);
  const n = await h.q(`update public.settings set booking = booking || '{"roads_month_tx": 1000000, "roads_web_tx": 1000000, "near_min": 12}'::jsonb where id = 1 returning id`);
  assert.equal(n.length, 1, 'the office may save the booking settings');
  let b = await booking(h);
  assert.deepEqual([b.roads_month_tx, b.roads_web_tx, b.near_min], [5000, 800, 12], 'before: the office could raise the month’s TomTom spend to 1 000 000');
  // a ceiling the office takes away, or one that did not exist and the office adds: as it was
  await h.q(`update public.settings set booking = booking - 'roads_month_tx' where id = 1`);
  assert.equal((await booking(h)).roads_month_tx, 5000);
  await become(h, o);
  await h.q(`update public.settings set booking = booking - 'roads_web_tx' where id = 1`);
  await become(h, office);
  await h.q(`update public.settings set booking = booking || '{"roads_web_tx": 99999}'::jsonb where id = 1`);
  assert.equal('roads_web_tx' in (await booking(h)), false, 'not there before: still not there');
  // the owner: saved
  await become(h, o);
  await h.q(`update public.settings set booking = booking || '{"roads_month_tx": 1000000, "roads_web_tx": 1500}'::jsonb where id = 1`);
  b = await booking(h);
  assert.deepEqual([b.roads_month_tx, b.roads_web_tx], [1000000, 1500]);
  // the server itself (no person: a script, a test copy): saved
  await setBooking(h, 'roads_month_tx', 2500);
  assert.equal((await booking(h)).roads_month_tx, 2500);
}));

// ---------- 2. drive_wanted says why each pair is listed (7th element) ----------
test('drive_wanted: each pair says why it is listed — new (no row), old (a real time past roads_keep_days), osrm (an OSRM time a day old: ask TomTom again), none (« no road » past its 7 days)', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 4);
  await h.truck('Camion', null, WEEK);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await book(h, ca, day, 'am', 60); await book(h, cb, day, 'pm', 60);
  const trips = [[HOME, A], [A, HOME], [HOME, B], [B, HOME], [A, B], [B, A]];
  await store(h, trips.map(([x, y]) => [...x, ...y, 0, 10, 5, 'tomtom']));
  await age(h, HOME, A, 0, `at = now() - interval '121 days'`);                                          // old
  await age(h, A, HOME, 0, `source = 'osrm', at = now() - interval '25 hours'`);                         // osrm
  await age(h, B, A, 0, `source = 'osrm', at = now() - interval '2 hours'`);                             // osrm of today: not listed
  await age(h, B, HOME, 0, `source = 'none', minutes = null, km = null, at = now() - interval '8 days'`); // none
  await age(h, A, B, 0, `source = 'osrm', at = now() - interval '130 days'`);                            // an OSRM time past keep: old
  const w = await W(h, P, day, 1);
  const why = Object.fromEntries(w.pairs.map((p) => [pk(p), p[6]]));
  assert.ok(w.pairs.every((p) => p.length === 7), 'before: 6 elements, the function could not tell an OSRM row from a new trip');
  assert.ok(w.pairs.filter((p) => touches(p, P)).every((p) => p[6] === 'new' && p[5] === true), 'the address: no row, new');
  assert.deepEqual([why[pk([...HOME, ...A, 0])], why[pk([...A, ...HOME, 0])], why[pk([...B, ...HOME, 0])], why[pk([...A, ...B, 0])]],
    ['old', 'osrm', 'none', 'old']);
  assert.equal(pk([...B, ...A, 0]) in why, false);
  assert.equal(w.total0, 6, 'total0 counts only « new » usual-hours trips (what roads_switch waits for)');
  // the order of before: the address first, then the other usual-hours trips, then the OSRM rows to ask TomTom again
  const order = w.pairs.map((p) => p[6]);
  assert.deepEqual(order.slice(0, 6), Array(6).fill('new'));
  assert.equal(order.indexOf('osrm'), Math.max(order.lastIndexOf('old'), order.lastIndexOf('none')) + 1);
}));

// ---------- 3. fn M3: no rush-hour time for an address that is not a place of the day ----------
test('drive_wanted (fn M3): an address typed and not booked gets no rush-hour pair; once it is a booked stop its rush pairs are listed (for its warm and for the sweep)', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);                    // a Tuesday: the rush times are asked
  await h.truck('Camion', null, WEEK);
  const ca = await h.customer('A', ...A), cp = await h.customer('P', ...P);
  await book(h, ca, day, 'am', 60);
  await measure(h, [HOME, A, P], () => 40);            // every usual-hours time there, 40 min (≥ roads_rush_min)
  await server(h, `delete from public.drive_times where slot > 0`);
  let w = await W(h, P, day, 1);
  const rush = (x) => x.pairs.filter((p) => p[4] > 0);
  assert.deepEqual(rush(w).map(pk).sort(), [[HOME, A], [A, HOME]].flatMap(([x, y]) => [1, 2].map((s) => pk([...x, ...y, s]))).sort(),
    'the day’s own trips only: before, the 8 rush pairs of the address were listed too (paid ~2.5 × for an address maybe never booked)');
  assert.equal(rush(w).some((p) => touches(p, P)), false);
  assert.equal(w.point_place, false, 'the address is not a place of that day');
  // booked: its rush pairs are the day's (its warm after the booking and the sweep list them)
  await book(h, cp, day, 'pm', 60);
  w = await W(h, P, day, 1);
  assert.equal(rush(w).filter((p) => touches(p, P)).length, 8, 'P ↔ the start and A, both ways, at 8 h and 17 h');
  assert.equal(w.point_place, true, 'now a booked stop of that day: its trips are the sweep’s too');
  assert.equal(rush(await W(h, null, day, 1)).filter((p) => touches(p, P)).length, 8, 'the sweep lists them');
  assert.equal((await W(h, null, day, 1)).point_place, false, 'no address asked: false');
}));

// ---------- 4. day_drive today: from where and when the truck really is ----------
test('day_drive today (fix-sql F3, second half): a leg already driven counts at the hour it was driven, the next one from where the truck is and when; it agrees with the arrival times route_retime writes', () => tx(async (h) => {
  await owner(h);
  const T = await futureDay(h, 2);                      // « today » is made a Tuesday (rush hours: 6 h 30–9 h 29, 15 h–18 h 29)
  await today(h, T);
  const t = await h.truck('Camion', null, WEEK);
  await measure(h, [HOME, A, B, C, D], (a, b, s) => [30, 60, 50][s]);
  await roads(h, true);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B), cc = await h.customer('C', ...C), cd = await h.customer('D', ...D);
  const job = async (cust, block, order, eta, travel, dur, status, extra = '') => val(h, `insert into public.jobs (customer_id, day, block, status, duration_min, truck_id, stop_order, eta_min, travel_min${extra ? ', arrived_at' : ''})
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9${extra ? `, ${extra}` : ''}) returning id`, [cust, T, block, status, dur, t, order, eta, travel]);
  // the morning as it was planned at 6 h 40: start → A at 8 h (the rush: 60), A → B at 9 h 35 (30), B → D (30); C in the afternoon
  const ja = await job(ca, 'am', 1, 540, 65, 30, 'done');
  const jb = await job(cb, 'am', 2, 605, 35, 30, 'on_site', `now() - interval '5 minutes'`);   // there for 5 minutes: 25 left
  const jd = await job(cd, 'am', 3, 670, 35, 15, 'booked');
  await job(cc, 'pm', 1, 750, 35, 45, 'booked');
  const dd = async () => (await val(h, `select public.day_drive($1::date, $2::uuid) v`, [T, t]));
  const legOf = async (id) => (await server(h, `select travel_min - 5 m from public.jobs where id = $1`, [id]))[0].m;

  // 10 h: A done, B under way. Start → A was driven at 8 h (60), never at « now » (10 h: 30)
  await clock(h, 600);
  let d = await dd();
  assert.equal(d.min, 60 + 30 + 30 + 30 + 30, 'before: 150, the first leg of the morning counted at 10 h');
  await server(h, `select public.route_retime($1::uuid, $2::date, 'am')`, [t, T]);
  assert.deepEqual([await legOf(jd), (await server(h, `select eta_min from public.jobs where id = $1`, [jd]))[0].eta_min], [30, 600 + 25 + 30], 'route_retime: D from B at 10 h 25 (B’s 25 minutes left)');
  // a moment of today's afternoon: the vehicle's day without it is the one above (« Garde-route » reads the same legs)
  const cq = await h.customer('Q', ...P);
  void cq;
  const pm = (await h.rpc('suggest_blocks', { p_lat: C[0] + 0.001, p_lng: C[1], p_duration: 15, p_from: T, p_days: 1, p_exclude: null, p_limit: 20 })).find((x) => x.block === 'pm');
  assert.ok(pm, 'the afternoon of today is offered');
  assert.equal(pm.day_min - pm.add_min, 180, 'the suggestion’s day without the new stop = the legs at the hours they are driven');

  // 9 h: the truck is early (A done, B there for 5 minutes): D is reached from B at 9 h 25 — still the morning rush (60), not
  // 10 h 40 as the plan of 6 h 40 said (30)
  await clock(h, 540);
  d = await dd();
  assert.equal(d.min, 60 + 30 + 60 + 30 + 30, 'before: 180, D counted from the old plan’s end of B (10 h 40)');
  await server(h, `select public.route_retime($1::uuid, $2::date, 'am')`, [t, T]);
  assert.equal(await legOf(jd), 60, 'route_retime writes the same leg for D (the arrival time and its drive agree with day_drive)');
  void ja; void jb;
  // switch off: the estimate of before, whatever the hour
  await roads(h, false);
  const off = await dd();
  await clock(h, 600);
  assert.equal((await dd()).min, off.min, 'off: day_drive does not depend on the hour');
}));

// ---------- 5. web_book / web_suggest in a block with a frozen vehicle ----------
test('online booking in a block whose vehicle is frozen by the real roads: the page is never offered that vehicle’s room; the other vehicle’s room is still offered and booked; alone, the block is full', () => tx(async (h) => {
  await owner(h);
  const day = await futureDay(h, 2);
  const t1 = await h.truck('Camion', null, WEEK), t2 = await h.truck('Voiture', null, WEEK);
  await server(h, `update public.trucks set tire_machine = false where id = $1`, [t2]);
  const Q = [HOME[0] + 0.01, HOME[1] + 0.01];
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  const ja = (await book(h, ca, day, 'am', 100, { vehicle_kind: 'truck' })).job_id, jb = (await book(h, cb, day, 'am', 100, { vehicle_kind: 'truck' })).job_id;
  await measure(h, [HOME, A, B, Q], (a, b) => (same(a, Q) || same(b, Q) ? 5 : 80));
  const sw = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.deepEqual(sw.kept, [{ day, block: 'am' }], 'the truck’s morning no longer fits on the real roads: kept');
  assert.deepEqual((await val(h, `select public.plan_block($1::date, 'am') v`, [day])).frozen, [t1]);
  const before = (await server(h, `select id, stop_order, eta_min from public.jobs where truck_id = $1 and day = $2 order by stop_order`, [t1, day])).map((r) => [r.id, r.stop_order, r.eta_min]);
  await server(h, `update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": true}'::jsonb) where id = 1`);
  const svc = await val(h, `insert into public.services (name_fr, price_cents, duration_min, active) values ('Vidange TEST', 7999, 30, true) returning id`);
  const offered = async () => (await val(h, `select public.web_suggest($1, $2, $3::uuid[], $4::date, 1, 6) v`, [...Q, [svc], day])).filter((x) => x.block === 'am');
  const web = (phone) => val(h, `select public.web_book($1::jsonb) v`, [JSON.stringify({ first_name: 'Web', last_name: 'Gel', phone, lang: 'fr', address: '10 rue du Test',
    lat: Q[0], lng: Q[1], services: [svc], day, block: 'am' })]);
  // the car's morning is offered online, and booked on the car
  assert.equal((await offered()).length, 1, 'the morning offered online (the car is empty)');
  await h.c.query('savepoint w');
  const r = await web('5145550111');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await server(h, `select truck_id from public.jobs where id = $1`, [r.job_id]))[0].truck_id, t2, 'on the car, never on the frozen truck');
  assert.deepEqual((await server(h, `select id, stop_order, eta_min from public.jobs where truck_id = $1 and day = $2 order by stop_order`, [t1, day])).map((x) => [x.id, x.stop_order, x.eta_min]), before, 'the frozen truck untouched');
  await h.c.query('rollback to savepoint w');
  // the car does not work that morning: the frozen truck alone → not offered online, and a booking sent anyway is refused
  await server(h, `update public.trucks set active = false where id = $1`, [t2]);
  assert.deepEqual(await offered(), [], 'the frozen truck’s morning is never offered online');
  const e = await h.fails(() => web('5145550112'));
  assert.equal(e?.hint, 'block_full', JSON.stringify(e?.message));
  assert.deepEqual((await server(h, `select id, stop_order, eta_min from public.jobs where truck_id = $1 and day = $2 order by stop_order`, [t1, day])).map((x) => [x.id, x.stop_order, x.eta_min]), before);
  assert.ok([ja, jb].length === 2);
}));
