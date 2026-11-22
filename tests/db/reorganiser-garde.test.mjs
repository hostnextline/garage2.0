// Part 29 (20261122000200_garder_ordre.sql) — « Réorganiser la journée »: the stop he drags takes the hour of the place he
// put it and keeps it; the others keep theirs. Hassan, 2026-11-22, on the live Part 28: « when re-arranging the day, if i
// move an appointement down, i need it to change its hour, and accept the appointement where i put it without moving all
// the others arround ». The law: STATE.md 2026-11-22 10:35 (G1–G7); the numbers: the reproducer's prototype on this stack
// (reports/drag-keeps-spec.md §2 R6, §6.1).
// Each test runs in a transaction rolled back at the end.
// The world (`hassanDay`): window mode, live's plages (avant 60, après 180, arrondi 15), « Vraies routes » off; the Camion
// and the Voiture 8 h – 20 h from the same garage; the Camion A 60 min, B 90, C 45, D 75, E 60, F 90, the Voiture G 60,
// H 45, customers a few km apart (P: every trip counts, the straight line × 1.3 at 35 km/h); each window cut by win_for
// around the stop's arrival (as a booking does), then C and E pointed (an exact move) 20 min after their arrival, rounded
// to 5, and walked again. Arrival = « eta »; a stop ends at eta + 5 + its length. Later day = today + 37.
//   before:  A 488 (8–12) · B 569 (8 h 30–12 h 30) · C 720 pin 720 (11–15) · D 787 (11 h 45–15 h 45) · E 878 pin 875 (13 h 30–
//            17 h 30, 3 min late already) · F 955 (14 h 30–18 h 30) · Voiture G 490 (8–12) · H 572 (8 h 30–12 h 30)
//   no pins: C 697 (10 h 30–14 h 30) · D 764 · E 855 (13 h 15–17 h 15) · F 932
// Run: node --test tests/db/reorganiser-garde.test.mjs (Mac: bash tests/stack/mac/db-tests.sh reorganiser-garde)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tx, pool, uuid } from './helpers.mjs';

after(() => pool.end());

const HERE = [45.5150, -73.6400];
const P = { A: [45.5300, -73.6000], B: [45.4700, -73.5800], C: [45.5700, -73.7000], D: [45.5100, -73.6650], E: [45.4950, -73.6100],
  F: [45.5400, -73.6300], G: [45.5050, -73.5900], H: [45.5250, -73.6800] };
