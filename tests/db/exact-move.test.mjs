// « Un déplacement tombe exactement où on pointe » (Hassan, 2026-11-21: « when i move an appointement, i want it to move
// exactly where i point it to move, but the rest stays the same »; STATE.md « exact move », S1–S9 with the owner's
// correction of 20:25). The move with a minute pointed: move_job's 8th argument p_exact = { at, late_ok }, and its preview
// move_preview(p_job, p_day, p_truck, p_at). Each test runs in a transaction rolled back at the end.
// Run: node --test tests/db/exact-move.test.mjs (Mac: bash tests/stack/mac/db-tests.sh exact-move)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

// the places of the reader's runs (reports/exact-move-server-exp/s3.mjs): a few km apart in Montréal
const P = { A: [45.5150, -73.6400], B: [45.5300, -73.6000], C: [45.4700, -73.5800], D: [45.5700, -73.7500], E: [45.5100, -73.6550],
  F: [45.4950, -73.6100], G: [45.5200, -73.6300] };
const DAY = [[480, 1200]];
const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
/** asks the server itself (its own building blocks are not open to the app), then goes on as `who` */
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
const winFor = async (h, who, at) => { const r = (await server(h, who, `select * from public.win_for($1)`, [at]))[0]; return [r.win_start, r.win_end]; };
/** the job as JSON (its day as « YYYY-MM-DD », as the app reads it) */
const row = async (h, id) => (await h.one(`select to_jsonb(j) r from public.jobs j where j.id = $1`, [id])).r;
/** the move with a minute pointed, as the new app sends it (the 8 names) */
const exact = (h, job, day, at, { truck = null, lateOk = [], op = uuid() } = {}) =>
  h.rpc('move_job', { p_op: op, p_job: job, p_day: day, p_block: 'day', p_truck: truck, p_win_start: null, p_win_flex: null, p_exact: { at, late_ok: lateOk } });
const preview = (h, job, day, at, truck = null) => h.rpc('move_preview', { p_job: job, p_day: day, p_truck: truck, p_at: at });
/** every appointment of those days, the columns a move may write */
const snap = (h, days) => h.q(`select id, day::text, block, truck_id, truck_pinned, stop_order, eta_min, travel_min, win_start, win_end, win_flex,
    arrive_at, manual_order, forced, confirm_sent_at, eta_measured, updated_at, status from public.jobs where day = any($1::date[]) and deleted_at is null order by id`, [days]);
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const stopOf = (r, id) => r.stops.find((s) => s.id === id);

/** the owner's case: one truck working 8 h – 20 h on a Thursday and the Friday after, four appointments of 60 min on the
 *  Thursday (A 8–12, B 10–14, C 12–16, D 14–18: C is the third) and two on the Friday (E 9–13, F 12–16), windows on.
 *  `dur` / `ws`: other lengths or windows; `hours`: the truck's hours; `trucks`: a second vehicle (« Voiture »). */
async function world(h, { dur = {}, ws = {}, hours = DAY, second = null, mechanic = false } = {}) {
  const owner = await h.person('Hassan', ['owner']);
  const saleh = mechanic ? await h.person('Saleh', ['mechanic']) : null;
  const day = await futureDay(h, 4, 3);
  const day2 = await h.val(`select ($1::date + 1)::text`, [day]);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const tk = await h.truck('Camion', saleh, { [dow]: hours, [(dow + 1) % 7]: hours });
  const tk2 = second ? await h.truck('Voiture', null, second.week ?? { [dow]: DAY, [(dow + 1) % 7]: DAY }) : null;
  if (second?.start) await server(h, null, `update public.trucks set start = $2::jsonb where id = $1`, [tk2, JSON.stringify(second.start)]);
  // the browser tests' vehicles (a database not made fresh) are left out of this rolled-back world
  await server(h, null, `update public.trucks set active = false where id <> all($1::uuid[]) and active`, [[tk, tk2].filter(Boolean)]);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const cust = {};
  for (const k of Object.keys(P)) cust[k] = await h.customer(k, ...P[k]);
  const ids = {};
  const W = { A: 480, B: 600, C: 720, D: 840, E: 540, F: 720, ...ws };
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const d = 'EF'.includes(k) ? day2 : day;
    const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: cust[k], day: d, block: 'day', duration_min: dur[k] ?? 60, win_start: W[k], ...(second ? { truck_id: tk } : {}) }, p_items: [] });
    ids[k] = r.job_id;
  }
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, saleh, day, day2, dow, tk, tk2, cust, ids, name };
}
const order = async (h, w, day, truck = w.tk) =>
  (await h.q(`select id from public.jobs where day = $1 and truck_id = $2 and status = 'booked' and deleted_at is null order by stop_order`, [day, truck])).map((r) => w.name[r.id] ?? r.id);

