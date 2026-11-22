// Part 28 « Réorganiser la journée » (REARRANGE.md §1.4, §1.7, §4; tests D1–D18 of §6.1): day_order_preview (written, judged,
// undone) and day_order_save (the same body, kept), the owner's « nothing changes until Enregistrer », every stop held to
// what its customer was told, the warn first, the basis, the rights, the locks; and Part 27 left untouched.
// Each test runs in a transaction rolled back at the end, but the two-connection ones (D12b, D13, D13b): their own
// committed rows, taken away after.
// The worlds put every stop at the truck's start (switch « Vraies routes » off, a trip between two same points is 0 min),
// so the arrivals are exact: 8 h + the waits and the work (5 min a stop + its length).
// Run: node --test tests/db/reorganiser.test.mjs (Mac: bash tests/stack/mac/db-tests.sh reorganiser)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tx, pool, uuid } from './helpers.mjs';

after(() => pool.end());

const HERE = [45.5150, -73.6400];
const FAR = { B: [45.5300, -73.6000], C: [45.4700, -73.5800], D: [45.5700, -73.7500], E: [45.5100, -73.6550], F: [45.4950, -73.6100], G: [45.5200, -73.6300], A: [45.5150, -73.6400] };
const DAY = [[480, 1200]];
const week = (r = DAY) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, r]));
const become = async (h, who) => { h.me = who ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const sval = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
const clock = (h, min) => server(h, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
/** settings.booking keys written as they are (the guards and the re-plan of a settings save left out: this transaction only) */
async function booking(h, keys) {
  await h.as(null);
  await h.q(`set local session_replication_role = replica`);
  await h.q(`update public.settings set booking = coalesce(booking, '{}'::jsonb) || $1::jsonb where id = 1`, [JSON.stringify(keys)]);
  await h.q(`set local session_replication_role = origin`);
  await h.as(h.me ?? null);
}
const row = async (h, id) => (await server(h, `select to_jsonb(j) r from public.jobs j where j.id = $1`, [id]))[0].r;
const winFor = async (h, eta) => { const r = (await server(h, `select * from public.win_for($1)`, [eta]))[0]; return [r.win_start, r.win_end]; };

/** a job written as the server writes it */
async function put(h, j) {
  const id = j.id ?? uuid();
  const r = { duration_min: 60, block: 'day', status: 'booked', ...j, id };
  const cols = Object.keys(r).map((k) => `"${k}"`).join(', ');
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  await h.q(`insert into public.jobs (${cols}) select ${cols} from jsonb_populate_record(null::public.jobs, $1::jsonb)`, [JSON.stringify(r)]);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await h.as(h.me ?? null);
  return id;
}
/** written as the server (the planner's own columns are closed to the app) */
async function set(h, id, cols) {
  const keys = Object.keys(cols);
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  await h.q(`update public.jobs set ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => cols[k])]);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await h.as(h.me ?? null);
}

/** The owner's garage: Hassan (owner), Lina (office), Saleh (mechanic, drives the Camion); the Camion (tire machine) and the
 *  Voiture (none), both 8 h – 20 h every day unless said; windows on; a day 37 days ahead (or o.day). Jobs: o.jobs =
 *  { key: { t: 'tk' | 'tk2' | null, ws, dur, at, ...columns } } in each truck's order; default: A 8–12, B 10–14, C 12–16,
 *  D 14–18 on the Camion, E 9–13, F 12–16 on the Voiture; every place HERE (o.far: each key its own place) */
async function world(h, o = {}) {
  await h.as(null);
  const owner = await h.person('Hassan Roy', ['owner'], { short_name: 'Hassan' });
  const office = await h.person('Lina Tremblay', ['office'], { short_name: 'Lina' });
  const saleh = await h.person('Saleh Ali', ['mechanic'], { short_name: 'Saleh' });
  // far enough that the browser tests' rows (a database not made fresh) are not on it
  const day = o.day ?? await h.val(`select (public.local_today() + 37)::text`);
  const tk = await h.truck('Camion', saleh, week(o.hours ?? DAY));
  const tk2 = await h.truck('Voiture', null, week(o.hours2 ?? DAY));
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [tk2]);
  await h.q(`update public.trucks set start = $2::jsonb where id = any($1::uuid[])`, [[tk, tk2], JSON.stringify({ label: 'Ici', lat: HERE[0], lng: HERE[1] })]);
  // the browser tests' vehicles (a database not made fresh) are left out of this rolled-back world
  await h.q(`update public.trucks set active = false where id <> all($1::uuid[]) and active`, [[tk, tk2]]);
  await become(h, owner);
  if (!o.blocks) assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const jobs = o.jobs ?? { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 600 }, C: { t: 'tk', ws: 720 }, D: { t: 'tk', ws: 840 }, E: { t: 'tk2', ws: 540 }, F: { t: 'tk2', ws: 720 } };
  const ids = {}, cust = {};
  const n = { tk: 0, tk2: 0 };
  await h.as(null);
  for (const [k, j] of Object.entries(jobs)) {
    const p = o.far ? FAR[k] ?? HERE : HERE;
    cust[k] = await h.customer(k, ...p);
    const { t, ws, dur, flex, ...rest } = j;
    const truck = t === 'tk' ? tk : t === 'tk2' ? tk2 : null;
    const order = t ? ++n[t] : null;
    ids[k] = await put(h, { customer_id: cust[k], day: rest.day ?? day, block: o.blocks ? (rest.block ?? 'am') : 'day', truck_id: truck, stop_order: order,
      win_start: o.blocks || flex ? null : ws, win_end: o.blocks || flex ? null : ws + 240, win_flex: !!flex, duration_min: dur ?? 60,
      lat: p[0], lng: p[1], eta_min: o.blocks ? null : ws, ...rest });
  }
  await become(h, owner);
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, office, saleh, day, tk, tk2, ids, name, cust, blocks: !!o.blocks };
}
/** what the phone would send: p_was of the listed trucks and their lists in the stored order */
async function basis(h, w, trucks = [w.tk, w.tk2], day = w.day) {
  const rows = await server(h, `select id, truck_id, block, stop_order, win_start, win_end, arrive_at, status from public.jobs
    where day = $1 and truck_id = any($2::uuid[]) and deleted_at is null and status in ('booked', 'en_route', 'on_site')
    order by stop_order nulls last, eta_min nulls last, id`, [day, trucks]);
  const was = Object.fromEntries(rows.map((r) => [r.id, [r.truck_id, r.block, r.stop_order, r.win_start, r.win_end, r.arrive_at, r.status]]));
  const keys = w.blocks ? ['am', 'pm', 'eve'] : ['day'];
  const lists = [];
  for (const t of trucks) for (const b of keys) lists.push({ truck: t, block: b, jobs: rows.filter((r) => r.truck_id === t && r.block === b && r.status === 'booked').map((r) => r.id) });
  return { was, lists };
}
/** the lists with one stop put on that truck (and block) at that place (0 = first) */
function moveIn(lists, id, truck, at, block = null) {
  const out = lists.map((l) => ({ ...l, jobs: l.jobs.filter((x) => x !== id) }));
  const l = out.find((x) => x.truck === truck && (block == null || x.block === block));
  l.jobs.splice(at < 0 ? l.jobs.length + 1 + at : at, 0, id);
  return out;
}
const J = (v) => (v == null ? null : JSON.stringify(v));
const preview = (h, day, lists, { moved = [], was = null, auto = false } = {}) =>
  h.val(`select public.day_order_preview($1::date, $2::jsonb, $3::uuid[], $4::jsonb, $5::boolean) v`, [day, J(lists), moved, J(was), auto]);
const save = (h, day, lists, { moved = [], was, auto = false, accept = {}, op = uuid() } = {}) =>
  h.val(`select public.day_order_save($1::uuid, $2::date, $3::jsonb, $4::uuid[], $5::jsonb, $6::boolean, $7::jsonb) v`, [op, day, J(lists), moved, J(was), auto, J(accept)]);
const stopOf = (r, id) => r.stops.find((s) => s.id === id);
/** everything that could have been written */
const snap = async (h, day) => JSON.stringify(await server(h, `select (select count(*) from public.jobs) jobs, (select count(*) from public.activity) act,
  (select count(*) from public.op_log) ops, (select max(updated_at) from public.jobs) upd,
  (select coalesce(jsonb_agg(to_jsonb(j) order by j.id), '[]'::jsonb) from public.jobs j where j.day = $1::date) rows`, [day]));
/** the sequences (never rolled back: a number spent by a preview would show) */
const seqs = (h) => server(h, `select (select last_value from public.activity_id_seq) act, (select last_value from public.job_number_seq) num`);
/** everything the coming days still want, measured (the switch-on cases): fn(pair) minutes */
async function measureAll(h, fn = () => 12) {
  for (let i = 0; i < 20; i++) {
    const w = await sval(h, `select public.drive_wanted(null, null, 120) v`);
    if (!w.total) return;
    await sval(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify(w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], fn(p), 5, 'tomtom']))]);
  }
  throw new Error('still something to measure');
}
async function roadsOn(h, w, fn) {
  await measureAll(h, fn);
  await become(h, w.owner);
  assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).on, true);
}
/** the oracle (D2): what the save wrote is what the preview said */
async function sameAsPreview(h, p, what) {
  for (const s of p.stops) {
    const r = await row(h, s.id);
    assert.equal(r.truck_id, s.truck_id, `${what}: truck of ${s.id}`);
    assert.equal(r.stop_order, s.order, `${what}: order`);
    assert.equal(r.eta_min, s.eta, `${what}: arrival`);
    assert.deepEqual([r.win_start, r.win_end], s.new_win ?? s.win ?? [null, null], `${what}: window`);
    assert.equal(r.arrive_at, s.pin, `${what}: minute pointed`);
    assert.equal(r.manual_order, null, `${what}: no order by hand`);
    if (p.roads) assert.equal(r.eta_measured, s.measured, `${what}: measured`);
  }
}

/* ------------------------------------------------------------------------------------------------------------------
   D1 — the preview writes nothing
   ------------------------------------------------------------------------------------------------------------------ */

test('D1 day_order_preview writes nothing (rows, activity, op_log, updated_at, the numbers spent), switch off and on', () => tx(async (h) => {
  const w = await world(h, { far: true });
  for (const on of [false, true]) {
    if (on) await roadsOn(h, w, () => 9);
    await become(h, w.owner);
    const b = await basis(h, w);
    const lists = moveIn(moveIn(b.lists, w.ids.D, w.tk, 0), w.ids.E, w.tk, -1);
    const before = await snap(h, w.day), s0 = await seqs(h);
    const p = await preview(h, w.day, lists, { moved: [w.ids.D, w.ids.E], was: b.was });
    assert.equal(p.ok, true); assert.equal(p.basis_ok, true); assert.equal(p.roads, on);
    assert.equal(stopOf(p, w.ids.E).truck_id, w.tk, 'judged on the Camion');
    assert.equal(await snap(h, w.day), before, `switch ${on ? 'on' : 'off'}: nothing written`);
    assert.deepEqual(await seqs(h), s0, 'no number spent (activity, jobs)');
    // the preview gave its lock_timeout back with everything else
    assert.notEqual(await h.val(`select current_setting('lock_timeout')`), '500ms');
  }
}));

/* ------------------------------------------------------------------------------------------------------------------
   D2 — the oracle: the save writes what the preview said
   ------------------------------------------------------------------------------------------------------------------ */

test('D2 the preview’s stops (arrival, new window, back, flexible fixed, minute lost, past hours) are what day_order_save then writes: switch off, on, and with a trip not measured', () => tx(async (h) => {
  const w = await world(h, { far: true });
  const run = async (what) => {
    await become(h, w.owner);
    const b = await basis(h, w);
    const lists = moveIn(moveIn(b.lists, w.ids.A, w.tk, -1), w.ids.F, w.tk, 1);
    const moved = [w.ids.A, w.ids.F];
    const p = await preview(h, w.day, lists, { moved, was: b.was });
    assert.equal(p.ok, true, what);
    const s = await save(h, w.day, lists, { moved, was: b.was, accept: p.accept });
    assert.equal(s.saved, true, what);
    const strip = (x) => JSON.stringify({ ...x, saved: undefined, rows: undefined, due_after: undefined });
    assert.equal(strip(s), strip(p), `${what}: the save's answer is the preview's`);
    await sameAsPreview(h, p, what);
    assert.ok(s.rows.jobs.some((x) => x.id === w.ids.A), 'the day’s rows come back');
    return p;
  };
  const off = await run('switch off');
  assert.equal(stopOf(off, w.ids.A).measured, null, 'off: « measured » not said');
  assert.ok(stopOf(off, w.ids.A).new_win, 'A, last, gets the window of its arrival');
  await roadsOn(h, w, (p) => 8 + Math.round(Math.abs(p[0] - p[2]) * 300));
  const on = await run('switch on');
  assert.ok(on.stops.every((x) => x.measured === true), 'every trip measured');
  // a trip not measured: B's place has no time at all any more
  await server(h, `delete from public.drive_times where a = public.drive_key($1, $2) or b = public.drive_key($1, $2)`, FAR.B);
  const un = await run('a trip not measured');
  const sb = stopOf(un, w.ids.B);
  assert.equal(sb.measured, false, 'B: not measured');
  for (const x of un.stops.filter((y) => y.measured === false)) {
    assert.deepEqual([x.new_win, x.late_min, x.early_min, x.flex_fixed], [null, null, null, false], 'never cut, never late from a guess');
  }
}));

/* ------------------------------------------------------------------------------------------------------------------
   D3 — all or nothing
   ------------------------------------------------------------------------------------------------------------------ */

test('D3 all or nothing: tire work put on the car → needs_truck, nothing written; a stop put on the Voiture (8 h – 12 h) that ends after 12 h → truck_ends { truck, ends: 720, jobs }; on its own truck: over_min, saved once accepted', () => tx(async (h) => {
  const w = await world(h, { hours2: [[480, 720]], jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 600 }, C: { t: 'tk', ws: 720 }, D: { t: 'tk', ws: 840, dur: 120 }, E: { t: 'tk2', ws: 540 } } });
  await set(h, w.ids.B, { needs_machine: true });
  const b = await basis(h, w);
  const before = await snap(h, w.day);
  // the Camion reordered, E brought over, and B (tire work) sent to the car
  let lists = moveIn(moveIn(moveIn(b.lists, w.ids.D, w.tk, 0), w.ids.E, w.tk, -1), w.ids.B, w.tk2, 0);
  let e = await h.fails(() => save(h, w.day, lists, { moved: [w.ids.D, w.ids.E, w.ids.B], was: b.was }));
  assert.equal(e?.hint, 'needs_truck');
  assert.deepEqual(JSON.parse(e.detail).jobs, [w.ids.B]);
  assert.equal((await h.fails(() => preview(h, w.day, lists, { moved: [w.ids.B], was: b.was })))?.hint, 'needs_truck', 'the preview says it too');
  assert.equal(await snap(h, w.day), before, 'every row as before');
  // D on the Voiture after E: E 9 h – 10 h 05, D 10 h 05 + 5 + 120 = 12 h 10, after the Voiture's 12 h
  lists = moveIn(b.lists, w.ids.D, w.tk2, -1);
  e = await h.fails(() => preview(h, w.day, lists, { moved: [w.ids.D], was: b.was }));
  assert.equal(e?.hint, 'truck_ends');
  assert.deepEqual(JSON.parse(e.detail), { truck: w.tk2, ends: 720, jobs: [w.ids.D] });
  assert.match(e.message, /^Voiture finit à 12 h ce jour-là : D n’y entre pas\.$/);
  assert.equal((await h.fails(() => save(h, w.day, lists, { moved: [w.ids.D], was: b.was })))?.hint, 'truck_ends');
  assert.equal(await snap(h, w.day), before);
  // on its own truck: E made long, past the Voiture's hours → said (over_min), saved after « Enregistrer quand même »
  await set(h, w.ids.E, { duration_min: 200 });
  const b2 = await basis(h, w);
  lists = moveIn(b2.lists, w.ids.C, w.tk, 1);
  const p = await preview(h, w.day, lists, { moved: [w.ids.C], was: b2.was });
  const tv = p.trucks.find((t) => t.id === w.tk2);
  assert.deepEqual([tv.hours_end, tv.finish, tv.over_min], [720, 540 + 5 + 200, 25]);
  assert.deepEqual(p.accept.over, { [w.tk2]: 25 });
  assert.equal((await h.fails(() => save(h, w.day, lists, { moved: [w.ids.C], was: b2.was })))?.hint, 'outcome_changed');
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.C], was: b2.was, accept: p.accept })).saved, true);
}));

test('D3b tire work ALREADY on the Voiture that nobody moves (a « montage » line added while it stayed there): the day is previewed and saved; only a stop PUT on the Voiture is refused (review S3)', () => tx(async (h) => {
  const w = await world(h, { jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk2', ws: 540 }, C: { t: 'tk2', ws: 600 }, D: { t: 'tk', ws: 840 } } });
  await set(h, w.ids.B, { needs_machine: true });
  const b = await basis(h, w);
  // nothing changed
  const p0 = await preview(h, w.day, b.lists, { was: b.was });
  assert.equal(p0.ok, true);
  // C put before B on the same Voiture: B stays where it is
  const lists = moveIn(b.lists, w.ids.C, w.tk2, 0);
  const p = await preview(h, w.day, lists, { moved: [w.ids.C], was: b.was });
  assert.equal(p.ok, true, 'previewed');
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.C], was: b.was, accept: p.accept })).saved, true, 'saved');
  // tire work PUT on the Voiture: still refused
  await set(h, w.ids.D, { needs_machine: true });
  const b2 = await basis(h, w);
  const e = await h.fails(() => preview(h, w.day, moveIn(b2.lists, w.ids.D, w.tk2, -1), { moved: [w.ids.D], was: b2.was }));
  assert.equal(e?.hint, 'needs_truck');
  assert.deepEqual(JSON.parse(e.detail).jobs, [w.ids.D], 'only the stop put there');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D4 — coverage and the list itself
   ------------------------------------------------------------------------------------------------------------------ */

test('D4 a booked stop of a listed truck left out, a stop of another day, an « À placer » → changed; an id twice, a truck twice, no basis → bad_list; nothing written', () => tx(async (h) => {
  const w = await world(h);
  const other = await h.val(`select (public.local_today() + 38)::text`);
  const away = await put(h, { customer_id: w.cust.A, day: other, truck_id: w.tk, stop_order: 1, win_start: 480, win_end: 720, lat: HERE[0], lng: HERE[1] });
  const loose = await put(h, { customer_id: w.cust.B, day: w.day, truck_id: null, win_start: 480, win_end: 720, lat: HERE[0], lng: HERE[1] });
  const b = await basis(h, w);
  const before = await snap(h, w.day);
  const missing = b.lists.map((l) => ({ ...l, jobs: l.jobs.filter((x) => x !== w.ids.C) }));
  let e = await h.fails(() => save(h, w.day, missing, { was: b.was }));
  assert.equal(e?.hint, 'changed'); assert.deepEqual(JSON.parse(e.detail), { missing: [w.ids.C], extra: [] });
  for (const extra of [away, loose]) {
    e = await h.fails(() => preview(h, w.day, moveIn(b.lists, extra, w.tk, 0), { was: b.was }));
    assert.equal(e?.hint, 'changed'); assert.deepEqual(JSON.parse(e.detail), { missing: [], extra: [extra] });
  }
  const twice = b.lists.map((l, i) => (i === 0 ? { ...l, jobs: [...l.jobs, w.ids.A] } : l));
  assert.equal((await h.fails(() => save(h, w.day, twice, { was: b.was })))?.hint, 'bad_list');
  assert.equal((await h.fails(() => save(h, w.day, [...b.lists, b.lists[0]], { was: b.was })))?.hint, 'bad_list');
  assert.equal((await h.fails(() => save(h, w.day, b.lists, { was: null })))?.hint, 'bad_list', 'a save with no basis');
  assert.equal((await h.fails(() => save(h, w.day, [{ truck: w.tk, block: 'day', jobs: ['pas-un-id'] }], { was: b.was })))?.hint, 'bad_list');
  assert.equal((await h.fails(() => save(h, w.day, [{ truck: w.tk, block: 'am', jobs: [] }], { was: b.was })))?.hint, 'bad_block', 'windows mode: the day only');
  const past = await h.val(`select (public.local_today() - 1)::text`);
  assert.equal((await h.fails(() => preview(h, past, b.lists)))?.hint, 'past');
  assert.equal((await h.fails(() => preview(h, w.day, null)))?.hint, 'bad_list', 'no lists without « Laisser l’app choisir »');
  assert.equal(await snap(h, w.day), before, 'nothing written');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D5 — the stops under way stay first
   ------------------------------------------------------------------------------------------------------------------ */

test('D5 today: the stops done and under way stay first, never moved; the order starts after their highest number; the walk starts from now', () => tx(async (h) => {
  const today = await h.val(`select public.local_today()::text`);
  const w = await world(h, { day: today, jobs: {} });
  await clock(h, 600);
  const c = w.cust.A ?? await server(h, `select id from public.customers limit 1`).then((r) => r[0]?.id);
  await h.as(null);
  const cu = await h.customer('Z', ...HERE);
  await become(h, w.owner);
  const done = await put(h, { customer_id: cu, day: today, truck_id: w.tk, stop_order: 1, status: 'done', win_start: 480, win_end: 720, lat: HERE[0], lng: HERE[1], finished_at: new Date().toISOString() });
  const site = await put(h, { customer_id: cu, day: today, truck_id: w.tk, stop_order: 2, status: 'on_site', win_start: 480, win_end: 720, lat: HERE[0], lng: HERE[1],
    arrived_at: new Date(Date.now() - 10.5 * 60000).toISOString() });
  const y1 = await put(h, { customer_id: cu, day: today, truck_id: w.tk, stop_order: 3, win_start: 720, win_end: 960, lat: HERE[0], lng: HERE[1] });
  const y2 = await put(h, { customer_id: cu, day: today, truck_id: w.tk, stop_order: 4, win_start: 840, win_end: 1080, lat: HERE[0], lng: HERE[1] });
  void c;
  const b = await basis(h, w, [w.tk], today);
  assert.deepEqual(b.lists[0].jobs, [y1, y2]);
  const lists = [{ truck: w.tk, block: 'day', jobs: [y2, y1] }];
  const p = await preview(h, today, lists, { moved: [y2], was: b.was });
  const s = await save(h, today, lists, { moved: [y2], was: b.was, accept: p.accept });
  assert.equal(s.saved, true);
  const [rd, rs, r1, r2] = [await row(h, done), await row(h, site), await row(h, y1), await row(h, y2)];
  assert.deepEqual([rd.stop_order, rd.status, rs.stop_order, rs.status], [1, 'done', 2, 'on_site'], 'never moved');
  assert.deepEqual([r2.stop_order, r1.stop_order], [3, 4], 'after their highest number');
  assert.equal(r2.eta_min, 650, 'from now (10 h) + the 50 min left on site');
  assert.equal(r1.eta_min, 720, 'Y1 waits for its window');
  assert.deepEqual([r2.win_start, r2.win_end], await winFor(h, 650), 'Y2 dragged first: the window of its arrival');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D6 — order by hand, trucks, minutes pointed
   ------------------------------------------------------------------------------------------------------------------ */

test('D6 after a save: no order by hand; truck_pinned only where the truck changed; a minute kept when it holds, lost when pushed past it; a DRAGGED stop with a minute: pin_lost + pin_moved, refused unless accepted', () => tx(async (h) => {
  const w = await world(h, { jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 600, arrive_at: 660 }, C: { t: 'tk', ws: 720, arrive_at: 730 },
    D: { t: 'tk', ws: 840, arrive_at: 900, dur: 120 }, E: { t: 'tk2', ws: 540 }, F: { t: 'tk2', ws: 720 } } });
  await set(h, w.ids.A, { manual_order: 1 });
  const b = await basis(h, w);
  // D between B and C; F brought to the Camion's end
  const lists = moveIn(moveIn(b.lists, w.ids.D, w.tk, 2), w.ids.F, w.tk, -1);
  const moved = [w.ids.D, w.ids.F];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const [sa, sb, sd, sc, sf] = [w.ids.A, w.ids.B, w.ids.D, w.ids.C, w.ids.F].map((id) => stopOf(p, id));
  assert.deepEqual([sa.eta, sb.eta, sd.eta, sc.eta, sf.eta], [480, 660, 725, 850, 915], 'A 8 h, B at its 11 h, D right after, C pushed, F last');
  assert.deepEqual([sb.pin, sb.pin_lost], [660, null], 'B keeps its minute');
  assert.deepEqual([sd.pin, sd.pin_lost, sd.pin_moved], [null, 900, true], 'D dragged: its minute goes, said');
  assert.deepEqual([sc.pin, sc.pin_lost, sc.pin_moved], [null, 730, false], 'C pushed past 12 h 10: its minute no longer holds');
  assert.deepEqual(p.accept.pins, { [w.ids.D]: 900, [w.ids.C]: 730 });
  assert.deepEqual(sd.new_win, await winFor(h, 725));
  const noPin = { ...p.accept, pins: { [w.ids.C]: 730 } };
  const e = await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: noPin }));
  assert.equal(e?.hint, 'outcome_changed', 'the dragged stop’s minute was not accepted');
  assert.deepEqual(JSON.parse(e.detail).accept, p.accept, 'the refusal carries the whole answer');
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: p.accept })).saved, true);
  for (const k of ['A', 'B', 'C', 'D', 'F']) assert.equal((await row(h, w.ids[k])).manual_order, null, `${k}: no order by hand`);
  assert.deepEqual([(await row(h, w.ids.F)).truck_pinned, (await row(h, w.ids.A)).truck_pinned, (await row(h, w.ids.E)).truck_pinned], [true, false, false]);
  assert.deepEqual([(await row(h, w.ids.B)).arrive_at, (await row(h, w.ids.C)).arrive_at, (await row(h, w.ids.D)).arrive_at], [660, null, null]);
  assert.equal((await row(h, w.ids.F)).vehicle_kind, 'truck', 'its kind follows the vehicle');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D7 — a stop not dragged is never planned early
   ------------------------------------------------------------------------------------------------------------------ */

test('D7 a stop NOT dragged, after a dragged one, never arrives before its window — a « quand même » one too; the one dragged first arrives early and gets the window of its arrival', () => tx(async (h) => {
  const w = await world(h, { jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 600 }, C: { t: 'tk', ws: 720, forced: true }, D: { t: 'tk', ws: 840 } } });
  const b = await basis(h, w, [w.tk]);
  const lists = moveIn(b.lists, w.ids.D, w.tk, 0);
  const p = await preview(h, w.day, lists, { moved: [w.ids.D], was: b.was });
  const s = Object.fromEntries(['A', 'B', 'C', 'D'].map((k) => [k, stopOf(p, w.ids[k])]));
  assert.deepEqual([s.D.eta, s.A.eta, s.B.eta, s.C.eta], [480, 545, 610, 720], 'D 8 h; A 8 h 05 (after D); B after A; C waits for 12 h');
  for (const k of ['A', 'B', 'C']) assert.ok(s[k].eta >= s[k].win[0], `${k} not before its window`);
  assert.deepEqual(s.D.new_win, await winFor(h, 480), 'D: 8 h à 12 h');
  assert.equal(s.D.win_back, false);
  assert.deepEqual(p.accept.windows, { [w.ids.D]: 480 });
  assert.deepEqual([s.A.new_win, s.B.new_win, s.C.new_win], [null, null, null], 'the others keep theirs');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D8 — the windows at « Enregistrer » (R5b), judged against what each customer was TOLD
   ------------------------------------------------------------------------------------------------------------------ */

test('D8 pushed past its window → the window of its arrival; still inside → kept; « plages fixes » (rewin false) → nothing re-cut, late_min said, hand_at', () => tx(async (h) => {
  const w = await world(h);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.A, w.tk, -1);
  const p = await preview(h, w.day, lists, { moved: [w.ids.A], was: b.was });
  const sa = stopOf(p, w.ids.A);
  assert.equal(sa.eta, 905, 'A after D: 15 h 05');
  assert.deepEqual(sa.new_win, [840, 1080]); assert.equal(sa.win_back, false);
  for (const k of ['B', 'C', 'D']) assert.equal(stopOf(p, w.ids[k]).new_win, null, `${k} inside: kept`);
  assert.equal(p.rewin, true);
  // the switch « les plages ne bougent jamais »
  await booking(h, { rewin: false });
  const q = await preview(h, w.day, lists, { moved: [w.ids.A], was: b.was });
  const qa = stopOf(q, w.ids.A);
  assert.deepEqual([q.rewin, qa.new_win, qa.late_min], [false, null, 905 - 720]);
  assert.deepEqual(q.accept.windows, {}); assert.deepEqual(q.accept.late, { [w.ids.A]: 185 });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.A], was: b.was, accept: q.accept })).saved, true);
  const ra = await row(h, w.ids.A);
  assert.deepEqual([ra.win_start, ra.win_end], [480, 720], 'no window written');
  assert.notEqual(ra.hand_at, null, 'moved out of his window by hand: not a slip');
  assert.equal((await row(h, w.ids.B)).hand_at, null);
}));

test('D8 flexible: tomorrow after 18 h → its window at the save (win_flex kept); 3 days ahead → stays flexible (flex_later)', () => tx(async (h) => {
  const tomorrow = await h.val(`select (public.local_today() + 1)::text`);
  for (const [day, at, want] of [[tomorrow, 1100, 'fixed'], [await h.val(`select (public.local_today() + 3)::text`), 1100, 'later'], [tomorrow, 900, 'later']]) {
    await h.c.query('savepoint d');
    const w = await world(h, { day, jobs: { A: { t: 'tk', ws: 480 }, G: { t: 'tk', ws: 600, flex: true }, B: { t: 'tk', ws: 720 } } });
    await clock(h, at);
    const b = await basis(h, w, [w.tk]);
    const lists = moveIn(b.lists, w.ids.G, w.tk, 0);
    const p = await preview(h, day, lists, { moved: [w.ids.G], was: b.was });
    const sg = stopOf(p, w.ids.G);
    assert.equal(sg.eta, 480);
    if (want === 'fixed') {
      assert.deepEqual([sg.flex_fixed, sg.flex_later, sg.new_win], [true, false, await winFor(h, 480)]);
      assert.deepEqual(p.accept.flex, { [w.ids.G]: 480 }); assert.deepEqual(p.accept.windows, {});
      assert.equal((await h.fails(() => save(h, day, lists, { moved: [w.ids.G], was: b.was, accept: { ...p.accept, flex: {} } })))?.hint, 'outcome_changed');
      assert.equal((await save(h, day, lists, { moved: [w.ids.G], was: b.was, accept: p.accept })).saved, true);
      const rg = await row(h, w.ids.G);
      assert.deepEqual([rg.win_start, rg.win_end, rg.win_flex], [480, 720, true]);
    } else {
      assert.deepEqual([sg.flex_fixed, sg.flex_later, sg.new_win], [false, true, null], `${day} at ${at}: « sa plage se fixe la veille à 18 h »`);
      assert.equal((await save(h, day, lists, { moved: [w.ids.G], was: b.was, accept: p.accept })).saved, true);
      assert.equal((await row(h, w.ids.G)).win_start, null);
    }
    await h.c.query('rollback to savepoint d');
  }
}));

test('D8 TOLD: told 9 h à 13 h, planned 13 h à 17 h by an earlier save: a save not dragging her holds her to 9 h, arrival inside → win_back, the window put back, nothing to send; dragged first → a NEW window; « avant » 0: the window of her arrival misses it → early_min', () => tx(async (h) => {
  const w = await world(h, { jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 780 }, C: { t: 'tk', ws: 840 } } });
  await set(h, w.ids.B, { told_day: w.day, told_start: 540, told_end: 780, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms' });
  let b = await basis(h, w, [w.tk]);
  const p = await preview(h, w.day, b.lists, { was: b.was });
  const sb = stopOf(p, w.ids.B);
  assert.equal(sb.eta, 545, 'held to the window she was told (9 h), right after A');
  assert.deepEqual([sb.win, sb.new_win, sb.win_back], [[780, 1020], [540, 780], true]);
  assert.deepEqual(p.accept.windows, {}, 'back to what she was told: not a warning');
  assert.equal((await save(h, w.day, b.lists, { was: b.was, accept: {} })).saved, true, 'saved with nothing to accept');
  let rb = await row(h, w.ids.B);
  assert.deepEqual([rb.win_start, rb.win_end], [540, 780]);
  assert.equal(await sval(h, `select public.tell_state(j) from public.jobs j where j.id = $1`, [w.ids.B]), 'ok', 'nothing to send');
  // the same planned / told gap, and now she is dragged first: 8 h, outside what she was told → a new window
  await set(h, w.ids.B, { win_start: 780, win_end: 1020 });
  b = await basis(h, w, [w.tk]);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 0);
  const q = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  const qb = stopOf(q, w.ids.B);
  assert.deepEqual([qb.eta, qb.new_win, qb.win_back], [480, [480, 720], false]);
  assert.deepEqual(q.accept.windows, { [w.ids.B]: 480 });
  // « avant » 0, « après » 180, round 60: A made 90 min, C dragged after it arrives 9 h 35 → 10 h à 13 h, 25 min early
  await booking(h, { win_before_min: 0, win_after_min: 180, win_round_min: 60 });
  await set(h, w.ids.A, { duration_min: 90 });
  b = await basis(h, w, [w.tk]);
  const l2 = moveIn(b.lists, w.ids.C, w.tk, 1);
  const r = await preview(h, w.day, l2, { moved: [w.ids.C], was: b.was });
  const rc = stopOf(r, w.ids.C);
  assert.equal(rc.eta, 575);
  assert.deepEqual([rc.new_win, rc.early_min], [[600, 780], 25]);
  assert.deepEqual([r.accept.windows[w.ids.C], r.accept.early[w.ids.C]], [600, 25]);
  rb = await row(h, w.ids.B); void rb;
}));

test('D8 TOLD, pulled EARLIER by a first save: a second save that does not drag it keeps it at its planned start (never held to a later told start: the truck would idle and the stops after it be re-cut); it stays owed its new window (review R1)', () => tx(async (h) => {
  const w = await world(h);
  for (const [k, ws] of [['A', 480], ['B', 600], ['C', 720], ['D', 840], ['E', 540], ['F', 720]]) {
    await set(h, w.ids[k], { told_day: w.day, told_start: ws, told_end: ws + 240, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms' });
  }
  // save 1: D (told 14 h à 18 h) dragged first → 8 h à 12 h, not texted yet
  let b = await basis(h, w);
  let lists = moveIn(b.lists, w.ids.D, w.tk, 0);
  const p1 = await preview(h, w.day, lists, { moved: [w.ids.D], was: b.was });
  assert.deepEqual(p1.accept.windows, { [w.ids.D]: 480 });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.D], was: b.was, accept: p1.accept })).saved, true);
  // save 2: only B onto the Voiture
  b = await basis(h, w);
  lists = moveIn(b.lists, w.ids.B, w.tk2, -1);
  const p2 = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  const sd = stopOf(p2, w.ids.D), sa = stopOf(p2, w.ids.A), sc = stopOf(p2, w.ids.C);
  assert.deepEqual([sd.eta, sd.win, sd.new_win, sd.win_back], [480, [480, 720], null, false], 'D at 8 h, its planned window kept');
  assert.deepEqual([sa.eta, sa.new_win, sc.eta, sc.new_win], [545, null, 720, null], 'A and C keep their windows');
  assert.deepEqual(p2.accept.windows, {}, 'nobody re-cut');
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p2.accept })).saved, true);
  assert.equal(await sval(h, `select public.tell_state(j) from public.jobs j where j.id = $1`, [w.ids.D]), 'changed', 'D still owed 8 h à 12 h');
  for (const k of ['A', 'C']) assert.equal(await sval(h, `select public.tell_state(j) from public.jobs j where j.id = $1`, [w.ids[k]]), 'ok', `${k}: nothing to send`);
}));

/* ------------------------------------------------------------------------------------------------------------------
   D9 / D10 — what a later automatic plan does to a saved day (§1.7)
   ------------------------------------------------------------------------------------------------------------------ */

test('D9 the evening lock after a save of tomorrow after 18 h has nothing to fix and leaves the order; after a save 3 days ahead (flexible kept) it fixes them', () => tx(async (h) => {
  const tomorrow = await h.val(`select (public.local_today() + 1)::text`);
  let w = await world(h, { day: tomorrow, jobs: { A: { t: 'tk', ws: 480 }, G: { t: 'tk', ws: 600, flex: true }, B: { t: 'tk', ws: 720 } } });
  await clock(h, 1100);
  let b = await basis(h, w, [w.tk]);
  let lists = moveIn(b.lists, w.ids.G, w.tk, 2);
  let p = await preview(h, tomorrow, lists, { moved: [w.ids.G], was: b.was });
  assert.equal((await save(h, tomorrow, lists, { moved: [w.ids.G], was: b.was, accept: p.accept })).saved, true);
  const orders = async () => (await server(h, `select id, stop_order from public.jobs where day = $1 and truck_id = $2 order by id`, [w.day, w.tk]));
  const o1 = await orders();
  const lock = await sval(h, `select public.lock_windows_core($1::date) v`, [tomorrow]);
  assert.equal(lock.fixed, 0, 'nothing left to fix');
  assert.deepEqual(await orders(), o1, 'the order as saved');
  // 3 days ahead: the flexible one stays flexible; the lock (as the evening before) gives it its window
  const d3 = await h.val(`select (public.local_today() + 3)::text`);
  await h.as(null);
  const c = await h.customer('H', ...HERE);
  await become(h, w.owner);
  const f3 = await put(h, { customer_id: c, day: d3, truck_id: w.tk, stop_order: 1, win_flex: true, lat: HERE[0], lng: HERE[1] });
  const a3 = await put(h, { customer_id: c, day: d3, truck_id: w.tk, stop_order: 2, win_start: 600, win_end: 840, lat: HERE[0], lng: HERE[1] });
  b = await basis(h, w, [w.tk], d3);
  lists = [{ truck: w.tk, block: 'day', jobs: [a3, f3] }];
  p = await preview(h, d3, lists, { moved: [f3], was: b.was });
  assert.equal(stopOf(p, f3).flex_later, true);
  assert.equal((await save(h, d3, lists, { moved: [f3], was: b.was, accept: p.accept })).saved, true);
  assert.equal((await row(h, f3)).win_start, null);
  const lock3 = await sval(h, `select public.lock_windows_core($1::date) v`, [d3]);
  assert.equal(lock3.fixed, 1, 'the evening lock fixes it (and plans that day: the cost said in Q4)');
  assert.notEqual((await row(h, f3)).win_start, null);
  void w;
}));

test('D10 after a save, a booking next door to stop 2 is placed between the stops (not only at the end) and every saved window holds', () => tx(async (h) => {
  const w = await world(h, { far: true, jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 540 }, C: { t: 'tk', ws: 840 } } });
  const b = await basis(h, w, [w.tk]);
  const lists = moveIn(b.lists, w.ids.C, w.tk, 2);
  const p = await preview(h, w.day, lists, { was: b.was });
  assert.equal((await save(h, w.day, lists, { was: b.was, accept: p.accept })).saved, true);
  await h.as(null);
  const near = await h.customer('Voisin', FAR.B[0] + 0.0005, FAR.B[1]);
  await become(h, w.owner);
  const lateBefore = Number(await sval(h, `select count(*) from public.activity where action = 'window_late'`));
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: near, day: w.day, block: 'day', duration_min: 30, win_start: 600, truck_id: w.tk }, p_items: [] });
  assert.equal(r.ok, true);
  const order = (await server(h, `select id, stop_order, eta_min, win_start, win_end from public.jobs where day = $1 and truck_id = $2 and status = 'booked' order by stop_order`, [w.day, w.tk]));
  const at = order.findIndex((x) => x.id === r.job_id);
  assert.ok(at >= 0 && at < order.length - 1, `placed between the stops (${at + 1} of ${order.length}), not only at the end`);
  for (const x of order) assert.ok(x.eta_min >= x.win_start && x.eta_min <= x.win_end, `every window holds (${x.eta_min} in ${x.win_start}–${x.win_end})`);
  assert.equal(Number(await sval(h, `select count(*) from public.activity where action = 'window_late'`)), lateBefore, 'no window_late');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D11 — warn first
   ------------------------------------------------------------------------------------------------------------------ */

test('D11 warn first: a new window not accepted → outcome_changed with the answer; fewer consequences than accepted → saved; another start → refused; late accepted 7 min under what the save finds → refused, 3 min under → saved', () => tx(async (h) => {
  const w = await world(h);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.A, w.tk, -1);
  const moved = [w.ids.A];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  let e = await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: {} }));
  assert.equal(e?.hint, 'outcome_changed');
  const d = JSON.parse(e.detail);
  assert.deepEqual(d.accept, p.accept); assert.ok(Array.isArray(d.stops) && d.stops.length === p.stops.length, 'the screen redraws from it');
  e = await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: { ...p.accept, windows: { [w.ids.A]: 780 } } }));
  assert.equal(e?.hint, 'outcome_changed', 'another start');
  const more = { ...p.accept, windows: { ...p.accept.windows, [w.ids.B]: 600 }, late: { [w.ids.C]: 30 } };
  await h.c.query('savepoint s');
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: more })).saved, true, 'fewer consequences than accepted');
  await h.c.query('rollback to savepoint s');
  await booking(h, { rewin: false });
  const q = await preview(h, w.day, lists, { moved, was: b.was });
  assert.deepEqual(q.accept.late, { [w.ids.A]: 185 });
  e = await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: { ...q.accept, late: { [w.ids.A]: 178 } } }));
  assert.equal(e?.hint, 'outcome_changed', 'later than accepted by more than 5 min');
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: { ...q.accept, late: { [w.ids.A]: 182 } } })).saved, true, 'within 5 min');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D12 — the basis
   ------------------------------------------------------------------------------------------------------------------ */

test('D12 the basis: a move between the draft and the save → preview basis_ok false, save day_changed, nothing written; another person’s save between → by { name }; « Je pars » between the preview and the save → day_changed', () => tx(async (h) => {
  const w = await world(h);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.D, w.tk, 0);
  // E moved to the Camion by « Changer de camion » meanwhile
  assert.equal((await h.rpc('move_job', { p_op: uuid(), p_job: w.ids.E, p_day: w.day, p_block: 'day', p_truck: w.tk })).ok, true);
  const before = await snap(h, w.day);
  const p = await preview(h, w.day, lists, { moved: [w.ids.D], was: b.was });
  assert.equal(p.basis_ok, false); assert.ok(p.changed.includes(w.ids.E), 'E is said changed'); assert.equal(p.by, null);
  const e = await h.fails(() => save(h, w.day, lists, { moved: [w.ids.D], was: b.was }));
  assert.equal(e?.hint, 'day_changed'); assert.ok(JSON.parse(e.detail).changed.includes(w.ids.E));
  assert.equal(await snap(h, w.day), before, 'nothing written');
  // Lina (office) saves the day meanwhile: the owner's old basis is refused, naming her
  const b1 = await basis(h, w);
  await become(h, w.office);
  const l1 = moveIn(b1.lists, w.ids.C, w.tk, 0);
  assert.equal((await save(h, w.day, l1, { moved: [w.ids.C], was: b1.was, accept: (await preview(h, w.day, l1, { moved: [w.ids.C], was: b1.was })).accept })).saved, true);
  await become(h, w.owner);
  const p2 = await preview(h, w.day, b1.lists, { was: b1.was });
  assert.deepEqual([p2.basis_ok, p2.by], [false, { name: 'Lina' }]);
  const e2 = await h.fails(() => save(h, w.day, b1.lists, { was: b1.was }));
  assert.deepEqual(JSON.parse(e2.detail).by, { name: 'Lina' });
  // « Je pars » between the preview and the save
  const b2 = await basis(h, w);
  const l2 = moveIn(b2.lists, w.ids.B, w.tk, -1);
  const p3 = await preview(h, w.day, l2, { moved: [w.ids.B], was: b2.was });
  assert.equal(p3.basis_ok, true);
  assert.equal((await h.rpc('job_step', { p_op: uuid(), p_job: w.ids.A, p_action: 'leave', p_data: {} })).ok, true);
  assert.equal((await h.fails(() => save(h, w.day, l2, { moved: [w.ids.B], was: b2.was, accept: p3.accept })))?.hint, 'day_changed');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D14 — who may
   ------------------------------------------------------------------------------------------------------------------ */

test('D14 rights: owner and office yes; the driver his truck yes, another truck no, a stop to the other truck no (also with « Routes partagées »), the app’s order no; a driver’s save never re-cuts a window and marks hand_at on exactly the stops it pushed out; an inactive member, an account with no staff row: no', () => tx(async (h) => {
  const w = await world(h);
  const b = await basis(h, w);
  for (const who of [w.owner, w.office]) {
    await become(h, who);
    assert.equal((await preview(h, w.day, b.lists, { was: b.was })).ok, true);
  }
  await become(h, w.saleh);
  const bm = await basis(h, w, [w.tk]);
  const mine = bm.lists;
  const pm = await preview(h, w.day, mine, { was: bm.was });
  assert.deepEqual([pm.ok, pm.basis_ok], [true, true], 'the driver, his truck');
  assert.equal((await h.fails(() => preview(h, w.day, b.lists.filter((l) => l.truck === w.tk2))))?.hint, 'not_allowed', 'another truck');
  let e = await h.fails(() => preview(h, w.day, moveIn(b.lists, w.ids.E, w.tk, 0)));
  assert.equal(e?.hint, 'not_allowed');
  await booking(h, { shared_routes: true });
  e = await h.fails(() => preview(h, w.day, moveIn(b.lists, w.ids.E, w.tk, 0)));
  assert.equal(e?.hint, 'not_allowed'); assert.match(e.message, /Seuls le propriétaire et le bureau changent un arrêt de camion/);
  assert.equal((await preview(h, w.day, b.lists, { was: b.was })).ok, true, '« Routes partagées »: both vehicles, in their order');
  assert.equal((await h.fails(() => preview(h, w.day, null, { auto: true })))?.hint, 'not_allowed', 'the app’s order');
  await booking(h, { shared_routes: false });
  // his save: A last (late), D first (early); no window re-cut
  const lists = moveIn(moveIn(mine, w.ids.A, w.tk, -1), w.ids.D, w.tk, 0);
  const moved = [w.ids.A, w.ids.D];
  const p = await preview(h, w.day, lists, { moved, was: bm.was });
  assert.equal(p.rewin, false);
  assert.ok(p.stops.every((s) => s.new_win === null), 'never « Nouvelle plage » for a mechanic');
  assert.equal(stopOf(p, w.ids.D).early_min, 840 - 480);
  assert.ok(stopOf(p, w.ids.A).late_min > 0);
  assert.equal((await save(h, w.day, lists, { moved, was: bm.was, accept: p.accept })).saved, true);
  const hand = (await server(h, `select id from public.jobs where day = $1 and hand_at is not null order by id`, [w.day])).map((r) => r.id);
  assert.deepEqual(hand, [w.ids.A, w.ids.D].sort(), 'hand_at on exactly the two pushed out');
  for (const k of ['A', 'D']) { const r = await row(h, w.ids[k]); assert.equal(r.win_start, { A: 480, D: 840 }[k], `${k}: window kept`); }
  // the owner's save (switch on): windows re-cut, no hand_at
  await become(h, w.owner);
  const b3 = await basis(h, w);
  const l3 = moveIn(b3.lists, w.ids.B, w.tk, -1);
  const p3 = await preview(h, w.day, l3, { moved: [w.ids.B], was: b3.was });
  assert.equal((await save(h, w.day, l3, { moved: [w.ids.B], was: b3.was, accept: p3.accept })).saved, true);
  assert.equal((await row(h, w.ids.B)).hand_at, null, 'an owner’s save writes none');
  // an inactive member, a signed-in account with no staff row
  for (const who of [w.office, w.saleh]) {
    await h.as(null);
    await h.q(`update public.staff set active = false where id = $1`, [who]);
    await become(h, who);
    assert.equal((await h.fails(() => preview(h, w.day, mine)))?.hint, 'not_allowed');
  }
  const stranger = randomUUID();
  await h.as(null);
  await h.q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [stranger, `${stranger.slice(0, 8)}@test.local`]);
  await become(h, stranger);
  assert.equal((await h.fails(() => preview(h, w.day, mine)))?.hint, 'not_allowed');
}));

/* ------------------------------------------------------------------------------------------------------------------
   D15 — blocks
   ------------------------------------------------------------------------------------------------------------------ */

test('D15 blocks: an order inside the morning saved, the afternoon’s times follow from the morning’s last stop; a stop listed in another block → changed; past the block’s end → late_min, never a window', () => tx(async (h) => {
  const w = await world(h, { blocks: true, jobs: { A: { t: 'tk', dur: 100 }, B: { t: 'tk', dur: 100 }, C: { t: 'tk', dur: 100 }, D: { t: 'tk', dur: 100 }, P: { t: 'tk', block: 'pm', dur: 60 } } });
  // A is where the afternoon's P is; the other three 4 km away
  for (const k of ['B', 'C', 'D']) await set(h, w.ids[k], { lat: FAR.C[0], lng: FAR.C[1] });
  await set(h, w.ids.P, { stop_order: 1 });
  const b = await basis(h, w, [w.tk]);
  const am = b.lists.find((l) => l.block === 'am');
  assert.deepEqual(am.jobs, [w.ids.A, w.ids.B, w.ids.C, w.ids.D]);
  let p = await preview(h, w.day, b.lists, { was: b.was });
  const pFar = stopOf(p, w.ids.P).eta;
  assert.equal(p.mode, 'blocks');
  assert.ok(stopOf(p, w.ids.D).late_min > 0 && stopOf(p, w.ids.D).new_win === null, 'D after 12 h: late, no window');
  // A last in the morning: the afternoon leaves from P's own door
  const lists = b.lists.map((l) => (l.block === 'am' ? { ...l, jobs: [w.ids.B, w.ids.C, w.ids.D, w.ids.A] } : l));
  p = await preview(h, w.day, lists, { moved: [w.ids.A], was: b.was });
  assert.equal(stopOf(p, w.ids.P).eta, 720, 'P at 12 h: no drive from A');
  assert.ok(pFar > 720, `before, P came from 4 km away (${pFar})`);
  assert.deepEqual(p.accept.late[w.ids.A], stopOf(p, w.ids.A).eta - 720);
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.A], was: b.was, accept: p.accept })).saved, true);
  assert.equal((await row(h, w.ids.P)).eta_min, 720);
  assert.deepEqual([(await row(h, w.ids.A)).stop_order, (await row(h, w.ids.A)).block, (await row(h, w.ids.A)).win_start], [4, 'am', null]);
  // a stop listed in another block
  const b2 = await basis(h, w, [w.tk]);
  const wrong = b2.lists.map((l) => (l.block === 'pm' ? { ...l, jobs: [...l.jobs, w.ids.B] } : l.block === 'am' ? { ...l, jobs: l.jobs.filter((x) => x !== w.ids.B) } : l));
  const e = await h.fails(() => preview(h, w.day, wrong, { was: b2.was }));
  assert.equal(e?.hint, 'changed');
  assert.deepEqual(JSON.parse(e.detail), { missing: [w.ids.B], extra: [w.ids.B] });
}));

/* ------------------------------------------------------------------------------------------------------------------
   D16 / D17 — « Laisser l'app choisir », the same press twice
   ------------------------------------------------------------------------------------------------------------------ */

test('D16 « Laisser l’app choisir »: the preview’s lists are the planner’s, every booked stop listed, each on its kind of vehicle; the save writes them with the order by hand, the trucks kept by hand and the minutes forgotten', () => tx(async (h) => {
  const w = await world(h, { far: true });
  await set(h, w.ids.B, { needs_machine: true, manual_order: 1, arrive_at: 640 });
  await set(h, w.ids.E, { vehicle_kind: 'car', truck_pinned: true });
  const b = await basis(h, w);
  const p = await preview(h, w.day, null, { was: b.was, auto: true });
  assert.equal(p.auto, true); assert.equal(p.basis_ok, true);
  const listed = p.lists.flatMap((l) => l.jobs).sort();
  assert.deepEqual(listed, Object.values(w.ids).sort(), 'every booked stop, once');
  const on = (id) => p.lists.find((l) => l.jobs.includes(id)).truck;
  assert.equal(on(w.ids.B), w.tk, 'tire work stays on the Camion');
  assert.equal(on(w.ids.E), w.tk2, 'a « car » stays on the Voiture');
  assert.deepEqual(p.accept.pins, {}, 'the minutes are forgotten (asked first in the app)');
  const s = await save(h, w.day, p.lists, { was: b.was, auto: true, accept: p.accept });
  assert.equal(s.saved, true);
  for (const id of Object.values(w.ids)) {
    const r = await row(h, id);
    assert.deepEqual([r.manual_order, r.truck_pinned, r.arrive_at], [null, false, null]);
  }
  assert.equal((await h.fails(() => save(h, w.day, null, { was: b.was, auto: true })))?.hint, 'bad_list', 'a save never plans');
}));

test('D16 « Laisser l’app choisir »: a stop the planner cannot place stays at the END of its own truck (judged there); switch on, a FROZEN vehicle keeps its stored order', () => tx(async (h) => {
  // the Camion works 8 h – 10 h only, three stops of 60 min: one does not fit
  const w = await world(h, { hours: [[480, 600]], hours2: [], jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 480 }, C: { t: 'tk', ws: 480 } } });
  const b = await basis(h, w, [w.tk]);
  // what the planner itself says once the order and the minutes are forgotten (the preview's step 7, here undone)
  await h.c.query('savepoint plan');
  await server(h, `select set_config('garage.rpc', 'on', true)`);
  await server(h, `update public.jobs set manual_order = null, truck_pinned = false, arrive_at = null where day = $1 and truck_id = $2`, [w.day, w.tk]);
  const plan = await sval(h, `select public.plan_block($1::date, 'day') v`, [w.day]);
  await h.c.query('rollback to savepoint plan');
  const over = plan.over ?? [];
  assert.ok(over.length >= 1, 'the planner leaves one out: ' + JSON.stringify(plan.over));
  const p = await preview(h, w.day, null, { was: b.was, auto: true });
  const camion = p.lists.find((l) => l.truck === w.tk);
  assert.deepEqual(camion.jobs.slice(-over.length).sort(), [...over].sort(), 'at the end of its own truck (in their stored order)');
  assert.deepEqual(p.lists.flatMap((l) => l.jobs).sort(), Object.values(w.ids).sort(), 'every one still listed (nobody to « À placer »)');
  assert.ok(p.trucks.find((t) => t.id === w.tk).over_min > 0, 'the Camion said past its hours');
  // each of them is flagged for the screen (« L'app ne trouve pas de place pour … »), nobody else
  assert.deepEqual(p.stops.filter((s) => s.over).map((s) => s.id).sort(), [...over].sort(), 'the stops the planner left out say `over`');
  // switch on, real trips far longer than the day holds: the vehicle is frozen, its stops in their stored order
  await h.c.query('rollback to savepoint plan');
  const v = await world(h, { far: true, hours2: [], jobs: { A: { t: 'tk', ws: 480 }, B: { t: 'tk', ws: 600 }, C: { t: 'tk', ws: 720 } } });
  await roadsOn(h, v, () => 240);
  await become(h, v.owner);
  const bv = await basis(h, v, [v.tk]);
  const stored = bv.lists[0].jobs;
  const frozen = await sval(h, `select public.plan_route($1::date, 'day', null, null, null) v`, [v.day]);
  assert.ok((frozen.frozen ?? []).includes(v.tk), 'the planner freezes the Camion: ' + JSON.stringify(frozen.frozen));
  const pv = await preview(h, v.day, null, { was: bv.was, auto: true });
  assert.deepEqual(pv.lists.find((l) => l.truck === v.tk).jobs, stored, 'its stored order');
}));

test('D17 the same press twice (the same op): the stored answer, ONE day_ordered row', () => tx(async (h) => {
  const w = await world(h);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.C, w.tk, 0);
  const p = await preview(h, w.day, lists, { moved: [w.ids.C], was: b.was });
  const op = uuid();
  const a1 = await save(h, w.day, lists, { moved: [w.ids.C], was: b.was, accept: p.accept, op });
  const a2 = await save(h, w.day, lists, { moved: [w.ids.C], was: b.was, accept: p.accept, op });
  assert.deepEqual(a2, a1);
  const acts = await server(h, `select actor, data from public.activity where action = 'day_ordered' and data->>'day' = $1`, [w.day]);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].actor, w.owner);
  assert.deepEqual([acts[0].data.moved, acts[0].data.auto, acts[0].data.trucks.sort()], [[w.ids.C], false, [w.tk, w.tk2].sort()]);
}));

/* ------------------------------------------------------------------------------------------------------------------
   D12b, D13, D13b — two connections (their own committed rows: blocks mode, no switch flipped, taken away after)
   ------------------------------------------------------------------------------------------------------------------ */

const within = (p, ms) => Promise.race([p.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r('waiting'), ms))]);
async function committedWorld(fn) {
  const c = await pool.connect();
  const opened = [];
  const people = { owner: randomUUID(), office: randomUUID() };
  const truck = randomUUID(), cust = randomUUID();
  const jobs = [randomUUID(), randomUUID(), randomUUID()];
  const ops = [];
  try {
    await c.query('begin');
    for (const [k, id] of Object.entries(people)) {
      await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [id, `${id.slice(0, 8)}@test.local`]);
      await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, $2, $3, $4, '{}', $5)`,
        [id, k === 'owner' ? 'Hassan Deux' : 'Lina Deux', k === 'owner' ? 'Hassan' : 'Lina', k === 'owner' ? '{owner}' : '{office}', `${id.slice(0, 8)}@test.local`]);
    }
    await c.query(`insert into public.trucks (id, name, active, sort) values ($1, 'Camion Deux', true, 0)`, [truck]);
    for (let d = 0; d < 7; d++) await c.query(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, $3)`, [truck, d, JSON.stringify(DAY)]);
    await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'Deux', 'Test', '5145550101', $2, $3, '1 rue Test')`, [cust, ...HERE]);
    const blk = (await c.query(`select key from public.blocks() order by pos limit 1`)).rows[0].key;
    const day = (await c.query(`select (public.local_today() + 36)::text d`)).rows[0].d;
    await c.query(`select set_config('garage.rpc', 'on', true)`);
    for (const [i, id] of jobs.entries()) {
      await c.query(`insert into public.jobs (id, customer_id, day, block, truck_id, stop_order, status, duration_min, lat, lng) values ($1, $2, $3, $4, $5, $6, 'booked', 30, $7, $8)`,
        [id, cust, day, blk, truck, i + 1, ...HERE]);
    }
    await c.query('commit');
    const open = async (who) => {
      const k = await pool.connect(); opened.push(k);
      await k.query('begin');
      if (who) {
        await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: who, role: 'authenticated' }), who]);
        await k.query('set local role authenticated');
      }
      return k;
    };
    const basisOf = async (k) => {
      const rows = (await k.query(`select id, truck_id, block, stop_order, win_start, win_end, arrive_at, status from public.jobs where day = $1 and truck_id = $2 and deleted_at is null
        and status in ('booked', 'en_route', 'on_site') order by stop_order`, [day, truck])).rows;
      return { was: Object.fromEntries(rows.map((r) => [r.id, [r.truck_id, r.block, r.stop_order, r.win_start, r.win_end, r.arrive_at, r.status]])),
        ids: rows.filter((r) => r.status === 'booked').map((r) => r.id) };
    };
    const saveSql = `select public.day_order_save($1::uuid, $2::date, $3::jsonb, $4::uuid[], $5::jsonb, false, $6::jsonb) v`;
    const op = () => { const x = randomUUID(); ops.push(x); return x; };
    await fn({ c, open, people, truck, cust, jobs, day, blk, basisOf, saveSql, op });
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    await c.query('rollback').catch(() => {});
    await c.query('begin');
    await c.query(`select set_config('garage.rpc', 'on', true)`);
    await c.query(`delete from public.trips where job_id = any($1::uuid[])`, [jobs]);
    await c.query(`delete from public.jobs where id = any($1::uuid[])`, [jobs]);
    await c.query(`delete from public.customers where id = $1`, [cust]);
    await c.query(`delete from public.truck_week where truck_id = $1`, [truck]);
    await c.query(`delete from public.trucks where id = $1`, [truck]);
    await c.query(`delete from public.op_log where op = any($1::uuid[])`, [ops]);
    await c.query(`delete from public.activity where entity_id = any($1::uuid[]) or entity_id = $2 or entity_id = $3 or actor = any($4::uuid[]) or xmin = pg_current_xact_id()::xid`,
      [jobs, cust, truck, Object.values(people)]);
    await c.query(`delete from public.staff where id = any($1::uuid[])`, [Object.values(people)]);
    await c.query(`delete from auth.users where id = any($1::uuid[])`, [Object.values(people)]);
    await c.query('commit');
    c.release();
  }
}