const DAY = [[480, 1200]];
const week = (r = DAY) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, r]));
const become = async (h, who) => { h.me = who ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const sval = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
const clock = (h, min) => server(h, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
async function booking(h, keys) {
  await h.as(null);
  await h.q(`set local session_replication_role = replica`);
  await h.q(`update public.settings set booking = coalesce(booking, '{}'::jsonb) || $1::jsonb where id = 1`, [JSON.stringify(keys)]);
  await h.q(`set local session_replication_role = origin`);
  await h.as(h.me ?? null);
}
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
async function set(h, id, cols) {
  const keys = Object.keys(cols);
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  await h.q(`update public.jobs set ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => cols[k])]);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await h.as(h.me ?? null);
}
const row = async (h, id) => (await server(h, `select to_jsonb(j) r from public.jobs j where j.id = $1`, [id]))[0].r;
const winFor = async (h, eta) => { const r = (await server(h, `select * from public.win_for($1)`, [eta]))[0]; return [r.win_start, r.win_end]; };

/** Hassan's kind of day (the reproducer's `hassanDay`). o.day; o.today = { now, enRoute }; o.pins (default C and E);
 *  o.driver: the Camion's driver (a mechanic, for the save without « Réserver ») */
async function hassanDay(h, o = {}) {
  await h.as(null);
  const owner = await h.person('Hassan Roy', ['owner'], { short_name: 'Hassan' });
  const saleh = await h.person('Saleh Ali', ['mechanic'], { short_name: 'Saleh' });
  const day = o.day ?? await h.val(`select (public.local_today() + 37)::text`);
  const tk = await h.truck('Camion', o.driver ? saleh : null, week(o.hours));
  const tk2 = await h.truck('Voiture', null, week(o.hours));
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [tk2]);
  await h.q(`update public.trucks set start = $2::jsonb where id = any($1::uuid[])`, [[tk, tk2], JSON.stringify({ label: 'Garage', lat: HERE[0], lng: HERE[1] })]);
  // the browser tests' vehicles (a database not made fresh) are left out of this rolled-back world
  await h.q(`update public.trucks set active = false where id <> all($1::uuid[]) and active`, [[tk, tk2]]);
  await become(h, owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  await booking(h, { win_before_min: 60, win_after_min: 180, win_round_min: 15 });
  if (o.today) await clock(h, o.today.now);
  const spec = [['A', 'tk', 60], ['B', 'tk', 90], ['C', 'tk', 45], ['D', 'tk', 75], ['E', 'tk', 60], ['F', 'tk', 90], ['G', 'tk2', 60], ['H', 'tk2', 45]];
  const ids = {}, cust = {}, n = { tk: 0, tk2: 0 };
  await h.as(null);
  for (const [k, t, dur] of spec) {
    cust[k] = await h.customer(k, ...P[k]);
    ids[k] = await put(h, { customer_id: cust[k], day, block: 'day', truck_id: t === 'tk' ? tk : tk2, stop_order: ++n[t], win_start: 480, win_end: 1200,
      duration_min: dur, lat: P[k][0], lng: P[k][1] });
  }
  if (o.today?.enRoute) await set(h, ids.A, { status: 'en_route', started_at: new Date().toISOString() });
  const walk = async () => { for (const t of [tk, tk2]) await sval(h, `select public.route_hold($1::uuid, $2::date, 'day', '{}'::jsonb)::text v`, [t, day]); };
  await walk();
  for (const k of Object.keys(ids)) {
    const r = (await server(h, `select coalesce(eta_min, $2) eta_min from public.jobs where id = $1`, [ids[k], o.today?.now ?? 480]))[0];
    const w = (await server(h, `select * from public.win_for($1)`, [r.eta_min]))[0];
    await set(h, ids[k], { win_start: w.win_start, win_end: w.win_end });
  }
  for (const k of o.pins ?? ['C', 'E']) {
    const r = (await server(h, `select eta_min from public.jobs where id = $1`, [ids[k]]))[0];
    const at = Math.ceil((r.eta_min + 20) / 5) * 5;
    const w = (await server(h, `select * from public.win_for($1)`, [at]))[0];
    await set(h, ids[k], { arrive_at: at, win_start: w.win_start, win_end: w.win_end, truck_pinned: true });
  }
  await walk();
  await become(h, owner);
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, saleh, day, tk, tk2, ids, cust, name };
}
/** what the phone sends: p_was of the listed trucks and their lists in the stored order */
async function basis(h, w, trucks = [w.tk, w.tk2]) {
  const rows = await server(h, `select id, truck_id, block, stop_order, win_start, win_end, arrive_at, status from public.jobs
    where day = $1 and truck_id = any($2::uuid[]) and deleted_at is null and status in ('booked', 'en_route', 'on_site')
    order by stop_order nulls last, eta_min nulls last, id`, [w.day, trucks]);
  const was = Object.fromEntries(rows.map((r) => [r.id, [r.truck_id, r.block, r.stop_order, r.win_start, r.win_end, r.arrive_at, r.status]]));
  const keys = w.blocks ? ['am', 'pm', 'eve'] : ['day'];
  const lists = [];
  for (const t of trucks) for (const b of keys) lists.push({ truck: t, block: b, jobs: rows.filter((r) => r.truck_id === t && r.block === b && r.status === 'booked').map((r) => r.id) });
  return { was, lists };
}
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
/** k → { eta, at (pin), win, truck, order } as stored */
async function dayOf(h, w) {
  const rows = await server(h, `select id, truck_id, stop_order, eta_min, arrive_at, win_start, win_end, truck_pinned, manual_order, status from public.jobs
    where day = $1 and truck_id = any($2::uuid[]) and deleted_at is null and status in ('booked', 'en_route', 'on_site')`, [w.day, [w.tk, w.tk2]]);
  return Object.fromEntries(rows.map((r) => [w.name[r.id] ?? r.id, { eta: r.eta_min, at: r.arrive_at, win: [r.win_start, r.win_end], truck: r.truck_id, order: r.stop_order,
    pinned: r.truck_pinned, manual: r.manual_order, status: r.status }]));
}
const etas = (d, ks) => ks.map((k) => d[k].eta);
/** the oracle: what the save wrote is what the preview said (Part 28's D2 oracle; `pin` is the minute written) */
async function sameAsPreview(h, p, what) {
  for (const s of p.stops) {
    const r = await row(h, s.id);
    assert.equal(r.truck_id, s.truck_id, `${what}: truck of ${s.id}`);
    assert.equal(r.stop_order, s.order, `${what}: order`);
    assert.equal(r.eta_min, s.eta, `${what}: arrival`);
    assert.deepEqual([r.win_start, r.win_end], s.new_win ?? s.win ?? [null, null], `${what}: window`);
    assert.equal(r.arrive_at, s.pin, `${what}: minute pointed`);
    assert.equal(r.manual_order, null, `${what}: no order by hand`);
  }
}
/** G2, for every stop he did not drag: never before its arrival before the save; a pinned one never before its minute */
function neverEarlier(w, p, moved) {
  for (const s of p.stops) {
    if (moved.includes(s.id) || s.eta_before == null) continue;
    const pinWas = s.pin_lost ?? s.pin_was ?? s.pin;
    if (pinWas != null) assert.ok(s.eta >= pinWas, `${w.name[s.id]}: not before its minute (${s.eta} ≥ ${pinWas})`);
    else assert.ok(s.eta >= s.eta_before, `${w.name[s.id]}: not before its arrival before the save (${s.eta} ≥ ${s.eta_before})`);
  }
}
/** a booking near C at 10 h on the Camion (the reproducer's « booking at 10 h ») */
async function bookNearC(h, w) {
  await h.as(null);
  const near = await h.customer('Nouveau', P.C[0] + 0.004, P.C[1]);
  await become(h, w.owner);
  let r = null;
  const e = await h.fails(async () => { r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: near, day: w.day, block: 'day', duration_min: 45, win_start: 600, truck_id: w.tk }, p_items: [] }); });
  return e ? { refused: e.hint } : r;
}
const replan = (h, w) => sval(h, `select public.replan_block_safe($1::date, 'day') v`, [w.day]);
const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const FILE = MIG + '20261122000200_garder_ordre.sql';
/** Part 27's text of a function (to show what the guard keeps from happening, inside a savepoint) */
function part27(name) {
  const s = readFileSync(MIG + '20261119000200_vraies_routes.sql', 'utf8');
  const m = new RegExp(`^create or replace function public\\.${name}\\(`, 'm').exec(s);
  return s.slice(m.index, s.indexOf('\nend $$;\n', m.index) + '\nend $$;\n'.length);
}

/* ------------------------------------------------------------------------------------------------------------------
   G1 / G2 — a drag DOWN: the dragged stop takes the hour of its new place and keeps it; the others keep theirs
   ------------------------------------------------------------------------------------------------------------------ */

test('G1a G2a later day, no minute pointed: B dragged DOWN to place 5 → B 15 h 29 (E’s end 15 h 20 + the drive) pointed there, its window 14 h 30 – 18 h 30; C, D, E keep 11 h 37, 12 h 44, 14 h 15 (Part 28: 10 h 30, 11 h 45, 13 h 16); F 15 h 32 → 17 h 24 inside its window, nothing said; the save writes exactly that', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  const d0 = await dayOf(h, w);
  assert.deepEqual(etas(d0, ['A', 'B', 'C', 'D', 'E', 'F']), [488, 569, 697, 764, 855, 932], 'the day before');
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const moved = [w.ids.B];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const s = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((k) => [k, stopOf(p, w.ids[k])]));
  assert.deepEqual([s.A.eta, s.C.eta, s.D.eta, s.E.eta, s.B.eta, s.F.eta], [488, 697, 764, 855, 929, 1044], 'A, C, D, E unchanged; B after E; F after B');
  assert.deepEqual([s.B.pin, s.B.pin_new, s.B.pin_was, s.B.pin_lost], [929, true, null, null], 'B pointed where he put it');
  assert.deepEqual(s.B.new_win, [870, 1110]); assert.deepEqual(s.B.new_win, await winFor(h, 929));
  assert.deepEqual([s.F.new_win, s.F.late_min, s.F.pin], [null, null, null], 'F inside its 14 h 30 – 18 h 30: nothing said');
  for (const k of ['A', 'C', 'D', 'E', 'F', 'G', 'H']) assert.equal(s[k].pin_new, false, `${k} not dragged`);
  assert.deepEqual(p.accept.at, { [w.ids.B]: 929 });
  assert.deepEqual(p.accept.windows, { [w.ids.B]: 870 });
  assert.deepEqual([p.accept.pins, p.accept.late, p.accept.over], [{}, {}, {}]);
  neverEarlier(w, p, moved);
  const r = await save(h, w.day, lists, { moved, was: b.was, accept: p.accept });
  assert.equal(r.saved, true);
  await sameAsPreview(h, p, 'G1a');
  const d1 = await dayOf(h, w);
  assert.deepEqual([d1.B.at, d1.B.pinned, d1.B.order, d1.B.manual], [929, true, 5, null], 'B: its minute, its vehicle kept, place 5, no order by hand');
  for (const k of ['A', 'C', 'D', 'E', 'F']) assert.equal(d1[k].at, null, `${k}: no minute`);
  const act = await server(h, `select data from public.activity where action = 'day_ordered' and data->>'day' = $1`, [w.day]);
  assert.deepEqual(act[0].data.pinned, { [w.ids.B]: 929 }, 'the activity says the minute pointed');
}));

test('G2b D2 later day, C and E pointed: B dragged DOWN to place 5 → C 12 h 00 (its minute kept), D 13 h 07, E 14 h 38 (its 14 h 35 already passed, not made later: pointed again at 14 h 38), B 15 h 52 pointed (14 h 45 – 18 h 45), F 15 h 55 → 17 h 47', () => tx(async (h) => {
  const w = await hassanDay(h);
  const d0 = await dayOf(h, w);
  assert.deepEqual(etas(d0, ['A', 'B', 'C', 'D', 'E', 'F']), [488, 569, 720, 787, 878, 955], 'the day before');
  assert.deepEqual([d0.C.at, d0.E.at], [720, 875], 'C at its minute; E 3 min after its minute (an exact move « quand même »)');
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const moved = [w.ids.B];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const s = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((k) => [k, stopOf(p, w.ids[k])]));
  assert.deepEqual([s.A.eta, s.C.eta, s.D.eta, s.E.eta, s.B.eta, s.F.eta], [488, 720, 787, 878, 952, 1067]);
  assert.deepEqual([s.C.pin, s.C.pin_lost, s.C.pin_was], [720, null, null], 'C keeps its minute');
  // D2 (Part 28: « pin_lost 875 », written null at ANY save, though the drag did not touch E)
  assert.deepEqual([s.E.pin, s.E.pin_lost, s.E.pin_new, s.E.pin_was], [878, null, false, 875], 'E pointed again at its arrival');
  assert.deepEqual([s.B.pin, s.B.pin_new, s.B.new_win], [952, true, [885, 1125]]);
  assert.deepEqual([s.F.new_win, s.F.late_min], [null, null], 'F 17 h 47 inside 14 h 30 – 18 h 30');
  assert.deepEqual(p.accept.at, { [w.ids.B]: 952, [w.ids.E]: 878 });
  assert.deepEqual(p.accept.pins, {}, 'no minute lost');
  neverEarlier(w, p, moved);
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: p.accept })).saved, true);
  await sameAsPreview(h, p, 'G2b');
  const d1 = await dayOf(h, w);
  assert.deepEqual([d1.C.at, d1.E.at, d1.B.at], [720, 878, 952]);
  // G4, a day with room: a re-plan keeps every minute; a booking at 10 h near C is placed, B stays where he put it
  await h.c.query('savepoint g4');
  await replan(h, w);
  const d2 = await dayOf(h, w);
  for (const k of ['C', 'E', 'B']) assert.deepEqual([d2[k].eta, d2[k].at, d2[k].truck], [d1[k].at, d1[k].at, w.tk], `${k} at its minute, on the Camion, after a re-plan`);
  await h.c.query('rollback to savepoint g4');
  const bk = await bookNearC(h, w);
  assert.equal(bk.ok, true, 'the booking at 10 h is placed: ' + JSON.stringify(bk));
  const d3 = await dayOf(h, w);
  for (const k of ['C', 'E', 'B']) assert.deepEqual([d3[k].eta, d3[k].at], [d1[k].at, d1[k].at], `${k} at its minute after the booking`);
  for (const [k, v] of Object.entries(d3)) assert.ok(v.eta >= v.win[0] && v.eta <= v.win[1], `${k} inside its window after the booking (${v.eta} in ${v.win})`);
}));

/* ------------------------------------------------------------------------------------------------------------------
   G1 — up, and onto the other vehicle
   ------------------------------------------------------------------------------------------------------------------ */

test('G1b later day: F (the last) dragged UP to place 2 → F 9 h 19 pointed (8 h 15 – 12 h 15); B 11 h 14 inside its window; C 12 h 00 → 13 h 22 and E → 16 h 00: their minutes no longer hold (said, accepted, written null); D 14 h 29', () => tx(async (h) => {
  const w = await hassanDay(h);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.F, w.tk, 1);
  const moved = [w.ids.F];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const s = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((k) => [k, stopOf(p, w.ids[k])]));
  assert.deepEqual([s.A.eta, s.F.eta, s.B.eta, s.C.eta, s.D.eta, s.E.eta], [488, 559, 674, 802, 869, 960]);
  assert.deepEqual([s.F.pin, s.F.pin_new, s.F.new_win], [559, true, [495, 735]]);
  assert.deepEqual([s.B.new_win, s.D.new_win], [null, null], 'B and D still inside their windows');
  assert.deepEqual([s.C.pin, s.C.pin_lost, s.E.pin, s.E.pin_lost], [null, 720, null, 875], 'C and E pushed past their minutes: said');
  assert.deepEqual(p.accept.pins, { [w.ids.C]: 720, [w.ids.E]: 875 });
  assert.deepEqual(p.accept.at, { [w.ids.F]: 559 });
  neverEarlier(w, p, moved);
  // « Enregistrer » without « Enregistrer quand même » → refused; with it → written (G3: accepted where he put it)
  assert.equal((await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: { ...p.accept, pins: {} } })))?.hint, 'outcome_changed');
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: p.accept })).saved, true);
  await sameAsPreview(h, p, 'G1b');
  const d1 = await dayOf(h, w);
  assert.deepEqual([d1.F.at, d1.F.order, d1.C.at, d1.E.at], [559, 2, null, null]);
  // a later re-plan may plan the others around F (his 11-21 rule), never F
  await replan(h, w);
  const d2 = await dayOf(h, w);
  assert.deepEqual([d2.F.eta, d2.F.at, d2.F.truck], [559, 559, w.tk], 'F stays where he put it');
}));

test('G1c later day: D dragged onto the Voiture, place 2 → D 9 h 29 pointed there (8 h 30 – 12 h 30), kept on the Voiture; H 9 h 32 → 10 h 54 inside its window; on the Camion E back to its minute 14 h 35 (the time D held is free), F stays 15 h 55 (Part 28: 15 h 52)', () => tx(async (h) => {
  const w = await hassanDay(h);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.D, w.tk2, 1);
  const moved = [w.ids.D];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const s = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((k) => [k, stopOf(p, w.ids[k])]));
  assert.deepEqual([s.G.eta, s.D.eta, s.H.eta], [490, 569, 654], 'the Voiture');
  assert.deepEqual([s.A.eta, s.B.eta, s.C.eta, s.E.eta, s.F.eta], [488, 569, 720, 875, 955], 'the Camion');
  assert.deepEqual([s.D.truck_id, s.D.truck_before, s.D.pin, s.D.pin_new, s.D.new_win], [w.tk2, w.tk, 569, true, [510, 750]]);
  assert.deepEqual([s.E.pin, s.E.pin_lost, s.E.pin_was], [875, null, null], 'E at its minute again: nothing pointed anew');
  assert.deepEqual([s.H.new_win, s.H.late_min], [null, null]);
  assert.deepEqual(p.accept.at, { [w.ids.D]: 569 });
  neverEarlier(w, p, moved);
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: p.accept })).saved, true);
  await sameAsPreview(h, p, 'G1c');
  const d1 = await dayOf(h, w);
  assert.deepEqual([d1.D.truck, d1.D.pinned, d1.D.at], [w.tk2, true, 569]);
  // G4, a day with room: the re-plan and a booking leave D on the Voiture at its minute
  await h.c.query('savepoint g4');
  await replan(h, w);
  const d2 = await dayOf(h, w);
  assert.deepEqual([d2.D.truck, d2.D.eta, d2.D.at], [w.tk2, 569, 569]);
  await h.c.query('rollback to savepoint g4');
  assert.equal((await bookNearC(h, w)).ok, true);
  const d3 = await dayOf(h, w);
  assert.deepEqual([d3.D.truck, d3.D.eta, d3.D.at], [w.tk2, 569, 569]);
}));

/* ------------------------------------------------------------------------------------------------------------------
   G3 — TODAY, a tight day: accepted where he put it; F4; the warn-first
   ------------------------------------------------------------------------------------------------------------------ */

test('G3 F4 today 10 h 20, A en route: B dragged after E → B 18 h 12 pointed (16 h – 20 h); F 20 h 07: 7 min late, NO « new window » (its window is already 16 h – 20 h; Part 28 said « 16 h à 20 h devient 16 h à 20 h »); the Camion 102 min past its hours; refused until accepted, then saved in his order', () => tx(async (h) => {
  const day = await h.val(`select public.local_today()::text`);
  const w = await hassanDay(h, { day, today: { now: 620, enRoute: true } });
  const d0 = await dayOf(h, w);
  assert.deepEqual(etas(d0, ['B', 'C', 'D', 'E', 'F']), [709, 860, 927, 1018, 1095], 'the day before');
  assert.deepEqual([d0.C.at, d0.E.at], [860, 1015]);
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 3);   // A is under way (not listed): B after C, D, E
  const moved = [w.ids.B];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const s = Object.fromEntries(['B', 'C', 'D', 'E', 'F'].map((k) => [k, stopOf(p, w.ids[k])]));
  assert.deepEqual([s.C.eta, s.D.eta, s.E.eta, s.B.eta, s.F.eta], [860, 927, 1018, 1092, 1207]);
  assert.deepEqual([s.B.pin, s.B.pin_new, s.B.new_win], [1092, true, [960, 1200]]);
  assert.deepEqual([s.E.pin, s.E.pin_was, s.E.pin_lost], [1018, 1015, null], 'E (3 min past its minute, not made later): pointed again');
  assert.deepEqual([s.F.win, s.F.new_win, s.F.late_min], [[960, 1200], null, 7], 'F4: late, no new window');
  assert.equal(p.accept.windows[w.ids.F], undefined, 'F4: not asked as a new window');
  assert.deepEqual(p.accept.late, { [w.ids.F]: 7 });
  assert.equal(p.trucks.find((t) => t.id === w.tk).over_min, 102);
  assert.deepEqual(p.accept.at, { [w.ids.B]: 1092, [w.ids.E]: 1018 });
  // G3: never refused for lateness — only until accepted (« Enregistrer quand même »)
  for (const a of [{}, { ...p.accept, late: {} }, { ...p.accept, over: {} }, { ...p.accept, at: {} }]) {
    assert.equal((await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: a })))?.hint, 'outcome_changed');
  }
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: p.accept })).saved, true);
  await sameAsPreview(h, p, 'G3');
  const d1 = await dayOf(h, w);
  assert.deepEqual(['C', 'D', 'E', 'B', 'F'].map((k) => d1[k].order), [2, 3, 4, 5, 6], 'his order (after A, under way)');
  assert.deepEqual([d1.B.at, d1.C.at, d1.E.at], [1092, 860, 1018]);
}));

/* ------------------------------------------------------------------------------------------------------------------
   G4 — a later automatic plan on a TIGHT day: the guard keeps the stored routes (Part 27's planner breaks the minutes)
   ------------------------------------------------------------------------------------------------------------------ */

test('G4 tight day (today, the Camion past its hours, F late): after the save, a re-plan (a cancel, « Client absent », the evening lock) keeps the stored routes — kept, why late — every minute held; without the guard (Part 27’s re-plan) C pointed 14 h 20 is sent to 17 h 50', () => tx(async (h) => {
  const day = await h.val(`select public.local_today()::text`);
  const w = await hassanDay(h, { day, today: { now: 620, enRoute: true } });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 3);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  const d1 = await dayOf(h, w);
  // what Part 27's re-plan does to this day (inside a savepoint, undone): the planner of a tight day breaks the minutes
  await h.c.query('savepoint old');
  await server(h, part27('replan_block_safe'));
  await server(h, part27('plan_route'));
  await replan(h, w);
  const old = await dayOf(h, w);
  assert.ok(old.C.eta > old.C.at, `Part 27: C past its minute (${old.C.eta} > ${old.C.at})`);
  await h.c.query('rollback to savepoint old');
  // Part 29: kept (the guard), or planned with the Camion frozen (plan_route: its stored day would break)
  const r = await replan(h, w);
  assert.ok((r.kept && r.why === 'late') || (r.frozen ?? []).includes(w.tk), 'kept or the Camion frozen: ' + JSON.stringify({ kept: r.kept, why: r.why, frozen: r.frozen }));
  const d2 = await dayOf(h, w);
  for (const k of ['C', 'E', 'B']) assert.deepEqual([d2[k].eta, d2[k].at, d2[k].order], [d1[k].at, d1[k].at, d1[k].order], `${k} at its minute, in his order`);
  for (const k of ['D', 'F', 'G', 'H']) assert.deepEqual([d2[k].eta, d2[k].order], [d1[k].eta, d1[k].order], `${k} as saved`);
  // roads_replan (the measures, the switch) of that day: the same guard (and Part 27's text breaks it the same way)
  await h.c.query('savepoint rr');
  const rr = await sval(h, `select public.roads_replan(array[$1::date]) v`, [w.day]);
  assert.deepEqual(rr.kept, [{ day: w.day, block: 'day' }], 'roads_replan: kept (the guard, or the Camion frozen)');
  const dr = await dayOf(h, w);
  for (const k of ['C', 'E', 'B']) assert.deepEqual([dr[k].eta, dr[k].at], [d1[k].at, d1[k].at], `${k} at its minute after roads_replan`);
  await server(h, part27('roads_replan'));
  await server(h, part27('plan_route'));
  await sval(h, `select public.roads_replan(array[$1::date]) v`, [w.day]);
  assert.ok((await dayOf(h, w)).C.eta > d1.C.at, 'Part 27’s roads_replan: C past its minute');
  await h.c.query('rollback to savepoint rr');
  // a cancel of the Voiture's G re-plans the day (job_step → replan_block_safe): the Camion's minutes hold
  assert.equal((await h.rpc('job_step', { p_op: uuid(), p_job: w.ids.G, p_action: 'cancel', p_data: {} })).ok, true);
  const d3 = await dayOf(h, w);
  for (const k of ['C', 'E', 'B']) assert.deepEqual([d3[k].eta, d3[k].at], [d1[k].at, d1[k].at], `${k} at its minute after a cancel`);
}));

test('G4 tight later day (the trucks start at 10 h 20, not today): the planner alone would make late someone served on time; after the save a re-plan keeps the stored routes (kept, why late), every stop as saved', () => tx(async (h) => {
  const w = await hassanDay(h, { hours: [[620, 1200]] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.ok(Object.keys(p.accept.late).length + Object.keys(p.accept.over).length > 0, 'a tight day: something late or past the hours');
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  const d1 = await dayOf(h, w);
  const core = await sval(h, `select public.plan_route_core($1::date, 'day', null, null, null, null) v`, [w.day]);
  const breaks = (core.late ?? []).filter((id) => { const x = d1[w.name[id]]; return x && x.eta <= (x.at ?? x.win[1]); });
  assert.ok(breaks.length > 0, 'the planner alone would make late someone served on time: ' + JSON.stringify((core.late ?? []).map((x) => w.name[x])));
  // the reviews' F1: plan_route freezes the Camion (every plan of that day: a booking, a length, the hours)
  const plan = await sval(h, `select public.plan_block($1::date, 'day') v`, [w.day]);
  assert.deepEqual(plan.frozen, [w.tk], 'the Camion frozen');
  assert.deepEqual(await sval(h, `select public.plan_breaks($1::jsonb, null) v`, [JSON.stringify(plan)]), [], 'the plan breaks nothing');
  const r = await replan(h, w);
  assert.ok(r.why === 'late' || (r.frozen ?? []).includes(w.tk), JSON.stringify({ why: r.why, frozen: r.frozen }));
  const d2 = await dayOf(h, w);
  for (const k of Object.keys(d1)) assert.deepEqual([d2[k].eta, d2[k].order, d2[k].at], [d1[k].eta, d1[k].order, d1[k].at], `${k} as saved`);
}));

test('G4 a day with room: after the save, a re-plan may plan the others around the dragged stop (his 11-21 rule), never the dragged stop; nothing is « kept »', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  const r = await replan(h, w);
  assert.equal(r.kept, undefined, 'planned, not kept: ' + JSON.stringify(Object.keys(r)));
  const d = await dayOf(h, w);
  assert.deepEqual([d.B.eta, d.B.at, d.B.truck], [929, 929, w.tk], 'B where he put it');
  for (const [k, v] of Object.entries(d)) assert.ok(v.eta >= v.win[0] && v.eta <= v.win[1], `${k} inside its window`);
  assert.equal((await bookNearC(h, w)).ok, true, 'a booking at 10 h is placed');
  assert.deepEqual([(await dayOf(h, w)).B.eta], [929]);
}));

/* ------------------------------------------------------------------------------------------------------------------
   G5 — the window of the dragged stop, and what the client is owed (no text by itself)
   ------------------------------------------------------------------------------------------------------------------ */

test('G5 D1 a dragged stop whose new hour is inside the window it has (and was told) keeps it: nothing to tell; one outside gets the window of its hour, owed for the day’s button; nobody is texted', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  // everybody told what they have
  for (const k of Object.keys(w.ids)) {
    const r = await row(h, w.ids[k]);
    await set(h, w.ids[k], { told_day: w.day, told_start: r.win_start, told_end: r.win_end, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms' });
  }
  const msgs = async () => Number(await sval(h, `select count(*) v from public.messages`));
  const m0 = await msgs();
  // D (11 h 45 – 15 h 45, 12 h 44) dragged after E: right after E's end → inside its window
  let b = await basis(h, w);
  let lists = moveIn(b.lists, w.ids.D, w.tk, 4);
  let p = await preview(h, w.day, lists, { moved: [w.ids.D], was: b.was });
  const sd = stopOf(p, w.ids.D);
  assert.ok(sd.eta > 764 && sd.eta <= 945, `D after E, inside 11 h 45 – 15 h 45 (${sd.eta})`);
  assert.deepEqual([sd.new_win, sd.win_back, sd.pin, sd.pin_new], [null, false, sd.eta, true], 'D1: its window kept, pointed');
  assert.deepEqual(p.accept.windows, {});
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.D], was: b.was, accept: p.accept })).saved, true);
  const state = (k) => sval(h, `select public.tell_state(j) v from public.jobs j where j.id = $1`, [w.ids[k]]);
  assert.equal(await state('D'), 'ok', 'inside what he was told: nothing to send');
  // B (8 h 30 – 12 h 30) dragged to the end: outside → the window of its hour, owed
  b = await basis(h, w);
  lists = moveIn(b.lists, w.ids.B, w.tk, -1);
  p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  const sb = stopOf(p, w.ids.B);
  assert.deepEqual(sb.new_win, await winFor(h, sb.eta));
  assert.deepEqual(p.accept.windows, { [w.ids.B]: sb.new_win[0] });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  assert.equal(await state('B'), 'changed', 'owed his new window: the day’s button');
  assert.equal(await msgs(), m0, 'no text by itself');
}));

test('told (replaces the first half of Part 28’s D8 TOLD): H told 8 h 30 à 12 h 30, planned 13 h à 17 h by an earlier save (13 h 00); a save that does not drag her → she stays at 13 h 00 (Part 28 pulled her back to 9 h 32, inside what she was told), no win_back, still owed', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  await set(h, w.ids.H, { win_start: 780, win_end: 1020, told_day: w.day, told_start: 510, told_end: 750, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms' });
  await sval(h, `select public.route_hold($1::uuid, $2::date, 'day', '{}'::jsonb)::text v`, [w.tk2, w.day]);
  assert.equal((await row(h, w.ids.H)).eta_min, 780, 'the Voiture waits for her 13 h');
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);   // only the Camion changes
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  const sh = stopOf(p, w.ids.H);
  assert.deepEqual([sh.eta, sh.new_win, sh.win_back, sh.early_min], [780, null, false, null], 'H keeps 13 h and her planned window');
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  assert.equal(await sval(h, `select public.tell_state(j) v from public.jobs j where j.id = $1`, [w.ids.H]), 'changed', 'still owed 13 h à 17 h');
}));

/* ------------------------------------------------------------------------------------------------------------------
   G6 — « Laisser l'app choisir »
   ------------------------------------------------------------------------------------------------------------------ */

test('G6 « Laisser l’app choisir » after a save with drags: the lists are the planner’s, the save clears the minutes and the vehicles kept by hand; a stop dragged AFTER it in the same draft is pointed', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  let b = await basis(h, w);
  let lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  let p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  assert.equal((await dayOf(h, w)).B.at, 929);
  b = await basis(h, w);
  const a = await preview(h, w.day, null, { was: b.was, auto: true });
  assert.equal(a.auto, true);
  assert.deepEqual([a.accept.at, a.accept.pins], [{}, {}], 'nothing pointed, nothing said lost (asked first in the app)');
  assert.ok(a.stops.every((s) => s.pin === null && s.pin_new === false));
  // the same draft, F then dragged first on the Camion
  const camion = a.lists.find((l) => l.truck === w.tk);
  const l2 = moveIn(a.lists, w.ids.F, w.tk, 0);
  void camion;
  const q = await preview(h, w.day, l2, { moved: [w.ids.F], was: b.was, auto: true });
  const sf = stopOf(q, w.ids.F);
  assert.deepEqual([sf.pin, sf.pin_new], [sf.eta, true], 'F dragged after « Laisser l’app choisir »: pointed');
  assert.deepEqual(q.accept.at, { [w.ids.F]: sf.eta });
  assert.equal((await save(h, w.day, l2, { moved: [w.ids.F], was: b.was, auto: true, accept: q.accept })).saved, true);
  const d = await dayOf(h, w);
  assert.deepEqual([d.F.at, d.F.pinned], [sf.eta, true]);
  for (const k of ['A', 'B', 'C', 'D', 'E', 'G', 'H']) assert.deepEqual([d[k].at, d[k].pinned], [null, false], `${k}: the app's order, nothing by hand`);
}));

/* ------------------------------------------------------------------------------------------------------------------
   warn first, the mechanic, the switch « Vraies routes », blocks mode
   ------------------------------------------------------------------------------------------------------------------ */

test('warn first: accept.at missing, or another minute → outcome_changed with the whole answer, nothing written; the windows’ refusal as before', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const moved = [w.ids.B];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  const snap = async () => JSON.stringify(await server(h, `select coalesce(jsonb_agg(to_jsonb(j) order by j.id), '[]') r from public.jobs j where j.day = $1`, [w.day]));
  const before = await snap();
  for (const at of [undefined, {}, { [w.ids.B]: 930 }, { [w.ids.B]: '929' }]) {
    const e = await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: { ...p.accept, at } }));
    assert.equal(e?.hint, 'outcome_changed', JSON.stringify(at));
    assert.deepEqual(JSON.parse(e.detail).accept, p.accept, 'the refusal carries the whole answer');
  }
  assert.equal((await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: { ...p.accept, windows: {} } })))?.hint, 'outcome_changed', 'the new window');
  assert.equal(await snap(), before, 'nothing written');
  // more minutes accepted than shown (an older answer): fewer consequences never refuse
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: { ...p.accept, at: { ...p.accept.at, [w.ids.F]: 1044 } } })).saved, true);
}));