test('the owner’s case: the third of four appointments moved to 16 h the same day arrives at 16 h exactly, its window is the one of 16 h, the three others keep their order and their times', () => tx(async (h) => {
  const w = await world(h);
  const before = byId(await snap(h, [w.day]));
  assert.deepEqual(await order(h, w, w.day), ['A', 'B', 'C', 'D']);
  const r = await exact(h, w.ids.C, w.day, 960);
  assert.equal(r.ok, true); assert.equal(r.exact, true);
  const c = await row(h, w.ids.C);
  assert.equal(c.eta_min, 960, `C arrives at 16:00 exactly (${hm(c.eta_min)})`);
  assert.equal(c.arrive_at, 960, 'the minute pointed is kept on the job');
  assert.deepEqual([c.win_start, c.win_end], await winFor(h, w.owner, 960), 'the customer’s window is the garage’s rule for 16 h (15 h à 19 h)');
  assert.equal(c.truck_id, w.tk, 'on its truck'); assert.equal(c.truck_pinned, true);
  assert.deepEqual(await order(h, w, w.day), ['A', 'B', 'D', 'C'], 'the others keep their order; C where 16 h falls');
  for (const k of ['A', 'B', 'D']) assert.equal((await row(h, w.ids[k])).eta_min, before[w.ids[k]].eta_min, `${k} keeps its time`);
  // the answer says it, stop by stop (S3)
  for (const k of ['A', 'B', 'D']) {
    const s = stopOf(r, w.ids[k]);
    assert.ok(s, `${k} is in the answer`);
    assert.equal(s.eta_before, s.eta_after); assert.equal(s.delay_min, 0); assert.equal(s.late, false); assert.equal(s.late_min, 0);
    assert.equal(s.day, w.day); assert.equal(s.truck_id, w.tk); assert.equal(s.measured, null, '« Vraies routes » off: not said');
  }
  const sc = stopOf(r, w.ids.C);
  assert.deepEqual([sc.order_before, sc.order_after, sc.eta_before, sc.eta_after], [3, 4, before[w.ids.C].eta_min, 960]);
  assert.deepEqual([sc.win_start, sc.win_end], [c.win_start, c.win_end]);
  assert.equal(r.over_hours, 0);
  assert.ok(r.earliest <= 960 && r.earliest_keep <= 960, `earliest ${r.earliest}, earliest without moving anyone ${r.earliest_keep}`);
  // and what move_job answers today
  assert.equal(r.changed, false); assert.equal(r.tell, true, 'a new window: the customer is told again'); assert.equal(r.window_changed, true);
  assert.equal(r.truck_changed, false); assert.equal(r.now.win_start, c.win_start); assert.equal(r.was.win_start, 720);
  assert.ok(Array.isArray(r.rows.jobs) && r.rows.jobs.some((x) => x.id === w.ids.C && x.eta_min === 960));
  assert.equal(c.confirm_sent_at, null);
}));

test('the owner’s case at 13 h: C between B and D at 13 h; D, after it, arrives later but inside its window: said, never late', () => tx(async (h) => {
  const w = await world(h);
  const before = byId(await snap(h, [w.day]));
  const r = await exact(h, w.ids.C, w.day, 780);
  assert.equal((await row(h, w.ids.C)).eta_min, 780);
  assert.deepEqual(await order(h, w, w.day), ['A', 'B', 'C', 'D']);
  for (const k of ['A', 'B']) assert.equal((await row(h, w.ids[k])).eta_min, before[w.ids[k]].eta_min);
  const d = await row(h, w.ids.D);
  const s = stopOf(r, w.ids.D);
  assert.ok(d.eta_min > before[w.ids.D].eta_min && d.eta_min <= d.win_end, `D pushed inside its window: ${hm(d.eta_min)}`);
  assert.equal(s.delay_min, d.eta_min - before[w.ids.D].eta_min); assert.equal(s.late, false);
  assert.equal(stopOf(r, w.ids.A).delay_min, 0);
}));

