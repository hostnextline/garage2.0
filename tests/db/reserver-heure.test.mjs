// « Réserver à l'heure choisie » (Part 30, 20261122000300_reserver_heure.sql; Hassan, 2026-11-22: « if i forcefully book
// someone at a specific time, i want the system to show a warning if there is no place but still let me book it, then show
// me the new map »; STATE.md 13:00, K1, K2, K5). book_job with p_job.arrive_at (+ truck_id, late_ok) and its preview
// book_preview(p_job, p_items). Each test runs in a transaction rolled back at the end.
// Run: node --test tests/db/reserver-heure.test.mjs (Mac: bash tests/stack/mac/db-tests.sh reserver-heure)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const P = { A: [45.5150, -73.6400], B: [45.5300, -73.6000], C: [45.4700, -73.5800], D: [45.5700, -73.7500], N: [45.5100, -73.6550] };
const DAY = [[480, 1200]];
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
const winFor = async (h, who, at) => { const r = (await server(h, who, `select * from public.win_for($1)`, [at]))[0]; return [r.win_start, r.win_end]; };
const row = async (h, who, id) => (await server(h, who, `select to_jsonb(j) r from public.jobs j where j.id = $1`, [id]))[0]?.r ?? null;
const seq = async (h, who) => (await server(h, who, `select last_value, is_called from public.job_number_seq`))[0];
/** every appointment of the day, what a booking may write */
const snap = (h, who, day) => server(h, who, `select id, truck_id, stop_order, eta_min, travel_min, win_start, win_end, arrive_at, forced, updated_at
  from public.jobs where day = $1 and deleted_at is null order by id`, [day]);
const stopOf = (r, id) => r.stops.find((s) => s.id === id);
/** the booking at a minute, as the new app sends it */
const bookAt = (h, job, items = []) => h.rpc('book_job', { p_op: uuid(), p_job: { block: 'day', duration_min: 60, ...job }, p_items: items });
const preview = (h, job, items = []) => h.rpc('book_preview', { p_job: { block: 'day', duration_min: 60, ...job }, p_items: items });

/** one truck (« Camion ») working 8 h – 20 h that day, four appointments of 60 min (A 8–12, B 10–14, C 12–16, D 14–18),
 *  windows on; `hours`: the truck's hours; `second`: a « Voiture » too; `mechanic`: Saleh drives the Camion */
async function world(h, { hours = DAY, second = false, mechanic = false, dur = {} } = {}) {
  const owner = await h.person('Hassan', ['owner']);
  const saleh = mechanic ? await h.person('Saleh', ['mechanic']) : null;
  const day = await futureDay(h, 4, 3);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const tk = await h.truck('Camion', saleh, { [dow]: hours });
  await h.as(null);
  await h.q(`update public.trucks set sort = 1, tire_machine = true where id = $1`, [tk]);
  const tk2 = second ? await h.truck('Voiture', null, { [dow]: DAY }) : null;
  if (tk2) await h.q(`update public.trucks set sort = 2, tire_machine = false where id = $1`, [tk2]);
  // the browser tests' vehicles (a database not made fresh) are left out of this rolled-back world
  await h.q(`update public.trucks set active = false where id <> all($1::uuid[]) and active`, [[tk, tk2].filter(Boolean)]);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const cust = {};
  for (const k of Object.keys(P)) cust[k] = await h.customer(k, ...P[k]);
  const ids = {};
  const W = { A: 480, B: 600, C: 720, D: 840 };
  for (const k of ['A', 'B', 'C', 'D']) {
    const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: cust[k], day, block: 'day', duration_min: dur[k] ?? 60, win_start: W[k], truck_id: tk }, p_items: [] });
    ids[k] = r.job_id;
  }
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, saleh, day, dow, tk, tk2, cust, ids, name };
}
const order = async (h, w, truck = w.tk) =>
  (await server(h, w.me ?? w.owner, `select id from public.jobs where day = $1 and truck_id = $2 and status = 'booked' and deleted_at is null order by stop_order`, [w.day, truck])).map((r) => w.name[r.id] ?? 'N');