test('a save by the mechanic (no « Réserver », his own truck): the dragged stop is pointed, its window never re-cut (late said, hand_at); the others keep theirs', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [], driver: true });
  await become(h, w.saleh);
  const b = await basis(h, w, [w.tk]);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal(p.rewin, false);
  const sb = stopOf(p, w.ids.B);
  assert.deepEqual([sb.eta, sb.pin, sb.pin_new, sb.new_win, sb.late_min], [929, 929, true, null, 929 - 750]);
  assert.deepEqual(etas(Object.fromEntries(['C', 'D', 'E'].map((k) => [k, stopOf(p, w.ids[k])])), ['C', 'D', 'E']), [697, 764, 855]);
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  const rb = await row(h, w.ids.B);
  assert.deepEqual([rb.arrive_at, rb.win_start, rb.win_end, rb.hand_at !== null], [929, 510, 750, true]);
}));

/** everything the coming days still want, measured: fn(pair) minutes (reorganiser.test.mjs's) */
async function measureAll(h, fn = () => 12) {
  for (let i = 0; i < 20; i++) {
    const w = await sval(h, `select public.drive_wanted(null, null, 120) v`);
    if (!w.total) return;
    await sval(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify(w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], fn(p), 5, 'tomtom']))]);
  }
  throw new Error('still something to measure');
}

