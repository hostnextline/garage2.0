// « Un déplacement tombe exactement où on pointe » (STATE.md « exact move »): what happens AFTER the move with a minute
// pointed. S6 as corrected by the owner (2026-11-21 20:25, « i disagree with first one »): every later plan holds the pinned
// stop at its minute (a window of one minute), the OTHER stops of that day are planned as today (the planner may reorder
// them); S7: the pin is cleared by a move without a minute, an order by hand that lists it, the windows switched off;
// blocks mode; « Vraies routes » on (measured, not measured, a time measured after the move); today with a stop under
// way; two moves at once. Each test rolls back (the two-connection test cleans up what it committed: only its own rows).
// Run: node --test tests/db/exact-move-plans.test.mjs (Mac: bash tests/stack/mac/db-tests.sh exact-move-plans)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const P = { A: [45.5150, -73.6400], B: [45.5300, -73.6000], C: [45.4700, -73.5800], D: [45.5700, -73.7500], E: [45.5100, -73.6550],
  F: [45.4950, -73.6100], G: [45.5200, -73.6300] };
const DAY = [[480, 1200]];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, DAY]));
const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p.then(() => 'done', () => 'failed'), sleep(ms).then(() => 'waiting')]);
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
/** the job as JSON (its day as « YYYY-MM-DD », as the app reads it) */
const row = async (h, id) => (await h.one(`select to_jsonb(j) r from public.jobs j where j.id = $1`, [id])).r;
const exact = (h, job, day, at, { truck = null, lateOk = [] } = {}) =>
  h.rpc('move_job', { p_op: uuid(), p_job: job, p_day: day, p_block: 'day', p_truck: truck, p_win_start: null, p_win_flex: null, p_exact: { at, late_ok: lateOk } });
const preview = (h, job, day, at, truck = null) => h.rpc('move_preview', { p_job: job, p_day: day, p_truck: truck, p_at: at });
const book = (h, p_job) => h.rpc('book_job', { p_op: uuid(), p_job, p_items: [] });
const inside = (j, what) => assert.ok(j.eta_min >= j.win_start && j.eta_min <= j.win_end, `${what} inside its window: ${hm(j.eta_min)} in ${hm(j.win_start)}–${hm(j.win_end)}`);
const stopOrder = (h, truck, day, ids) => h.val(`select public.set_stop_order($1, $2, $3, 'day', $4::uuid[])`, [uuid(), truck, day, ids]);

/** the owner's world (as exact-move.test.mjs): one truck 8 h – 20 h, A 8–12, B 10–14, C 12–16, D 14–18 on a Thursday;
 *  E 9–13, F 12–16 on the Friday. `only`: the letters booked; `on`: windows on (false: blocks, each letter in `blocks`) */
async function world(h, { only = 'ABCDEF', dur = {}, ws = {}, on = true, blocks = {}, roads = false } = {}) {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h, 4, 3);
  const day2 = await h.val(`select ($1::date + 1)::text`, [day]);
  const tk = await h.truck('Camion', null, WEEK);
  await server(h, null, `update public.trucks set active = false where id <> $1 and active`, [tk]);
  await h.as(owner);
  if (on) assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const cust = {};
  for (const k of Object.keys(P)) cust[k] = await h.customer(k, ...P[k]);
  const ids = {};
  const W = { A: 480, B: 600, C: 720, D: 840, E: 540, F: 720, ...ws };
  for (const k of only) {
    const d = 'EF'.includes(k) ? day2 : day;
    const r = await book(h, { customer_id: cust[k], day: d, block: on ? 'day' : (blocks[k] ?? 'am'), duration_min: dur[k] ?? 60, ...(on ? { win_start: W[k] } : {}) });
    ids[k] = r.job_id;
  }
  if (roads) await roadsOn(h, owner);
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, day, day2, tk, cust, ids, name };
}
/** « Vraies routes » on: every trip the coming days want measured (`fn`: its minutes), then the owner's switch */
async function roadsOn(h, owner, fn = () => 10) {
  await h.as(null);
  for (let i = 0; i < 20; i++) {
    const w = await h.val(`select public.drive_wanted(null, null, 120) v`);
    if (!w.total) break;
    await h.val(`select public.drive_store($1::jsonb) v`, [JSON.stringify(w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], fn(p), 5, 'tomtom']))]);
  }
  await h.as(owner);
  const r = await h.rpc('roads_switch', { p_op: uuid(), p_on: true });
  assert.equal(r.on, true);
}
const order = async (h, w, day) =>
  (await h.q(`select id from public.jobs where day = $1 and truck_id = $2 and status = 'booked' and deleted_at is null order by stop_order`, [day, w.tk])).map((r) => w.name[r.id] ?? r.id.slice(0, 4));

