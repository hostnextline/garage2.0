// The planner and booking rules, on the local copy of the database. Run: node --test tests/db/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const AM = [[480, 720]], DAY = [[480, 1200]];
const near = [45.5150, -73.6400], near2 = [45.5100, -73.6550], laval = [45.5700, -73.7500], longueuil = [45.5300, -73.5200];
const job = (customer, day, block, extra = {}) => ({ customer_id: customer, day, block, duration_min: 60, ...extra });

test('a booking goes on a truck that works the block, with an arrival time', () => tx(async (h) => {
  const owner = await h.person('Hassan Jeha', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Camion de Saleh', null, { [dow]: DAY });
  const t2 = await h.truck('Camion 2', null, { [dow]: [[960, 1200]] });     // evening only
  const c1 = await h.customer('Jean', ...near);
  await h.as(owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: job(c1, day, 'am'), p_items: [{ description: 'Vidange d’huile', unit_cents: 7999, duration_min: 30 }] });
  assert.equal(r.ok, true);
  assert.equal(r.truck_id, t1, 'only truck 1 works in the morning');
  const j = await h.one(`select * from public.jobs where id = $1`, [r.job_id]);
  assert.equal(j.status, 'booked');
  assert.equal(j.stop_order, 1);
  assert.ok(j.eta_min >= 480 && j.eta_min < 520, 'arrives early in the morning: ' + j.eta_min);
  assert.ok(j.travel_min > 0);
  assert.equal(j.duration_min, 60);
  assert.equal(await h.val(`select count(*)::int from public.job_items where job_id = $1`, [r.job_id]), 1);
  void t2;
}));

test('a block refuses the booking that does not fit (durations + driving), and never bumps a booked job', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion 1', null, { [dow]: AM });
  const cs = [];
  for (let i = 0; i < 5; i++) cs.push(await h.customer('C' + i, near[0] + i * 0.002, near[1]));
  await h.as(owner);
  let ok = 0, err;
  for (const c of cs) {
    const e = await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] }));
    if (e) { err = e; break; }
    ok++;
  }
  assert.equal(ok, 3, '3 one-hour jobs + driving fit in 4 hours, not 4');
  assert.equal(err.hint, 'block_full');
  assert.match(err.message, /complet/);
  const used = await h.val(`select sum(duration_min + travel_min)::int from public.jobs where day = $1 and block = 'am'`, [day]);
  assert.ok(used <= 240, 'never more than the truck\'s hours: ' + used);
}));

test('two trucks share the work, each one a short route', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('Nord', null, { [dow]: AM });
  const t2 = await h.truck('Sud', null, { [dow]: AM });
  const north = [await h.customer('N1', ...laval), await h.customer('N2', laval[0] + 0.003, laval[1])];
  const south = [await h.customer('S1', ...longueuil), await h.customer('S2', longueuil[0] + 0.003, longueuil[1])];
  await h.as(owner);
  for (const c of [...north, ...south]) await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] });
  const trucksOf = async (ids) => (await h.q(`select distinct truck_id from public.jobs where customer_id = any($1)`, [ids])).map((r) => r.truck_id);
  const tn = await trucksOf(north), ts = await trucksOf(south);
  assert.equal(tn.length, 1, 'the two Laval jobs ride together');
  assert.equal(ts.length, 1, 'the two Longueuil jobs ride together');
  assert.notEqual(tn[0], ts[0]);
  assert.deepEqual([tn[0], ts[0]].sort(), [t1, t2].sort());
}));

test('a truck chosen by hand keeps the job, or says it has no room', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('A', null, { [dow]: AM });
  const tb = await h.truck('B', null, { [dow]: [[480, 570]] });   // 1 h 30 only
  const c1 = await h.customer('X', ...near), c2 = await h.customer('Y', ...near2);
  await h.as(owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: job(c1, day, 'am', { truck_id: tb }), p_items: [] });
  assert.equal(r.truck_id, tb);
  assert.equal(await h.val(`select truck_pinned from public.jobs where id = $1`, [r.job_id]), true);
  const e = await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(c2, day, 'am', { truck_id: tb }), p_items: [] }));
  assert.equal(e?.hint, 'truck_full');
  // without choosing, the other truck takes it
  const r2 = await h.rpc('book_job', { p_op: uuid(), p_job: job(c2, day, 'am'), p_items: [] });
  assert.notEqual(r2.truck_id, tb);
}));