test('blocks mode (not live): the others keep their arrival times (Part 28 pulled them earlier), no minute is written (a minute is window mode only)', () => tx(async (h) => {
  await h.as(null);
  const owner = await h.person('Hassan Roy', ['owner'], { short_name: 'Hassan' });
  const day = await h.val(`select (public.local_today() + 37)::text`);
  const tk = await h.truck('Camion', null, week());
  await h.q(`update public.trucks set start = $2::jsonb where id = $1`, [tk, JSON.stringify({ label: 'Garage', lat: HERE[0], lng: HERE[1] })]);
  await h.q(`update public.trucks set active = false where id <> $1 and active`, [tk]);
  const ids = {};
  for (const [i, k] of ['A', 'B', 'C', 'D'].entries()) {
    const cu = await h.customer(k, ...P[k]);
    ids[k] = await put(h, { customer_id: cu, day, block: 'am', truck_id: tk, stop_order: i + 1, duration_min: 30, lat: P[k][0], lng: P[k][1] });
  }
  await sval(h, `select public.route_hold($1::uuid, $2::date, 'am', '{}'::jsonb)::text v`, [tk, day]);
  await become(h, owner);
  const w = { day, tk, tk2: tk, ids, name: Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k])), blocks: true, owner };
  const before = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await row(h, id)).eta_min])));
  const b = await basis(h, w, [tk]);
  const lists = b.lists.map((l) => (l.block === 'am' ? { ...l, jobs: [ids.B, ids.C, ids.D, ids.A] } : l));
  const p = await preview(h, day, lists, { moved: [ids.A], was: b.was });
  assert.equal(p.mode, 'blocks');
  for (const k of ['B', 'C', 'D']) assert.equal(stopOf(p, ids[k]).eta, before[k], `${k} keeps its arrival`);
  assert.ok(stopOf(p, ids.A).eta > before.D, 'A after D');
  assert.deepEqual([stopOf(p, ids.A).pin, stopOf(p, ids.A).pin_new, p.accept.at], [null, false, {}]);
  assert.equal((await save(h, day, lists, { moved: [ids.A], was: b.was, accept: p.accept })).saved, true);
  for (const k of ['A', 'B', 'C', 'D']) assert.equal((await row(h, ids[k])).arrive_at, null);
}));