test('S6: a later booking that day is planned as today around the pinned stop, which still arrives at its minute', () => tx(async (h) => {
  const w = await world(h);
  await exact(h, w.ids.C, w.day, 780);
  assert.equal((await row(h, w.ids.C)).eta_min, 780);
  const r = await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 45, win_start: 600 });
  assert.equal(r.ok, true);
  const c = await row(h, w.ids.C);
  assert.equal(c.eta_min, 780, `C still at 13:00 (${hm(c.eta_min)})`); assert.equal(c.arrive_at, 780);
  for (const k of ['A', 'B', 'D']) inside(await row(h, w.ids[k]), k);
  inside(await row(h, r.job_id), 'the new booking');
  // a cancellation and a length changed: planned again as today, the pin holds
  await h.rpc('job_step', { p_op: uuid(), p_job: w.ids.A, p_action: 'cancel', p_data: {} });
  assert.equal((await row(h, w.ids.C)).eta_min, 780, 'after a cancellation');
  await h.rpc('set_job_duration', { p_op: uuid(), p_job: w.ids.B, p_duration: 90 });
  assert.equal((await row(h, w.ids.C)).eta_min, 780, 'after a longer job before it');
  // the plan itself holds it as a window of one minute
  const p = await server(h, w.owner, `select public.plan_block($1::date, 'day') v`, [w.day]);
  assert.equal(p[0].v.jobs[w.ids.C].eta, 780);
}));

test('S6: the hours planned again (replan_days) and the evening lock of the flexible ones (lock_windows_core): the day planned as today, the pin holds', () => tx(async (h) => {
  const w = await world(h);
  await exact(h, w.ids.C, w.day, 780);
  const flex = await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 30, win_flex: true });
  assert.equal((await row(h, flex.job_id)).win_flex, true);
  assert.equal((await row(h, w.ids.C)).eta_min, 780, 'after a flexible booking');
  const n = await server(h, w.owner, `select public.replan_days(array[$1::date]) v`, [w.day]);
  assert.ok(n[0].v >= 1, 'the day was planned again');
  assert.equal((await row(h, w.ids.C)).eta_min, 780, 'after replan_days (hours, starts, route numbers changed)');
  const l = await server(h, w.owner, `select public.lock_windows_core($1::date) v`, [w.day]);
  assert.equal(l[0].v.fixed, 1, 'the flexible one got its window');
  assert.equal((await row(h, w.ids.C)).eta_min, 780, 'after the evening lock');
  for (const k of ['A', 'B', 'D']) inside(await row(h, w.ids[k]), k);
}));

test('S6: a booking that would push the pinned stop past its minute is not offered, nor booked; without the pin it is', () => tx(async (h) => {
  const w = await world(h, { only: 'C' });
  await exact(h, w.ids.C, w.day, 780);
  const ask = () => h.rpc('suggest_windows', { p_lat: P.G[0], p_lng: P.G[1], p_duration: 200, p_day: w.day, p_exclude: null, p_need: false, p_kind: null });
  const offered = (await ask()).map((x) => x.win_start);
  assert.equal(offered.includes(600), false, `10 h – 14 h is not offered (offered: ${offered.map(hm).join(', ')})`);
  const e = await h.fails(() => book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 200, win_start: 600 }));
  assert.ok(['window_full', 'block_full'].includes(e?.hint), e?.message);
  assert.equal((await row(h, w.ids.C)).eta_min, 780);
  // the same day without the pin (C back to its window of 12 h by a move without a minute): offered and booked
  await h.c.query('savepoint free');
  await h.rpc('move_job', { p_op: uuid(), p_job: w.ids.C, p_day: w.day, p_block: 'day', p_truck: null, p_win_start: 720, p_win_flex: false });
  assert.equal((await row(h, w.ids.C)).arrive_at, null);
  assert.equal((await ask()).some((x) => x.win_start === 600), true, '10 h – 14 h offered once C is free in its window');
  assert.equal((await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 200, win_start: 600 })).ok, true);
  await h.c.query('rollback to savepoint free');
}));