test('a day with room: booked AT the minute (pinned, its window that of the minute), nobody else moves; the preview said so first and wrote nothing, not even a job number', () => tx(async (h) => {
  const w = await world(h);
  const before = await snap(h, w.owner, w.day);
  const s0 = await seq(h, w.owner);
  const acts0 = (await server(h, w.owner, `select count(*)::int n from public.activity`))[0].n;
  const id = uuid();
  const job = { id, customer_id: w.cust.N, day: w.day, arrive_at: 1020 };
  const p = await preview(h, job);
  assert.equal(p.ok, true); assert.equal(p.exact, true); assert.equal(p.preview, true);
  assert.deepEqual([p.at, p.job_id, p.truck_id], [1020, id, w.tk]);
  assert.deepEqual([p.win_start, p.win_end], await winFor(h, w.owner, 1020));
  assert.deepEqual([p.forced, p.may_force, p.late, p.over_hours], [false, true, [], 0]);
  for (const k of ['A', 'B', 'C', 'D']) {
    const s = stopOf(p, w.ids[k]);
    assert.ok(s, `${k} in the preview`); assert.equal(s.delay_min, 0, `${k} keeps its hour`); assert.equal(s.late, false);
  }
  assert.equal(stopOf(p, id).eta_after, 1020);
  // nothing written: the rows, the job number, the activity
  assert.deepEqual(await snap(h, w.owner, w.day), before, 'the preview wrote nothing');
  assert.deepEqual(await seq(h, w.owner), s0, 'the preview spent no job number');
  assert.equal((await server(h, w.owner, `select count(*)::int n from public.activity`))[0].n, acts0, 'no activity');
  assert.equal(await row(h, w.owner, id), null);
  // booked
  const r = await bookAt(h, job, [{ description: 'Diagnostic', duration_min: 60, unit_cents: 9000 }]);
  assert.deepEqual([r.ok, r.exact, r.job_id, r.truck_id, r.forced, r.at, r.eta], [true, true, id, w.tk, false, 1020, 1020]);
  const n = await row(h, w.owner, id);
  assert.deepEqual([n.eta_min, n.arrive_at, n.truck_id, n.truck_pinned, n.forced, n.block, n.win_flex], [1020, 1020, w.tk, true, false, 'day', false]);
  assert.deepEqual([n.win_start, n.win_end], await winFor(h, w.owner, 1020));
  assert.deepEqual([r.win_start, r.win_end], [n.win_start, n.win_end]);
  assert.ok(n.number > 0, 'a real job number');
  for (const b of before) {
    const x = await row(h, w.owner, b.id);
    assert.deepEqual([x.eta_min, x.win_start, x.win_end, x.truck_id], [b.eta_min, b.win_start, b.win_end, b.truck_id], `${w.name[b.id]} unchanged`);
  }
  assert.deepEqual(await order(h, w), ['A', 'B', 'C', 'D', 'N']);
  assert.ok(r.rows.jobs.some((x) => x.id === id && x.eta_min === 1020), 'the rows of the day');
  assert.equal(r.rows.job_items.length, 1, 'its line');
  // the booking text's window (Part 28: never told, its window the one of the minute)
  const told = (await server(h, w.owner, `select public.tell_state(j) st, (select row_to_json(x) from public.tell_now(j) x) now from public.jobs j where j.id = $1`, [id]))[0];
  assert.equal(told.st, 'new');
  assert.deepEqual([told.now.n_start, told.now.n_end], [n.win_start, n.win_end], 'the booking text says the window of the minute');
}));