/* ------------------------------------------------------------------------------------------------------------------
   The reviews' fix (reports/drag-keeps-review-days.md F1, F7, F8). F1: on a TIGHT day (someone late, the truck past its
   hours: what « Enregistrer quand même » makes), every path that writes a plan of the whole day — a booking, « Réserver
   quand même », a length changed, the truck's hours, a move into the day — went through Part 27's planner, which breaks
   the minutes and the windows there. Now plan_route freezes the vehicle whose stored day the plan would break (Part 27's
   frozen vehicle: its stops stay in their order, nothing new on it but « quand même », at its end); the other vehicle is
   planned around (G4)
   ------------------------------------------------------------------------------------------------------------------ */

/** the tight day of G3, saved: today 10 h 20, A under way, B dragged after E (F 7 min late, the Camion past its hours) */
async function tightToday(h) {
  const day = await h.val(`select public.local_today()::text`);
  const w = await hassanDay(h, { day, today: { now: 620, enRoute: true } });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 3);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  return { w, d1: await dayOf(h, w) };
}
/** a tight LATER day: the trucks from 10 h 20, B dragged to place 5 and saved (« quand même ») */
async function tightLater(h) {
  const w = await hassanDay(h, { hours: [[620, 1200]] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  return { w, d1: await dayOf(h, w) };
}
/** after a later action, against the day as saved: every stop still on a vehicle; one at its minute stays at it; one
 *  inside its window stays inside it (the same window); one already past its minute is not made later; the vehicles of
 *  `order` keep his order */
function keeps(w, d1, d2, what, order = [w.tk]) {
  for (const [k, x] of Object.entries(d1)) {
    if (!w.ids[k] || x.status === 'en_route') continue;
    const y = d2[k];
    assert.ok(y, `${what}: ${k} still on a vehicle`);
    if (x.at != null && x.eta <= x.at) assert.deepEqual([y.at, y.eta], [x.at, x.at], `${what}: ${k} at its minute`);
    else if (x.at != null) assert.ok(y.eta <= x.eta, `${what}: ${k} (past its minute) not made later (${y.eta} ≤ ${x.eta})`);
    else if (x.win[0] != null && x.eta >= x.win[0] && x.eta <= x.win[1]) {
      assert.deepEqual(y.win, x.win, `${what}: ${k} its window`);
      assert.ok(y.eta >= x.win[0] && y.eta <= x.win[1], `${what}: ${k} inside its window (${y.eta} in ${x.win})`);
    }
  }
  for (const t of order) {
    const was = Object.keys(d1).filter((k) => w.ids[k] && d1[k].truck === t).sort((a, b) => d1[a].order - d1[b].order);
    const now = Object.keys(d2).filter((k) => was.includes(k) && d2[k].truck === t).sort((a, b) => d2[a].order - d2[b].order);
    assert.deepEqual(now, was, `${what}: his order on that vehicle`);
  }
}
const bookAt = async (h, w, job) => {
  await h.as(null);
  const near = await h.customer('Nouveau', P.C[0] + 0.004, P.C[1]);
  await become(h, w.owner);
  let r = null;
  const e = await h.fails(async () => { r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: near, day: w.day, block: 'day', duration_min: 45, ...job }, p_items: [] }); });
  return e ? { refused: e.hint } : r;
};
const try_ = async (h, fn) => { await h.c.query('savepoint z'); try { return await fn(); } finally { await h.c.query('rollback to savepoint z'); } };

