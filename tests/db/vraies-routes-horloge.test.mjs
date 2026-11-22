// « Vraies routes » (Part 27), ONE CLOCK: with the switch on, every decision of the planner (does it fit: used / left / over,
// is it late, the place of a new stop, the moments offered) counts the same drive times as the arrival times it writes: each
// leg at the minute the truck leaves for it (the rush-hour time on a working day). Review-sql H1 (« e3 »), server F5.
// Run: node --test tests/db/vraies-routes-horloge.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const HOME = [45.5005053, -73.6577429];                       // home_point() when the settings have none
const A = [45.5150, -73.6400], B = [45.5700, -73.7500], C = [45.5300, -73.6100], D = [45.4800, -73.5800];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const same = (p, q) => p[0] === q[0] && p[1] === q[1];
const row = (h, id) => h.one(`select * from public.jobs where id = $1`, [id]);
/** the following statements run as this person (remembered, so that a question to the server comes back to them) */
const become = async (h, id) => { h.me = id ?? null; await h.as(h.me); };
/** asks the server itself (these building blocks are not open to the app), then goes on as the person of the test */
async function server(h, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(h.me ?? null); return r; }
const val = async (h, sql, params = []) => Object.values((await server(h, sql, params))[0])[0];
/** the switch flipped by the server itself (what roads_switch does inside), without planning anything */
async function roads(h, on) {
  await server(h, `select set_config('garage.roads', 'on', true)`);
  await server(h, `update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', to_jsonb($1::boolean)) where id = 1`, [on]);
  await server(h, `select set_config('garage.roads', '', true)`);
}
/** every trip between these places measured, both ways, the three times: fn(from, to, slot) minutes */
async function measure(h, places, fn) {
  const rows = [];
  for (const a of places) for (const b of places) if (a !== b) for (const s of [0, 1, 2]) rows.push([...a, ...b, s, fn(a, b, s), 5, 'tomtom']);
  await val(h, `select public.drive_store($1::jsonb)`, [JSON.stringify(rows)]);
}
const book = (h, customer, day, block, dur, extra = {}) =>
  h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, day, block, duration_min: dur, ...extra }, p_items: [] });