test('S6: a stop pinned earlier counts late after ITS minute: another move that pushes it is said and refused without late_ok', () => tx(async (h) => {
  const w = await world(h);
  await exact(h, w.ids.C, w.day, 540, { lateOk: Object.values(w.ids) });
  const p = await preview(h, w.ids.D, w.day, 570);
  const sc = p.stops.find((s) => s.id === w.ids.C);
  assert.equal(sc.late, true, `C, pinned at 9:00, would arrive at ${hm(sc.eta_after)}`);
  assert.equal(sc.late_min, sc.eta_after - 540);
  assert.equal((await h.fails(() => exact(h, w.ids.D, w.day, 570)))?.hint, 'late_changed');
}));

test('S6 / « Vraies routes »: a drive time measured after the move (drive_store → roads_replan) plans the day as usual and the pinned stop still arrives at its minute', () => tx(async (h) => {
  const w = await world(h, { roads: true });
  const r = await exact(h, w.ids.C, w.day, 780);
  assert.ok(r.stops.every((s) => s.measured === true), 'every trip measured: said');
  let c = await row(h, w.ids.C);
  assert.deepEqual([c.eta_min, c.eta_measured], [780, true]);
  // a longer time for the trips around D (the day is planned again from nothing by roads_replan)
  const home = await h.one(`select lat, lng from public.home_point()`);
  const pts = [[home.lat, home.lng], ...Object.values(P)];
  const rows = pts.filter((x) => x !== P.D).flatMap((x) => [0, 1, 2].flatMap((s) => [[...x, ...P.D, s, 40, 5, 'tomtom'], [...P.D, ...x, s, 40, 5, 'tomtom']]));
  await h.as(null);
  const st = await h.val(`select public.drive_store($1::jsonb) v`, [JSON.stringify(rows)]);
  await h.as(w.owner);
  assert.equal(st.replan_error, undefined, st.replan_error);
  assert.ok(st.planned >= 1 || (st.kept ?? []).length >= 1, JSON.stringify(st));
  c = await row(h, w.ids.C);
  assert.deepEqual([c.eta_min, c.eta_measured, c.arrive_at], [780, true, 780], 'still at 13:00');
  for (const k of ['A', 'B', 'D']) inside(await row(h, w.ids[k]), k);
}));

test('S6: an automatic re-plan that cannot keep the minute places the pinned stop late and SAYS it (window_late), never throws it out', () => tx(async (h) => {
  const w = await world(h, { roads: true });
  await exact(h, w.ids.C, w.day, 780);
  // every trip to C now measured at 6 h 40: nobody can be at C at 13:00 any more (the day starts at 8:00)
  const home = await h.one(`select lat, lng from public.home_point()`);
  const rows = [[home.lat, home.lng], ...Object.values(P)].filter((x) => x !== P.C).flatMap((x) => [0, 1, 2].map((s) => [...x, ...P.C, s, 400, 5, 'tomtom']));
  await h.as(null);
  const st = await h.val(`select public.drive_store($1::jsonb) v`, [JSON.stringify(rows)]);
  await h.as(w.owner);
  assert.equal(st.replan_error, undefined, st.replan_error);
  const c = await row(h, w.ids.C);
  assert.ok(c.truck_id, 'still on a truck: never thrown to « À placer »');
  assert.ok(c.eta_min > 780, `late: ${hm(c.eta_min)}`);
  assert.equal(c.arrive_at, 780, 'the minute pointed stays');
  assert.ok(st.late.includes(w.ids.C), 'the re-plan says it: ' + JSON.stringify(st.late));
  const a = await server(h, w.owner, `select data from public.activity where action = 'window_late' and entity_id = $1`, [w.ids.C]);
  assert.equal(a.length, 1); assert.equal(a[0].data.arrive_at, 780);
}));