test('the owner’s case, then to another day: C at 11 h on Friday between E and F; E keeps its time; Thursday keeps its order and its times', () => tx(async (h) => {
  const w = await world(h);
  const before = byId(await snap(h, [w.day, w.day2]));
  const r = await exact(h, w.ids.C, w.day2, 660);
  const c = await row(h, w.ids.C);
  assert.equal(c.day, w.day2); assert.equal(c.eta_min, 660); assert.equal(c.arrive_at, 660); assert.equal(c.truck_id, w.tk);
  assert.deepEqual(await order(h, w, w.day2), ['E', 'C', 'F']);
  assert.equal((await row(h, w.ids.E)).eta_min, before[w.ids.E].eta_min, 'E keeps its time');
  const f = await row(h, w.ids.F);
  assert.ok(f.eta_min >= before[w.ids.F].eta_min && f.eta_min <= f.win_end, 'F inside its window');
  assert.deepEqual(await order(h, w, w.day), ['A', 'B', 'D'], 'the day it left keeps its order (numbered again)');
  for (const k of ['A', 'B', 'D']) assert.equal((await row(h, w.ids[k])).eta_min, before[w.ids[k]].eta_min, `${k} keeps its time on Thursday`);
  assert.deepEqual((await h.q(`select stop_order from public.jobs where day = $1 and status = 'booked' order by stop_order`, [w.day])).map((x) => x.stop_order), [1, 2, 3]);
  assert.equal(r.changed, true); assert.equal(r.tell, true);
  assert.equal(stopOf(r, w.ids.D).day, w.day, 'the day left is in the answer'); assert.equal(stopOf(r, w.ids.D).delay_min, 0);
  assert.equal(stopOf(r, w.ids.E).day, w.day2);
  assert.ok(r.rows.jobs.some((x) => x.id === w.ids.D), 'the rows of both days');
}));

test('two trucks: the moved appointment stays on its truck though the other one is nearer; a truck picked: it goes there, at the minute', () => tx(async (h) => {
  const w = await world(h, { second: { start: { label: 'Près de C', lat: 45.4710, lng: -73.5810 } } });
  const before = byId(await snap(h, [w.day]));
  assert.deepEqual(await order(h, w, w.day), ['A', 'B', 'C', 'D']);
  await exact(h, w.ids.C, w.day, 960);
  let c = await row(h, w.ids.C);
  assert.equal(c.truck_id, w.tk, 'its own truck'); assert.equal(c.eta_min, 960);
  const r = await exact(h, w.ids.C, w.day, 690, { truck: w.tk2 });
  c = await row(h, w.ids.C);
  assert.equal(c.truck_id, w.tk2, 'the truck picked'); assert.equal(c.eta_min, 690); assert.equal(c.truck_pinned, true);
  assert.equal(r.truck_changed, true);
  assert.deepEqual(await order(h, w, w.day), ['A', 'B', 'D']);
  for (const k of ['A', 'B', 'D']) assert.equal((await row(h, w.ids[k])).eta_min, before[w.ids[k]].eta_min, `${k} keeps its time on the Camion`);
  assert.equal(stopOf(r, w.ids.A).truck_id, w.tk, 'the truck it left is in the answer');
}));

/** A takes 3 h, B 9–13: C moved to 9 h can only go first, and B then arrives after 13 h */
const lateWorld = (h) => world(h, { dur: { A: 180 }, ws: { B: 540 } });

test('somebody after it becomes late: refused « late_changed » without late_ok (nothing written); the preview names who and by how much; moved with late_ok', () => tx(async (h) => {
  const w = await lateWorld(h);
  const before = await snap(h, [w.day]);
  const op = uuid();
  const e = await h.fails(() => exact(h, w.ids.C, w.day, 540, { op }));
  assert.equal(e?.hint, 'late_changed', e?.message);
  assert.ok(/retard/.test(e.message), 'French words');
  const det = JSON.parse(e.detail);
  assert.deepEqual(det.late.map((x) => x.id), [w.ids.B]);
  assert.deepEqual(await snap(h, [w.day]), before, 'nothing written');
  assert.equal((await server(h, w.owner, `select count(*)::int n from public.op_log where op = $1`, [op]))[0].n, 0);
  const p = await preview(h, w.ids.C, w.day, 540);
  assert.equal(p.exact, true);
  const sb = stopOf(p, w.ids.B);
  assert.equal(sb.late, true, 'B is said late');
  assert.equal(sb.late_min, sb.eta_after - sb.win_end); assert.ok(sb.late_min > 0, `by ${sb.late_min} min`);
  assert.equal(stopOf(p, w.ids.A).late, false, 'A pushed inside its window is not late');
  assert.ok(stopOf(p, w.ids.A).delay_min > 0);
  assert.equal(det.late[0].late_min, sb.late_min, 'the refusal says the same');
  const r = await exact(h, w.ids.C, w.day, 540, { lateOk: [w.ids.B] });
  assert.equal(r.ok, true);
  assert.equal((await row(h, w.ids.C)).eta_min, 540);
  assert.equal((await row(h, w.ids.B)).eta_min, sb.eta_after, 'B late, as the preview said');
  assert.deepEqual(await order(h, w, w.day), ['C', 'A', 'B', 'D']);
}));