const plan = (h, day, block) => val(h, `select public.plan_block($1::date, $2) v`, [day, block]);
const suggest = (h, at, dur, day) => h.rpc('suggest_blocks', { p_lat: at[0], p_lng: at[1], p_duration: dur, p_from: day, p_days: 1, p_exclude: null, p_limit: 9 });
/** the server's clock for this test only (minutes of today; the change is rolled back with the test) */
const clock = (h, min) => server(h, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
/** THE invariant: for each truck the room the plan counts is the time of its own arrival times: used = the work + the drive
 *  written for each stop (travel = the leg + the stop) + the waiting; left = cap − used */
async function holds(h, p, durs = {}) {
  for (const t of p.trucks) {
    let work = 0, drive = 0;
    for (const [id, j] of Object.entries(p.jobs)) {
      if (j.truck !== t.id) continue;
      work += durs[id] ?? (await server(h, `select duration_min from public.jobs where id = $1`, [id]))[0].duration_min;
      drive += j.travel;
    }
    assert.equal(t.used, work + drive + (t.wait ?? 0), `the room counted (${t.used}) is the work (${work}) + the drive behind the arrival times (${drive}) + the wait (${t.wait})`);
    assert.equal(t.left, t.cap - t.used);
  }
}
async function start(h, dow, week = WEEK) {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const day = await futureDay(h, dow);
  const truck = await h.truck('Camion 1', null, week);
  return { owner, day, truck };
}

test('e3 — blocks, a Tuesday: the morning counts 90 minutes of rush, as its arrival times; a full morning says so', () => tx(async (h) => {
  const { day, truck } = await start(h, 2);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await roads(h, true);
  await measure(h, [HOME, A, B], (a, b, s) => (s === 1 ? 90 : 30));      // 30 at the usual hours, 90 in the morning rush
  const r1 = await book(h, ca, day, 'am', 75);
  assert.deepEqual([(await row(h, r1.job_id)).eta_min, (await row(h, r1.job_id)).travel_min], [480 + 90, 95], 'leaves at 8 h: the morning rush');
  let p = await plan(h, day, 'am');
  await holds(h, p);
  assert.equal(p.trucks[0].left, 240 - (75 + 95), 'the room left counts the 90 minutes driven');
  // a second 75-minute job would end at 12 h 35: refused (before: booked, the plan saying « 20 minutes left »)
  assert.equal((await h.fails(() => book(h, cb, day, 'am', 75)))?.hint, 'block_full');
  // « Réserver quand même »: at the end of the route, past the hours, and the plan says so
  const r2 = await book(h, cb, day, 'am', 75, { force: true });
  assert.equal(r2.forced, true);
  const j2 = await row(h, r2.job_id);
  assert.deepEqual([j2.eta_min, j2.travel_min], [650 + 30, 35], 'leaves A at 10 h 50, after the rush: 30 minutes');
  p = await plan(h, day, 'am');
  await holds(h, p);
  assert.equal(p.trucks[0].left, 240 - (150 + 95 + 35), 'past its hours: never « 20 minutes left »');
  assert.ok(p.trucks.every((t) => t.left !== 20));
  // a 15-minute job next to A is not offered that morning
  assert.equal((await suggest(h, [A[0] + 0.0001, A[1] + 0.0001], 15, day)).some((x) => x.block === 'am'), false, 'the morning is full on the real roads');
  // route_retime writes the very same times
  await server(h, `select public.route_retime($1, $2::date, 'am')`, [truck, day]);
  assert.deepEqual([(await row(h, r1.job_id)).eta_min, (await row(h, r2.job_id)).eta_min], [570, 680]);
}));

test('a leg leaving at 16 h 50 on a Wednesday: the evening rush, in the arrival AND in the room counted', () => tx(async (h) => {
  const { day } = await start(h, 3);
  const cc = await h.customer('C', ...C), cd = await h.customer('D', ...D);
  await roads(h, true);
  await measure(h, [HOME, C, D], (a, b, s) => {
    if (same(a, HOME) && same(b, C)) return s === 2 ? 20 : 10;
    if (same(a, C) && same(b, D)) return s === 2 ? 40 : 15;
    if (same(a, D) && same(b, C)) return 60;
    return 10;
  });
  const rc = await book(h, cc, day, 'eve', 25);
  assert.equal((await row(h, rc.job_id)).eta_min, 960 + 20, 'leaves at 16 h: evening rush');
  const rd = await book(h, cd, day, 'eve', 30);
  const jd = await row(h, rd.job_id);
  // C ends at 16 h 45, its 5 minutes of stop: the truck leaves at 16 h 50 (1010) → 40 minutes, not the usual 15
  assert.deepEqual([jd.eta_min, jd.travel_min], [1010 + 40, 45]);
  const p = await plan(h, day, 'eve');
  await holds(h, p);
  assert.equal(p.trucks[0].used, 55 + 25 + 45);
}));

test('a Saturday has no rush: the usual hours everywhere, and the room that is really there', () => tx(async (h) => {
  const { day } = await start(h, 6);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await roads(h, true);
  await measure(h, [HOME, A, B], (a, b, s) => (s === 1 ? 90 : 30));
  const r1 = await book(h, ca, day, 'am', 75);
  assert.equal((await row(h, r1.job_id)).eta_min, 480 + 30, 'Saturday 8 h: the usual hours');
  await book(h, cb, day, 'am', 75);
  const etas = (await h.q(`select eta_min from public.jobs where day = $1 and block = 'am' order by stop_order`, [day])).map((r) => r.eta_min);
  assert.deepEqual(etas, [480 + 30, 510 + 80 + 30], 'both fit: 30 minutes each leg');
  const p = await plan(h, day, 'am');
  await holds(h, p);
  assert.equal(p.trucks[0].left, 20, 'here the 20 minutes are true');
}));

test('a truck with a break in its hours: the stretches walked on the clock, the room counted the same way', () => tx(async (h) => {
  const split = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 600], [660, 1200]]]));   // a break 10 h – 11 h
  const { day } = await start(h, 2, split);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B), cc = await h.customer('C', ...C);
  await roads(h, true);
  await measure(h, [HOME, A, B, C], (a, b, s) => (s === 1 ? 60 : 20));
  await book(h, ca, day, 'am', 30);
  await book(h, cb, day, 'am', 30);
  const etas = (await h.q(`select eta_min from public.jobs where day = $1 and block = 'am' order by stop_order`, [day])).map((r) => r.eta_min);
  // the first leaves at 8 h (rush, 60) → 9 h; the second leaves at 9 h 35 (usual, 20) → 9 h 55, no room for 35 minutes
  // before 10 h: after the break, 11 h
  assert.deepEqual(etas, [540, 660]);
  const p = await plan(h, day, 'am');
  await holds(h, p);
  assert.equal(p.trucks[0].cap, 180);
  assert.equal(p.trucks[0].used, 60 + 65 + 25);
  // a third one would start at 11 h 55 for 35 minutes: past noon, refused
  assert.equal((await h.fails(() => book(h, cc, day, 'am', 30)))?.hint, 'block_full');
}));