test('sending the same booking twice (lost answer) books it once', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('A', null, { [dow]: AM });
  const c = await h.customer('Z', ...near);
  await h.as(owner);
  const op = uuid(), id = uuid();
  const a = await h.rpc('book_job', { p_op: op, p_job: job(c, day, 'am', { id }), p_items: [] });
  const b = await h.rpc('book_job', { p_op: op, p_job: job(c, day, 'am', { id }), p_items: [] });
  assert.deepEqual(a.job_id, b.job_id);
  assert.equal(await h.val(`select count(*)::int from public.jobs where customer_id = $1`, [c]), 1);
}));

test('closed blocks, started blocks and past days are refused', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('A', null, { [dow]: AM });
  const c = await h.customer('Z', ...near);
  await h.as(owner);
  const closed = await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'eve'), p_items: [] }));
  assert.equal(closed?.hint, 'block_closed');
  const past = await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(c, '2020-01-02', 'am'), p_items: [] }));
  assert.equal(past?.hint, 'block_started');
  const noCustomer = await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(null, day, 'am'), p_items: [] }));
  assert.equal(noCustomer?.hint, 'no_customer');
}));

test('moving a job checks the new block and re-plans the old one', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('A', null, { [dow]: DAY });
  const c1 = await h.customer('M1', ...near), c2 = await h.customer('M2', ...near2);
  await h.as(owner);
  const a = await h.rpc('book_job', { p_op: uuid(), p_job: job(c1, day, 'am'), p_items: [] });
  const b = await h.rpc('book_job', { p_op: uuid(), p_job: job(c2, day, 'am'), p_items: [] });
  assert.deepEqual((await h.q(`select stop_order from public.jobs where day = $1 and block = 'am' order by stop_order`, [day])).map((r) => r.stop_order), [1, 2]);
  const m = await h.rpc('move_job', { p_op: uuid(), p_job: a.job_id, p_day: day, p_block: 'pm', p_truck: null });
  assert.equal(m.changed, true);
  const moved = await h.one(`select block, stop_order from public.jobs where id = $1`, [a.job_id]);
  assert.equal(moved.block, 'pm');
  assert.equal(moved.stop_order, 1);
  assert.equal(await h.val(`select stop_order from public.jobs where id = $1`, [b.job_id]), 1, 'the job left behind is now first');
}));

test('closing a truck for a day sends its jobs to another truck, or to « À placer »', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const t1 = await h.truck('A', null, { [dow]: AM });
  const t2 = await h.truck('B', null, { [dow]: [[480, 600]] });
  const cs = [await h.customer('K1', ...near), await h.customer('K2', ...near2), await h.customer('K3', ...longueuil)];
  await h.as(owner);
  for (const c of cs) await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] });
  // truck A closed that day
  await h.c.query(`insert into public.truck_days (truck_id, day, ranges) values ($1, $2, '[]')`, [t1, day]);
  const rows = await h.q(`select truck_id from public.jobs where day = $1 and block = 'am'`, [day]);
  assert.equal(rows.filter((r) => r.truck_id === t1).length, 0, 'nothing stays on the closed truck');
  assert.equal(rows.filter((r) => r.truck_id === t2).length, 1, 'truck B (2 h) takes what it can');
  assert.equal(rows.filter((r) => r.truck_id === null).length, 2, 'the rest waits in « À placer »');
}));