test('F1 tight today, saved (B after E): a plain booking at 16 h does not go on the Camion (its day as saved: every minute, window and his order), it goes on the Voiture', () => tx(async (h) => {
  const { w, d1 } = await tightToday(h);
  const r = await bookAt(h, w, { win_start: 960 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.truck_id, w.tk2, 'on the Voiture');
  keeps(w, d1, await dayOf(h, w), 'booking 16 h');
}));

test('F1 tight today, saved: « Réserver quand même » on the Camion goes at the END of his order, nobody else moves; D shortened (75 → 45 min) and the Camion until 21 h keep every minute and his order', () => tx(async (h) => {
  const { w, d1 } = await tightToday(h);
  await try_(h, async () => {
    const r = await bookAt(h, w, { win_start: 960, truck_id: w.tk, force: true });
    assert.deepEqual([r.ok, r.forced, r.truck_id], [true, true, w.tk], JSON.stringify(r));
    const d2 = await dayOf(h, w);
    keeps(w, d1, d2, '« quand même »');
    const last = Math.max(...Object.values(d2).filter((x) => x.truck === w.tk).map((x) => x.order));
    assert.equal(d2[r.job_id].order, last, 'at the end of his order');
  });
  await try_(h, async () => {
    assert.equal((await h.rpc('set_job_duration', { p_op: uuid(), p_job: w.ids.D, p_duration: 45 })).ok, true);
    keeps(w, d1, await dayOf(h, w), 'D 75 → 45');
  });
  await try_(h, async () => {
    const dow = String(new Date(w.day + 'T12:00:00').getDay());
    assert.equal((await h.rpc('apply_hours', { p_op: uuid(), p_truck: w.tk, p_mode: 'day', p_week: { [dow]: [[480, 1260]] }, p_from: w.day, p_weeks: 1 })).ok, true);
    keeps(w, d1, await dayOf(h, w), 'the Camion until 21 h', []);
  });
}));

test('F1 a tight LATER day (the trucks from 10 h 20), saved: a booking, « Réserver quand même », a length changed, the hours — A (never dragged, 9 h 30 – 13 h 30) stays inside its window, every minute held', () => tx(async (h) => {
  const { w, d1 } = await tightLater(h);
  await try_(h, async () => { const r = await bookAt(h, w, { win_start: 960 }); if (r.ok) keeps(w, d1, await dayOf(h, w), 'booking 16 h'); else assert.match(r.refused, /block_full|window_full/); });
  await try_(h, async () => {
    const r = await bookAt(h, w, { win_start: 960, force: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    keeps(w, d1, await dayOf(h, w), '« quand même » 16 h');
  });
  await try_(h, async () => { assert.equal((await h.rpc('set_job_duration', { p_op: uuid(), p_job: w.ids.D, p_duration: 45 })).ok, true); keeps(w, d1, await dayOf(h, w), 'D 75 → 45'); });
  await try_(h, async () => {
    const dow = String(new Date(w.day + 'T12:00:00').getDay());
    assert.equal((await h.rpc('apply_hours', { p_op: uuid(), p_truck: w.tk, p_mode: 'day', p_week: { [dow]: [[620, 1260]] }, p_from: w.day, p_weeks: 1 })).ok, true);
    keeps(w, d1, await dayOf(h, w), 'the Camion until 21 h', []);
  });
}));

test('F1 live as it is today (no Part 29 save: C and E pointed by exact moves, E 3 min past its minute): a plain booking at 16 h keeps C at 14 h 20 and his order (Part 27 sent C to 23 h 22)', () => tx(async (h) => {
  const day = await h.val(`select public.local_today()::text`);
  const w = await hassanDay(h, { day, today: { now: 620, enRoute: true } });
  const d1 = await dayOf(h, w);
  const r = await bookAt(h, w, { win_start: 960 });
  if (r.ok) keeps(w, d1, await dayOf(h, w), 'booking 16 h'); else assert.match(r.refused, /block_full|window_full/);
  // a move of the Voiture's G onto the Camion, the same day: refused, or it keeps the Camion's day
  const e = await h.fails(() => h.rpc('move_job', { p_op: uuid(), p_job: w.ids.G, p_day: w.day, p_block: 'day', p_truck: w.tk }));
  if (!e) keeps(w, d1, await dayOf(h, w), 'G onto the Camion', []);
}));

test('F1 a day with room: the planner as before (nothing frozen): the same answer with or without the fix, a booking placed as before', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  const plan = await sval(h, `select public.plan_block($1::date, 'day') v`, [w.day]);
  assert.equal(plan.frozen, undefined, 'nothing frozen on a day with room');
  const core = await sval(h, `select public.plan_route_core($1::date, 'day', null, null, null, null) v`, [w.day]);
  assert.deepEqual(plan, core, 'plan_block = the planner of before');
  assert.equal((await bookNearC(h, w)).ok, true);
}));

test('F7 today: the clock crosses a 5-minute step between the preview and « Enregistrer » → saved with the minute walked now (at most 5 later than shown); past that, « Regarde de nouveau »', () => tx(async (h) => {
  const day = await h.val(`select public.local_today()::text`);
  const w = await hassanDay(h, { day, today: { now: 621, enRoute: true }, pins: [] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.F, w.tk, 0);
  const moved = [w.ids.F];
  const p = await preview(h, w.day, lists, { moved, was: b.was });
  await clock(h, 626);
  const p2 = await preview(h, w.day, lists, { moved, was: b.was });
  assert.ok(p2.accept.at[w.ids.F] > p.accept.at[w.ids.F] && p2.accept.at[w.ids.F] <= p.accept.at[w.ids.F] + 5, `F's minute walked from the clock (${p.accept.at[w.ids.F]} → ${p2.accept.at[w.ids.F]})`);
  assert.deepEqual([p2.accept.windows, p2.accept.flex, p2.accept.pins], [p.accept.windows, p.accept.flex, p.accept.pins], 'nothing else new');
  await try_(h, async () => {
    await clock(h, 640);
    assert.equal((await h.fails(() => save(h, w.day, lists, { moved, was: b.was, accept: p.accept })))?.hint, 'outcome_changed', '15 minutes later: look again');
  });
  assert.equal((await save(h, w.day, lists, { moved, was: b.was, accept: p.accept })).saved, true);
  assert.equal((await row(h, w.ids.F)).arrive_at, p2.accept.at[w.ids.F], 'the minute walked now');
}));

test('F8 « Vraies routes » on, trips not measured: a dragged stop whose guessed hour is inside its window is pointed; one outside it is NOT (no minute from a guess outside what it has), its row says « not measured »', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  await measureAll(h, () => 12);
  await become(h, w.owner);
  assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).on, true);
  await server(h, `delete from public.drive_times where a = public.drive_key($1, $2) or b = public.drive_key($1, $2)`, P.B);
  const b = await basis(h, w);
  // A after B (inside 8 h – 12 h): pointed
  const la = moveIn(b.lists, w.ids.A, w.tk, 1);
  const pa = await preview(h, w.day, la, { moved: [w.ids.A], was: b.was });
  const sa = stopOf(pa, w.ids.A);
  assert.ok(sa.eta >= sa.win[0] && sa.eta <= sa.win[1], 'inside its window');
  assert.deepEqual([sa.measured, sa.pin, sa.pin_new], [false, sa.eta, true]);
  // B to the end (outside 8 h 30 – 12 h 30): not pointed
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  const sb = stopOf(p, w.ids.B);
  assert.ok(sb.eta > sb.win[1], 'outside its window');
  assert.deepEqual([sb.measured, sb.pin, sb.pin_new, sb.new_win, sb.late_min], [false, null, false, null, null]);
  assert.equal(p.accept.at[w.ids.B], undefined);
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  const rb = await row(h, w.ids.B);
  assert.deepEqual([rb.arrive_at, rb.win_start, rb.win_end], [null, 510, 750], 'no minute; its window as it was');
}));