test('the minute between two stops: it goes there, the stop after it pushed later inside its window is SAID (delay), never late', () => tx(async (h) => {
  const w = await world(h);
  const before = Object.fromEntries((await snap(h, w.owner, w.day)).map((x) => [w.name[x.id], x]));
  const id = uuid();
  const p = await preview(h, { id, customer_id: w.cust.N, day: w.day, arrive_at: 690 });
  assert.equal(stopOf(p, id).eta_after, 690);
  const r = await bookAt(h, { id, customer_id: w.cust.N, day: w.day, arrive_at: 690 });
  assert.equal(r.forced, false);
  assert.deepEqual(await order(h, w), ['A', 'B', 'N', 'C', 'D']);
  for (const k of ['A', 'B']) assert.equal((await row(h, w.owner, w.ids[k])).eta_min, before[k].eta_min, `${k} keeps its hour`);
  for (const k of ['C', 'D']) {
    const x = await row(h, w.owner, w.ids[k]);
    assert.equal(x.eta_min, stopOf(p, w.ids[k]).eta_after, `${k} as previewed`);
    assert.ok(x.eta_min >= before[k].eta_min && x.eta_min <= x.win_end, `${k} inside its window`);
  }
  assert.ok(stopOf(p, w.ids.C).delay_min > 0, 'C pushed, said');
}));


test('no room (9 h for 4 h of work): the preview names who would be late and by how much; refused until they are accepted (nothing written, no number spent); then booked AT 9 h, the others pushed exactly as previewed, in their order', () => tx(async (h) => {
  const w = await world(h);
  const id = uuid();
  const job = { id, customer_id: w.cust.N, day: w.day, arrive_at: 540, duration_min: 240 };
  const p = await preview(h, job);
  assert.deepEqual([p.ok, p.forced, p.may_force, p.over_hours, p.truck_id], [true, true, true, 0, w.tk]);
  const late = p.late.map((x) => w.name[x.id]);
  assert.deepEqual(late, ['A', 'B'], 'A and B would arrive after their window');
  for (const x of p.late) {
    const s = stopOf(p, x.id);
    assert.equal(s.late, true); assert.equal(s.late_min, x.late_min); assert.ok(x.late_min > 0);
    assert.equal(s.late_min, s.eta_after - s.win_end, 'by how much: past the end of the window told');
  }
  for (const k of ['C', 'D']) { const s = stopOf(p, w.ids[k]); assert.ok(s.delay_min > 0 && !s.late, `${k} pushed, inside its window`); }
  const before = await snap(h, w.owner, w.day);
  const s0 = await seq(h, w.owner);
  // refused while the late ones are not accepted (the app's preview, then « Réserver quand même »)
  for (const ok of [[], [w.ids.A]]) {
    const e = await h.fails(() => bookAt(h, { ...job, late_ok: ok }));
    assert.equal(e?.hint, 'late_changed', `late_ok ${ok.length}`);
    const d = JSON.parse(e.detail);
    assert.deepEqual(d.late.map((x) => w.name[x.id]), ['A', 'B']); assert.equal(d.over_hours, 0);
  }
  assert.deepEqual(await snap(h, w.owner, w.day), before, 'nothing written');
  assert.deepEqual(await seq(h, w.owner), s0, 'no job number spent by a refusal');
  // « Réserver quand même à 9 h »
  const r = await bookAt(h, { ...job, late_ok: p.late.map((x) => x.id) });
  assert.deepEqual([r.ok, r.forced, r.truck_id, r.eta], [true, true, w.tk, 540]);
  assert.deepEqual(r.late, p.late, 'the same late ones, by the same minutes');
  assert.deepEqual(await order(h, w), ['N', 'A', 'B', 'C', 'D'], 'at its minute; the others in their order');
  for (const s of p.stops) assert.equal((await row(h, w.owner, s.id)).eta_min, s.eta_after, `${w.name[s.id] ?? 'N'} exactly as previewed`);
  const n = await row(h, w.owner, id);
  assert.deepEqual([n.eta_min, n.arrive_at, n.truck_pinned, n.forced], [540, 540, true, false], 'pinned at 9 h (never a « quand même » of Part 19: at the end)');
  for (const k of ['A', 'B', 'C', 'D']) {
    const x = await row(h, w.owner, w.ids[k]);
    const b = before.find((y) => y.id === w.ids[k]);
    assert.deepEqual([x.win_start, x.win_end], [b.win_start, b.win_end], `${k} keeps the window it was told`);
  }
  const act = await server(h, w.owner, `select action, data from public.activity where entity_id = $1 and action = 'booked_at'`, [id]);
  assert.equal(act.length, 1, 'who was made late, kept');
  assert.deepEqual(act[0].data.late, p.late); assert.equal(act[0].data.at, 540);
}));