test('S8: « Vraies routes » on, a trip not measured: the move is never refused nor said late from it (measured: false)', () => tx(async (h) => {
  const w = await world(h, { roads: true });
  // a new place nobody measured (the booking takes the fixed « position inconnue » time for its trips)
  const x = await h.customer('Loin', 45.6100, -73.8200);
  const b = await book(h, { customer_id: x, day: w.day2, block: 'day', duration_min: 60, win_start: 900 });
  // 8:10 counted with the unknown time (20 min from the start at 8:00) is after 8:10: not a fact, so not refused
  const p = await preview(h, b.job_id, w.day, 490);
  assert.equal(p.exact, true);
  const sx = p.stops.find((s) => s.id === b.job_id);
  assert.equal(sx.measured, false); assert.equal(sx.late, false);
  for (const s of p.stops.filter((s) => s.measured === false)) assert.equal(s.late, false, 'never late from a guess');
  const r = await exact(h, b.job_id, w.day, 490);
  assert.equal(r.ok, true);
  const j = await row(h, b.job_id);
  assert.deepEqual([j.arrive_at, j.eta_measured], [490, false]);
  assert.ok(j.eta_min >= 490);
}));

test('S7: the pin is cleared by a move without a minute (5 or 7 arguments: « Laisser l’app choisir », the old app), by an order by hand that lists it, by the windows switched off', () => tx(async (h) => {
  const w = await world(h);
  const pin = async () => { await exact(h, w.ids.C, w.day, 960); assert.equal((await row(h, w.ids.C)).arrive_at, 960); };
  await pin();
  await h.rpc('move_job', { p_op: uuid(), p_job: w.ids.C, p_day: w.day, p_block: 'day', p_truck: null });
  assert.equal((await row(h, w.ids.C)).arrive_at, null, '5 arguments');
  await pin();
  const c = await row(h, w.ids.C);
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: w.ids.C, p_day: w.day, p_block: 'day', p_truck: w.tk, p_win_start: c.win_start, p_win_flex: false });
  assert.notEqual(m.unchanged, true, 'a pinned stop is never « unchanged » for a move without a minute');
  assert.equal((await row(h, w.ids.C)).arrive_at, null, '7 arguments, the same window and truck');
  inside(await row(h, w.ids.C), 'C, back to the planner');
  await pin();
  await stopOrder(h, w.tk, w.day, [w.ids.A, w.ids.B]);
  assert.equal((await row(h, w.ids.C)).arrive_at, 960, 'an order by hand that does not list it keeps it');
  assert.equal((await row(h, w.ids.C)).eta_min, 960);
  await stopOrder(h, w.tk, w.day, [w.ids.C, w.ids.A]);
  assert.equal((await row(h, w.ids.C)).arrive_at, null, 'an order by hand that lists it: the last action wins');
  await pin();
  assert.equal((await row(h, w.ids.A)).manual_order, 2, 'a move to a minute keeps that truck’s order by hand (verify-off H1: the others are planned as today)');
  await h.rpc('windows_switch', { p_op: uuid(), p_on: false });
  assert.equal(await h.val(`select count(*)::int from public.jobs where arrive_at is not null`), 0, 'the windows off: no pin left');
}));

test('blocks mode: the move goes to the block of that minute on its truck, nothing pinned, the answer says exact: false; the preview writes nothing', () => tx(async (h) => {
  const w = await world(h, { on: false, only: 'ABC', blocks: { A: 'am', B: 'am', C: 'pm' } });
  const c0 = await row(h, w.ids.C);
  assert.equal(c0.block, 'pm');
  const before = await h.q(`select id, block, stop_order, eta_min, updated_at from public.jobs where day = $1 order by id`, [w.day]);
  const p = await preview(h, w.ids.C, w.day, 570);
  assert.equal(p.exact, false); assert.equal(p.changed, true);
  assert.deepEqual(await h.q(`select id, block, stop_order, eta_min, updated_at from public.jobs where day = $1 order by id`, [w.day]), before, 'the preview wrote nothing');
  const r = await exact(h, w.ids.C, w.day, 570);
  assert.equal(r.ok, true); assert.equal(r.exact, false); assert.equal(r.changed, true);
  const c = await row(h, w.ids.C);
  assert.deepEqual([c.block, c.truck_id, c.arrive_at], ['am', c0.truck_id, null]);
  assert.equal(r.now.block, 'am');
}));

