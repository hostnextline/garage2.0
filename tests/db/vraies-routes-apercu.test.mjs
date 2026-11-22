// « Vraies routes » (Part 27): the read-only answers for the app (CONTRACT §2.6, phone-estimates PE-07 and PE-08).
// move_preview = what « La voiture ferme » would do to the other vehicle's day (move_job for each appointment, in that order,
// its window kept as the app sends it); stop_order_preview = what « Ordre des arrêts » would do (set_stop_order with that
// list). Proved here: nothing is written (the day's rows, the counts, updated_at), the same right as the action (a person
// without it is refused the same way), and the SAME order and arrival times as the action then gives, switch on and off.
// Run: node --test tests/db/vraies-routes-apercu.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const A = [45.5150, -73.6400], B = [45.5700, -73.7500], C = [45.5300, -73.6000], D = [45.4800, -73.5800], E = [45.5500, -73.7000];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
const book = async (h, customer, day, block, dur, extra = {}) =>
  (await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] })).job_id;
/** everything the coming days still want, measured: fn(pair) minutes */
async function measureAll(h, fn) {
  for (let i = 0; i < 20; i++) {
    const w = await val(h, `select public.drive_wanted(null, null, 120) v`);
    if (!w.total) return;
    await val(h, `select public.drive_store($1::jsonb) v`, [JSON.stringify(w.pairs.map((p) => [p[0], p[1], p[2], p[3], p[4], fn(p), 5, 'tomtom']))]);
  }
  throw new Error('still something to measure');
}
/** everything that could have been written, as it is now */
const snap = async (h, day) => JSON.stringify(await server(h, `select (select count(*) from public.jobs) jobs, (select count(*) from public.activity) act,
  (select count(*) from public.op_log) ops, (select count(*) from public.drive_times) dt, (select max(updated_at) from public.jobs) upd,
  (select coalesce(jsonb_agg(to_jsonb(j) order by j.id), '[]'::jsonb) from public.jobs j where j.day = $1::date) rows`, [day]));
const movePreview = (h, truck, day, block, ids) => h.val(`select public.move_preview($1::uuid, $2::date, $3, $4::uuid[]) v`, [truck, day, block, ids]);
const orderPreview = (h, truck, day, block, ids) => h.val(`select public.stop_order_preview($1::uuid, $2::date, $3, $4::uuid[]) v`, [truck, day, block, ids]);
/** « Déplacer vers … » as the app sends it: move_job for each, the same day and block, the window kept (keepWindow); refused ones listed */
async function moveAll(h, truck, ids) {
  const refused = [];
  for (const id of ids) {
    const j = await h.one(`select day::text, block, win_start, win_end, win_flex from public.jobs where id = $1`, [id]);
    const win = j.block !== 'day' ? [null, null] : j.win_start != null && j.win_end != null ? [j.win_start, false] : [null, !!j.win_flex];
    const e = await h.fails(() => h.q(`select public.move_job($1::uuid, $2::uuid, $3::date, $4, $5::uuid, $6::int, $7::boolean)`, [uuid(), id, j.day, j.block, truck, ...win]));
    if (e) { assert.equal(e.code, 'P0001', String(e.message)); refused.push(id); }
  }
  return refused;
}
/** the vehicle's day as the server then has it: its stops in walk order, their arrival, its driving (as move_preview says it) */
async function dayOf(h, truck, day, on) {
  const d = await val(h, `select public.day_drive($1::date, $2::uuid) v`, [day, truck]);
  const rows = await server(h, `select id::text, eta_min from public.jobs where id::text = any($1::text[])`, [d.ids]);
  const eta = Object.fromEntries(d.ids.map((id) => [id, rows.find((r) => r.id === id).eta_min]));
  return { order: d.ids, eta, day_min: d.min, day_km: on ? d.km : null, unmeasured: on ? d.unmeasured : null };
}
/** a truck's booked stops of a block (all blocks: null) in their order, with « late » = after the window, else the block, told;
 *  measured: what stop_order_preview says of each (fix-sql: null with the switch off; here every trip is measured when on) */
async function stopsOf(h, truck, day, block, measured = null) {
  return (await server(h, `select j.id::text id, j.eta_min eta, coalesce(j.eta_min > coalesce(j.win_end, b.end_min), false) late, $4::boolean measured
    from public.jobs j join public.blocks() b on b.key = j.block
    where j.truck_id = $1 and j.day = $2::date and ($3::text is null or j.block = $3) and j.status = 'booked' and j.deleted_at is null
    order by b.pos, j.stop_order, j.eta_min`, [truck, day, block, measured]));
}
/** the owner, the truck (tire machine) and the car, both every day; a coming Thursday; three stops on the truck in the morning */
async function garage(h) {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, 4);
  const t1 = await h.truck('Camion', null, WEEK), t2 = await h.truck('Voiture', null, WEEK);
  await server(h, `update public.trucks set tire_machine = false where id = $1`, [t2]);
  const cs = [];
  for (const p of [A, B, C, D, E]) cs.push(await h.customer('C' + cs.length, ...p));
  return { owner, day, t1, t2, cs };
}