test('past the truck\'s hours (19 h for 2 h, the truck ends at 20 h): the preview says by how much; the new appointment\'s own id accepts it', () => tx(async (h) => {
  const w = await world(h);
  const id = uuid();
  const job = { id, customer_id: w.cust.N, day: w.day, arrive_at: 1140, duration_min: 120 };
  const p = await preview(h, job);
  assert.deepEqual([p.forced, p.late, p.over_hours > 0], [true, [], true]);
  assert.equal(p.over_hours, 1140 + 5 + 120 - 1200, 'its end (with the 5 minutes of a stop) past 20 h');
  assert.equal((await h.fails(() => bookAt(h, job)))?.hint, 'late_changed');
  const r = await bookAt(h, { ...job, late_ok: [id] });
  assert.deepEqual([r.ok, r.forced, r.eta, r.over_hours], [true, true, 1140, p.over_hours]);
  for (const k of ['A', 'B', 'C', 'D']) assert.equal(stopOf(r, w.ids[k]).delay_min, 0, `${k} keeps its hour`);
}));

test('the truck cannot be there (8 h: it leaves the garage at 8 h): refused « arrive_late » with the earliest minute, the preview too; « Mettre à … » books at that minute', () => tx(async (h) => {
  const w = await world(h);
  const id = uuid();
  const job = { id, customer_id: w.cust.N, day: w.day, arrive_at: 480 };
  const e = await h.fails(() => preview(h, job));
  assert.equal(e?.hint, 'arrive_late');
  const d = JSON.parse(e.detail);
  assert.ok(d.earliest > 480, `the earliest: ${d.earliest}`);
  assert.equal(d.truck_id, w.tk);
  assert.match(e.message, /au plus tôt 8 h 0\d/);
  assert.equal((await h.fails(() => bookAt(h, job)))?.hint, 'arrive_late', 'the booking too');
  assert.equal(await row(h, w.owner, id), null);
  const p = await preview(h, { ...job, arrive_at: d.earliest });
  const r = await bookAt(h, { ...job, arrive_at: d.earliest, late_ok: p.late.map((x) => x.id).concat(p.over_hours > 0 ? [id] : []) });
  assert.equal(r.eta, d.earliest);
  assert.equal((await row(h, w.owner, id)).arrive_at, d.earliest);
}));

/* ---------- a TIGHT day of Part 29 (the fixture of tests/db/reorganiser-garde.test.mjs: hassanDay + tightLater) ---------- */
const HERE = [45.5150, -73.6400];
const Q = { A: [45.5300, -73.6000], B: [45.4700, -73.5800], C: [45.5700, -73.7000], D: [45.5100, -73.6650], E: [45.4950, -73.6100],
  F: [45.5400, -73.6300], G: [45.5050, -73.5900], H: [45.5250, -73.6800] };
const week = (r) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, r]));
async function asServer(h, fn) { await h.as(null); await h.q(`select set_config('garage.rpc', 'on', true)`); try { return await fn(); } finally { await h.q(`select set_config('garage.rpc', '', true)`); } }
async function putJob(h, j) {
  const id = uuid();
  const r = { duration_min: 60, block: 'day', status: 'booked', ...j, id };
  const cols = Object.keys(r).map((k) => `"${k}"`).join(', ');
  await asServer(h, () => h.q(`insert into public.jobs (${cols}) select ${cols} from jsonb_populate_record(null::public.jobs, $1::jsonb)`, [JSON.stringify(r)]));
  return id;
}
const setJob = (h, id, cols) => asServer(h, () => h.q(`update public.jobs set ${Object.keys(cols).map((k, i) => `"${k}" = $${i + 2}`).join(', ')} where id = $1`, [id, ...Object.values(cols)]));
/** Hassan's kind of day, the trucks from 10 h 20: the Camion's six stops walked, their windows cut from their arrivals, C
 *  and E pointed 20 minutes later; then B dragged to place 5 and saved « quand même » (Part 29): a tight day, where the
 *  planner alone would make late someone the stored day serves on time, so plan_route freezes the Camion */