test('today, a stop under way: the move to a minute comes after it, at that minute; before the truck is free: « arrive_late » with the earliest', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const tk = await h.truck('Camion', null, WEEK);
  await server(h, null, `update public.trucks set active = false where id <> $1 and active`, [tk]);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  await server(h, owner, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select 600 $$`);
  const today = await h.val(`select public.local_today()::text`);
  const put = async (k, status, order, eta, ws) => {
    const c = await h.customer(k, ...P[k]);
    const id = uuid();
    await h.as(null);
    await h.q(`select set_config('garage.rpc', 'on', true)`);
    await h.q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min, win_start, win_end, win_flex, arrived_at)
      values ($1, $2, $3, 'day', $4, $5, 60, $6, $7, $8, $9, 10, $10, $11, false, $12)`,
      [id, c, today, tk, status, ...P[k], order, eta, ws, ws == null ? null : ws + 240, status === 'on_site' ? new Date(Date.now() - 10 * 60000) : null]);
    await h.q(`select set_config('garage.rpc', '', true)`);
    await h.as(owner);
    return id;
  };
  const s = await put('A', 'on_site', 1, 590, 480);
  const u1 = await put('B', 'booked', 2, 720, 720);
  const u2 = await put('G', 'booked', 3, 840, 840);
  const e = await h.fails(() => exact(h, u2, today, 610));
  assert.equal(e?.hint, 'arrive_late', 'the truck is still at A until about 10:50');
  const d = JSON.parse(e.detail);
  assert.ok(d.earliest >= 650, `earliest ${hm(d.earliest)}`);
  const r = await exact(h, u2, today, 690, { lateOk: [u1] });
  assert.equal(r.ok, true);
  const j = await row(h, u2);
  assert.deepEqual([j.eta_min, j.arrive_at], [690, 690]);
  const on = await h.q(`select id, stop_order, status from public.jobs where day = $1 and truck_id = $2 order by stop_order`, [today, tk]);
  assert.deepEqual(on.map((x) => x.id), [s, u2, u1], 'after the stop under way, which keeps its place');
  assert.equal((await row(h, s)).status, 'on_site');
  inside(await row(h, u1), 'B');
}));