test('the best blocks are where a truck already drives nearby', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h, 4, 2);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const week = {}; for (let d = 0; d < 7; d++) week[d] = DAY;
  await h.truck('A', null, week);
  const c = await h.customer('Far', ...longueuil);
  await h.as(owner);
  await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'pm'), p_items: [] });
  const s = await h.rpc('suggest_blocks', { p_lat: longueuil[0] + 0.002, p_lng: longueuil[1], p_duration: 60, p_from: day, p_days: 3, p_exclude: null, p_limit: 5 });
  assert.ok(s.length >= 3);
  assert.equal(s[0].day, day);
  assert.equal(s[0].block, 'pm', 'next to the job already booked');
  assert.ok(s[0].near >= 1);
  assert.ok(s[0].drive_min <= s[1].drive_min);
  void dow;
}));

test('rights: who may book', () => tx(async (h) => {
  const mech = await h.person('Saleh', ['mechanic']);
  const tres = await h.person('Trésorier', ['treasurer']);
  const office = await h.person('Bureau', ['office']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const own = await h.truck('Camion de Saleh', mech, { [dow]: AM });
  const c = await h.customer('R', ...near);
  await h.as(tres);
  assert.equal((await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] })))?.hint, 'not_allowed');
  await h.as(mech);
  assert.equal((await h.fails(() => h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] })))?.hint, 'not_allowed', 'a mechanic without « book » only books on his own truck');
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am', { truck_id: own }), p_items: [] });
  assert.equal(r.truck_id, own);
  await h.as(office);
  const r2 = await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] });
  assert.equal(r2.ok, true);
}));

test('schedule drawn on the grid: today only, N weeks, or from now on', () => tx(async (h) => {
  const mech = await h.person('Saleh', ['mechanic']);
  const other = await h.person('Ali', ['mechanic']);
  const t = await h.truck('Saleh', mech, {});
  const t2 = await h.truck('Ali', other, {});
  const day = await futureDay(h, 2);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.as(mech);
  const applied = await h.rpc('apply_hours', { p_op: uuid(), p_truck: t, p_mode: 'weeks', p_week: { [dow]: [[600, 660], [480, 540], [540, 600]] }, p_from: day, p_weeks: 2 });
  assert.equal(applied.rows.truck_days.length, 2, 'the changed days come back for the screen');
  const days = await h.q(`select day::text, ranges from public.truck_days where truck_id = $1 order by day`, [t]);
  assert.equal(days.length, 2, 'two weeks → that weekday twice');
  assert.deepEqual(days[0].ranges, [[480, 660]], 'touching hours are merged');
  await h.rpc('apply_hours', { p_op: uuid(), p_truck: t, p_mode: 'always', p_week: { [dow]: [[720, 960]] }, p_from: day, p_weeks: 1 });
  assert.deepEqual(await h.val(`select ranges from public.truck_week where truck_id = $1 and dow = $2`, [t, dow]), [[720, 960]]);
  assert.equal(await h.val(`select count(*)::int from public.truck_days where truck_id = $1 and deleted_at is null`, [t]), 0, 'the new usual week replaces the days changed before');
  const e = await h.fails(() => h.rpc('apply_hours', { p_op: uuid(), p_truck: t2, p_mode: 'day', p_week: { [dow]: [] }, p_from: day, p_weeks: 1 }));
  assert.equal(e?.hint, 'not_allowed', 'a mechanic changes only his own truck');
}));

