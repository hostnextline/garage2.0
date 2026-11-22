// « Vraies routes » (Part 27), the switch OFF is the rollback state: a differential check. Every planner function Part 27
// makes again answers exactly what its definition of before Part 27 answered. Inside the test's transaction (rolled back), the
// cases are run with today's functions, then the definitions of before (read from the migrations before 20261119000200) are
// put back and the same cases run again; every answer and every row written must be the same. Road times are stored (absurd
// ones) and the day of the week left set to anything (« garage.drive_dow »), so nothing of Part 27 may leak while it is off.
// One exception, Part 29 (20261122000200_garder_ordre.sql): on a TIGHT window day (a plan would make late someone the
// stored day serves on time, or a late minute later still) plan_route freezes that vehicle and the re-plans keep the stored
// routes, switch off too; the cases here are blocks or days with room (tests/db/reorganiser-garde.test.mjs covers the rest).
// Run: node --test tests/db/vraies-routes-off.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tx, pool, futureDay } from './helpers.mjs';

after(() => pool.end());

const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const PART27 = '20261119000200';
/** the latest definition of public.<name> in the migrations before Part 27 (what tools/fn.py reads, Part 27 left out; and
 *  every later one too: Part 29, 20261122000200, makes replan_block_safe and roads_replan again) */
function before(name) {
  let out = null;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql') && x < PART27).sort()) {
    const s = readFileSync(MIG + f, 'utf8');
    const re = new RegExp(`^create or replace function public\\.${name}\\s*\\(`, 'gim');
    for (const m of s.matchAll(re)) {
      const tail = s.slice(m.index);
      const q = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
      const end = tail.indexOf(q[1], q.index + q[0].length);
      out = tail.slice(0, tail.indexOf(';', end) + 1);
    }
  }
  assert.ok(out, 'a definition of ' + name + ' before Part 27');
  return out;
}
/** every planner function Part 27 makes again (drive_min: the one the old functions call, with 7 arguments) */
const REMADE = ['drive_min', 'route_walk_in', 'route_cost', 'route_retime', 'plan_route', 'day_drive', 'suggest_core', 'suggest_windows_core',
  'web_suggest', 'web_windows', 'plan_inputs',
  // fix-sql (verify-on F1, F4, F11): plan_route is now a wrapper of plan_route_core; apply_plan's chain and replan_block_safe
  // gained a branch for the switch on; customers_replan_on_position takes its locks in order (review-sql L6)
  'apply_plan', 'replan_block_safe', 'customers_replan_on_position',
  // final-fix-server (final-guess G1): a window is cut only from a measured arrival (book_job, move_job, lock_windows_core),
  // the flag jobs.eta_measured is not an « update » of the appointment (log_activity)
  'book_job', 'move_job', 'lock_windows_core', 'log_activity',
  // « exact move » (STATE.md 2026-11-21, S7): an order by hand and the windows switched off clear the minute pointed
  'stop_order_one', 'windows_switch',
  // « exact move » fix (verify-on F5): a pinned stop already late that a plan makes later counts as made late
  'plan_late_new'];