test('the truck would end past its hours: said (over_hours) and refused unless the moved one itself is in late_ok', () => tx(async (h) => {
  const w = await world(h, { hours: [[480, 960]] });
  const p = await preview(h, w.ids.D, w.day, 930);
  assert.equal(p.over_hours, 930 + 5 + 60 - 960, 'D ends at 16:35, the truck stops at 16:00');
  assert.equal(p.stops.filter((s) => s.late).length, 0, 'nobody late: only the hours');
  const e = await h.fails(() => exact(h, w.ids.D, w.day, 930));
  assert.equal(e?.hint, 'late_changed');
  assert.equal(JSON.parse(e.detail).over_hours, p.over_hours);
  const e2 = await h.fails(() => exact(h, w.ids.D, w.day, 930, { lateOk: [w.ids.A] }));
  assert.equal(e2?.hint, 'late_changed', 'another id does not accept the hours');
  const r = await exact(h, w.ids.D, w.day, 930, { lateOk: [w.ids.D] });
  assert.equal(r.over_hours, p.over_hours);
  assert.equal((await row(h, w.ids.D)).eta_min, 930);
}));

test('the truck cannot be there at that minute: refused « arrive_late » with the earliest minute, nothing written', () => tx(async (h) => {
  const w = await world(h);
  const before = await snap(h, [w.day]);
  const acts = await h.val(`select count(*)::int from public.activity`);
  const e = await h.fails(() => exact(h, w.ids.C, w.day, 480));
  assert.equal(e?.hint, 'arrive_late', e?.message);
  const d = JSON.parse(e.detail);
  assert.ok(Number.isInteger(d.earliest) && d.earliest > 480, `the earliest: ${hm(d.earliest)}`);
  assert.ok('earliest_keep' in d);
  assert.ok(e.message.includes(`${Math.floor(d.earliest / 60)} h ${String(d.earliest % 60).padStart(2, '0')}`), e.message);
  assert.deepEqual(await snap(h, [w.day]), before, 'nothing written');
  assert.equal(await h.val(`select count(*)::int from public.activity`), acts);
  const pe = await h.fails(() => preview(h, w.ids.C, w.day, 480));
  assert.equal(pe?.hint, 'arrive_late', 'the preview refuses the same');
  assert.equal(pe.detail, e.detail);
  // and the earliest it said is taken
  const r = await exact(h, w.ids.C, w.day, d.earliest, { lateOk: Object.values(w.ids) });
  assert.equal((await row(h, w.ids.C)).eta_min, d.earliest);
  void r;
}));

test('its truck does not work that day: « pick_truck »; a truck picked that works: moved; a truck picked that does not work: « pick_truck »', () => tx(async (h) => {
  const w = await world(h, { second: { week: {} } });
  const day3 = await h.val(`select ($1::date + 2)::text`, [w.day]);
  const dow3 = await h.val(`select extract(dow from $1::date)::int`, [day3]);
  await server(h, w.owner, `insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[480, 1200]]')`, [w.tk2, dow3]);
  const e = await h.fails(() => exact(h, w.ids.C, day3, 600));
  assert.equal(e?.hint, 'pick_truck', e?.message);
  const e2 = await h.fails(() => exact(h, w.ids.C, w.day, 600, { truck: w.tk2 }));
  assert.equal(e2?.hint, 'pick_truck', 'the Voiture does not work on Thursday');
  const pe = await h.fails(() => preview(h, w.ids.C, day3, 600));
  assert.equal(pe?.hint, 'pick_truck');
  await exact(h, w.ids.C, day3, 600, { truck: w.tk2 });
  const c = await row(h, w.ids.C);
  assert.deepEqual([c.day, c.truck_id, c.eta_min], [day3, w.tk2, 600]);
}));