test('D12b (two connections) « Je pars » holds a listed stop’s row: the save passes the basis and the coverage, waits at its writes, then answers changed; the stop under way keeps its truck, nothing written', () => committedWorld(async (x) => {
  const a = await x.open(x.people.owner);
  const { was, ids } = await x.basisOf(a);
  const lists = [{ truck: x.truck, block: x.blk, jobs: [ids[2], ids[1], ids[0]] }];
  const b = await x.open(null);
  await b.query(`select set_config('garage.rpc', 'on', true)`);
  await b.query(`update public.jobs set status = 'en_route', started_at = now() where id = $1`, [ids[1]]);
  const p = a.query(x.saveSql, [x.op(), x.day, JSON.stringify(lists), [ids[2]], JSON.stringify(was), '{}']);
  assert.equal(await within(p, 600), 'waiting', 'the save waits for the row « Je pars » holds');
  await b.query('commit');
  const e = await p.then(() => null, (err) => err);
  assert.equal(e?.hint, 'changed');
  assert.deepEqual(JSON.parse(e.detail).missing, [ids[1]]);
  await a.query('rollback');
  const r = (await x.c.query(`select status, truck_id, stop_order from public.jobs where id = $1`, [ids[1]])).rows[0];
  assert.deepEqual([r.status, r.truck_id, r.stop_order], ['en_route', x.truck, 2], 'the stop under way keeps its truck and its place');
}));

