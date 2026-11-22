// « Un déplacement tombe exactement où on pointe » (STATE.md « exact move », 2026-11-21 20:00 + 20:25): what the two
// verifiers found and the fixer mended (reports/exact-move-verify-on.md, exact-move-verify-off.md, exact-move-fix-server.md).
//   F7  a clean move on a truck with a lunch break stays at its minute at the next plans (the wait in front of the pinned stop
//       counted the break as work time)
//   F5  a pinned stop already late (accepted at a move) is never pushed later in silence by a booking
//   F1  « Vraies routes » on: a minute that measured trips prove impossible is refused, even with a stop not measured before
//   M1 / F2  « au plus tôt »: never a minute before the one pointed (a truck with a break)
//   F3  « Vraies routes » off too: a pinned stop that a later plan puts after its minute is written down (window_late)
//   H1 / F6  the order by hand of the other stops of that truck's day stays (planned as today)
//   F8  the words for an appointment on no truck
// Each test rolls back. Run: node --test tests/db/exact-move-fix.test.mjs (Mac: bash tests/stack/mac/db-tests.sh exact-move-fix)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const P = { A: [45.5150, -73.6400], B: [45.5300, -73.6000], C: [45.4700, -73.5800], D: [45.5700, -73.7500], E: [45.5100, -73.6550],
  F: [45.4950, -73.6100], G: [45.5200, -73.6300] };
const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
const row = async (h, id) => (await h.one(`select to_jsonb(j) r from public.jobs j where j.id = $1`, [id])).r;
const exact = (h, job, day, at, { truck = null, lateOk = [] } = {}) =>
  h.rpc('move_job', { p_op: uuid(), p_job: job, p_day: day, p_block: 'day', p_truck: truck, p_win_start: null, p_win_flex: null, p_exact: { at, late_ok: lateOk } });
const preview = (h, job, day, at, truck = null) => h.rpc('move_preview', { p_job: job, p_day: day, p_truck: truck, p_at: at });
const book = (h, p_job) => h.rpc('book_job', { p_op: uuid(), p_job, p_items: [] });
const cancel = (h, job) => h.rpc('job_step', { p_op: uuid(), p_job: job, p_action: 'cancel', p_data: {} });
const stopOrder = (h, truck, day, ids) => h.val(`select public.set_stop_order($1, $2, $3, 'day', $4::uuid[])`, [uuid(), truck, day, ids]);
/** runs fn inside a savepoint that is always rolled back: the next step starts from the same day */
async function tried(h, fn) {
  await h.q('savepoint tried');
  try { return await fn(); } finally { await h.q('rollback to savepoint tried'); }
}
/** one truck (its hours on that Thursday: `hours`; the Friday 8–20), windows on, the customers of P, the appointments `jobs`
 *  [[letter, win_start, minutes]] that Thursday */
async function world(h, jobs, { hours = [[480, 1200]], positions = {} } = {}) {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h, 4, 3);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const tk = await h.truck('Camion', null, { [dow]: hours, [(dow + 1) % 7]: [[480, 1200]] });
  await server(h, null, `update public.trucks set active = false where id <> $1 and active`, [tk]);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const cust = {};
  for (const k of Object.keys({ ...P, ...positions })) cust[k] = await h.customer(k, ...(positions[k] ?? P[k]));
  const ids = {};
  for (const [k, ws, dur] of jobs) ids[k] = (await book(h, { customer_id: cust[k], day, block: 'day', duration_min: dur ?? 60, win_start: ws })).job_id;
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { owner, day, tk, cust, ids, name };
}
const order = async (h, w) =>
  (await h.q(`select id from public.jobs where day = $1 and truck_id = $2 and status = 'booked' and deleted_at is null order by stop_order`, [w.day, w.tk])).map((r) => w.name[r.id] ?? 'new');
const hands = async (h, w) =>
  (await h.q(`select id from public.jobs where day = $1 and truck_id = $2 and status = 'booked' and deleted_at is null and manual_order is not null order by manual_order`, [w.day, w.tk])).map((r) => w.name[r.id] ?? 'new');