async function tightLater(h) {
  await h.as(null);
  const owner = await h.person('Hassan Roy', ['owner'], { short_name: 'Hassan' });
  const day = await h.val(`select (public.local_today() + 37)::text`);
  const tk = await h.truck('Camion', null, week([[620, 1200]]));
  const tk2 = await h.truck('Voiture', null, week([[620, 1200]]));
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [tk2]);
  await h.q(`update public.trucks set start = $2::jsonb where id = any($1::uuid[])`, [[tk, tk2], JSON.stringify({ label: 'Garage', lat: HERE[0], lng: HERE[1] })]);
  await h.q(`update public.trucks set active = false where id <> all($1::uuid[]) and active`, [[tk, tk2]]);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  await h.as(null);
  await h.q(`set local session_replication_role = replica`);
  await h.q(`update public.settings set booking = coalesce(booking, '{}'::jsonb) || $1::jsonb where id = 1`, [JSON.stringify({ win_before_min: 60, win_after_min: 180, win_round_min: 15 })]);
  await h.q(`set local session_replication_role = origin`);
  const spec = [['A', 'tk', 60], ['B', 'tk', 90], ['C', 'tk', 45], ['D', 'tk', 75], ['E', 'tk', 60], ['F', 'tk', 90], ['G', 'tk2', 60], ['H', 'tk2', 45]];
  const ids = {}, n = { tk: 0, tk2: 0 };
  for (const [k, t, dur] of spec) {
    const c = await h.customer(k, ...Q[k]);
    ids[k] = await putJob(h, { customer_id: c, day, block: 'day', truck_id: t === 'tk' ? tk : tk2, stop_order: ++n[t], win_start: 480, win_end: 1200, duration_min: dur, lat: Q[k][0], lng: Q[k][1] });
  }
  const walk = async () => { await h.as(null); for (const t of [tk, tk2]) await h.q(`select public.route_hold($1::uuid, $2::date, 'day', '{}'::jsonb)`, [t, day]); };
  await walk();
  for (const k of Object.keys(ids)) {
    const r = (await h.q(`select eta_min from public.jobs where id = $1`, [ids[k]]))[0];
    const w = (await h.q(`select * from public.win_for($1)`, [r.eta_min]))[0];
    await setJob(h, ids[k], { win_start: w.win_start, win_end: w.win_end });
  }
  for (const k of ['C', 'E']) {
    const r = (await h.q(`select eta_min from public.jobs where id = $1`, [ids[k]]))[0];
    const at = Math.ceil((r.eta_min + 20) / 5) * 5;
    const w = (await h.q(`select * from public.win_for($1)`, [at]))[0];
    await setJob(h, ids[k], { arrive_at: at, win_start: w.win_start, win_end: w.win_end, truck_pinned: true });
  }
  await walk();
  await h.as(owner);
  const rows = await server(h, owner, `select id, truck_id, block, stop_order, win_start, win_end, arrive_at, status from public.jobs
    where day = $1 and truck_id = any($2::uuid[]) and deleted_at is null and status in ('booked', 'en_route', 'on_site') order by stop_order nulls last, eta_min nulls last, id`, [day, [tk, tk2]]);
  const was = Object.fromEntries(rows.map((r) => [r.id, [r.truck_id, r.block, r.stop_order, r.win_start, r.win_end, r.arrive_at, r.status]]));
  const lists = [tk, tk2].map((t) => ({ truck: t, block: 'day', jobs: rows.filter((r) => r.truck_id === t).map((r) => r.id) }));
  lists[0].jobs = lists[0].jobs.filter((x) => x !== ids.B); lists[0].jobs.splice(4, 0, ids.B);
  const J = (v) => JSON.stringify(v);
  const p = await h.val(`select public.day_order_preview($1::date, $2::jsonb, $3::uuid[], $4::jsonb, false) v`, [day, J(lists), [ids.B], J(was)]);
  assert.ok(Object.keys(p.accept.late).length + Object.keys(p.accept.over).length > 0, 'saved « quand même »: someone late or past the hours');
  const s = await h.val(`select public.day_order_save($1::uuid, $2::date, $3::jsonb, $4::uuid[], $5::jsonb, false, $6::jsonb) v`, [uuid(), day, J(lists), [ids.B], J(was), J(p.accept)]);
  assert.equal(s.saved, true);
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, day, tk, tk2, ids, name };
}
const camion = async (h, w) => (await server(h, w.owner, `select id, stop_order, eta_min, arrive_at, duration_min from public.jobs where day = $1 and truck_id = $2 and status = 'booked' and deleted_at is null order by stop_order`, [w.day, w.tk]))
  .map((r) => ({ k: w.name[r.id] ?? 'N', id: r.id, order: r.stop_order, eta: r.eta_min, at: r.arrive_at, dur: r.duration_min }));