test('D13 (two connections) two saves at once: the second waits for the first, then answers day_changed naming who saved', () => committedWorld(async (x) => {
  const k1 = await x.open(x.people.office), k2 = await x.open(x.people.owner);
  const { was, ids } = await x.basisOf(k1);
  const l1 = [{ truck: x.truck, block: x.blk, jobs: [ids[2], ids[0], ids[1]] }];
  const l2 = [{ truck: x.truck, block: x.blk, jobs: [ids[1], ids[2], ids[0]] }];
  const r1 = (await k1.query(x.saveSql, [x.op(), x.day, JSON.stringify(l1), [ids[2]], JSON.stringify(was), '{}'])).rows[0].v;
  assert.equal(r1.saved, true);
  const p2 = k2.query(x.saveSql, [x.op(), x.day, JSON.stringify(l2), [ids[1]], JSON.stringify(was), '{}']);
  assert.equal(await within(p2, 500), 'waiting', 'the second waits (the day’s block locks)');
  await k1.query('commit');
  const e = await p2.then(() => null, (err) => err);
  assert.equal(e?.hint, 'day_changed');
  assert.deepEqual(JSON.parse(e.detail).by, { name: 'Lina' });
  await k2.query('rollback');
  const order = (await x.c.query(`select id from public.jobs where id = any($1::uuid[]) order by stop_order`, [ids])).rows.map((r) => r.id);
  assert.deepEqual(order, l1[0].jobs, 'the first save stands');
}));