test('move_preview (blocks, switch off): the other vehicle’s day as the moves then make it, and nothing written', () => tx(async (h) => {
  const { day, t1, t2, cs } = await garage(h);
  const ja = await book(h, cs[0], day, 'am', 45, { truck_id: t1 });
  const jb = await book(h, cs[1], day, 'am', 45, { truck_id: t1 });
  await book(h, cs[2], day, 'am', 45, { truck_id: t1 });
  await book(h, cs[3], day, 'am', 60, { truck_id: t2 });
  await book(h, cs[4], day, 'pm', 30, { truck_id: t2 });
  const before = await snap(h, day);
  const p = await movePreview(h, t2, day, null, [ja, jb]);
  assert.equal(await snap(h, day), before, 'nothing written: the day’s rows, the counts and updated_at are the same');
  assert.deepEqual(Object.keys(p).sort(), ['day_km', 'day_min', 'eta', 'order', 'refused', 'refused_why', 'unmeasured']);   // refused_why: fix-sql
  assert.deepEqual([p.refused, p.day_km, p.unmeasured], [[], null, null], 'switch off: no km and no « measured » said (never an estimate of km)');
  assert.ok(p.order.includes(ja) && p.order.includes(jb) && p.order.length === 4);
  assert.deepEqual(await moveAll(h, t2, [ja, jb]), []);
  assert.deepEqual(p, { ...(await dayOf(h, t2, day, false)), refused: [], refused_why: {} }, 'the same order, arrivals and driving as the moves made');
}));

test('move_preview (blocks, switch on): the clock of the real roads, a refused move said, and the same answer as the moves', () => tx(async (h) => {
  const { owner, day, t1, t2, cs } = await garage(h);
  const ja = await book(h, cs[0], day, 'am', 30, { truck_id: t1 });
  const jb = await book(h, cs[1], day, 'am', 30, { truck_id: t1 });
  const jc = await book(h, cs[2], day, 'am', 30, { truck_id: t1 });
  await book(h, cs[3], day, 'am', 60, { truck_id: t2 });
  await book(h, cs[4], day, 'pm', 30, { truck_id: t2 });
  // rush times other than the usual ones, so an answer counted at the usual hours would show
  await measureAll(h, (p) => (p[4] === 1 ? 26 : p[4] === 2 ? 23 : 15 + Math.round(Math.abs(p[0] - p[2]) * 100)));
  assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).on, true);
  await server(h, `select set_config('garage.rpc', 'on', true)`);
  await server(h, `update public.jobs set needs_machine = true where id = $1`, [jc]);   // tire work: never to the car
  await become(h, owner);
  const before = await snap(h, day);
  const p = await movePreview(h, t2, day, null, [ja, jc, jb]);
  assert.equal(await snap(h, day), before, 'nothing written');
  assert.deepEqual(p.refused, [jc], 'move_job would refuse it (needs_truck): said, and the others still go');
  assert.ok(p.order.includes(ja) && p.order.includes(jb));
  assert.equal(typeof p.unmeasured, 'number');
  assert.deepEqual(await moveAll(h, t2, [ja, jc, jb]), [jc], 'the moves refuse the same one');
  const now = await dayOf(h, t2, day, true);
  assert.deepEqual(p, { ...now, refused: [jc], refused_why: { [jc]: 'needs_truck' } });
  assert.equal(p.unmeasured, 0, 'every trip measured');
  assert.equal(typeof p.day_km, 'number');
}));

test('move_preview (arrival windows): the window kept as « La voiture ferme » sends it, the same answer as the moves', () => tx(async (h) => {
  const { day, t1, t2, cs } = await garage(h);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const ja = await book(h, cs[0], day, 'day', 45, { truck_id: t1, win_start: 480 });
  const jb = await book(h, cs[1], day, 'day', 45, { truck_id: t1, win_flex: true });
  await book(h, cs[2], day, 'day', 45, { truck_id: t1, win_start: 720 });
  await book(h, cs[3], day, 'day', 60, { truck_id: t2, win_start: 600 });
  const before = await snap(h, day);
  const p = await movePreview(h, t2, day, null, [ja, jb]);
  assert.equal(await snap(h, day), before);
  assert.deepEqual(await moveAll(h, t2, [ja, jb]), []);
  assert.deepEqual(p, { ...(await dayOf(h, t2, day, false)), refused: [], refused_why: {} });
  assert.equal((await h.one(`select win_start from public.jobs where id = $1`, [ja])).win_start, 480, 'its window stayed');
}));