test('a TIGHT day of Part 29 (the Camion frozen by the planner): « Réserver quand même » of before goes at the END of his order; a booking « quand même » AT a minute goes AT that minute, in the middle, the others in their order; a later plain booking keeps it there', () => tx(async (h) => {
  const w = await tightLater(h);
  const plan = await server(h, w.owner, `select public.plan_block($1::date, 'day') p`, [w.day]);
  assert.deepEqual(plan[0].p.frozen, [w.tk], 'a tight day: the planner freezes the Camion (Part 29)');
  const d1 = await camion(h, w);
  const cust = await h.customer('Nouveau', Q.D[0] + 0.004, Q.D[1]);
  await h.as(w.owner);
  // the « quand même » of before (Part 19 / Part 29): at the end of the Camion's order
  await h.c.query('savepoint before');
  const old = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: cust, day: w.day, block: 'day', duration_min: 45, win_start: 780, truck_id: w.tk, force: true }, p_items: [] });
  assert.deepEqual([old.ok, old.forced], [true, true]);
  const o2 = await camion(h, w);
  assert.equal(o2[o2.length - 1].id, old.job_id, 'the « quand même » of before: at the end');
  await h.c.query('rollback to savepoint before');
  // at a minute: right after the Camion's second stop
  const second = d1[1];
  let at = Math.ceil((second.eta + 5 + second.dur + 15) / 5) * 5;
  const id = uuid();
  const job = { id, customer_id: cust, day: w.day, arrive_at: at, duration_min: 45, truck_id: w.tk };
  let p = null;
  const e = await h.fails(async () => { p = await preview(h, job); });
  if (e) { assert.equal(e.hint, 'arrive_late', e.message); at = JSON.parse(e.detail).earliest; job.arrive_at = at; p = await preview(h, job); }
  assert.equal(p.forced, true, 'no room there: somebody late or the Camion past its hours');
  const r = await bookAt(h, { ...job, late_ok: p.late.map((x) => x.id).concat(p.over_hours > 0 ? [id] : []) });
  assert.deepEqual([r.ok, r.eta], [true, at], `AT ${at} on a tight day`);
  const d2 = await camion(h, w);
  assert.notEqual(d2[d2.length - 1].id, id, 'not at the end');
  assert.deepEqual(d2.filter((x) => x.id !== id).map((x) => x.k), d1.map((x) => x.k), 'the others keep his order');
  for (const s of p.stops) assert.equal(d2.find((x) => x.id === s.id)?.eta, s.eta_after, `${w.name[s.id] ?? 'N'} as previewed`);
  for (const x of d1) if (!p.stops.find((s) => s.id === x.id && s.delay_min > 0)) assert.equal(d2.find((y) => y.id === x.id).eta, x.eta, `${x.k} keeps its hour`);
  // a later plain booking: the Camion stays frozen, the new minute held
  const cy = await h.customer('Y', Q.G[0] + 0.003, Q.G[1]);
  await h.as(w.owner);
  const r3 = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: cy, day: w.day, block: 'day', duration_min: 30, win_start: 900 }, p_items: [] }).catch((e) => ({ refused: e.hint }));
  assert.ok(r3.ok || /block_full|window_full/.test(r3.refused), JSON.stringify(r3));
  const d3 = await camion(h, w);
  assert.equal(d3.find((x) => x.id === id).eta, at, 'the new appointment still at its minute');
  assert.deepEqual(d3.filter((x) => x.id !== id && x.id !== r3.job_id).map((x) => x.k), d1.map((x) => x.k), 'his order');
}));