test('D13b (two connections) a cancel holding a job’s row: the preview gives up within ~0.5 s (55P03) and the cancel goes through; a booking holding the day’s block: the preview waits its turn, then answers', () => committedWorld(async (x) => {
  const a = await x.open(x.people.owner);
  const { was, ids } = await x.basisOf(a);
  const lists = [{ truck: x.truck, block: x.blk, jobs: [ids[2], ids[1], ids[0]] }];
  const prev = `select public.day_order_preview($1::date, $2::jsonb, $3::uuid[], $4::jsonb, false) v`;
  // the office cancels ids[0]: job_step locks the row first, then the block (the reverse order)
  const b = await x.open(x.people.office);
  await b.query(`select id from public.jobs where id = $1 for update`, [ids[0]]);
  const t0 = Date.now();
  const p = a.query(prev, [x.day, JSON.stringify(lists), [ids[2]], JSON.stringify(was)]);
  await new Promise((r) => setTimeout(r, 150));
  const cancel = b.query(`select public.job_step($1, $2, 'cancel', '{}'::jsonb) v`, [x.op(), ids[0]]);
  const e = await p.then(() => null, (err) => err);
  const took = Date.now() - t0;
  assert.equal(e?.code, '55P03', 'the preview gives up (« try again »): ' + (e?.message ?? 'answered'));
  assert.ok(took < 1500, `within its lock_timeout (${took} ms)`);
  assert.equal((await cancel).rows[0].v.ok, true, 'the cancel is not the one that fails');
  await b.query('commit');
  await a.query('rollback');
  // a booking holding the day's block: the preview waits, then answers (its lock_timeout comes after the block locks)
  const a2 = await x.open(x.people.owner);
  const bs = await x.basisOf(a2);
  const b2 = await x.open(null);
  await b2.query(`select public.lock_block($1::date, $2)`, [x.day, x.blk]);
  const p2 = a2.query(prev, [x.day, JSON.stringify([{ truck: x.truck, block: x.blk, jobs: bs.ids }]), [], JSON.stringify(bs.was)]);
  assert.equal(await within(p2, 900), 'waiting', 'it waits its turn, past 0.5 s');
  await b2.query('commit');
  const r = (await p2).rows[0].v;
  assert.equal(r.ok, true); assert.equal(r.basis_ok, true);
}));

