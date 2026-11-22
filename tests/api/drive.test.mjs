// « Vraies routes » (Part 27): the server function « drive » end to end on the local copy (real accounts, real database,
// fake TomTom and OSRM of tests/stack/mocks.mjs). CONTRACT §3: who may ask; TomTom answers (the address first, in two
// requests); the grouping the mock's log proves (requests, cells, the bill); TomTom down → OSRM for the usual hours;
// both down → nothing stored, not ready, the booking still goes; the month's ceiling; a trip with no road; the brakes;
// GitHub's ticket for the nightly sweep; « book » measuring an address before it offers moments; and the whole server
// side in one test: switch off (a warm harms nothing), sweep until ready, the switch on, a new address warmed → its
// suggestion counts the mock's times, booked → its arrival is the mock's time, never the straight line.
// The mock's road (copied from tests/stack/mocks.mjs on purpose: the test checks the numbers the function stored):
//   km = straight line × 1.25; TomTom: 240 s + 110 s a km, +120 s going north, × 1.5 at 8 h, × 1.8 at 17 h; OSRM: 32 km/h.
// Everything made here is removed at the end (the switch back off through its guard).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from '../stack/node_modules/pg/lib/index.js';

const K = JSON.parse(readFileSync(new URL('../stack/keys.json', import.meta.url)));
const API = 'http://127.0.0.1:54331', MOCK = 'http://127.0.0.1:8021', BASE = 'http://127.0.0.1:4173/';
const db = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 3 });
const made = { users: [], customers: [], trucks: [], services: [] };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

async function adminUser(email, password) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: K.service, authorization: `Bearer ${K.service}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }) });
  const d = await r.json();
  assert.ok(d.id, 'user created: ' + JSON.stringify(d));
  made.users.push(d.id);
  return d.id;
}
async function signIn(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return r.json();
}
async function fn(name, body, jwt, headers = {}) {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt || K.anon}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
}
async function rpc(name, args, jwt) {
  const r = await fetch(`${API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message), d);
  return d;
}
const mockLog = async () => (await fetch(`${MOCK}/log`)).json();
const clearLog = () => fetch(`${MOCK}/log/clear`, { method: 'POST' });
const control = (qs) => fetch(`${MOCK}/control?${qs}`);
const quiet = () => control('tomtom=ok&osrm=ok&tomtom_ms=0&noroad=');
/** a member of the team with an account, signed in */
async function member(name, roles) {
  const email = `${name.toLowerCase().replace(/\W/g, '')}-${randomUUID().slice(0, 6)}@test.local`;
  const id = await adminUser(email, 'motdepasse-9');
  await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, $2, $3, $4, $5)`, [id, name, name.split(' ')[0], roles, email]);
  return { id, email, jwt: (await signIn(email, 'motdepasse-9')).access_token };
}
async function customer(first, p) {
  const id = randomUUID(); made.customers.push(id);
  await q(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, $2, 'Route', $3, $4, $5, '1 rue Test')`,
    [id, first, `438555${String(made.customers.length).padStart(4, '0')}`, p.lat, p.lng]);
  return id;
}
/** an appointment written straight in the table (drive_wanted only needs its day and its position) */
async function stop(p, day, block = 'am') {
  const job = randomUUID();
  await q(`insert into public.jobs (id, customer_id, day, block, status, duration_min) values ($1, $2, $3, $4, 'booked', 60)`, [job, await customer('Arrêt', p), day, block]);
  return job;
}
const wanted = async (point, from, days) => (await q(`select public.drive_wanted($1::jsonb, $2::date, $3) w`, [point ? JSON.stringify(point) : null, from, days]))[0].w;
const timeOf = async (a, b, slot = 0) => (await q(`select minutes, km::float8 km, source from public.drive_times
  where a = public.drive_key($1, $2) and b = public.drive_key($3, $4) and slot = $5`, [a.lat, a.lng, b.lat, b.lng, slot]))[0] || null;
/** the planner's straight-line estimate of the switch off (drive_min's arithmetic, written out: with the switch on drive_min
    reads the road times) between two points: what must NEVER be stored, nor used with the switch on */
const straight = async (a, b) => (await q(`select ceil(public.km_between($1, $2, $3, $4) * public.bset('detour', 1.3) / greatest(public.bset('speed_kmh', 35), 5) * 60)::int m`,
  [a.lat, a.lng, b.lat, b.lng]))[0].m;
/** the switch flipped by the server itself (what roads_switch does inside), in one transaction (the guard lets it through) */
async function setBooking(booking) {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('garage.roads', 'on', true)`);
    await c.query(`update public.settings set booking = $1 where id = 1`, [booking]);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const booking = async () => (await q(`select booking from public.settings where id = 1`))[0].booking;
const bookingSet = (path, json) => q(`update public.settings set booking = jsonb_set(booking, $1::text[], $2::jsonb) where id = 1`, [path, JSON.stringify(json)]);
/** the k-th coming Thursday at least 2 days ahead (a working day: the three times of a trip are asked) */
const thursday = async (k) => (await q(`select (d::date + 7 * $1::int)::text d from generate_series(public.local_today() + 2, public.local_today() + 8, interval '1 day') d
  where extract(isodow from d) = 4 limit 1`, [k]))[0].d;

// the mock's road (tests/stack/mocks.mjs)
const roadKm = (a, b) => Math.hypot((b.lng - a.lng) * 78, (b.lat - a.lat) * 111) * 1.25;
const ttSec = (a, b, slot = 0) => Math.round((240 + roadKm(a, b) * 110 + (b.lat > a.lat ? 120 : 0)) * [1, 1.5, 1.8][slot]);
const ttMin = (a, b, slot = 0) => Math.ceil(ttSec(a, b, slot) / 60);
const osrmMin = (a, b) => Math.ceil(((roadKm(a, b) / 32) * 3600 / 60) * 1.2);
const kmOf = (a, b) => Math.round(Math.round(roadKm(a, b) * 1000) / 100) / 10;
const same = (xy, p) => xy[0] === p.lat && xy[1] === p.lng;
const txCost = (o, d) => (o > 5 && d > 5 ? 5 * Math.max(o, d) : o * d);
const matrix = async (at) => (await mockLog()).filter((x) => x.svc === 'tomtom' && x.kind === 'matrix' && (!at || String(x.departAt).endsWith(at)));
const osrmTables = async () => (await mockLog()).filter((x) => x.svc === 'osrm' && x.kind === 'table');
/** every cell a Matrix request of the mock's log asked: [from, to, departAt] */
const cellsAsked = (m) => m.flatMap((x) => x.from.flatMap((o) => x.to.map((t) => JSON.stringify([o, t, x.departAt]))));
const spentNow = async () => Number((await q(`select coalesce((select tx from public.drive_spend where month = date_trunc('month', public.local_today())::date), 0) tx`))[0].tx);

const HOME = { lat: 45.5312898, lng: -73.6544639, label: 'Centrale', address: '1401 rue Legendre O, Montréal' };
/** addresses of the tests, each its own (about 1 km apart: never the same 100 m place) */
const pt = (i) => ({ lat: Math.round((45.43 + (i % 10) * 0.013) * 1e5) / 1e5, lng: Math.round((-73.52 - Math.floor(i / 10) * 0.017 - (i % 10) * 0.004) * 1e5) / 1e5 });

let owner, office, mech, truck, bookingBefore;
before(async () => {
  bookingBefore = await booking();
  owner = await member('Hassan Route', '{owner}');
  office = await member('Bureau Route', '{office}');
  mech = await member('Mécano Route', '{mechanic}');
  await q(`delete from public.drive_times`); await q(`delete from public.drive_spend`); await q(`delete from public.rate_limits where key like 'drive:%'`);
  await bookingSet(['home'], HOME);
  // one vehicle working every day from « Départ des camions »
  truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active, driver_id) values ($1, 'Camion route', true, $2)`, [truck, mech.id]);
  for (let dow = 0; dow < 7; dow++) await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[480,1200]]')`, [truck, dow]);
  await quiet(); await clearLog();
});
after(async () => {
  await quiet();
  await setBooking(bookingBefore);
  // the customers made here, and the one the online booking made (last name « Route »)
  made.customers.push(...(await q(`select id from public.customers where last_name = 'Route'`)).map((r) => r.id));
  await q(`delete from public.trips where job_id in (select id from public.jobs where customer_id = any($1))`, [made.customers]);
  await q(`delete from public.messages where customer_id = any($1) or job_id in (select id from public.jobs where customer_id = any($1))`, [made.customers]);
  await q(`delete from public.public_links where job_id in (select id from public.jobs where customer_id = any($1))`, [made.customers]);
  await q(`delete from public.job_items where job_id in (select id from public.jobs where customer_id = any($1))`, [made.customers]);
  await q(`delete from public.jobs where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.vehicles where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.customers where id = any($1)`, [made.customers]);
  await q(`delete from public.services where id = any($1)`, [made.services]);
  await q(`delete from public.truck_week where truck_id = any($1)`, [made.trucks]);
  await q(`delete from public.trucks where id = any($1)`, [made.trucks]);
  await q(`delete from public.drive_times`); await q(`delete from public.drive_spend`);
  await q(`delete from public.rate_limits where key like 'drive:%' or key like 'slots:%' or key like 'book:%'`);
  await q(`delete from public.secrets where key = 'drive_limits' or key like 'backup_repo:%'`);
  await q(`delete from public.staff where id = any($1)`, [made.users]);
  await q(`delete from auth.users where id = any($1)`, [made.users]);
  await q(`delete from public.op_log`); await q(`delete from public.activity`);
  await db.end();
});