test('rights: a mechanic without « Réserver » books on his own truck at a minute with room; a time with no room is SAID to him (may_force false) and refused « not_allowed » even accepted; the office may force it', () => tx(async (h) => {
  const w = await world(h, { mechanic: true });
  await h.as(w.saleh); w.me = w.saleh;
  const id = uuid();
  // another truck than his, or none named: book_job's own rule
  assert.equal((await h.fails(() => preview(h, { id, customer_id: w.cust.N, day: w.day, arrive_at: 1020 })))?.hint, 'not_allowed');
  const ok = await preview(h, { id, customer_id: w.cust.N, day: w.day, arrive_at: 1020, truck_id: w.tk });
  assert.deepEqual([ok.forced, ok.may_force], [false, false]);
  const r = await bookAt(h, { id, customer_id: w.cust.N, day: w.day, arrive_at: 1020, truck_id: w.tk });
  assert.deepEqual([r.ok, r.eta], [true, 1020]);
  const id2 = uuid();
  const job = { id: id2, customer_id: w.cust.N, day: w.day, arrive_at: 540, duration_min: 240, truck_id: w.tk };
  const p = await preview(h, job);
  assert.deepEqual([p.forced, p.may_force, p.late.length > 0], [true, false, true], 'said, not refused');
  const e = await h.fails(() => bookAt(h, { ...job, late_ok: p.late.map((x) => x.id) }));
  assert.equal(e?.hint, 'not_allowed');
  assert.match(e.message, /propriétaire et le bureau/);
  assert.equal(await row(h, w.saleh, id2), null);
  // the office: the right of « Réserver quand même »
  await h.as(null);
  const lina = await h.person('Lina', ['office']);
  await h.as(lina); w.me = lina;
  const p3 = await preview(h, job);
  assert.equal(p3.may_force, true);
  assert.equal((await bookAt(h, { ...job, late_ok: p3.late.map((x) => x.id) })).eta, 540);
}));

test('two vehicles, none asked: the one where nobody is made late; both with room: the car first (as the planner); a tire job or « Camion » asked: the Camion', () => tx(async (h) => {
  const w = await world(h, { second: true });
  const p = await preview(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 540, duration_min: 240 });
  assert.deepEqual([p.truck_id, p.forced], [w.tk2, false], 'the Voiture: nobody late');
  const q = await preview(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 1020 });
  assert.equal(q.truck_id, w.tk2, 'both have room: the car first');
  const k = await preview(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 1020, vehicle_kind: 'truck' });
  assert.equal(k.truck_id, w.tk, '« Camion » asked');
  const m = await preview(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 1020 }, [{ description: 'Montage de 4 pneus', duration_min: 60 }]);
  assert.equal(m.truck_id, w.tk, 'tire work: the truck with the machine');
  const r = await bookAt(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 540, duration_min: 240 });
  assert.deepEqual([r.truck_id, r.eta, r.forced], [w.tk2, 540, false]);
}));

test('blocks mode: the minute is not read (the booking of before), the preview answers « not exact »; window mode: a minute that is not a whole minute of the day is refused; « flexible » wins over a minute', () => tx(async (h) => {
  const w = await world(h);
  const bad = await h.fails(() => bookAt(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 600.5 }));
  assert.equal(bad?.hint, 'bad_window');
  const flex = await bookAt(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 1020, win_flex: true });
  assert.equal(flex.ok, true);
  assert.equal((await row(h, w.owner, flex.job_id)).arrive_at, null, '« flexible »: no minute');
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: false })).ok, true);
  const pv = await preview(h, { id: uuid(), customer_id: w.cust.N, day: w.day, arrive_at: 1020 });
  assert.deepEqual(pv, { ok: true, exact: false, stops: [] });
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: w.cust.N, day: w.day, block: 'eve', duration_min: 60, arrive_at: 1020 }, p_items: [] });
  assert.equal(r.ok, true); assert.equal(r.exact, undefined);
  const n = await row(h, w.owner, r.job_id);
  assert.deepEqual([n.block, n.arrive_at], ['eve', null], 'the booking of before');
}));