test('the preview answers the very same as the move then does, and writes nothing (rows, updated_at, sequences, activity, op_log)', () => tx(async (h) => {
  const w = await lateWorld(h);
  const state = async () => ({
    rows: await snap(h, [w.day, w.day2]),
    act: await h.val(`select count(*)::int from public.activity`),
    ops: (await server(h, w.owner, `select count(*)::int n from public.op_log`))[0].n,
    seqs: await server(h, w.owner, `select schemaname, sequencename, last_value from pg_sequences where schemaname = 'public' order by 2`)
  });
  for (const [job, day, at] of [[w.ids.C, w.day, 540], [w.ids.C, w.day, 780], [w.ids.D, w.day2, 840], [w.ids.A, w.day, 1000]]) {
    const s0 = await state();
    const p = await preview(h, job, day, at);
    assert.deepEqual(await state(), s0, `nothing written by the preview of ${w.name[job]} → ${hm(at)}`);
    await h.c.query('savepoint m');
    const m = await exact(h, job, day, at, { lateOk: [...p.stops.filter((s) => s.late).map((s) => s.id), ...(p.over_hours > 0 ? [job] : [])] });
    const strip = (x) => ({ ...x, rows: x.rows.jobs.map((j) => [j.id, j.day, j.truck_id, j.stop_order, j.eta_min, j.arrive_at, j.win_start]).sort() });
    assert.deepEqual(strip(p), strip(m), `the preview of ${w.name[job]} → ${hm(at)} is the move`);
    await h.c.query('rollback to savepoint m');
  }
}));

test('rights: the same as move_job. A mechanic without « book » may not move another truck’s appointment, nor preview it; on his own truck, named, he may', () => tx(async (h) => {
  const w = await world(h, { mechanic: true });
  await h.as(null);
  const other = await h.person('Karim', ['mechanic']);
  await h.as(other);
  assert.equal((await h.fails(() => exact(h, w.ids.C, w.day, 960, { truck: w.tk })))?.hint, 'not_allowed');
  assert.equal((await h.fails(() => preview(h, w.ids.C, w.day, 960, w.tk)))?.hint, 'not_allowed');
  await h.as(w.saleh);
  assert.equal((await h.fails(() => exact(h, w.ids.C, w.day, 960)))?.hint, 'not_allowed', 'as move_job: a mechanic names his truck');
  const r = await exact(h, w.ids.C, w.day, 960, { truck: w.tk });
  assert.equal(r.ok, true);
  assert.equal((await row(h, w.ids.C)).eta_min, 960);
}));

test('the new calls and the old ones: exactly one function answers each (PostgREST picks by the names sent), the helpers are closed', () => tx(async (h) => {
  const fns = await h.q(`select p.oid, p.proname n, p.pronargs, p.pronargdefaults, coalesce(p.proargnames, '{}') args
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname in ('move_job', 'move_preview')`);
  const calls = [
    ['move_job', ['p_op', 'p_job', 'p_day', 'p_block', 'p_truck']],
    ['move_job', ['p_op', 'p_job', 'p_day', 'p_block', 'p_truck', 'p_win_start', 'p_win_flex']],
    ['move_job', ['p_op', 'p_job', 'p_day', 'p_block', 'p_truck', 'p_win_start', 'p_win_flex', 'p_exact']],
    ['move_preview', ['p_truck', 'p_day', 'p_block', 'p_jobs']],
    ['move_preview', ['p_truck', 'p_day', 'p_block', 'p_jobs', 'p_as_told']],
    ['move_preview', ['p_job', 'p_day', 'p_truck', 'p_at']]
  ];
  for (const [name, sent] of calls) {
    const fits = fns.filter((f) => f.n === name && sent.every((a) => f.args.includes(a)) && f.args.slice(0, f.pronargs - f.pronargdefaults).every((a) => sent.includes(a)));
    assert.equal(fits.length, 1, `${name}(${sent.join(', ')}): ${fits.length} function(s) answer`);
    assert.equal(await h.val(`select has_function_privilege('authenticated', $1::oid, 'execute')`, [fits[0].oid]), true);
    assert.equal(await h.val(`select has_function_privilege('anon', $1::oid, 'execute')`, [fits[0].oid]), false);
  }
  const helpers = await h.q(`select p.oid::regprocedure::text f, has_function_privilege('authenticated', p.oid, 'execute') a from pg_proc p
    where p.pronamespace = 'public'::regnamespace and (p.proname like 'exact\\_%' or p.proname = 'route_hold')`);
  assert.ok(helpers.length >= 3, helpers.map((x) => x.f).join(', '));
  assert.deepEqual(helpers.filter((x) => x.a).map((x) => x.f), [], 'closed to the app');
  // the 8th argument has no default: the old app's 7 names find one function only (checked above), and the column is the server's
  assert.equal(await h.val(`select has_column_privilege('authenticated', 'public.jobs', 'arrive_at', 'UPDATE')`), false);
}));