test('a stop order set by hand: the arrivals and the room on the same clock; the moments offered follow', () => tx(async (h) => {
  const { day, truck } = await start(h, 2);
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await roads(h, true);
  await measure(h, [HOME, A, B], (a, b, s) => (s === 1 ? 90 : 30));
  const ra = await book(h, ca, day, 'am', 45), rb = await book(h, cb, day, 'am', 45);
  const order = (await h.q(`select id from public.jobs where day = $1 and block = 'am' order by stop_order`, [day])).map((r) => r.id);
  const wanted = [...order].reverse();
  assert.equal((await h.val(`select public.set_stop_order($1, $2, $3, 'am', $4::uuid[])`, [uuid(), truck, day, wanted])).ok, true);
  const first = await row(h, wanted[0]), second = await row(h, wanted[1]);
  assert.deepEqual([first.eta_min, second.eta_min], [570, 620 + 30], 'the first at 9 h 30 (the rush), the second leaves at 10 h 20 (30 min)');
  const p = await plan(h, day, 'am');
  await holds(h, p);
  assert.equal(p.trucks[0].left, 240 - (90 + 95 + 35));
  // 15 minutes next to the second still fit (it ends at noon); 20 do not
  const near2 = same(wanted[1] === ra.job_id ? A : B, A) ? A : B;
  const at = [near2[0] + 0.0001, near2[1] + 0.0001];
  const s15 = (await suggest(h, at, 15, day)).find((x) => x.block === 'am');
  assert.ok(s15, 'a 15-minute job fits after the second');
  assert.equal(s15.left, 0);
  assert.equal((await suggest(h, at, 20, day)).some((x) => x.block === 'am'), false, 'a 20-minute job does not');
  void rb;
}));

test('a job under way today (window mode): the next leg leaves when the work is done, at that hour’s time', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const truck = await h.truck('Camion 1', null, WEEK);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  await clock(h, 900);                                              // 15 h
  const day = await val(h, `select public.local_today()::text`);
  const working = Number(await val(h, `select extract(isodow from public.local_today())::int`)) <= 5;
  const ca = await h.customer('A', ...A), cb = await h.customer('B', ...B);
  await roads(h, true);
  await measure(h, [HOME, A, B], (a, b, s) => (same(a, A) && same(b, B) ? (s === 2 ? 70 : 30) : 30));
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  const a = uuid(), b = uuid();
  await h.q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min, arrived_at)
    values ($1, $2, $3, 'day', $4, 'on_site', 60, $5, $6, 1, 840, 10, now() - interval '10 minutes')`, [a, ca, day, truck, ...A]);
  await h.q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order, eta_min, travel_min)
    values ($1, $2, $3, 'day', $4, 'booked', 30, $5, $6, 2, 960, 10)`, [b, cb, day, truck, ...B]);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await h.as(h.me);
  // from 15 h, at A: 50 minutes of work left + 5 → the truck leaves A at 15 h 55: the evening rush on a working day
  const leg = working ? 70 : 30;
  const p = await plan(h, day, 'day');
  assert.deepEqual([p.jobs[b].eta, p.jobs[b].travel], [955 + leg, leg + 5]);
  await holds(h, p, { [a]: 50 });
  await server(h, `select public.replan_block_safe($1::date, 'day')`, [day]);
  assert.equal((await row(h, b)).eta_min, 955 + leg);
}));