test('the same booking sent twice (the answer lost): the second gets the first answer, one appointment', () => tx(async (h) => {
  const w = await world(h);
  const op = uuid(), id = uuid();
  const args = { p_op: op, p_job: { id, customer_id: w.cust.N, day: w.day, block: 'day', duration_min: 60, arrive_at: 1020 }, p_items: [] };
  const a = await h.rpc('book_job', args);
  const b = await h.rpc('book_job', args);
  assert.deepEqual(b, a);
  assert.equal((await server(h, w.owner, `select count(*)::int n from public.jobs where id = $1`, [id]))[0].n, 1);
}));


/* ---------- the file ---------- */
const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const FILE = MIG + '20261122000300_reserver_heure.sql';
const fnText = (src, head, end = '\nend $function$;') => { const i = src.indexOf(head); assert.ok(i >= 0, head); return src.slice(i, src.indexOf(end, i) + end.length); };

test('the migration: « Part 30 » first; only book_job made again (Part 27\'s text but the « Part 30 » lines) and book_at, book_at_row, book_at_try, book_preview added; no drop / delete / truncate / alter; the rights; applied twice the same functions and grants', () => tx(async (h) => {
  const sql = readFileSync(FILE, 'utf8');
  assert.match(sql.split('\n')[0], /^-- Part 30 — Réserver à l'heure choisie/);
  const code = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(code, /\b(drop|truncate)\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i);
  assert.doesNotMatch(code, /alter\s+(function|table)/i);
  assert.doesNotMatch(code, /\bcreate\s+function\b/i, 'only « create or replace »');
  const made = [...sql.matchAll(/^create or replace function public\.([a-z_0-9]+)\s*\(/gim)].map((m) => m[1]);
  assert.deepEqual(made.sort(), ['book_at', 'book_at_row', 'book_at_try', 'book_job', 'book_preview']);
  // book_job: Part 27's text, but the lines that say « Part 30 » (its two declarations and its one branch)
  const head = "CREATE OR REPLACE FUNCTION public.book_job(p_op uuid, p_job jsonb, p_items jsonb DEFAULT '[]'::jsonb)";
  const p27 = fnText(readFileSync(MIG + '20261119000200_vraies_routes.sql', 'utf8'), head);
  let p30 = fnText(sql, head);
  p30 = p30.replace(/\n  -- Part 30: the minute said[^\n]*\n  v_at int; v_preview boolean[^\n]*/, '');
  const a = p30.indexOf('\n  -- Part 30 (« Réserver à l\'heure choisie »)'), b = p30.indexOf('\n\n  -- the window chosen: inside the day');
  assert.ok(a > 0 && b > a);
  assert.equal(p30.slice(0, a) + p30.slice(b + 1), p27, 'nothing else of book_job changed');
  await h.as(null); await h.c.query('reset role');
  const state = () => h.q(`select coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, p.proacl::text, md5(p.prosrc)) order by p.oid::regprocedure::text), '[]') fns
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('book_job', 'book_at', 'book_at_row', 'book_at_try', 'book_preview')`);
  const built = await state();
  assert.equal(built[0].fns.length, 5, 'one function each');
  for (const f of built[0].fns) {
    if (/^(book_job|book_preview)\(/.test(f[0])) {
      assert.match(f[1], /authenticated=X\//, `${f[0]}: the app may call it`);
      assert.doesNotMatch(f[1], /anon=|(^|[{,])=X\//, `${f[0]}: never the public key (${f[1]})`);
    } else {
      assert.doesNotMatch(f[1], /authenticated=|anon=|(^|[{,])=X\//, `${f[0]}: the server's own (${f[1]})`);
      assert.match(f[1], /service_role=X\//, `${f[0]}: the server may call it`);
    }
  }
  await h.c.query(sql);
  assert.deepEqual(await state(), built, 'applied a second time');
  await h.c.query(sql);
  assert.deepEqual(await state(), built, 'and a third');
}));