/* ------------------------------------------------------------------------------------------------------------------
   D18 — Part 27 untouched; the owner's rule (nothing removed) — S120's spirit
   ------------------------------------------------------------------------------------------------------------------ */

const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const FILE = MIG + '20261122000100_reorganiser.sql';

test('D18 Part 27 untouched: no function its generator copies (nor the off test’s list) is written again here, no « alter function », no pg_get_functiondef; the generator still makes exactly the applied file', () => {
  const sql = readFileSync(FILE, 'utf8');
  assert.match(sql.split('\n')[0], /^-- Part 28 — Réorganiser la journée et Envoyer les heures aux clients/);
  assert.equal(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().at(-1), '20261122000100_reorganiser.sql', 'after every migration');
  const copied = ['route_walk_in', 'route_cost', 'route_retime', 'plan_route', 'day_drive', 'suggest_core', 'suggest_windows_core', 'web_suggest', 'web_windows',
    'book_job', 'move_job', 'lock_windows_core', 'plan_late_new', 'plan_inputs', 'customers_replan_on_position', 'replan_block_safe', 'apply_plan', 'log_activity',
    'stop_order_one', 'windows_switch', 'drive_min', 'route_hold', 'route_mark', 'eta_known', 'exact_works', 'plan_block', 'win_for', 'roads_on', 'roads_no'];
  const made = [...sql.matchAll(/^create (?:or replace )?function public\.([a-z_0-9]+)\s*\(/gim)].map((m) => m[1]);
  assert.deepEqual(made.filter((n) => copied.includes(n)), [], 'none of Part 27’s functions is made again');
  assert.deepEqual(made.sort(), ['customers_told_reset', 'day_order_core', 'day_order_preview', 'day_order_save', 'day_rewin_on', 'jobs_told_reset', 'tell_done', 'tell_list',
    'tell_mark', 'tell_now', 'tell_release', 'tell_state', 'tell_take', 'told_hours', 'told_install'], 'only new names');
  const code = sql.replace(/--[^\n]*/g, ' ');
  assert.doesNotMatch(code, /alter\s+function/i);
  assert.doesNotMatch(code, /pg_get_functiondef/i);
  // the generator, run into a scratch file, makes the very file applied on live
  const gen = fileURLToPath(new URL('../../ops/generateurs/vraies-routes/build.py', import.meta.url));
  const out = join(mkdtempSync(join(tmpdir(), 'p27-')), 'p27.sql');
  execFileSync('python3', [gen], { env: { ...process.env, BUILD_OUT: out }, stdio: 'pipe' });
  assert.ok(readFileSync(out).equals(readFileSync(MIG + '20261119000200_vraies_routes.sql')), 'build.py → the same bytes as 20261119000200_vraies_routes.sql');
});

test('D18 the migration removes nothing (no drop, delete or truncate anywhere in it), makes its triggers with « create or replace », and applied again (twice) leaves the same triggers, functions and grants', () => tx(async (h) => {
  const sql = readFileSync(FILE, 'utf8');
  const code = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(drop|truncate)\b/i, 'nothing dropped');
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, 'no row taken away, not even inside a function');
  assert.doesNotMatch(code, /\bcreate\s+trigger\b/i);
  assert.equal(code.match(/\bcreate\s+or\s+replace\s+trigger\b/gi)?.length, 2);
  await h.as(null); await h.c.query('reset role');
  const state = () => h.q(`select (select coalesce(jsonb_agg(jsonb_build_array(t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)) order by t.tgname), '[]') from pg_trigger t
      join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('jobs', 'customers')) trg,
    (select coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, p.proacl::text) order by p.oid::regprocedure::text), '[]') from pg_proc p
      where p.pronamespace = 'public'::regnamespace and (p.proname like 'tell%' or p.proname like 'told%' or p.proname like 'day_order%' or p.proname = 'day_rewin_on')) fns,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and (column_name like 'told%' or column_name = 'hand_at')) cols`);
  const built = await state();
  assert.equal(Number(built[0].cols), 7);
  assert.ok(built[0].trg.some((t) => t[0] === 'jobs_told_reset' && /BEFORE UPDATE OF customer_id ON public\.jobs/.test(t[2])));
  assert.ok(built[0].trg.some((t) => t[0] === 'customers_told_reset' && /AFTER UPDATE OF phone ON public\.customers/.test(t[2])));
  await h.c.query(sql);
  assert.deepEqual(await state(), built, 'applied a second time');
  await h.c.query(sql);
  assert.deepEqual(await state(), built, 'and a third');
}));