/** « Vraies routes » on: every trip the coming days want measured at `min` minutes, then the owner's switch */
async function roadsOn(h, owner, min) {
  await h.as(null);
  for (let i = 0; i < 20; i++) {
    const w = await h.val(`select public.drive_wanted(null, null, 120) v`);
    if (!w.total) break;
    await h.val(`select public.drive_store($1::jsonb) v`, [JSON.stringify(w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], min, 5, 'tomtom']))]);
  }
  await h.as(owner);
  assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).on, true);
}

for (const [label, hours] of [['with a lunch break (8–12, 13–18)', [[480, 720], [780, 1080]]], ['without a break (8–18)', [[480, 1080]]]]) {
  test(`F7: a clean move ${label} stays at its minute: a cancel, a booking that does not touch it and a re-plan keep it there`, () => tx(async (h) => {
    const w = await world(h, [['A', 540, 30], ['C', 720, 90], ['B', 900, 60]], { hours });
    const p = await preview(h, w.ids.C, w.day, 900);
    assert.deepEqual([p.stops.filter((s) => s.late).length, p.over_hours], [0, 0], 'a clean move: nobody late, inside the hours');
    assert.equal((await exact(h, w.ids.C, w.day, 900)).ok, true);
    assert.equal((await row(h, w.ids.C)).eta_min, 900);
    await h.as(null);
    const plan = await h.val(`select public.plan_block($1::date, 'day') v`, [w.day]);
    await h.as(w.owner);
    assert.deepEqual(plan.late, [], 'the plan of that day keeps every stop in time');
    assert.ok(plan.trucks[0].left >= 0, `the truck stays inside its hours: used ${plan.trucks[0].used} of ${plan.trucks[0].cap} (the break is not work time)`);
    await tried(h, async () => {
      await cancel(h, w.ids.A);
      assert.equal((await row(h, w.ids.C)).eta_min, 900, 'a cancel of another stop: C still at 15:00');
    });
    await tried(h, async () => {
      const g = await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 30, win_start: 480 });
      assert.equal(g.ok, true, 'a morning booking that does not touch C is taken');
      assert.equal((await row(h, w.ids.C)).eta_min, 900, 'C still at 15:00');
    });
    await tried(h, async () => {
      await server(h, w.owner, `select public.replan_block_safe($1::date, 'day')`, [w.day]);
      assert.equal((await row(h, w.ids.C)).eta_min, 900, 'planned again: C still at 15:00');
    });
  }));
}

test('F5: a pin already late (accepted at a move) is never pushed later in silence: such a booking is neither offered nor booked; one that does not push it is', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['B', 600], ['C', 720], ['D', 840]]);
  await exact(h, w.ids.C, w.day, 780);
  const p = await preview(h, w.ids.D, w.day, 810);
  const late = p.stops.filter((s) => s.late).map((s) => s.id);
  assert.ok(late.includes(w.ids.C), 'D at 13:30 makes C (pinned 13:00) late: said');
  await exact(h, w.ids.D, w.day, 810, { lateOk: late });
  const c0 = (await row(h, w.ids.C)).eta_min;
  assert.ok(c0 > 780, `C late, accepted: ${hm(c0)}`);
  const offered = async (dur) => (await h.rpc('suggest_windows', { p_lat: P.G[0], p_lng: P.G[1], p_duration: dur, p_day: w.day, p_exclude: null, p_need: false, p_kind: null })).map((x) => x.win_start);
  const o90 = await offered(90);
  assert.ok(!o90.includes(840), `90 min at 14:00 would push C: not offered (${o90.map(hm)})`);
  await tried(h, async () => {
    const e = await h.fails(() => book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 90, win_start: 840 }));
    assert.ok(['window_full', 'block_full'].includes(e?.hint), `refused: ${e?.hint}`);
    assert.equal((await row(h, w.ids.C)).eta_min, c0, 'C not pushed');
  });
  // every moment offered for 30 min books without pushing C
  const o30 = await offered(30);
  assert.ok(o30.length > 0, 'the day is still bookable');
  for (const ws of o30) {
    await tried(h, async () => {
      const r = await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 30, win_start: ws });
      assert.equal(r.ok, true, `${hm(ws)} offered: booked`);
      assert.ok((await row(h, w.ids.C)).eta_min <= c0, `${hm(ws)}: C not pushed later (${hm((await row(h, w.ids.C)).eta_min)} vs ${hm(c0)})`);
    });
  }
}));