test('two moves at once (two connections): the second waits, then judges the day as the first left it (« late_changed »: the stop just pinned would be late)', async () => {
  // verify-off M2: the committed world is ITS OWN rows only. No windows_switch is committed (it would turn every coming
  // appointment of the shared database into window mode): the setting windows_on alone is flipped for the length of the test
  // (it plans nothing by itself: plan_inputs does not read it) and put back as it was; every activity / op_log row this test
  // commits is collected (xmin of its own transactions, its own op ids) and only those are deleted
  const c = await pool.connect();
  const opened = [];
  const ops = [];
  const acts = [];
  const op = () => { const x = randomUUID(); ops.push(x); return x; };
  const mine = async (k) => { for (const r of (await k.query(`select id from public.activity where xmin = pg_current_xact_id()::xid`)).rows) acts.push(r.id); };
  const owner = randomUUID(), truck = randomUUID();
  const cust = Object.fromEntries(Object.keys(P).map((k) => [k, randomUUID()]));
  let flipped = false, was;
  const flag = async (on) => {
    await c.query('begin');
    await c.query(`select set_config('garage.windows', 'on', true)`);
    if (on) await c.query(`update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{windows_on}', 'true') where id = 1`);
    else await c.query(`update public.settings set booking = case when $1::jsonb is null then booking - 'windows_on' else jsonb_set(booking, '{windows_on}', $1::jsonb) end where id = 1`, [was === undefined ? null : JSON.stringify(was)]);
    await c.query(`delete from public.activity where xmin = pg_current_xact_id()::xid`);
    await c.query('commit');
  };
  try {
    await c.query('begin');
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Hassan Exact', 'Hassan', '{owner}', '{}', $2)`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.trucks (id, name, active, sort) values ($1, 'Camion Exact', true, 0)`, [truck]);
    for (let d = 0; d < 7; d++) await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [truck, d, JSON.stringify(DAY)]);
    for (const [k, id] of Object.entries(cust)) await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, $2, 'Exact', '5145550000', $3, $4, '1 rue Test')`, [id, k, ...P[k]]);
    await mine(c);
    await c.query('commit');
    was = (await c.query(`select booking->'windows_on' w from public.settings where id = 1`)).rows[0]?.w ?? undefined;
    if (was === null) was = undefined;
    const day = (await c.query(`select (public.local_today() + 33)::text d`)).rows[0].d;
    const open = async () => {
      const k = await pool.connect(); opened.push(k);
      await k.query('begin');
      await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' }), owner]);
      await k.query('set local role authenticated');
      return k;
    };
    await flag(true); flipped = true;
    const k0 = await open();
    const ids = {};
    for (const [k, ws] of [['A', 480], ['B', 600], ['C', 720], ['D', 840]]) {
      ids[k] = (await k0.query(`select public.book_job(p_op => $1, p_job => $2::jsonb, p_items => '[]'::jsonb) as r`,
        [op(), JSON.stringify({ customer_id: cust[k], day, block: 'day', duration_min: 60, win_start: ws, truck_id: truck })])).rows[0].r.job_id;
    }
    await k0.query('reset role'); await mine(k0);
    await k0.query('commit');
    const move = `select public.move_job(p_op => $1, p_job => $2, p_day => $3::date, p_block => 'day', p_truck => null, p_win_start => null, p_win_flex => null, p_exact => $4::jsonb) as r`;
    // alone, D at 9:30 would go first and push A inside its window: nobody late (tried, then rolled back)
    const k3 = await open();
    const alone = (await k3.query(move, [op(), ids.D, day, JSON.stringify({ at: 570, late_ok: [] })])).rows[0].r;
    assert.equal(alone.ok, true);
    await k3.query('rollback');
    const k1 = await open(), k2 = await open();
    assert.equal((await k1.query(move, [op(), ids.C, day, JSON.stringify({ at: 540, late_ok: Object.values(ids) })])).rows[0].r.ok, true);
    const p2 = k2.query(move, [op(), ids.D, day, JSON.stringify({ at: 570, late_ok: [] })]);
    assert.equal(await within(p2, 400), 'waiting', 'the second waits for the first');
    await k1.query('reset role'); await mine(k1);
    await k1.query('commit');
    const e = await p2.then(() => null, (x) => x);
    assert.equal(e?.hint, 'late_changed', 'then it sees C pinned at 9:00 would be late');
    assert.ok(JSON.parse(e.detail).late.map((x) => x.id).includes(ids.C), 'C (pinned at 9:00) is named among the late: ' + e.detail);
    await k2.query('rollback');
    await flag(false); flipped = false;
    const cRow = (await c.query(`select eta_min, arrive_at from public.jobs where id = $1`, [ids.C])).rows[0];
    assert.deepEqual([cRow.eta_min, cRow.arrive_at], [540, 540], 'where the first put it');
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    if (flipped) await flag(false).catch(() => c.query('rollback'));
    // its own rows only, in one transaction whose own activity rows (the deletes are logged) go too
    await c.query('begin');
    await c.query(`select set_config('garage.rpc', 'on', true)`);
    await c.query(`delete from public.job_items where job_id in (select id from public.jobs where customer_id = any($1::uuid[]))`, [Object.values(cust)]);
    await c.query(`delete from public.jobs where customer_id = any($1::uuid[])`, [Object.values(cust)]);
    await c.query(`delete from public.customers where id = any($1::uuid[])`, [Object.values(cust)]);
    await c.query(`delete from public.truck_week where truck_id = $1`, [truck]);
    await c.query(`delete from public.trucks where id = $1`, [truck]);
    await c.query(`delete from public.op_log where op = any($1::uuid[])`, [ops]);
    await c.query(`delete from public.activity where id = any($1::bigint[]) or xmin = pg_current_xact_id()::xid`, [acts]);
    await c.query(`delete from public.staff where id = $1`, [owner]);
    await c.query(`delete from auth.users where id = $1`, [owner]);
    await c.query('commit');
    c.release();
  }
});