test('a position found later re-plans the block: the stop and its times follow the real place (Part 15)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion 1', null, { [dow]: DAY });
  const a = await h.customer('A', ...near);
  const b = await h.customer('B', null, null, { address: '144 58e Avenue, Laval, QC' });      // typed without a suggestion
  const c = await h.customer('C', null, null, { address: '160 khalil gibran' });
  await h.as(owner);
  const ja = (await h.rpc('book_job', { p_op: uuid(), p_job: job(a, day, 'am'), p_items: [] })).job_id;
  const jb = (await h.rpc('book_job', { p_op: uuid(), p_job: job(b, day, 'am', { address: '144 58e Avenue, Laval, QC' }), p_items: [] })).job_id;
  const jc = (await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'am'), p_items: [] })).job_id;
  // a stop with no position: the « unknown » drive plus the stop time
  const unknown = await h.val(`select coalesce((booking->>'unknown_min')::int, 20) + coalesce((booking->>'stop_min')::int, 5) from public.settings where id = 1`);
  assert.equal((await h.one(`select travel_min from public.jobs where id = $1`, [jb])).travel_min, unknown, 'no position: the planner counts the « unknown » drive');

  // the appointment's own position is found (the locator, as the owner): its block is planned again
  await h.q(`update public.jobs set lat = $1, lng = $2 where id = $3`, [...laval, jb]);
  const b1 = await h.one(`select travel_min, eta_min, stop_order from public.jobs where id = $1`, [jb]);
  assert.notEqual(b1.travel_min, unknown, 'the drive is now counted from the real place: ' + b1.travel_min);
  assert.ok(b1.eta_min != null && b1.stop_order != null);

  // the customer's position is found: its appointment that uses it is planned again too
  const before = await h.val(`select travel_min from public.jobs where id = $1`, [jc]);
  assert.equal(before, unknown);
  await h.q(`update public.customers set lat = $1, lng = $2 where id = $3`, [...near2, c]);
  assert.notEqual(await h.val(`select travel_min from public.jobs where id = $1`, [jc]), unknown, 'the customer’s new position counts for its appointment');
  assert.equal(await h.val(`select count(*)::int from public.jobs where id = any($1::uuid[]) and stop_order is not null`, [[ja, jb, jc]]), 3, 'all three still on the route');

  // nothing re-planned for a position that did not change, or for a past or finished appointment
  await h.as(null);
  await h.q(`update public.jobs set status = 'done' where id = $1`, [ja]);
  await h.as(owner);
  assert.equal(await h.fails(() => h.q(`update public.jobs set lat = lat, lng = lng where id = $1`, [ja])), null);
}));

test('a service says what it takes that depends on the car (an array, or nothing said)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await h.as(owner);
  const ok = await h.fails(() => h.q(`insert into public.services (name_fr, needs) values ('Changement d’huile', '[{"kind":"oil"},{"kind":"oil_filter"}]')`));
  assert.equal(ok, null);
  assert.equal(await h.fails(() => h.q(`insert into public.services (name_fr) values ('Inspection')`)), null, 'nothing said: guessed by the app');
  const bad = await h.fails(() => h.q(`insert into public.services (name_fr, needs) values ('X', '{"kind":"oil"}')`));
  assert.match(String(bad?.message), /services_needs_array/);
  assert.deepEqual(await h.val(`select needs from public.services where name_fr = 'Changement d’huile'`), [{ kind: 'oil' }, { kind: 'oil_filter' }]);
}));

/* Part 17: the trucks' starting point (« Départ des camions ») and the order of the stops */
const LEGENDRE = [45.5312898, -73.6544639], CENTRALE = [45.5005053, -73.6577429];
const AMRO = [45.52789, -73.66748], BASSAM = [45.54571, -73.72509], MAHDI = [45.58151, -73.64007];   // Chabanel, Laval, Montréal-Nord
const setStart = (h, [lat, lng], label = 'Centrale') => h.q(`update public.settings set booking = jsonb_set(booking, '{home}', coalesce(booking->'home', '{}') || jsonb_build_object('lat', $1::float8, 'lng', $2::float8, 'label', $3::text)) where id = 1`, [lat, lng, label]);
const route = async (h, ids) => (await h.q(`select id, stop_order, eta_min from public.jobs where id = any($1::uuid[]) order by stop_order`, [ids]));