test('F1: « Vraies routes » on, a stop without a position first: a minute the measured trips prove impossible is refused « arrive_late » with the earliest after it, nothing written', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['N', 540], ['B', 720], ['X', 840]], { positions: { N: [null, null], X: [45.51, -73.61], A: [45.50, -73.60], B: [45.52, -73.58] } });
  await server(h, w.owner, `update public.trucks set start = '{"label":"Loin","lat":45.60,"lng":-73.80}'::jsonb where id = $1`, [w.tk]);
  await roadsOn(h, w.owner, 30);
  const before = await h.q(`select id, stop_order, eta_min, arrive_at from public.jobs where day = $1 order by id`, [w.day]);
  for (const call of [() => preview(h, w.ids.X, w.day, 480), () => exact(h, w.ids.X, w.day, 480)]) {
    const e = await h.fails(call);
    assert.equal(e?.hint, 'arrive_late', 'the truck is measured 30 min from its first place: 8:00 cannot be');
    const d = JSON.parse(e.detail);
    assert.ok(d.earliest >= 480, `the earliest is not before the minute pointed: ${hm(d.earliest)}`);
    assert.match(e.message, /au plus tôt 8 h 30/);
  }
  assert.deepEqual(await h.q(`select id, stop_order, eta_min, arrive_at from public.jobs where day = $1 order by id`, [w.day]), before, 'nothing written');
  // a minute it can keep (first, from its start): moved, at that minute
  const r = await exact(h, w.ids.X, w.day, 600, { lateOk: Object.values(w.ids) });
  assert.equal(r.ok, true);
  const x = await row(h, w.ids.X);
  assert.deepEqual([x.arrive_at, x.eta_min], [600, 600]);
}));

test('M1 / F2: a truck with a lunch break: a minute in the break, or a job that does not end before it, is refused with « au plus tôt » the first minute after the break, never before the minute pointed', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['B', 600], ['C', 840]], { hours: [[480, 720], [780, 1200]] });
  for (const at of [750, 720, 690]) {
    const e = await h.fails(() => preview(h, w.ids.C, w.day, at));
    assert.equal(e?.hint, 'arrive_late', hm(at));
    const d = JSON.parse(e.detail);
    assert.equal(d.earliest, 780, `${hm(at)}: the earliest is 13:00 (${hm(d.earliest)})`);
    assert.ok(d.earliest_keep == null || d.earliest_keep >= at, `${hm(at)}: earliest_keep not before it either`);
    assert.match(e.message, /au plus tôt 13 h 00/);
  }
  const p = await preview(h, w.ids.C, w.day, 780);
  assert.equal(p.stops.find((s) => s.id === w.ids.C).eta_after, 780, '13:00: at 13:00');
}));