const HOME = [45.5005053, -73.6577429];
const PTS = [[45.5150, -73.6400], [45.5700, -73.7500], [45.4474, -73.4363], [45.6000, -73.5500], [45.5300, -73.6100], [45.4800, -73.5800],
  [45.5500, -73.7000], [45.5100, -73.5200], [45.5400, -73.6700], [45.4600, -73.6200]];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const X = '00000000-0000-4000-8000-0000000000aa';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const become = async (h, who) => { h.me = who ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
const book = (h, n, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: id(9000 + n), p_job: { id: id(n), customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });

/** the garage of the cases: two vehicles (the truck with its own start; the car with a break on Fridays), ten customers and
 *  one without a position, a Tuesday, a Friday and a Saturday booked, one appointment « quand même », one order by hand, and
 *  every trip between those places stored with absurd times (the switch is off: nothing may read them) */
async function world(h) {
  const owner = await h.person('Hassan', ['owner']);
  const tue = await futureDay(h, 2), fri = await futureDay(h, 5), sat = await futureDay(h, 6);
  const t1 = await h.truck('Camion', null, WEEK);
  const t2 = await h.truck('Voiture', null, { ...WEEK, 5: [[480, 600], [660, 1200]] });
  await server(h, `update public.trucks set start = '{"label": "Chez Saleh", "lat": 45.53, "lng": -73.62}'::jsonb where id = $1`, [t1]);
  await server(h, `update public.trucks set tire_machine = false where id = $1`, [t2]);
  const cs = [];
  for (const [i, p] of PTS.entries()) cs.push(await h.customer('C' + i, ...p));
  const lost = await h.customer('Sans adresse', null, null);
  await become(h, owner);
  let n = 1;
  const plan = [[tue, 'am', 45], [tue, 'am', 60], [tue, 'am', 30], [tue, 'pm', 45], [tue, 'pm', 50], [tue, 'pm', 40], [tue, 'eve', 45], [tue, 'eve', 30],
    [fri, 'am', 45], [fri, 'am', 40], [fri, 'pm', 60], [fri, 'pm', 30], [fri, 'eve', 45], [sat, 'am', 60], [sat, 'am', 45], [sat, 'pm', 30]];
  for (const [i, [d, b, dur]] of plan.entries()) {
    const e = await h.fails(() => book(h, n++, cs[i % cs.length], d, b, dur, i === 9 ? { vehicle_kind: 'truck' } : {}));
    if (e && e.hint !== 'block_full') throw e;                     // a full block: that case is simply not in the garage
  }
  await book(h, n++, lost, fri, 'pm', 30);
  await book(h, n++, cs[3], tue, 'am', 200, { force: true });
  const pmT1 = (await h.q(`select id from public.jobs where day = $1 and block = 'pm' and truck_id = $2 order by stop_order`, [tue, t1])).map((r) => r.id);
  if (pmT1.length >= 2) await h.val(`select public.set_stop_order($1, $2, $3, 'pm', $4::uuid[])`, [id(9500), t1, tue, [...pmT1].reverse()]);
  const rows = [];
  for (const a of [HOME, [45.53, -73.62], ...PTS]) for (const b of [HOME, [45.53, -73.62], ...PTS]) if (a !== b) for (const s of [0, 1, 2]) rows.push([...a, ...b, s, 99 + s * 7, 50, 'tomtom']);
  await val(h, `select public.drive_store($1::jsonb)`, [JSON.stringify(rows)]);
  assert.equal(await val(h, `select public.roads_on() v`), false, 'the switch is off');
  return { owner, days: [tue, fri, sat], tue, fri, sat, trucks: [t1, t2], cs, lost };
}

/** the answers of the reading cases (each a function of the planner, the switch off) */
async function reads(h, w) {
  const out = {};
  const ext = (p, dur = 45) => JSON.stringify({ id: X, lat: p[0], lng: p[1], dur });
  for (const dow of ['', '2', '6']) {
    await server(h, `select set_config('garage.drive_dow', $1, true)`, [dow]);
    for (const d of w.days) for (const b of ['am', 'pm', 'eve']) {
      const p0 = await val(h, `select public.plan_block($1::date, $2) v`, [d, b]);
      const p1 = await val(h, `select public.plan_extra($1::date, $2, $3::jsonb, null, $4::jsonb) v`, [d, b, ext(PTS[2]), JSON.stringify(p0)]);
      out[`plan ${dow} ${d} ${b}`] = p0;
      out[`plan+ ${dow} ${d} ${b}`] = p1;
      out[`plan forced ${dow} ${d} ${b}`] = await val(h, `select public.plan_block($1::date, $2, $3::jsonb) v`, [d, b, JSON.stringify({ id: X, lat: PTS[5][0], lng: PTS[5][1], dur: 240, force: true })]);
      for (const t of w.trucks) {
        const k = (o) => o && { min: o.min, km: o.km, stops: o.stops, hop: o.hop };   // the keys of before (Part 27 adds some)
        out[`day ${dow} ${d} ${b} ${t}`] = k(await val(h, `select public.day_drive($1::date, $2::uuid, $3::jsonb) v`, [d, t, JSON.stringify(p0)]));
        out[`day+ ${dow} ${d} ${b} ${t}`] = k(await val(h, `select public.day_drive($1::date, $2::uuid, $3::jsonb, $4::jsonb) v`, [d, t, JSON.stringify(p1), ext(PTS[2])]));
      }
    }
    const pts = JSON.stringify({ x: { lat: PTS[0][0], lng: PTS[0][1], dur: 30 }, y: { lat: PTS[1][0], lng: PTS[1][1], dur: 30, ws: 500, we: 560 },
      z: { lat: PTS[2][0], lng: PTS[2][1], dur: 30 }, q: { lat: null, lng: null, dur: 20 } });
    for (const [start, rg, win] of [[400, null, true], [480, '[[480, 600], [660, 720]]', false], [900, null, false], [1010, '[[900, 1000], [1020, 1200]]', true]]) {
      for (const [ids, add, at] of [['["x","y"]', 'z', 1], ['["z","x","q"]', 'y', 0], ['[]', 'x', 0], ['["y"]', null, 0]]) {
        for (const walk of [true, false]) {
          out[`route_cost ${dow} ${start} ${rg} ${win} ${ids} ${add} ${walk}`] = await val(h, `select public.route_cost($1::jsonb, $2, $3, $4::jsonb, $5, $6, $7, 45.6, -73.55, 35, 1.3, 20, 5, 0, $8::jsonb, $9, $10) v`,
            [ids, add, at, pts, start, ...HOME, rg, win, walk]);
        }
        out[`route_walk_in ${dow} ${start} ${rg} ${win} ${ids}`] = await val(h, `select public.route_walk_in($1::jsonb, $2::jsonb, $3, $4, $5, 35, 1.3, 20, 5, 1, $6::jsonb, $7) v`,
          [ids, pts, start, ...HOME, rg, win]);
      }
    }
  }
  for (const dow of ['', '5']) {
    await server(h, `select set_config('garage.drive_dow', $1, true)`, [dow]);
    for (const [p, dur] of [[PTS[2], 60], [PTS[7], 30], [[45.52, -73.60], 120]]) {
      out[`suggest ${dow} ${p} ${dur}`] = await val(h, `select public.suggest_core($1, $2, $3, $4::date, 5, null, 50, false, null) v`, [...p, dur, w.tue]);
    }
    out[`suggest need ${dow}`] = await val(h, `select public.suggest_core($1, $2, 45, $3::date, 4, null, 50, true, null) v`, [...PTS[4], w.tue]);
    out[`suggest move ${dow}`] = await val(h, `select public.suggest_core($1, $2, 45, $3::date, 4, $4::uuid, 50, false, 'car') v`, [...PTS[4], w.tue, id(2)]);
  }
  for (const b of [{}, { speed_kmh: 40 }, { roads_rush: false }, { detour: 1.5, unknown_min: 30 }, { home: { lat: 45.5, lng: -73.6 } }, { stop_min: 10, roads_on: true }]) {
    out[`plan_inputs ${JSON.stringify(b)}`] = await val(h, `select public.plan_inputs($1::jsonb) v`, [JSON.stringify(b)]);
  }
  for (const [i, a] of PTS.entries()) {
    const b = PTS[(i + 3) % PTS.length];
    for (const tm of [null, 400, 480, 900, 1100]) out[`drive_min ${a} ${b} ${tm}`] = await val(h, `select public.drive_min($1, $2, $3, $4, 35, 1.3, 20) v`, [...a, ...b]) + '/'
      + await val(h, `select public.drive_min($1, $2, $3, $4, 35, 1.3, 20, $5::int) v`, [...a, ...b, tm]);
  }
  await server(h, `select set_config('garage.drive_dow', '', true)`);
  return out;
}

/** the writing cases: each in a savepoint, the rows of the planner written read back, then rolled back */
async function writes(h, w) {
  const out = {};
  const snap = async () => (await server(h, `select id, day::text, block, truck_id, truck_pinned, stop_order, eta_min, travel_min, manual_order, forced, status, win_start, win_end,
    win_flex, eta_measured from public.jobs where day >= public.local_today() and deleted_at is null order by id`));
  const ops = [
    ['book', () => book(h, 100, w.cs[6], w.sat, 'pm', 45).then((r) => [r.ok, r.truck_id, r.forced])],
    ['book truck', () => book(h, 101, w.cs[7], w.tue, 'eve', 30, { truck_id: w.trucks[0] }).then((r) => [r.ok, r.truck_id])],
    ['book forced', () => book(h, 102, w.cs[8], w.sat, 'am', 300, { force: true }).then((r) => [r.ok, r.forced])],
    ['move', () => h.rpc('move_job', { p_op: id(9101), p_job: id(4), p_day: w.fri, p_block: 'eve', p_truck: null }).then((r) => [r.ok, r.changed])],
    ['duration', () => h.rpc('set_job_duration', { p_op: id(9102), p_job: id(16), p_duration: 60 }).then((r) => [r.ok])],
    ['cancel', () => h.rpc('job_step', { p_op: id(9103), p_job: id(2), p_action: 'cancel', p_data: {} }).then((r) => [r.ok])],
    ['order', async () => {
      const ids = (await h.q(`select id from public.jobs where day = $1 and block = 'am' and truck_id is not null and status = 'booked' order by stop_order`, [w.fri])).map((r) => r.id);
      const t = (await h.one(`select truck_id from public.jobs where id = $1`, [ids[0]])).truck_id;
      const mine = (await h.q(`select id from public.jobs where day = $1 and block = 'am' and truck_id = $2 and status = 'booked' order by stop_order`, [w.fri, t])).map((r) => r.id);
      return h.val(`select public.set_stop_order($1, $2, $3, 'am', $4::uuid[])`, [id(9104), t, w.fri, mine.reverse()]).then((r) => [r.ok]);
    }],
    ['retime', () => server(h, `select public.route_retime($1, $2::date, 'pm'), public.route_retime($3, $2::date, 'am')`, [w.trucks[0], w.tue, w.trucks[1]]).then(() => [])],
    ['replan_days', () => val(h, `select public.replan_days($1::date[]) v`, [w.days])],
    ['settings', async () => { await h.q(`update public.settings set booking = jsonb_set(booking, '{stop_min}', '9') where id = 1`); return []; }],
    // fix-sql: an address found later (customers_replan_on_position → replan_block → replan_block_safe), a re-plan by hand
    ['position', () => server(h, `update public.customers set lat = 45.47, lng = -73.60 where id = $1`, [w.lost]).then(() => [])],
    ['replan safe', () => val(h, `select public.replan_block_safe($1::date, 'am') v`, [w.fri])],
    ['move same block', () => h.rpc('move_job', { p_op: id(9105), p_job: id(9), p_day: w.fri, p_block: 'am', p_truck: w.trucks[1] }).then((r) => [r.ok, r.truck_changed])]
  ];
  for (const [name, op] of ops) {
    await server(h, `select set_config('garage.drive_dow', '2', true)`);
    await h.c.query('savepoint w');
    let answer;
    const e = await h.fails(async () => { answer = await op(); });  // a refusal is an answer too (the same one, before and now)
    out[`answer ${name}`] = e ? `refused ${e.hint || e.message}` : answer;
    out[`rows ${name}`] = await snap();
    out[`late rows ${name}`] = Number(await val(h, `select count(*) v from public.activity where action = 'window_late'`));
    out[`activity ${name}`] = await val(h, `select coalesce(jsonb_agg(jsonb_build_object('a', action, 'e', entity, 'd', data) order by action, entity, data::text), '[]'::jsonb) v
      from public.activity where at = now()`);
    await h.c.query('rollback to savepoint w');
  }
  await server(h, `select set_config('garage.drive_dow', '', true)`);
  return out;
}

async function windowCases(h, w) {
  const out = {};
  for (const dow of ['', '2']) {
    await server(h, `select set_config('garage.drive_dow', $1, true)`, [dow]);
    for (const d of w.days) {
      out[`plan day ${dow} ${d}`] = await val(h, `select public.plan_block($1::date, 'day') v`, [d]);
      for (const [p, dur] of [[PTS[2], 60], [PTS[9], 30]]) out[`windows ${dow} ${d} ${p}`] = await val(h, `select public.suggest_windows_core($1, $2, $3, $4::date) v`, [...p, dur, d]);
    }
    out[`suggest day ${dow}`] = await val(h, `select public.suggest_core($1, $2, 45, $3::date, 4, null, 50, false, null) v`, [...PTS[2], w.tue]);
    out[`web_windows ${dow}`] = await val(h, `select public.web_windows($1, $2, $3::uuid[], $4::date) v`, [...PTS[0], [w.svc], w.fri]);
  }
  // merge-main (2026-11-21): main changed suggest_windows_core before it went live (S38, aba05811: only the quarter hours a
  // vehicle able to take the job works, its hours of THAT day first; today none behind us). « Before » is now main's text;
  // these cases make that rule matter: the tire truck leaves at 13 h on the Saturday, the car works 8 h – 12 h; today at 11 h
  await h.c.query('savepoint s38');
  await server(h, `insert into public.truck_days (truck_id, day, ranges) values ($1, $3, '[[780, 1200]]'), ($2, $3, '[[480, 720]]')`, [...w.trucks, w.sat]);
  await server(h, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select 660 $$`);
  const today = await val(h, `select public.local_today()::text v`);
  const starts = (rows) => [...new Set((rows ?? []).map((x) => x.win_start))].sort((a, b) => a - b);
  for (const dow of ['', '6']) {
    await server(h, `select set_config('garage.drive_dow', $1, true)`, [dow]);
    for (const d of [w.sat, today]) for (const [need, kind] of [[false, null], [true, null], [false, 'truck'], [false, 'car']]) {
      out[`s38 ${dow} ${d} ${need} ${kind}`] = await val(h, `select public.suggest_windows_core($1, $2, 45, $3::date, null, $4, $5) v`, [...PTS[9], d, need, kind]);
    }
    out[`s38 web ${dow}`] = await val(h, `select public.web_windows($1, $2, $3::uuid[], $4::date) v`, [...PTS[0], [w.svc], w.sat]);
    // main's rule holds (whichever definition runs): tire work from 13 h → no window before 12 h – 16 h; the car → the morning;
    // today at 11 h → nothing before 10 h – 14 h
    const tire = starts(out[`s38 ${dow} ${w.sat} true null`]), car = starts(out[`s38 ${dow} ${w.sat} false car`]), now = starts(out[`s38 ${dow} ${today} false truck`]);
    assert.ok(tire.length > 0 && tire[0] >= 720, `the truck from 13 h: ${tire}`);
    assert.ok(car.every((s) => s <= 660), `the car works only the morning (its morning may be full already): ${car}`);
    assert.ok(now.length > 0 && now[0] >= 600, `today at 11 h: ${now}`);
  }
  await h.c.query('rollback to savepoint s38');
  await h.c.query('savepoint w');
  out['book window'] = await book(h, 200, w.cs[1], w.fri, 'day', 45, { win_start: 600 }).then((r) => [r.ok, r.win_start, r.eta]);
  out['book window rows'] = await server(h, `select id, truck_id, stop_order, eta_min, win_start, win_end, win_flex, eta_measured from public.jobs where day >= public.local_today() order by id`);
  await h.c.query('rollback to savepoint w');
  // final-fix-server: a booking and a move with no window said (the window cut from the planned arrival), a flexible one and
  // the evening's lock (lock_windows_core), the same as before
  await h.c.query('savepoint w');
  out['book no window'] = await book(h, 201, w.cs[2], w.fri, 'day', 45).then((r) => [r.ok, r.win_start, r.win_end, r.win_flex, r.eta]);
  out['book flexible'] = await book(h, 202, w.cs[3], w.sat, 'day', 30, { win_flex: true }).then((r) => [r.ok, r.win_start, r.win_flex]);
  out['move no window'] = await h.rpc('move_job', { p_op: id(9201), p_job: id(201), p_day: w.sat, p_block: 'day', p_truck: null, p_win_start: null, p_win_flex: false })
    .then((r) => [r.ok, r.tell]);
  out['lock'] = await val(h, `select public.lock_windows_core($1::date) v`, [w.sat]);
  out['no window rows'] = await server(h, `select id, truck_id, stop_order, eta_min, win_start, win_end, win_flex, eta_measured from public.jobs where day >= public.local_today() order by id`);
  await h.c.query('rollback to savepoint w');
  // « exact move » (S7, S9): while no appointment has a minute pointed, what the functions made again for it answer and write
  // in window mode is the one of before: an order by hand of the day, a walk again, a move keeping its window and truck
  // (« unchanged »), a move to another window, the windows switched off
  const rowsW = () => server(h, `select id, day::text, block, truck_id, truck_pinned, stop_order, eta_min, travel_min, win_start, win_end, win_flex, manual_order,
    forced, confirm_sent_at from public.jobs where day >= public.local_today() and deleted_at is null order by id`);
  const first = () => h.one(`select id, truck_id, truck_pinned, win_start from public.jobs where day = $1 and block = 'day' and status = 'booked' and truck_id is not null
    and win_start is not null order by truck_id, stop_order limit 1`, [w.fri]);
  for (const [name, op] of [
    ['order day', async () => {
      const j = await first();
      const mine = (await h.q(`select id from public.jobs where day = $1 and block = 'day' and truck_id = $2 and status = 'booked' order by stop_order`, [w.fri, j.truck_id])).map((r) => r.id);
      return h.val(`select public.set_stop_order($1, $2, $3, 'day', $4::uuid[]) v`, [id(9301), j.truck_id, w.fri, mine.reverse()]).then((r) => [r.ok]);
    }],
    ['retime day', () => server(h, `select public.route_retime($1, $2::date, 'day'), public.route_retime($3, $2::date, 'day')`, [w.trucks[0], w.fri, w.trucks[1]]).then(() => [])],
    ['move same window', async () => {
      const j = await first();
      return h.rpc('move_job', { p_op: id(9302), p_job: j.id, p_day: w.fri, p_block: 'day', p_truck: j.truck_pinned ? j.truck_id : null, p_win_start: j.win_start, p_win_flex: false })
        .then((r) => [r.ok, r.unchanged ?? null, r.tell ?? null]);
    }],
    ['move other window', async () => {
      const j = await first();
      return h.rpc('move_job', { p_op: id(9303), p_job: j.id, p_day: w.fri, p_block: 'day', p_truck: null, p_win_start: 900, p_win_flex: false }).then((r) => [r.ok, r.tell, r.window_changed]);
    }],
    ['windows off', () => h.rpc('windows_switch', { p_op: id(9304), p_on: false }).then((r) => [r.ok, r.converted, r.to_call?.length ?? null, r.kept])]
  ]) {
    await h.c.query('savepoint w');
    let answer;
    const e = await h.fails(async () => { answer = await op(); });
    out[`exact answer ${name}`] = e ? `refused ${e.hint || e.message}` : answer;
    out[`exact rows ${name}`] = await rowsW();
    await h.c.query('rollback to savepoint w');
  }
  await server(h, `select set_config('garage.drive_dow', '', true)`);
  return out;
}

async function putBack(h) {
  await h.as(null);
  for (const n of REMADE) await h.q(before(n));
  await h.as(h.me ?? null);
}
function compare(t, NEW, OLD, label) {
  const diff = Object.keys(NEW).filter((k) => JSON.stringify(NEW[k]) !== JSON.stringify(OLD[k]));
  t.diagnostic(`${label}: ${Object.keys(NEW).length} answers compared, ${diff.length} different`);
  assert.deepEqual(Object.keys(OLD).sort(), Object.keys(NEW).sort());
  assert.deepEqual(diff.map((k) => `${k}\n  now:    ${JSON.stringify(NEW[k]).slice(0, 400)}\n  before: ${JSON.stringify(OLD[k]).slice(0, 400)}`), [], label);
  return Object.keys(NEW).length;
}

test('switch off, blocks: every planner answer (plans, walks, day driving, moments offered, plan inputs, drive_min) is the one of before', (t) => tx(async (h) => {
  const w = await world(h);
  const NEW = await reads(h, w);
  await putBack(h);
  const OLD = await reads(h, w);
  assert.ok(compare(t, NEW, OLD, 'reads') >= 350);
}));

test('switch off, blocks: every write of the planner (book, « quand même », move, duration, cancel, order by hand, retime, re-plan, settings) is the one of before', (t) => tx(async (h) => {
  const w = await world(h);
  const NEW = await writes(h, w);
  await putBack(h);
  const OLD = await writes(h, w);
  t.diagnostic('the answers: ' + JSON.stringify(Object.fromEntries(Object.entries(NEW).filter(([k]) => k.startsWith('answer')))));
  assert.ok(compare(t, NEW, OLD, 'writes') >= 20);
}));

test('switch off, window mode: the day plans, the windows offered (also online) and a booking with a window are the ones of before', (t) => tx(async (h) => {
  const w = await world(h);
  assert.equal((await h.rpc('windows_switch', { p_op: '00000000-0000-4000-8000-00000000ffff', p_on: true })).ok, true);
  await server(h, `update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": true}'::jsonb) where id = 1`);
  w.svc = await val(h, `insert into public.services (name_fr, price_cents, duration_min, active) values ('Vidange TEST', 7999, 60, true) returning id`);
  const NEW = await windowCases(h, w);
  await putBack(h);
  const OLD = await windowCases(h, w);
  t.diagnostic('exact move cases: ' + JSON.stringify(Object.fromEntries(Object.entries(NEW).filter(([k]) => k.startsWith('exact answer')))));
  assert.ok(compare(t, NEW, OLD, 'window mode') >= 30);
}));