test('« drive »: who may ask what — never the public key; sweep for the owner, the office or the nightly job; a far or unknown address is refused before anything is paid', async () => {
  await clearLog();
  assert.deepEqual(Object.values(await fn('drive', { action: 'status' })).slice(0, 3), [401, false, 'signin'], 'the public key');
  const st = await fn('drive', { action: 'status' }, mech.jwt);
  assert.equal(st.ok, true, JSON.stringify(st));
  assert.equal(st.key, true, 'the test server has a TomTom key (tt-test)');
  assert.deepEqual(Object.keys(st).filter((k) => k !== 'status').sort(), ['key', 'left', 'left0', 'month', 'ok', 'on', 'rows']);
  assert.equal(st.on, false);
  assert.deepEqual(Object.keys(st.rows).sort(), ['none', 'osrm', 'tomtom']);
  assert.equal((await fn('drive', { action: 'sweep' }, mech.jwt)).code, 'not_allowed', 'a mechanic does not sweep');
  assert.equal((await fn('drive', { action: 'nope' }, mech.jwt)).code, 'action');
  assert.equal((await fn('drive', { action: 'warm', point: { lat: 'x', lng: -73.6 } }, mech.jwt)).code, 'no_position');
  assert.equal((await fn('drive', { action: 'warm', point: { lat: 91, lng: -73.6 } }, mech.jwt)).code, 'no_position');
  // a warm names an address: without one it would measure every trip of 14 days, the sweep's right (review-fn L3)
  assert.equal((await fn('drive', { action: 'warm', from: await thursday(9), days: 14 }, mech.jwt)).code, 'no_position', 'a mechanic: no address, no measure');
  const far = await fn('drive', { action: 'warm', point: { lat: 46.81, lng: -71.21 }, only: 'point' }, mech.jwt);
  assert.deepEqual([far.status, far.code], [400, 'far'], 'Québec City: more than 150 km from the start');
  assert.equal((await mockLog()).filter((x) => x.svc === 'tomtom' || x.svc === 'osrm').length, 0, 'nothing asked of TomTom or OSRM');
  // a mechanic warms an address (any role of the team may)
  const w = await fn('drive', { action: 'warm', point: pt(90), from: await thursday(9), days: 1, only: 'point' }, mech.jwt);
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.deepEqual(Object.keys(w).filter((k) => k !== 'status').sort(),
    ['kept', 'late', 'left', 'left0', 'more', 'no_road', 'ok', 'osrm', 'planned', 'ready', 'spent', 'stored', 'tomtom']);
  // the office sweeps
  const s = await fn('drive', { action: 'sweep' }, office.jwt);
  assert.equal(s.ok, true, JSON.stringify(s));
});