test('stop_order_preview (blocks, switch off then on): the arrivals of that order, as set_stop_order then writes them; nothing written', () => tx(async (h) => {
  const { owner, day, t1, cs } = await garage(h);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await book(h, cs[i], day, 'am', 50, { truck_id: t1 }));
  const order = (await stopsOf(h, t1, day, 'am')).map((x) => x.id).reverse();
  for (const on of [false, true]) {
    if (on) {
      await measureAll(h, (p) => (p[4] === 1 ? 33 : 17));
      assert.equal((await h.rpc('roads_switch', { p_op: uuid(), p_on: true })).on, true);
      await become(h, owner);
    }
    const before = await snap(h, day);
    const p = await orderPreview(h, t1, day, 'am', order);
    assert.equal(await snap(h, day), before, 'nothing written');
    assert.deepEqual(p.map((x) => x.id), order, 'the order asked');
    await h.q(`select public.set_stop_order($1::uuid, $2::uuid, $3::date, 'am', $4::uuid[])`, [uuid(), t1, day, order]);
    assert.deepEqual(p, await stopsOf(h, t1, day, 'am', on || null), `the same arrivals and « late » as the order saved (switch ${on ? 'on' : 'off'})`);
    order.reverse();
  }
  // « Laisser l'app choisir » (an empty list) too
  const p = await orderPreview(h, t1, day, 'am', []);
  await h.q(`select public.set_stop_order($1::uuid, $2::uuid, $3::date, 'am', '{}'::uuid[])`, [uuid(), t1, day]);
  assert.deepEqual(p, await stopsOf(h, t1, day, 'am', true));
  void ids;
}));

test('stop_order_preview (arrival windows): a stop pushed past its window is said late, as the order saved then makes it', () => tx(async (h) => {
  const { day, t1, cs } = await garage(h);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const jb = await book(h, cs[1], day, 'day', 240, { truck_id: t1, win_start: 480 });
  const ja = await book(h, cs[0], day, 'day', 240, { truck_id: t1, win_start: 600 });
  const p = await orderPreview(h, t1, day, 'day', [ja, jb]);
  assert.deepEqual(p.map((x) => [x.id, x.late]), [[ja, false], [jb, true]], 'A first waits for its window: B comes after 12 h');
  await h.q(`select public.set_stop_order($1::uuid, $2::uuid, $3::date, 'day', $4::uuid[])`, [uuid(), t1, day, [ja, jb]]);
  assert.deepEqual(p, await stopsOf(h, t1, day, 'day'));
}));

test('the same right as the action: a person without it is refused, the driver of the vehicle may see its order', () => tx(async (h) => {
  const { owner, day, t1, t2, cs } = await garage(h);
  const ja = await book(h, cs[0], day, 'am', 45, { truck_id: t1 });
  const jb = await book(h, cs[1], day, 'am', 45, { truck_id: t1 });
  await become(h, null);
  const mech = await h.person('Saleh', ['mechanic']);
  const driver = await h.person('Mahdi', ['mechanic']);
  await server(h, `update public.trucks set driver_id = $2 where id = $1`, [t1, driver]);
  await become(h, mech);
  for (const [what, fn] of [['move', () => movePreview(h, t2, day, null, [ja])], ['move, nothing listed', () => movePreview(h, t2, day, null, [])],
    ['order', () => orderPreview(h, t1, day, 'am', [jb, ja])]]) {
    assert.equal((await h.fails(fn))?.hint, 'not_allowed', what);
  }
  for (const sql of [`select public.move_job('${uuid()}'::uuid, '${ja}'::uuid, '${day}'::date, 'am', '${t2}'::uuid)`,
    `select public.set_stop_order('${uuid()}'::uuid, '${t1}'::uuid, '${day}'::date, 'am', array['${jb}', '${ja}']::uuid[])`]) {
    assert.equal((await h.fails(() => h.q(sql)))?.hint, 'not_allowed', 'and the action refuses him the same way');
  }
  await become(h, driver);
  const p = await orderPreview(h, t1, day, 'am', [jb, ja]);
  assert.deepEqual(p.map((x) => x.id), [jb, ja], 'the truck’s driver puts his own stops in order (set_stop_order’s rule)');
  assert.equal((await h.fails(() => movePreview(h, t2, day, null, [ja])))?.hint, 'not_allowed', 'but does not move them to a vehicle he does not drive');
  // closed to the public key
  await h.q(`reset role`); await h.q(`set local role anon`);
  // (« exact move », S5: move_preview has a second form of 4 arguments, so 4 bare nulls name neither: each form by its types)
  assert.match(String((await h.fails(() => h.q(`select public.move_preview(null::uuid, null::date, null::text, null::uuid[])`)))?.message), /permission denied/);
  assert.match(String((await h.fails(() => h.q(`select public.move_preview(null::uuid, null::date, null::uuid, null::integer)`)))?.message), /permission denied/);
  assert.match(String((await h.fails(() => h.q(`select public.stop_order_preview(null, null, null, null)`)))?.message), /permission denied/);
  void owner;
}));