/* ------------------------------------------------------------------------------------------------------------------
   the file
   ------------------------------------------------------------------------------------------------------------------ */

test('the migration: « Part 29 » first, only day_order_core, replan_block_safe, roads_replan, plan_route and plan_route_core made again and plan_breaks added (create or replace), no drop / delete / truncate / alter function, the rights the server’s own; applied twice the same functions and grants', () => tx(async (h) => {
  const sql = readFileSync(FILE, 'utf8');
  assert.match(sql.split('\n')[0], /^-- Part 29 — Réorganiser/);
  const code = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(drop|truncate)\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i);
  assert.doesNotMatch(code, /alter\s+(function|table)/i);
  assert.doesNotMatch(code, /\bcreate\s+function\b/i, 'only « create or replace »');
  const made = [...sql.matchAll(/^create or replace function public\.([a-z_0-9]+)\s*\(/gim)].map((m) => m[1]);
  assert.deepEqual(made.sort(), ['day_order_core', 'plan_breaks', 'plan_route', 'plan_route_core', 'replan_block_safe', 'roads_replan']);
  await h.as(null); await h.c.query('reset role');
  const state = () => h.q(`select coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, p.proacl::text, md5(p.prosrc)) order by p.oid::regprocedure::text), '[]') fns
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('day_order_core', 'replan_block_safe', 'roads_replan', 'plan_route', 'plan_route_core', 'plan_breaks', 'day_order_preview', 'day_order_save')`);
  const built = await state();
  for (const f of built[0].fns) {
    if (/^(day_order_core|replan_block_safe|roads_replan|plan_route|plan_route_core|plan_breaks)\(/.test(f[0])) {
      assert.doesNotMatch(f[1], /authenticated=|anon=|(^|[{,])=X\//, `${f[0]}: the server's own (${f[1]})`);
      assert.match(f[1], /service_role=X\//, `${f[0]}: the server may call it`);
    }
  }
  await h.c.query(sql);
  assert.deepEqual(await state(), built, 'applied a second time');
  await h.c.query(sql);
  assert.deepEqual(await state(), built, 'and a third');
}));

/* ------------------------------------------------------------------------------------------------------------------
   ops/live/partie29: the way back, and the try (on this copy)
   ------------------------------------------------------------------------------------------------------------------ */

const OPS = fileURLToPath(new URL('../../ops/live/partie29/', import.meta.url));
const undo = () => readFileSync(OPS + 'retour-partie29.sql', 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '');

test('the way back (retour-partie29.sql) puts back Part 28’s save and Part 27’s re-plans: a drag down then moves the others up again (C 11 h 37 → 10 h 30); the migration applied again is Part 29 again', () => tx(async (h) => {
  const w = await hassanDay(h, { pins: [] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const cOf = async () => stopOf(await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was }), w.ids.C).eta;
  assert.equal(await cOf(), 697, 'Part 29');
  await h.as(null); await h.c.query('reset role');
  await h.c.query(undo());
  const left = await h.q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('day_order_core', 'replan_block_safe', 'roads_replan', 'plan_route', 'plan_route_core') and prosrc like '%Part 29%'`);
  assert.deepEqual(left, [], 'none says Part 29');
  await become(h, w.owner);
  assert.equal(await cOf(), 630, 'Part 28 again (its F1: pulled to its window’s start)');
  await h.as(null); await h.c.query('reset role');
  await h.c.query(readFileSync(FILE, 'utf8'));
  await become(h, w.owner);
  assert.equal(await cOf(), 697, 'Part 29 again');
}));

test('the try (essai-partie29.sql) on this copy, Part 29 undone first and the download replaced by the file: « ESSAI OK : garder_ordre », the planner’s answers the same, the tight blocks and the minutes passed named, nothing kept', (t) => tx(async (h) => {
  // a coming day within the 14 the try plans: the trucks from 10 h 20 (tight), C and E pointed (E 3 min past its minute)
  const w = await hassanDay(h, { day: await h.val(`select (public.local_today() + 3)::text`), hours: [[620, 1200]] });
  const b = await basis(h, w);
  const lists = moveIn(b.lists, w.ids.B, w.tk, 4);
  const p = await preview(h, w.day, lists, { moved: [w.ids.B], was: b.was });
  assert.equal((await save(h, w.day, lists, { moved: [w.ids.B], was: b.was, accept: p.accept })).saved, true);
  await h.as(null); await h.c.query('reset role');
  // live's bookkeeping of migrations (absent from this copy), with Part 28 there and Part 29 not
  await h.c.query(`create schema if not exists supabase_migrations`);
  await h.c.query(`create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])`);
  await h.c.query(`insert into supabase_migrations.schema_migrations (version, name) values ('20261122000100', 'reorganiser') on conflict do nothing`);
  await h.c.query(`delete from supabase_migrations.schema_migrations where version = '20261122000200'`);
  await h.c.query(undo());
  const tmpl = readFileSync(OPS + 'essai-partie29.sql', 'utf8');
  const local = tmpl.replace(/  select \* into r from extensions\.http_get[\s\S]*?raise exception 'sha différent : %', sha; end if;\n/, "  body := current_setting('essai.body');\n");
  assert.ok(local !== tmpl && !local.includes('http_get'), 'the download replaced');
  await h.c.query(`select set_config('essai.body', $1, true)`, [readFileSync(FILE, 'utf8')]);
  const before = await h.q(`select md5(string_agg(prosrc, '' order by proname)) m from pg_proc where pronamespace = 'public'::regnamespace and proname in ('day_order_core', 'replan_block_safe', 'roads_replan', 'plan_route', 'plan_route_core')`);
  await h.c.query('savepoint e');
  let msg = null;
  try { await h.c.query(local); } catch (e) { msg = e.message; }
  await h.c.query('rollback to savepoint e');
  assert.match(msg ?? '', /^ESSAI OK : garder_ordre \(rien n'est gardé\) ; (\d+) réponses du planificateur comparées, les mêmes hors des blocs serrés ; (\d+) blocs serrés où les véhicules gelés gardent leur ordre/, msg);
  t.diagnostic(msg);
  const [, n, tight] = /; (\d+) réponses .*; (\d+) blocs serrés/.exec(msg);
  assert.ok(msg.includes(w.tk), `the tight day's frozen vehicle is named: ${msg}`);
  assert.ok(Number(n) >= 14, `${n} answers`);
  assert.ok(Number(tight) >= 1 && msg.includes(w.day), `the tight day is named: ${msg}`);
  assert.match(msg, /minutes pointées déjà dépassées/);
  const after = await h.q(`select md5(string_agg(prosrc, '' order by proname)) m from pg_proc where pronamespace = 'public'::regnamespace and proname in ('day_order_core', 'replan_block_safe', 'roads_replan', 'plan_route', 'plan_route_core')`);
  assert.deepEqual(after, before, 'nothing kept');
  // and its two refusals: Part 29 already there, Part 28 missing
  await h.c.query(readFileSync(FILE, 'utf8'));
  await h.c.query(`insert into supabase_migrations.schema_migrations (version, name) values ('20261122000200', 'garder_ordre')`);
  await h.c.query('savepoint e2');
  msg = null;
  try { await h.c.query(local); } catch (e) { msg = e.message; }
  await h.c.query('rollback to savepoint e2');
  assert.match(msg ?? '', /^ARRÊT : la Partie 29 \(20261122000200\) est déjà en ligne/);
}));