test('F3: « Vraies routes » off, a pinned stop that a later plan puts after its minute is written down (window_late, why pin); without a pin nothing new is written', () => tx(async (h) => {
  const w = await world(h, [['A', 600], ['C', 720], ['D', 840]]);
  const far = { label: 'Loin', lat: 45.78, lng: -74.0 };
  await tried(h, async () => {
    await h.rpc('set_truck_start', { p_op: uuid(), p_truck: w.tk, p_start: far });
    const n = await server(h, w.owner, `select count(*)::int n from public.activity where action = 'window_late' and at = now()`);
    assert.equal(n[0].n, 0, 'no pin: nothing new written (as before)');
  });
  const p = await preview(h, w.ids.C, w.day, 540);
  await exact(h, w.ids.C, w.day, 540, { lateOk: p.stops.filter((s) => s.late).map((s) => s.id) });
  assert.equal((await row(h, w.ids.C)).eta_min, 540);
  await h.rpc('set_truck_start', { p_op: uuid(), p_truck: w.tk, p_start: far });
  const c = await row(h, w.ids.C);
  assert.ok(c.eta_min > 540, `C can no longer be there at 9:00: ${hm(c.eta_min)}`);
  assert.equal(c.arrive_at, 540, 'the minute pointed stays');
  const a = await server(h, w.owner, `select data from public.activity where action = 'window_late' and entity_id = $1`, [w.ids.C]);
  assert.equal(a.length, 1, 'said once');
  assert.deepEqual([a[0].data.why, a[0].data.arrive_at, a[0].data.eta], ['pin', 540, c.eta_min]);
}));

test('H1 / F6: an exact move keeps the order by hand of the other stops of that truck\'s day; the next booking plans them as today', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['B', 480], ['C', 720], ['D', 840]]);
  await stopOrder(h, w.tk, w.day, [w.ids.B, w.ids.A, w.ids.C, w.ids.D]);
  const control = await tried(h, async () => {
    await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 30, win_start: 900 });
    return order(h, w);
  });
  assert.deepEqual(control.slice(0, 4), ['B', 'A', 'C', 'D'], 'without the move, a booking keeps the order by hand');
  // E (another day) moved onto that day at 17:00, after them all
  const e = (await book(h, { customer_id: w.cust.E, day: await h.val(`select ($1::date + 1)::text`, [w.day]), block: 'day', duration_min: 60, win_start: 540 })).job_id;
  w.name[e] = 'E';
  const before = await h.q(`select id, eta_min from public.jobs where day = $1 and status = 'booked' order by id`, [w.day]);
  assert.equal((await exact(h, e, w.day, 1020)).ok, true);
  assert.deepEqual(await hands(h, w), ['B', 'A', 'C', 'D'], 'the order by hand stays');
  for (const b of before) assert.equal((await row(h, b.id)).eta_min, b.eta_min, 'the others keep their times');
  await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 30, win_start: 900 });
  const now = await order(h, w);
  assert.deepEqual(now.filter((k) => k !== 'new' && k !== 'E'), ['B', 'A', 'C', 'D'], `the next booking keeps it: ${now}`);
  assert.equal((await row(h, e)).eta_min, 1020, 'E still at 17:00');
}));

test('H1 / F6: moved to a minute between two stops of an order by hand, it joins that order there; later plans keep it at its minute', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['B', 600], ['C', 720], ['D', 840]]);
  await stopOrder(h, w.tk, w.day, [w.ids.A, w.ids.B, w.ids.C, w.ids.D]);
  const p = await preview(h, w.ids.D, w.day, 660);
  assert.equal(p.stops.find((s) => s.id === w.ids.D).eta_after, 660);
  await exact(h, w.ids.D, w.day, 660, { lateOk: p.stops.filter((s) => s.late).map((s) => s.id) });
  const hand = await hands(h, w);
  assert.equal(hand.length, 4, `D joined the order by hand: ${hand}`);
  assert.deepEqual(hand.filter((k) => k !== 'D'), ['A', 'B', 'C'], 'the others keep their order');
  assert.deepEqual(await order(h, w), hand, 'the stops in that order');
  assert.equal((await row(h, w.ids.D)).eta_min, 660);
  await tried(h, async () => {
    const g = await book(h, { customer_id: w.cust.G, day: w.day, block: 'day', duration_min: 30, win_start: 960 });
    assert.equal(g.ok, true);
    assert.equal((await row(h, w.ids.D)).eta_min, 660, 'a booking: D still at 11:00');
    assert.deepEqual((await order(h, w)).filter((k) => k !== 'new'), hand, 'the order by hand kept');
  });
  await tried(h, async () => {
    await cancel(h, w.ids.A);
    assert.equal((await row(h, w.ids.D)).eta_min, 660, 'a cancel before it: D waits for 11:00');
  });
  await tried(h, async () => {
    await server(h, w.owner, `select public.replan_block_safe($1::date, 'day')`, [w.day]);
    assert.equal((await row(h, w.ids.D)).eta_min, 660, 'planned again: D at 11:00');
  });
}));