test('« Garde-route » takes each leg at its hour: the same hop is near at noon and far at 16 h (the evening rush)', () => tx(async (h) => {
  const { day } = await start(h, 3);                                // a Wednesday
  const ca = await h.customer('A', ...A);
  await book(h, ca, day, 'am', 60);
  const near = [A[0] + 0.004, A[1] + 0.004];                        // ~0.5 km from A, but 50 minutes in the evening rush
  await roads(h, true);
  await measure(h, [HOME, A, near], (a, b, s) => ((same(a, A) && same(b, near)) || (same(a, near) && same(b, A)) ? (s === 2 ? 50 : 20) : 10));
  const rows = await suggest(h, near, 30, day);
  const at = (b) => rows.find((x) => x.block === b);
  // the afternoon leaves A's place at 12 h (usual hours: 20 min); the evening at 16 h (rush: 50 min, over the 35 of « Garde-route »)
  assert.deepEqual([at('pm').hop_min, at('pm').far, at('pm').unmeasured], [20, null, 0]);
  assert.deepEqual([at('eve').hop_min, at('eve').far], [50, 'hop'], 'far for a fact, at the hour it is driven');
  assert.equal(at('eve').day_min - at('pm').day_min, 30, 'the day’s driving counts the 50 minutes too');
  // blocks mode: no place said (fix-sql, lead's F2 decision: the booking may re-plan the other blocks)
  assert.deepEqual([at('eve').rank, at('eve').route], [null, null]);
}));

test('a busy garage, blocks then windows: every plan of every block counts the room with the times of its own arrivals', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await become(h, owner);
  const t1 = await h.truck('Camion', null, WEEK);
  await h.truck('Voiture', null, { ...WEEK, 2: [[480, 600], [660, 1200]] });   // a break on Tuesdays
  await server(h, `update public.trucks set start = '{"label": "Chez Saleh", "lat": 45.53, "lng": -73.62}'::jsonb where id = $1`, [t1]);
  const pts = [[45.5150, -73.6400], [45.5700, -73.7500], [45.4474, -73.4363], [45.6000, -73.5500], [45.5300, -73.6100], [45.4800, -73.5800],
    [45.5500, -73.7000], [45.5100, -73.5200], [45.5400, -73.6700], [45.4600, -73.6200]];
  const cs = [];
  for (const [i, p] of pts.entries()) cs.push(await h.customer('C' + i, ...p));
  await roads(h, true);
  // every trip measured; each its own times, the rush longer (or, for some, shorter) than the usual hours
  const mins = (a, b, s) => { const base = 6 + Math.round(Math.abs(a[0] - b[0]) * 400 + Math.abs(a[1] - b[1]) * 200); return s === 0 ? base : s === 1 ? base + (base % 3) * 9 : Math.max(1, base + (base % 4) * 7 - 5); };
  await measure(h, [HOME, [45.53, -73.62], ...pts], mins);
  const days = [await futureDay(h, 2), await futureDay(h, 3), await futureDay(h, 5)];
  let booked = 0, full = 0, k = 0;
  const check = async (blocks) => {
    for (const d of days) for (const b of blocks) {
      const p = await plan(h, d, b);
      await holds(h, p);
      for (const [id, j] of Object.entries(p.jobs)) {
        if (j.dep !== undefined) assert.ok(j.travel - 5 === j.eta - j.dep || j.eta > j.dep + j.travel - 5, `${id}: the leg written (${j.travel - 5}) is the one between its departure (${j.dep}) and its arrival (${j.eta})`);
      }
    }
  };
  for (const d of days) for (const b of ['am', 'pm', 'eve']) for (let i = 0; i < 4; i++) {
    const e = await h.fails(() => book(h, cs[k++ % cs.length], d, b, 30 + (k % 4) * 15));
    if (e) { assert.equal(e.hint, 'block_full'); full++; } else booked++;
  }
  await book(h, cs[3], days[0], 'am', 120, { force: true });
  assert.ok(booked >= 10 && full >= 1, `a full garage: ${booked} booked, ${full} refused`);
  await check(['am', 'pm', 'eve']);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  for (const d of days) for (let i = 0; i < 3; i++) {
    const e = await h.fails(() => book(h, cs[k++ % cs.length], d, 'day', 45, { win_start: 540 + i * 120 }));
    if (e) assert.ok(['window_full', 'block_full'].includes(e.hint), e.message);
  }
  await check(['day']);
}));