test('the stops go in the order that drives the least, not only where each one was put (Part 17)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion Complet', null, { [dow]: DAY });
  await setStart(h, LEGENDRE);
  const [a, b, m] = [await h.customer('Amro', ...AMRO), await h.customer('Bassam', ...BASSAM), await h.customer('Mahdi', ...MAHDI)];
  await h.as(owner);
  const ids = [];
  for (const c of [a, b, m]) ids.push((await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'pm'), p_items: [] })).job_id);
  // put one by one, Mahdi went before Bassam (Chabanel, Montréal-Nord, then back west to Laval): 36 min of driving;
  // Chabanel, Laval, then Montréal-Nord drives 32
  assert.deepEqual((await route(h, ids)).map((x) => x.id), [ids[0], ids[1], ids[2]], 'Amro, Bassam, then Mahdi');
  const legs = await h.val(`select sum(travel_min)::int from public.jobs where id = any($1::uuid[])`, [ids]);
  assert.equal(legs, 32 + 3 * 5, 'driving + 5 min per stop');

  // the order of the stops on the way or there never changes
  await h.as(null);
  const pts = { x: { lat: MAHDI[0], lng: MAHDI[1], dur: 60 }, y: { lat: AMRO[0], lng: AMRO[1], dur: 60 }, z: { lat: BASSAM[0], lng: BASSAM[1], dur: 60 } };
  const better = await h.val(`select public.route_improve($1::jsonb, 1, $2::jsonb, $3, $4, 35, 1.3, 20, 5)`, [JSON.stringify(['x', 'y', 'z']), JSON.stringify(pts), ...LEGENDRE]);
  assert.equal(better[0], 'x', 'the first stop (on site) stays first');
  assert.deepEqual([...better].sort(), ['x', 'y', 'z']);
  assert.deepEqual(await h.val(`select public.route_improve('["x"]', 0, $1::jsonb, $2, $3, 35, 1.3, 20, 5)`, [JSON.stringify(pts), ...LEGENDRE]), ['x']);
}));

test('moving the starting point re-plans the coming blocks; its name alone does not (Part 17)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const mech = await h.person('Saleh', ['mechanic']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion Complet', null, { [dow]: DAY });
  await setStart(h, CENTRALE);
  const [a, b, m] = [await h.customer('Amro', ...AMRO), await h.customer('Bassam', ...BASSAM), await h.customer('Mahdi', ...MAHDI)];
  await h.as(owner);
  const ids = [];
  for (const c of [a, b, m]) ids.push((await h.rpc('book_job', { p_op: uuid(), p_job: job(c, day, 'pm'), p_items: [] })).job_id);
  const first = async () => (await h.one(`select eta_min, travel_min from public.jobs where id = $1`, [ids[0]]));
  assert.deepEqual(await first(), { eta_min: 727, travel_min: 12 }, 'from 8255 Mountain Sights: 7 min to Amro, at 12 h 07');

  // the owner moves the start to 1401 Legendre Ouest (Réglages, Réservations, Départ des camions): planned again at once
  await h.q(`update public.settings set booking = jsonb_set(booking, '{home}', booking->'home' || '{"address":"1401 rue Legendre Ouest, Montréal, QC","lat":45.5312898,"lng":-73.6544639}') where id = 1`);
  assert.deepEqual(await first(), { eta_min: 723, travel_min: 8 }, 'from Legendre: 3 min to Amro, at 12 h 03');
  assert.deepEqual((await route(h, ids)).map((x) => x.id), ids, 'still Amro, Bassam, Mahdi');

  // only the name on the map: nothing is planned again (a time put wrong by hand stays wrong)
  await h.as(null);
  await h.q(`update public.jobs set eta_min = 999 where id = $1`, [ids[0]]);
  await h.as(owner);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{home,label}', '"Garage"') where id = 1`);
  assert.equal((await first()).eta_min, 999, 'the name changed: not re-planned');
  // a number of the route estimate: planned again
  await h.q(`update public.settings set booking = booking || '{"stop_min": 7}' where id = 1`);
  assert.deepEqual(await first(), { eta_min: 723, travel_min: 10 }, 'stop time 7 min: re-planned');

  // a mechanic cannot move the start
  await h.as(mech);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{home,lat}', '45.6') where id = 1`);
  await h.as(null);
  assert.equal(await h.val(`select (booking->'home'->>'lat')::float8 from public.settings where id = 1`), 45.5312898, 'not changed by a mechanic');
}));