test('F8: an appointment on no truck moved to a minute with no truck picked: « pick_truck » with words that say to pick one', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['D', 840]]);
  await server(h, w.owner, `select set_config('garage.rpc', 'on', true)`);
  await server(h, w.owner, `update public.jobs set truck_id = null, stop_order = null, eta_min = null where id = $1`, [w.ids.D]);
  const e = await h.fails(() => preview(h, w.ids.D, w.day, 900));
  assert.equal(e?.hint, 'pick_truck');
  assert.match(e.message, /aucun camion/);
  const r = await exact(h, w.ids.D, w.day, 900, { truck: w.tk });
  assert.equal(r.ok, true, 'a truck picked: moved');
}));

test('F4: the day it left keeps its times even when a stop without a position comes right after the moved one', () => tx(async (h) => {
  // A far to the west, X and B side by side, N without a position between them: A, X, N, B by hand
  const w = await world(h, [['A', 480], ['X', 540], ['N', 600], ['B', 720]],
    { positions: { A: [45.5700, -73.7500], X: [45.4700, -73.5800], N: [null, null], B: [45.4720, -73.5820] } });
  await stopOrder(h, w.tk, w.day, [w.ids.A, w.ids.X, w.ids.N, w.ids.B]);
  const before = Object.fromEntries((await h.q(`select id, eta_min from public.jobs where day = $1 and status = 'booked'`, [w.day])).map((r) => [r.id, r.eta_min]));
  const friday = await h.val(`select ($1::date + 1)::text`, [w.day]);
  const r = await exact(h, w.ids.X, friday, 600);
  assert.equal(r.ok, true);
  for (const k of ['A', 'N', 'B']) {
    assert.equal((await row(h, w.ids[k])).eta_min, before[w.ids[k]], `${k} keeps its time (${hm(before[w.ids[k]])})`);
    const s = r.stops.find((x) => x.id === w.ids[k]);
    assert.equal(s.delay_min, 0, `${k}: no delay said`);
  }
  assert.deepEqual(await order(h, w), ['A', 'N', 'B'], 'the same order, the hole closed');
}));

test('two pins, one accepted late: a later plan keeps the pin that is at its minute, the one accepted late stays the late one', () => tx(async (h) => {
  const w = await world(h, [['A', 480], ['B', 600], ['C', 720], ['D', 840]]);
  await exact(h, w.ids.D, w.day, 780);
  // C at 12:30 pushes D (pinned at 13:00, farther from the start: the planner would place it first) late; accepted
  const p = await preview(h, w.ids.C, w.day, 750);
  const late = p.stops.filter((s) => s.late).map((s) => s.id);
  assert.ok(late.includes(w.ids.D), 'D said late');
  await exact(h, w.ids.C, w.day, 750, { lateOk: late });
  const d0 = (await row(h, w.ids.D)).eta_min;
  assert.equal((await row(h, w.ids.C)).eta_min, 750);
  for (const [what, fn] of [['a cancel', () => cancel(h, w.ids.A)], ['a re-plan', () => server(h, w.owner, `select public.replan_block_safe($1::date, 'day')`, [w.day])]]) {
    await tried(h, async () => {
      await fn();
      assert.equal((await row(h, w.ids.C)).eta_min, 750, `${what}: C, at its minute, stays at 12:30`);
      assert.ok((await row(h, w.ids.D)).eta_min > 780, `${what}: D stays the late one`);
    });
  }
}));