test('« drive » warm: TomTom answers — the address first in TWO requests (1 × N, N × 1), each paid before it goes; the times are the mock’s, never the straight line; then the rest of the day and its rush times', async () => {
  const day = await thursday(0);
  const A = pt(1), B = pt(2), C = pt(3), P = pt(4);
  const jobs = [await stop(A, day, 'am'), await stop(B, day, 'pm'), await stop(C, day, 'eve')];
  try {
    await quiet(); await clearLog();
    const before = await wanted(P, day, 1);
    const mine = before.pairs.filter((p) => p[5] && p[4] === 0);
    assert.equal(mine.length, 8, 'the address ↔ the start and the 3 stops, both ways');
    const spent0 = (await fn('drive', { action: 'status' }, owner.jwt)).month.tx;
    const w = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.equal(w.ok, true, JSON.stringify(w));
    assert.deepEqual([w.ready, w.stored, w.tomtom, w.osrm, w.more, w.no_road, w.planned], [true, 8, 'ok', 'unused', false, 0, 0], JSON.stringify(w));
    const m = await matrix();
    // the two go at the same time (either may reach TomTom first)
    const out = m.find((x) => x.origins === 1), back = m.find((x) => x.destinations === 1);
    assert.deepEqual([m.length, out?.destinations, back?.origins, out?.traffic, back?.traffic], [2, 4, 4, 'historical', 'historical'], 'two requests: 1 × 4 and 4 × 1');
    assert.deepEqual(out.from, [[P.lat, P.lng]]);
    assert.deepEqual(back.to, [[P.lat, P.lng]]);
    // TomTom's usual traffic of a coming Tuesday to Thursday at 11 h 30, written without an offset
    for (const x of m) {
      assert.match(x.departAt, /^\d{4}-\d{2}-\d{2}T11:30:00$/);
      const dow = new Date(x.departAt.slice(0, 10) + 'T12:00:00Z').getUTCDay();
      assert.ok([2, 3, 4].includes(dow), x.departAt);
      assert.ok(x.departAt.slice(0, 10) > (await q(`select public.local_today()::text d`))[0].d, 'at least one day ahead');
    }
    assert.equal(w.spent.tx - spent0, 8, 'the bill: 4 + 4 transactions');
    assert.equal((await q(`select tx from public.drive_spend where month = date_trunc('month', public.local_today())::date`))[0].tx, w.spent.tx);
    // stored: the mock's minutes (rounded up) and km, each direction its own; never the straight-line estimate
    for (const [a, b] of [[P, HOME], [HOME, P], [P, A], [A, P], [P, C], [C, P]]) {
      const t = await timeOf(a, b);
      assert.deepEqual(t, { minutes: ttMin(a, b), km: kmOf(a, b), source: 'tomtom' }, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
      assert.notEqual(t.minutes, await straight(a, b), 'not the straight line');
    }
    assert.notEqual((await timeOf(P, HOME)).minutes, (await timeOf(HOME, P)).minutes, 'the road there is not the road back');
    assert.equal((await timeOf(HOME, A)), null, 'the other trips of the day wait (only: the address)');

    // without « only »: the rest of that day, then the rush times of the long trips (8 h and 17 h)
    await clearLog();
    const r = await fn('drive', { action: 'warm', point: P, from: day, days: 1 }, owner.jwt);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.more, false);
    const t0 = await matrix('T11:30:00');
    assert.equal(t0.reduce((n, x) => n + x.cells, 0) >= 12, true, 'the 12 other trips of the day (start ↔ stops, stop ↔ stop)');
    assert.deepEqual(await timeOf(HOME, A), { minutes: ttMin(HOME, A), km: kmOf(HOME, A), source: 'tomtom' });
    const long = (await q(`select count(*)::int n from public.drive_times where slot = 0 and minutes >= 15`))[0].n;
    assert.ok(long > 0, 'some trips are 15 minutes or more');
    const rush = (await q(`select slot, count(*)::int n from public.drive_times where slot > 0 group by slot order by slot`));
    assert.deepEqual(rush.map((x) => x.slot), [1, 2], 'the morning and evening rush');
    assert.ok((await matrix('T08:00:00')).length > 0 && (await matrix('T17:00:00')).length > 0);
    // every long trip of the day has its three times: × 1.5 at 8 h, × 1.8 at 17 h (TomTom's), each its own row
    const trips = [[HOME, A], [A, HOME], [HOME, B], [B, HOME], [HOME, C], [C, HOME], [A, B], [B, A], [A, C], [C, A], [B, C], [C, B]];
    const longs = trips.filter(([a, b]) => ttMin(a, b) >= 15);
    assert.ok(longs.length > 0);
    for (const [pa, pb] of longs) {
      assert.deepEqual([(await timeOf(pa, pb, 0))?.minutes, (await timeOf(pa, pb, 1))?.minutes, (await timeOf(pa, pb, 2))?.minutes],
        [ttMin(pa, pb, 0), ttMin(pa, pb, 1), ttMin(pa, pb, 2)]);
    }
    // the address typed and NOT booked: its usual-hours trips only, never a rush time (the lead's « fn M3»: it may never be
    // booked; before, ~2.5 × its star was paid)
    const mineP = [[P, HOME], [HOME, P], [P, A], [A, P], [P, B], [B, P], [P, C], [C, P]];
    const longP = mineP.filter(([a, b]) => ttMin(a, b) >= 15);
    assert.ok(longP.length > 0, 'some of the address’s trips are long (15 minutes or more)');
    for (const [pa, pb] of longP) assert.deepEqual([(await timeOf(pa, pb, 1)), (await timeOf(pa, pb, 2))], [null, null], 'no rush time for an address not booked');
    const rushAsked = [...(await matrix('T08:00:00')), ...(await matrix('T17:00:00'))];
    assert.equal(rushAsked.some((x) => [...x.from, ...x.to].some((xy) => same(xy, P))), false, 'no rush request touches the address');
    assert.equal(rushAsked.reduce((n, x) => n + x.cells, 0), longs.length * 2, 'the rush times of the day’s own long trips, nothing else');
    // a short trip (under roads_rush_min, 15) gets no rush time
    const short = (await q(`select count(*)::int n from public.drive_times d0 where d0.slot = 0 and d0.minutes < 15
      and exists (select 1 from public.drive_times d1 where d1.a = d0.a and d1.b = d0.b and d1.slot > 0)`))[0].n;
    assert.equal(short, 0);
    // the bill of each request is in the month's spend
    const all = [...t0, ...(await matrix('T08:00:00')), ...(await matrix('T17:00:00'))];
    assert.equal(r.spent.tx - w.spent.tx, all.reduce((n, x) => n + txCost(x.origins, x.destinations), 0));
    assert.ok(all.every((x) => x.cells <= 100));
    // nothing left for that day: asked again, nothing is sent
    await clearLog();
    const again = await fn('drive', { action: 'warm', point: P, from: day, days: 1 }, owner.jwt);
    assert.deepEqual([again.ready, again.stored, again.tomtom, again.left], [true, 0, 'unused', 0], JSON.stringify(again));
    assert.equal((await matrix()).length, 0);
    // booked: now a stop of that day, its rush times come (the warm after the booking, as the app sends it; the sweep too)
    jobs.push(await stop(P, day, 'pm'));
    await clearLog();
    const spentB = await spentNow();
    const booked = await fn('drive', { action: 'warm', point: P, from: day, days: 1 }, owner.jwt);
    assert.deepEqual([booked.ok, booked.ready, booked.stored, booked.more, booked.left], [true, true, longP.length * 2, false, 0], JSON.stringify(booked));
    for (const [pa, pb] of longP) {
      assert.deepEqual([(await timeOf(pa, pb, 1))?.minutes, (await timeOf(pa, pb, 2))?.minutes], [ttMin(pa, pb, 1), ttMin(pa, pb, 2)], 'its rush times, once booked');
    }
    const mb = await matrix();
    assert.ok(mb.length > 0 && mb.every((x) => !x.departAt.endsWith('T11:30:00') && [...x.from, ...x.to].some((xy) => same(xy, P))), 'only the address’s rush trips asked');
    assert.equal(await spentNow() - spentB, mb.reduce((n, x) => n + txCost(x.origins, x.destinations), 0), 'the spend = the bill');
  } finally {
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: a full day of 8 places is asked as ONE square (8 × 8 for 40 transactions instead of 56 as rows); 6 places as rows, at most 5 requests at a time', async () => {
  const day = await thursday(1);
  const pts = [pt(11), pt(12), pt(13), pt(14), pt(15), pt(16), pt(17)];
  const jobs = [];
  for (const p of pts) jobs.push(await stop(p, day, 'am'));
  const was = await booking();
  try {
    await bookingSet(['roads_rush'], false);   // the usual hours only: the square alone in the log
    await quiet(); await clearLog();
    const w = await wanted(null, day, 1);
    assert.equal(w.pairs.length, 56, '7 stops ↔ 7 stops (42) + the start ↔ each stop (14)');
    const spentBefore = Number((await fn('drive', { action: 'status' }, owner.jwt)).month.tx);
    const r = await fn('drive', { action: 'warm', from: day, days: 1 }, owner.jwt);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.ready, r.stored, r.left0], [true, 56, 0], JSON.stringify(r));
    assert.equal(r.spent.tx - spentBefore, 40, 'the 8 × 8 square is charged 5 × 8 = 40, not 64 (review-fn L9)');
    const m = await matrix();
    assert.deepEqual(m.map((x) => [x.origins, x.destinations, x.cells]), [[8, 8, 64]], 'one square');
    assert.equal(txCost(8, 8), 40);
    assert.equal(r.spent.tx, (await q(`select tx from public.drive_spend`))[0].tx);
    // 6 places (5 stops + the start): a square would cost 30 too → rows, five in flight at most
    const day2 = await thursday(2);
    for (const p of [pt(21), pt(22), pt(23), pt(24), pt(25)]) jobs.push(await stop(p, day2, 'pm'));
    await control('tomtom_ms=400'); await clearLog();
    const r2 = await fn('drive', { action: 'warm', from: day2, days: 1 }, owner.jwt);
    assert.deepEqual([r2.ok, r2.ready, r2.stored], [true, true, 30], JSON.stringify(r2));
    const m2 = await matrix();
    assert.equal(m2.length, 6, 'six rows of 1 × 5');
    assert.ok(m2.every((x) => x.origins === 1 || x.destinations === 1));
    assert.equal(m2.reduce((n, x) => n + x.cells, 0), 30);
    assert.equal(Math.max(...m2.map((x) => x.inflight)), 5, 'five requests at a time, never more');
  } finally {
    await quiet();
    await setBooking({ ...(await booking()), roads_rush: was.roads_rush ?? true });
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: TomTom down, refused or busy → OSRM for the usual hours (+20 %), no rush time; TomTom AND OSRM down → nothing stored, nothing guessed, not ready', async () => {
  const day = await thursday(3);
  const A = pt(31);
  const jobs = [await stop(A, day, 'am')];
  try {
    for (const [mode, state, i] of [['fail', 'busy', 32], ['refuse', 'refused', 33], ['busy', 'busy', 34]]) {
      const P = pt(i);
      await control(`tomtom=${mode}&osrm=ok`); await clearLog();
      const w = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
      assert.deepEqual([w.ok, w.ready, w.stored, w.tomtom, w.osrm], [true, true, 4, state, 'ok'], mode + ': ' + JSON.stringify(w));
      assert.equal((await osrmTables()).length, 1, 'one OSRM table for the 3 places');
      for (const [a, b] of [[P, HOME], [HOME, P], [P, A], [A, P]]) {
        assert.deepEqual(await timeOf(a, b), { minutes: osrmMin(a, b), km: kmOf(a, b), source: 'osrm' }, mode);
        assert.notEqual((await timeOf(a, b)).minutes, await straight(a, b));
      }
      assert.equal((await q(`select count(*)::int n from public.drive_times where slot > 0 and (a = public.drive_key($1, $2) or b = public.drive_key($1, $2))`, [P.lat, P.lng]))[0].n, 0, 'OSRM gives no rush time');
    }
    // over its own day the rest waits for TomTom: without it the rush times cannot come, and « more » never loops
    await control('tomtom=fail&osrm=ok');
    const rest = await fn('drive', { action: 'warm', from: day, days: 1 }, owner.jwt);
    assert.deepEqual([rest.ok, rest.more, rest.tomtom], [true, false, 'busy'], JSON.stringify(rest));
    // both down
    const P = pt(35);
    await control('tomtom=fail&osrm=fail'); await clearLog();
    const none = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([none.ok, none.ready, none.stored, none.tomtom, none.osrm, none.more], [true, false, 0, 'busy', 'down', false], JSON.stringify(none));
    assert.equal((await q(`select count(*)::int n from public.drive_times where a = public.drive_key($1, $2) or b = public.drive_key($1, $2)`, [P.lat, P.lng]))[0].n, 0, 'nothing stored, nothing guessed');
    assert.ok(none.left0 >= 4);
  } finally {
    await quiet();
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: the month’s TomTom ceiling — a request that would pass it is never sent (OSRM for the usual hours, « over_budget »)', async () => {
  const day = await thursday(4);
  const A = pt(41), P = pt(42);
  const jobs = [await stop(A, day, 'am')];
  const was = await booking();
  try {
    await quiet(); await clearLog();
    const tx = Number((await fn('drive', { action: 'status' }, owner.jwt)).month.tx);
    await bookingSet(['roads_month_tx'], tx + 2);   // a 1 × 2 request (2) fits, the next one (2) does not
    const w = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w.ok, w.ready, w.tomtom, w.osrm, w.stored], [true, true, 'over_budget', 'ok', 4], JSON.stringify(w));
    assert.deepEqual([w.spent.tx, w.spent.cap], [tx + 2, tx + 2], 'the ceiling is never passed');
    assert.equal((await matrix()).length, 1, 'one TomTom request sent, the second never left');
    const sources = (await q(`select source, count(*)::int n from public.drive_times where a = public.drive_key($1, $2) or b = public.drive_key($1, $2) group by source order by source`, [P.lat, P.lng]));
    assert.deepEqual(sources, [{ source: 'osrm', n: 2 }, { source: 'tomtom', n: 2 }]);
    // next time (the ceiling raised): the OSRM times are asked to TomTom again after a day
    await bookingSet(['roads_month_tx'], 10000);
    await q(`update public.drive_times set at = now() - interval '2 days' where source = 'osrm' and (a = public.drive_key($1, $2) or b = public.drive_key($1, $2))`, [P.lat, P.lng]);
    await clearLog();
    const w2 = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w2.ok, w2.tomtom, w2.stored], [true, 'ok', 2], JSON.stringify(w2));
    assert.deepEqual((await q(`select distinct source from public.drive_times where a = public.drive_key($1, $2) or b = public.drive_key($1, $2)`, [P.lat, P.lng])).map((x) => x.source), ['tomtom']);
  } finally {
    await setBooking({ ...(await booking()), roads_month_tx: was.roads_month_tx ?? 10000 });
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: a trip with no road — TomTom says none, OSRM is asked, still none → « no road » kept (no minutes, no km); TomTom alone saying none is not enough', async () => {
  const day = await thursday(5);
  const A = pt(51), P = pt(52), Q = pt(53);
  const jobs = [await stop(A, day, 'am')];
  try {
    await control(`tomtom=ok&osrm=ok&noroad=${P.lat},${P.lng}`); await clearLog();
    const w = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w.ok, w.no_road, w.stored, w.ready, w.tomtom, w.osrm], [true, 4, 4, true, 'ok', 'ok'], JSON.stringify(w));
    assert.equal((await osrmTables()).length, 1, 'OSRM asked for a second opinion');
    assert.deepEqual(await timeOf(P, A), { minutes: null, km: null, source: 'none' });
    assert.equal((await wanted(P, day, 1)).pairs.filter((p) => p[5] && p[4] === 0).length, 0, 'not asked again for 7 days');
    // TomTom says none for every trip, OSRM finds them: OSRM's times
    await control('tomtom=noroad&osrm=ok&noroad='); await clearLog();
    const w2 = await fn('drive', { action: 'warm', point: Q, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w2.no_road, w2.stored, w2.ready], [0, 4, true], JSON.stringify(w2));
    assert.deepEqual(await timeOf(Q, A), { minutes: osrmMin(Q, A), km: kmOf(Q, A), source: 'osrm' });
  } finally {
    await quiet();
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: two calls at the same time never measure — nor pay — the same trips twice: the same address by two people, then the rest of its day by two phones (review-fn H1)', async () => {
  const day = await thursday(12);
  const jobs = [];
  for (const p of [pt(121), pt(122), pt(123), pt(124), pt(125)]) jobs.push(await stop(p, day, 'am'));
  const P = pt(126);
  try {
    await quiet(); await clearLog();
    const spent0 = await spentNow();
    const only = { action: 'warm', point: P, from: day, days: 1, only: 'point' };
    const [a, b] = await Promise.all([fn('drive', only, owner.jwt), fn('drive', only, office.jwt)]);
    assert.deepEqual([a.ok, a.ready, b.ok, b.ready, a.stored + b.stored], [true, true, true, true, 12], JSON.stringify([a, b]));
    const m = await matrix();
    assert.deepEqual(m.map((x) => [x.origins, x.destinations]).sort(), [[1, 6], [6, 1]], 'the address’s star asked ONCE: ' + JSON.stringify(m.map((x) => [x.origins, x.destinations])));
    assert.equal(await spentNow() - spent0, 12, 'paid 2N (12), not 4N');
    // the rest of that day (each phone fires it after the address): one call measures, the other waits and finds it done
    await clearLog();
    const spent1 = await spentNow();
    const rest = { action: 'warm', point: P, from: day, days: 1 };
    const [c, d] = await Promise.all([fn('drive', rest, owner.jwt), fn('drive', rest, office.jwt)]);
    assert.deepEqual([c.ok, d.ok, c.more, d.more, c.left, d.left], [true, true, false, false, 0, 0], JSON.stringify([c, d]));
    const m2 = await matrix();
    const cells = cellsAsked(m2);
    assert.ok(cells.length >= 30, 'the 30 other trips of the day, then their rush times');
    assert.equal(cells.length, new Set(cells).size, 'no trip asked twice');
    assert.equal(await spentNow() - spent1, m2.reduce((n, x) => n + txCost(x.origins, x.destinations), 0), 'the spend = the bill of what was asked once');
    assert.equal((await q(`select count(*)::int n from public.rate_limits where key like 'drive:claim:%'`))[0].n, 0, 'every lease given back');
  } finally {
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: HTTP 200 with every cell failed (TomTom’s own trouble, not « no road »): « busy », OSRM gives the usual hours, never « ok » with nothing (review-fn M2)', async () => {
  const day = await thursday(13);
  const A = pt(131), P = pt(132);
  const jobs = [await stop(A, day, 'am')];
  try {
    await control('tomtom=cells&osrm=ok'); await clearLog();
    const spent0 = await spentNow();
    const w = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w.ok, w.ready, w.stored, w.tomtom, w.osrm], [true, true, 4, 'busy', 'ok'], JSON.stringify(w));
    assert.deepEqual(await timeOf(P, A), { minutes: osrmMin(P, A), km: kmOf(P, A), source: 'osrm' });
    assert.equal(await spentNow() - spent0, 4, 'the two requests were paid, once');
    await clearLog();
    const again = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([again.ready, again.stored, (await matrix()).length], [true, 0, 0], 'not asked (nor paid) again: ' + JSON.stringify(again));
  } finally {
    await quiet();
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« book » (the public page, no account): its own TomTom allowance a month (booking.roads_web_tx) and 30 new addresses an hour; past them OSRM gives the moments, the team’s month is kept; a slow TomTom never makes the page wait more than ~8 s (review-fn H2, M1)', async () => {
  const day = await thursday(14);
  // places near the start (a moment more than 35 min away is « far » and never offered online)
  const near = (k) => ({ lat: Math.round((45.505 + k * 0.0031) * 1e5) / 1e5, lng: Math.round((-73.625 - k * 0.0027) * 1e5) / 1e5 });
  const jobs = [await stop(near(0), day, 'am'), await stop(near(1), day, 'pm')];
  const svc = (await q(`insert into public.services (name_fr, name_en, price_cents, duration_min) values ('Huile publique', 'Oil public', 8000, 45) returning id`))[0].id;
  made.services.push(svc);
  const was = await booking();
  const month = (await q(`select to_char(public.local_today(), 'YYYY-MM') m`))[0].m;
  try {
    await quiet();
    // the day measured by the team first (a moment is offered online only when all its trips are), then the switch on
    const day0 = await fn('drive', { action: 'warm', from: day, days: 1 }, owner.jwt);
    assert.deepEqual([day0.ok, day0.left0], [true, 0], JSON.stringify(day0));
    await setBooking({ ...(await booking()), roads_on: true, roads_web_tx: 6 });   // one address: 1 × 3 + 3 × 1 = 6
    const slots = (p) => fn('book', { action: 'slots', lat: p.lat, lng: p.lng, services: [svc], from: day, days: 1 });
    // the first public address: TomTom, within the allowance
    await clearLog();
    const s1 = await slots(near(2));
    assert.equal(s1.ok, true, JSON.stringify(s1));
    assert.deepEqual((await matrix()).map((x) => [x.origins, x.destinations]).sort(), [[1, 3], [3, 1]]);
    assert.equal((await q(`select n from public.rate_limits where key = $1`, [`drive:web:tx:${month}`]))[0]?.n, 6, 'the public page’s spend of the month');
    // the second: the allowance is used up → TomTom not asked; OSRM measures it and the page still offers moments
    await clearLog();
    const spent0 = await spentNow();
    const s2 = await slots(near(3));
    assert.deepEqual([s2.ok, (await matrix()).length, (await osrmTables()).length], [true, 0, 1], JSON.stringify(s2));
    assert.ok(s2.slots.length > 0, 'moments offered (OSRM’s usual hours)');
    assert.equal(await spentNow(), spent0, 'nothing of the team’s month');
    assert.equal((await timeOf(HOME, near(3))).source, 'osrm');
    // the team still measures with TomTom
    await clearLog();
    const t = await fn('drive', { action: 'warm', point: near(4), from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([t.ok, t.tomtom, (await matrix()).length], [true, 'ok', 2], JSON.stringify(t));
    // every public call that measures counts in its hour, OSRM included (final-security F2): the two above did
    const bucket = (await q(`select floor(extract(epoch from now()) / 3600)::bigint b`))[0].b;
    assert.equal((await q(`select n from public.rate_limits where key = 'drive:web' and bucket = $1`, [bucket]))[0]?.n, 2);
    // an address already measured: nothing to measure, nothing counted
    await slots(near(3));
    assert.equal((await q(`select n from public.rate_limits where key = 'drive:web' and bucket = $1`, [bucket]))[0]?.n, 2);
    // 30 addresses measured an hour on the public page: past it nothing is measured (neither TomTom nor OSRM: the rows a
    // robot could leave are bounded), its moments are not offered, and the page is told why (critic W1: never « no moment free »)
    await setBooking({ ...(await booking()), roads_web_tx: 1000 });
    await q(`insert into public.rate_limits (key, bucket, n) values ('drive:web', $1, 30) on conflict (key, bucket) do update set n = 30`, [bucket]);
    await clearLog();
    const s3 = await slots(near(5));
    assert.deepEqual([s3.ok, (await matrix()).length, (await osrmTables()).length, s3.slots.length, s3.unmeasured], [true, 0, 0, 0, true], JSON.stringify(s3));
    assert.equal((await timeOf(HOME, near(5))) ?? null, null, 'nothing stored');
    assert.equal((await slots(near(2))).unmeasured, undefined, 'an address with moments offered: no such word');
    await q(`delete from public.rate_limits where key = 'drive:web'`);
    // M1: TomTom slower than the page may wait (13 s): the page answers within ~8 s, with OSRM's moments
    await control('tomtom_ms=13000'); await clearLog();
    const t0 = Date.now();
    const s4 = await slots(near(6));
    const took = Date.now() - t0;
    assert.equal(s4.ok, true, JSON.stringify(s4));
    assert.ok(took < 9000, `the page answered after ${took} ms`);
    assert.ok(s4.slots.length > 0, 'moments offered: ' + JSON.stringify(s4));
    assert.equal((await timeOf(HOME, near(6))).source, 'osrm');
  } finally {
    await quiet();
    await setBooking({ ...(await booking()), roads_on: was.roads_on ?? false, roads_web_tx: was.roads_web_tx });   // undefined: the key goes
    await q(`delete from public.rate_limits where key like 'drive:web%'`);
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: TomTom refused or the month spent — a trip whose time is OSRM’s (a day old) is not asked to OSRM again (it would answer the same); a trip with no time is; the address is ready (join-server: drive_wanted’s 7th element)', async () => {
  const day = await thursday(15);
  const A = pt(151), P = pt(152), Q = pt(153);
  const jobs = [await stop(A, day, 'am')];
  const was = await booking();
  try {
    await control('tomtom=refuse&osrm=ok'); await clearLog();
    const w = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w.ok, w.ready, w.stored, w.tomtom, w.osrm], [true, true, 4, 'refused', 'ok'], JSON.stringify(w));
    // two days later: drive_wanted lists them again, to ask TomTom (OSRM knows no traffic)
    await q(`update public.drive_times set at = now() - interval '2 days' where source = 'osrm' and (a = public.drive_key($1, $2) or b = public.drive_key($1, $2))`, [P.lat, P.lng]);
    assert.deepEqual((await wanted(P, day, 1)).pairs.filter((p) => p[5] && p[4] === 0).map((p) => p[6]), ['osrm', 'osrm', 'osrm', 'osrm']);
    // TomTom still refuses: nothing asked of OSRM, nothing stored, the address ready (the planner has its OSRM times)
    await clearLog();
    const w2 = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w2.ok, w2.ready, w2.stored, w2.tomtom, w2.osrm, w2.more], [true, true, 0, 'refused', 'unused', false], JSON.stringify(w2));
    assert.equal((await osrmTables()).length, 0, 'OSRM not asked again (before: one table at every call, and « ready: false »)');
    assert.ok((await matrix()).length > 0, 'TomTom was asked: it is the one that can make them better');
    // the month spent: no TomTom request leaves, OSRM is not asked for them either
    await quiet();
    await bookingSet(['roads_month_tx'], await spentNow());
    await clearLog();
    const w3 = await fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w3.ok, w3.ready, w3.stored, w3.tomtom, w3.osrm], [true, true, 0, 'over_budget', 'unused'], JSON.stringify(w3));
    assert.deepEqual([(await matrix()).length, (await osrmTables()).length], [0, 0]);
    // a new address at the same moment: OSRM measures it (only the OSRM times are left alone)
    await clearLog();
    const w4 = await fn('drive', { action: 'warm', point: Q, from: day, days: 1, only: 'point' }, owner.jwt);
    assert.deepEqual([w4.ok, w4.ready, w4.stored, w4.tomtom, w4.osrm], [true, true, 4, 'over_budget', 'ok'], JSON.stringify(w4));
    assert.equal((await osrmTables()).length, 1);
  } finally {
    await quiet();
    await setBooking({ ...(await booking()), roads_month_tx: was.roads_month_tx ?? 10000 });
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: an address already booked, warmed while a sweep runs (a known customer’s screen, the nightly job): its trips are asked ONCE and paid once (join-server: the lease of fix-fn H1’s known gap)', async () => {
  const day = await thursday(16);
  const jobs = [];
  for (const p of [pt(161), pt(162), pt(163)]) jobs.push(await stop(p, day, 'am'));
  const P = pt(164);
  try {
    await quiet();
    // every coming day measured first: the race below is about the address's trips
    let s = await fn('drive', { action: 'sweep' }, owner.jwt), n = 0;
    while (s.ok && s.more && n++ < 20) s = await fn('drive', { action: 'sweep' }, owner.jwt);
    assert.deepEqual([s.ok, s.left0, s.more], [true, 0, false], JSON.stringify(s));
    jobs.push(await stop(P, day, 'pm'));   // booked: its 8 usual-hours trips are now the sweep's too
    assert.equal((await wanted(P, day, 1)).point_place, true);
    await control('tomtom_ms=300'); await clearLog();
    const spent0 = await spentNow();
    const [sw, w] = await Promise.all([fn('drive', { action: 'sweep' }, owner.jwt),
      fn('drive', { action: 'warm', point: P, from: day, days: 1, only: 'point' }, office.jwt)]);
    assert.deepEqual([sw.ok, w.ok, w.ready], [true, true, true], JSON.stringify([sw, w]));
    const m = await matrix();
    const cells = cellsAsked(m);
    assert.equal(cells.length, new Set(cells).size, 'no trip asked twice (before: the address’s 8 by both calls)');
    assert.equal(cells.filter((c) => c.endsWith('T11:30:00"]') && JSON.parse(c).slice(0, 2).some((xy) => same(xy, P))).length, 8, 'its 8 usual-hours trips, once');
    assert.equal(await spentNow() - spent0, m.reduce((x, r) => x + txCost(r.origins, r.destinations), 0), 'the spend = the bill of what was asked once');
    assert.equal((await q(`select count(*)::int n from public.rate_limits where key like 'drive:claim:%'`))[0].n, 0, 'every lease given back');
  } finally {
    await quiet();
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: the brakes — 60 calls an hour a person, 300 for the garage; a call stops at its request limit and says « more », the next one goes on', async () => {
  const day = await thursday(6);
  const jobs = [];
  for (const p of [pt(61), pt(62), pt(63)]) jobs.push(await stop(p, day, 'am'));
  const other = await member('Autre Route', '{mechanic}');
  try {
    await quiet();
    const bucket = (await q(`select floor(extract(epoch from now()) / 3600)::bigint b`))[0].b;
    await q(`insert into public.rate_limits (key, bucket, n) values ($1, $2, 60)`, [`drive:${other.id}`, bucket]);
    const r = await fn('drive', { action: 'warm', point: pt(64), from: day, days: 1, only: 'point' }, other.jwt);
    assert.deepEqual([r.status, r.code], [429, 'busy'], 'a person: 60 an hour');
    await q(`delete from public.rate_limits where key = $1`, [`drive:${other.id}`]);
    await q(`insert into public.rate_limits (key, bucket, n) values ('drive:all', $1, 300) on conflict (key, bucket) do update set n = 300`, [bucket]);
    assert.equal((await fn('drive', { action: 'warm', point: pt(64), from: day, days: 1, only: 'point' }, other.jwt)).code, 'busy', 'the garage: 300 an hour');
    assert.equal((await fn('drive', { action: 'status' }, other.jwt)).ok, true, 'the status measures nothing: no brake');
    await q(`delete from public.rate_limits where key like 'drive:%'`);
    // a call that reaches its request limit (lowered for the test): what it measured is kept, « more » says call again
    await q(`insert into public.secrets (key, value) values ('drive_limits', '{"requests": 2}') on conflict (key) do update set value = excluded.value`);
    await clearLog();
    const a = await fn('drive', { action: 'warm', from: day, days: 1 }, owner.jwt);
    assert.deepEqual([a.ok, a.more, a.ready], [true, true, false], JSON.stringify(a));
    assert.equal((await matrix()).length, 2, 'two requests, then it stopped');
    assert.ok(a.stored > 0 && a.left0 > 0);
    let n = 0, b = a;
    while (b.more && n++ < 20) b = await fn('drive', { action: 'warm', from: day, days: 1 }, owner.jwt);
    assert.deepEqual([b.more, b.ready, b.left0], [false, true, 0], JSON.stringify(b));
  } finally {
    await q(`delete from public.secrets where key = 'drive_limits'`);
    await q(`delete from public.rate_limits where key like 'drive:%'`);
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive » sweep by the nightly job: GitHub’s signed ticket (as « recon »), the sweep only; a forged or foreign ticket is refused', async () => {
  const day = await thursday(7);
  const jobs = [await stop(pt(71), day, 'pm')];
  try {
    await quiet();
    const ticket = (await (await fetch(`${MOCK}/github/token?repository=hostnextline/garage2.0-sauvegardes`)).json()).value;
    const s = await fn('drive', { action: 'sweep' }, null, { 'x-github-oidc': ticket });
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.ok(s.stored >= 2);
    assert.equal((await fn('drive', { action: 'status' }, null, { 'x-github-oidc': ticket })).code, 'not_allowed', 'the job sweeps, nothing else');
    assert.equal((await fn('drive', { action: 'warm', point: pt(72) }, null, { 'x-github-oidc': ticket })).code, 'not_allowed');
    const foreign = (await (await fetch(`${MOCK}/github/token?repository=quelquun/autre`)).json()).value;
    assert.equal((await fn('drive', { action: 'sweep' }, null, { 'x-github-oidc': foreign })).code, 'not_allowed');
    assert.equal((await fn('drive', { action: 'sweep' }, null, { 'x-github-oidc': ticket.slice(0, -4) + 'AAAA' })).code, 'signin', 'a forged signature');
    assert.equal((await q(`select count(*)::int n from public.rate_limits where key like 'drive:%' and key <> 'drive:night'`))[0].n, 0, 'the nightly job uses no person’s brake');
    // its own (final-money F9): 20 sweeps an hour
    assert.ok((await q(`select n from public.rate_limits where key = 'drive:night'`))[0]?.n >= 1);
    assert.equal(typeof s.pruned, 'number', 'the night forgets the trips nobody drives (drive_prune)');
    assert.deepEqual(s.late_jobs, [], 'the appointments it made late, named for the summary');
    const bucket = (await q(`select floor(extract(epoch from now()) / 3600)::bigint b`))[0].b;
    await q(`update public.rate_limits set n = 20 where key = 'drive:night' and bucket = $1`, [bucket]);
    const busy = await fn('drive', { action: 'sweep' }, null, { 'x-github-oidc': ticket });
    assert.deepEqual([busy.status, busy.code], [429, 'busy'], 'a replayed ticket never sweeps without end');
  } finally {
    await q(`delete from public.rate_limits where key = 'drive:night'`);
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« book »: online booking closed (live today) and the switch on — « slots » is refused BEFORE anything is measured: no TomTom, no OSRM, no row (final-security F1)', async () => {
  const day = await thursday(13);
  const jobs = [await stop(pt(91), day, 'am')];
  const was = await booking();
  try {
    await quiet();
    await setBooking({ ...(await booking()), roads_on: true, web: { ...(was.web || {}), on: false } });
    const rows0 = Number((await q(`select count(*)::int n from public.drive_times`))[0].n);
    await clearLog();
    const r = await fn('book', { action: 'slots', lat: 45.505, lng: -73.625, services: [randomUUID()], from: day, days: 1 });
    assert.deepEqual([r.ok, r.code], [false, 'web_off'], JSON.stringify(r));
    assert.deepEqual((await mockLog()).filter((x) => x.svc === 'tomtom' || x.svc === 'osrm'), [], 'nothing asked');
    assert.equal(Number((await q(`select count(*)::int n from public.drive_times`))[0].n), rows0, 'nothing stored');
  } finally {
    await setBooking({ ...(await booking()), roads_on: was.roads_on ?? false, web: was.web });
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive »: a person’s own TomTom allowance for addresses (30 calls an hour that ask TomTom), then OSRM; status braked at 120 an hour (final-money F6, final-security F7)', async () => {
  const day = await thursday(12);
  const jobs = [await stop(pt(95), day, 'am'), await stop(pt(96), day, 'pm')];
  const who = await member('Mecano Allocation', '{mechanic}');
  const bucket = (await q(`select floor(extract(epoch from now()) / 3600)::bigint b`))[0].b;
  try {
    await quiet();
    await fn('drive', { action: 'warm', from: day, days: 1 }, owner.jwt);   // the day itself measured by the office
    await clearLog();
    const a = await fn('drive', { action: 'warm', point: pt(97), from: day, days: 1, only: 'point' }, who.jwt);
    assert.deepEqual([a.ok, a.tomtom, (await matrix()).length], [true, 'ok', 2], JSON.stringify(a));
    assert.equal((await q(`select n from public.rate_limits where key = $1`, [`drive:tt:${who.id}`]))[0]?.n, 1, 'counted once for the call');
    await q(`update public.rate_limits set n = 30 where key = $1 and bucket = $2`, [`drive:tt:${who.id}`, bucket]);
    await clearLog();
    const b = await fn('drive', { action: 'warm', point: pt(98), from: day, days: 1, only: 'point' }, who.jwt);
    assert.deepEqual([b.ok, b.ready, b.tomtom, b.osrm, (await matrix()).length], [true, true, 'over_budget', 'ok', 0], JSON.stringify(b));
    assert.equal((await timeOf(pt(98), pt(95))).source, 'osrm', 'measured by OSRM: the address still gets its moments');
    // the office's own allowance is its own
    await clearLog();
    const o = await fn('drive', { action: 'warm', point: pt(99), from: day, days: 1, only: 'point' }, office.jwt);
    assert.deepEqual([o.tomtom, (await matrix()).length], ['ok', 2], JSON.stringify(o));
    // status: 120 an hour a person
    await q(`insert into public.rate_limits (key, bucket, n) values ($1, $2, 120) on conflict (key, bucket) do update set n = 120`, [`drive:status:${who.id}`, bucket]);
    const st = await fn('drive', { action: 'status' }, who.jwt);
    assert.deepEqual([st.status, st.code], [429, 'busy']);
    assert.equal((await fn('drive', { action: 'status' }, office.jwt)).ok, true);
  } finally {
    await q(`delete from public.rate_limits where key like 'drive:%'`);
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
  }
});

test('« drive », the server side end to end: switch off a warm harms nothing; sweep until ready; the switch on; a new address warmed → its moment counts the mock’s times; booked → its arrival is the mock’s time; unmeasured → the fixed time, never the straight line; online booking measures first', async () => {
  const day = await thursday(8), dayB = await thursday(10);
  const A = pt(81), P = pt(82), U = pt(83), W = pt(84);
  const ca = await customer('Avant', A), cu = await customer('Inconnue', U);
  await stop(pt(88), await thursday(11), 'pm');   // another coming day not measured yet: the switch must wait for it
  const svc = (await q(`insert into public.services (name_fr, name_en, price_cents, duration_min) values ('Huile route', 'Oil road', 8000, 45) returning id`))[0].id;
  made.services.push(svc);
  await quiet();
  // switch off: a booked appointment planned with the estimate of before
  const b0 = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: ca, day, block: 'am', duration_min: 60 }, p_items: [] }, owner.jwt);
  const eta0 = (await q(`select eta_min from public.jobs where id = $1`, [b0.job_id]))[0].eta_min;
  assert.equal(eta0, 480 + await straight(HOME, A), 'off: the planner’s estimate of before');
  const etas = async () => (await q(`select id, eta_min, truck_id from public.jobs where day >= public.local_today() and status = 'booked' order by id`));
  const plans0 = await etas();
  // a warm with the switch off: times stored, NOTHING planned again, the switch stays off
  const w0 = await fn('drive', { action: 'warm', point: P, from: day, days: 1 }, owner.jwt);
  assert.deepEqual([w0.ok, w0.planned, w0.kept, w0.late], [true, 0, [], []], JSON.stringify(w0));
  assert.deepEqual(await etas(), plans0, 'no arrival time moved');
  assert.equal((await booking()).roads_on ?? false, false);
  // the switch waits for the trips of the coming days
  const cold = await rpc('roads_switch', { p_op: randomUUID(), p_on: true }, owner.jwt).catch((e) => e);
  assert.equal(cold.hint, 'roads_cold', JSON.stringify(cold));
  // « Mesurer maintenant »: sweep while « more »
  let s = await fn('drive', { action: 'sweep' }, owner.jwt), n = 0;
  while (s.ok && s.more && n++ < 20) s = await fn('drive', { action: 'sweep' }, owner.jwt);
  assert.deepEqual([s.ok, s.ready, s.left0, s.more], [true, true, 0, false], JSON.stringify(s));
  const st = await fn('drive', { action: 'status' }, owner.jwt);
  assert.deepEqual([st.left0, st.on], [0, false]);
  // the switch on, as the owner (it plans the coming days again with the real times)
  const on = await rpc('roads_switch', { p_op: randomUUID(), p_on: true }, owner.jwt);
  assert.deepEqual([on.ok, on.on], [true, true], JSON.stringify(on));
  // A's arrival is now the mock's time from the start at 8 h (the morning rush on a Thursday), not the estimate
  assert.equal((await q(`select eta_min from public.jobs where id = $1`, [b0.job_id]))[0].eta_min, 480 + ttMin(HOME, A, 1));

  // a NEW address on another day: warmed first (as the booking screen does), then its moments
  const P2 = pt(85);
  const cp2 = await customer('Neuve', P2);
  await clearLog();
  const wp = await fn('drive', { action: 'warm', point: P2, from: dayB, days: 1, only: 'point' }, owner.jwt);
  assert.deepEqual([wp.ok, wp.ready, wp.stored], [true, true, 2], JSON.stringify(wp));
  const rows = await rpc('suggest_blocks', { p_lat: P2.lat, p_lng: P2.lng, p_duration: 60, p_from: dayB, p_days: 1, p_exclude: null, p_limit: 6, p_need: false, p_kind: null }, owner.jwt);
  const pm = rows.find((x) => x.day === dayB && x.block === 'pm');
  assert.ok(pm, JSON.stringify(rows));
  assert.equal(pm.unmeasured, 0, 'every trip of that moment measured');
  // the afternoon leaves the start at 12 h and comes back before 15 h: the usual-hours times, there and back
  assert.equal(pm.add_min, ttMin(HOME, P2) + ttMin(P2, HOME), JSON.stringify(pm));
  assert.equal(pm.day_min, pm.add_min, 'the vehicle’s whole day that day: there and back');
  assert.notEqual(pm.add_min, await straight(HOME, P2) + await straight(P2, HOME));
  // booked: its arrival is the mock's time, not the straight line
  const bp = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: cp2, day: dayB, block: 'pm', duration_min: 60 }, p_items: [] }, owner.jwt);
  const etaP = (await q(`select eta_min from public.jobs where id = $1`, [bp.job_id]))[0].eta_min;
  assert.equal(etaP, 720 + ttMin(HOME, P2), 'arrival = 12 h + TomTom’s time from the start');
  assert.notEqual(etaP, 720 + await straight(HOME, P2));

  // TomTom and OSRM both down, an address nobody measured: not ready, the booking still goes, with the fixed unknown time
  await control('tomtom=fail&osrm=fail');
  const wu = await fn('drive', { action: 'warm', point: U, from: dayB, days: 1, only: 'point' }, owner.jwt);
  assert.deepEqual([wu.ok, wu.ready, wu.stored], [true, false, 0], JSON.stringify(wu));
  const bu = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: cu, day: dayB, block: 'eve', duration_min: 60 }, p_items: [] }, owner.jwt);
  assert.ok(bu.job_id, 'booked anyway');
  const unknown = Number((await booking()).unknown_min ?? 20);
  const ju = (await q(`select eta_min from public.jobs where id = $1`, [bu.job_id]))[0];
  assert.equal(ju.eta_min, 960 + unknown, 'the fixed time of a trip not measured (20 min), never a straight line');
  assert.notEqual(ju.eta_min, 960 + await straight(P2, U));

  // online booking with the switch on: the address is measured BEFORE the moments (an unmeasured moment is never offered online)
  await quiet();
  const sw = await fn('drive', { action: 'sweep' }, owner.jwt);   // the day of the unknown address measured meanwhile
  assert.deepEqual([sw.ok, sw.left0], [true, 0], JSON.stringify(sw));
  await clearLog();
  const sl = await fn('book', { action: 'slots', lat: W.lat, lng: W.lng, services: [svc], from: dayB, days: 1 });
  assert.equal(sl.ok, true, JSON.stringify(sl));
  const mw = await matrix();
  assert.deepEqual(mw.map((x) => [x.origins, x.destinations]).sort(), [[1, 3], [3, 1]], 'the address’s star (the start, P2, U): 1 × 3 and 3 × 1');
  assert.ok(same(mw.find((x) => x.origins === 1).from[0], W) && same(mw.find((x) => x.destinations === 1).to[0], W), JSON.stringify(mw.map((x) => [x.from, x.to])));
  assert.ok(sl.slots.length > 0, 'moments offered: they are measured now');
  assert.ok(sl.slots.every((x) => Object.keys(x).sort().join() === 'block,day,near'), 'the same keys as before');
  assert.deepEqual(await timeOf(HOME, W), { minutes: ttMin(HOME, W), km: kmOf(HOME, W), source: 'tomtom' });
  // both down: the page still answers (no moment it could not measure), and a booking still goes
  await control('tomtom=fail&osrm=fail');
  const W2 = pt(86);
  const sl2 = await fn('book', { action: 'slots', lat: W2.lat, lng: W2.lng, services: [svc], from: dayB, days: 1 });
  assert.deepEqual([sl2.ok, sl2.slots.length], [true, 0], JSON.stringify(sl2));
  const web = await fn('book', { action: 'book', base: BASE, lang: 'fr', services: [svc], day: dayB, block: 'am', first_name: 'Web', last_name: 'Route',
    phone: `514 555-${String(Math.floor(1000 + Math.random() * 8999))}`, address: '1 rue Test', lat: W2.lat, lng: W2.lng, vehicle: { year: '2020', make: 'Honda', model: 'Civic' } });
  assert.equal(web.ok, true, JSON.stringify(web));
  // the switch off again (roads off: the estimate of before)
  await quiet();
  const off = await rpc('roads_switch', { p_op: randomUUID(), p_on: false }, owner.jwt);
  assert.deepEqual([off.ok, off.on], [true, false]);
  assert.equal((await q(`select eta_min from public.jobs where id = $1`, [b0.job_id]))[0].eta_min, eta0, 'off: the estimate of before again');
  // roads off, online booking spends nothing on TomTom
  await clearLog();
  const sl3 = await fn('book', { action: 'slots', lat: pt(87).lat, lng: pt(87).lng, services: [svc], from: dayB, days: 1 });
  assert.equal(sl3.ok, true);
  assert.equal((await matrix()).length, 0, 'switch off: the address is not measured');
});
