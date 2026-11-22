// Part 28 « Envoyer les heures aux clients » (REARRANGE.md §1.3, §1.5; tests T1–T8 of §6.1): what a customer must be told now
// (tell_now / tell_state, the SAME table of cases as the app's twin: tests/fixtures/told-cases.json), what was already told
// on live (told_install), what clears it (the two triggers), the lease every text takes (tell_take / tell_done /
// tell_release), « Je l'ai averti » / « C'est envoyé » (tell_mark) and the list (tell_list). Each test runs in a transaction
// rolled back at the end, but T4b (two connections: its own committed rows, taken away after).
// Run: node --test tests/db/textos-journee.test.mjs (Mac: bash tests/stack/mac/db-tests.sh textos-journee)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tx, pool, uuid } from './helpers.mjs';

after(() => pool.end());

const CASES = JSON.parse(readFileSync(new URL('../fixtures/told-cases.json', import.meta.url), 'utf8'));
const DAY = [[480, 1200]];
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, DAY]));
const near = [45.5150, -73.6400];

/** asks the server itself (its own building blocks are closed to the app), then goes on as `who` */
async function server(h, who, sql, params = []) { await h.as(null); const r = await h.q(sql, params); await h.as(who); return r; }
/** the server's clock for this test only (minutes of today; rolled back with the test) */
const clock = (h, who, min) => server(h, who, `create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select ${Number(min)} $$`);
/** settings.booking / messages written as they are, the guards and the re-plan of a settings save left out (this
 *  transaction only): the case's own world, windows_on and roads_on included */
async function settingsAs(h, who, booking, messagesOn) {
  await h.as(null);
  await h.q(`set local session_replication_role = replica`);
  await h.q(`update public.settings set booking = $1::jsonb where id = 1`, [JSON.stringify(booking)]);
  if (messagesOn !== undefined) await h.q(`update public.settings set messages = jsonb_set(coalesce(messages, '{}'::jsonb), '{on}', $1::jsonb) where id = 1`, [JSON.stringify(messagesOn)]);
  await h.q(`set local session_replication_role = origin`);
  await h.as(who);
}
/** the case's settings.booking: the defaults, the case over them; rewin absent = not in booking */
function bookingOf(c) {
  const s = { ...CASES.defaults.settings, ...(c.settings || {}) };
  return s;
}
/** days from today → a date (null stays null) */
const dayOf = (h, n) => (n == null ? null : h.val(`select (public.local_today() + $1::int)::text`, [n]));
async function jobOf(h, c) {
  const j = { ...CASES.defaults.job, ...(c.job || {}) };
  return { ...j, day: await dayOf(h, j.day), told_day: await dayOf(h, j.told_day) };
}
const fromToday = (h, d) => (d == null ? null : h.val(`select ($1::date - public.local_today())::int`, [d]));
/** tell_now and tell_state of a row (never written) */
async function ruleOf(h, who, j) {
  const r = (await server(h, who, `select n.n_day::text d, n.n_start s, n.n_end e, n.rewin, n.drift, public.tell_state(x) st
    from jsonb_populate_record(null::public.jobs, $1::jsonb) x cross join lateral public.tell_now(x) n`, [JSON.stringify(j)]))[0];
  return { now: { day: await fromToday(h, r.d), start: r.s, end: r.e, rewin: r.rewin, drift: r.drift }, state: r.st };
}
/** a job written as the server writes it (the planner's and the told columns are the server's) */
async function put(h, who, j) {
  const id = j.id ?? uuid();
  await h.as(null);
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  const row = { duration_min: 60, ...j, id };
  const cols = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k)).map((k) => `"${k}"`).join(', ');
  await h.q(`insert into public.jobs (${cols}) select ${cols} from jsonb_populate_record(null::public.jobs, $1::jsonb)`, [JSON.stringify(row)]);
  await h.q(`select set_config('garage.rpc', '', true)`);
  await h.as(who);
  return id;
}
const row = (h, id) => h.one(`select to_jsonb(j) r from public.jobs j where j.id = $1`, [id]).then((x) => x.r);

/* ------------------------------------------------------------------------------------------------------------------
   T1 — the one rule, on the table of cases the app's twin reads too
   ------------------------------------------------------------------------------------------------------------------ */

test('T1 tell_now / tell_state answer every case of tests/fixtures/told-cases.json (the same table as the app’s twin, src/domain/jobs/told.test.ts)', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await h.as(owner);
  const base = (await server(h, owner, `select booking from public.settings where id = 1`))[0].booking ?? {};
  const wrong = [];
  for (const c of CASES.cases) {
    await h.c.query('savepoint c');
    const s = bookingOf(c);
    const booking = { ...base, ...s };
    if (!('rewin' in (c.settings || {}))) delete booking.rewin;
    await settingsAs(h, owner, booking, c.messages_on ?? {});
    await clock(h, owner, c.now_min ?? CASES.defaults.now_min);
    const j = await jobOf(h, c);
    const got = await ruleOf(h, owner, j);
    const want = c.want;
    if (JSON.stringify(got.now) !== JSON.stringify(want.now)) wrong.push(`${c.id}: now ${JSON.stringify(got.now)} ≠ ${JSON.stringify(want.now)}`);
    if (got.state !== want.state) wrong.push(`${c.id}: state ${got.state} ≠ ${want.state}`);
    // the kind and the list's three flags: through tell_list (the job written, a customer of the case)
    if (['new', 'changed', 'drift'].includes(want.state)) {
      const cu = c.customer ?? { phone: '5145550101', sms_ok: true };
      const cid = uuid();
      await h.as(null);
      await h.q(`insert into public.customers (id, first_name, last_name, phone, sms_ok, lat, lng, address) values ($1, 'Cas', 'Test', $2, $3, $4, $5, '1 rue Test')`,
        [cid, cu.phone, cu.sms_ok, ...near]);
      const id = await put(h, owner, { ...j, customer_id: cid, lat: near[0], lng: near[1] });
      const list = await h.rpc('tell_list', { p_day: j.day });
      const it = list.find((x) => x.id === id);
      if (!it) wrong.push(`${c.id}: not in tell_list`);
      else {
        if (it.state !== want.state) wrong.push(`${c.id}: tell_list state ${it.state}`);
        if (it.kind !== want.kind) wrong.push(`${c.id}: kind ${it.kind} ≠ ${want.kind}`);
        if (want.list) for (const k of ['phone_ok', 'sms_ok', 'kind_on']) if (it[k] !== want.list[k]) wrong.push(`${c.id}: ${k} ${it[k]} ≠ ${want.list[k]}`);
      }
    } else if (want.kind !== null) wrong.push(`${c.id}: a kind for a job not due`);
    await h.c.query('rollback to savepoint c');
  }
  assert.deepEqual(wrong, [], wrong.join('\n'));
  assert.ok(CASES.cases.length >= 70, 'the whole table is read');
}));

test('T1 tell_list on the world of told-cases.json: the due rows of each day (day or told day) in their order, the slips apart, never a past day', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await h.as(owner);
  const L = CASES.lists;
  const base = (await server(h, owner, `select booking from public.settings where id = 1`))[0].booking ?? {};
  await settingsAs(h, owner, { ...base, ...CASES.defaults.settings }, {});
  await clock(h, owner, L.now_min ?? CASES.defaults.now_min);
  const cust = {};
  await h.as(null);
  for (const j of L.jobs) if (j.customer && !cust[j.customer]) {
    cust[j.customer] = uuid();
    await h.q(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, $2, 'Liste', '5145550101', $3, $4, '1 rue Test')`, [cust[j.customer], j.customer, ...near]);
  }
  await h.as(owner);
  const ids = {};
  // numbers far from the base's own (a database not fresh holds browser rows)
  const n0 = Number(await h.val(`select coalesce(max(number), 0) + 100000 from public.jobs`));
  for (const x of L.jobs) {
    const j = { ...CASES.defaults.job, ...x.job };
    ids[x.id] = await put(h, owner, { ...j, day: await dayOf(h, j.day), told_day: await dayOf(h, j.told_day), number: n0 + x.number,
      customer_id: x.customer ? cust[x.customer] : null, lat: near[0], lng: near[1] });
  }
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  for (const [d, want] of Object.entries(L.days)) {
    const list = (await h.rpc('tell_list', { p_day: await dayOf(h, Number(d)) })).filter((x) => name[x.id]);
    assert.deepEqual(list.filter((x) => x.state !== 'drift').map((x) => name[x.id]), want.due, `day ${d}: the due ones, in order`);
    assert.deepEqual(list.filter((x) => x.state === 'drift').map((x) => name[x.id]), want.drift, `day ${d}: the slips`);
    const n = new Set(list.filter((x) => x.state !== 'drift').map((x) => x.customer_id ?? x.id)).size;
    assert.equal(n, want.n, `day ${d}: distinct clients`);
    for (const x of list) assert.equal(x.kind === null, x.state === 'drift', 'a slip has no kind');
  }
}));

/* ------------------------------------------------------------------------------------------------------------------
   T2 — told_install: what live's customers were already told
   ------------------------------------------------------------------------------------------------------------------ */

test('T2 told_install marks what was texted (told = now), the flexible ones by their window text, leaves the never-texted, never touches a cancelled or past one; twice = the same; a customer texted by the OLD notify after run 1 is marked again; no activity row', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const c = await h.customer('Ana', ...near);
  const d3 = await dayOf(h, 3), d1 = await dayOf(h, 1), dm1 = await dayOf(h, -1);
  const t0 = '2026-11-20T15:00:00+00:00', t1 = '2026-11-20T16:00:00+00:00', t2 = '2026-11-20T17:00:00+00:00';
  const J = (x) => ({ customer_id: c, block: 'day', status: 'booked', lat: near[0], lng: near[1], ...x });
  const texted = await put(h, owner, J({ day: d3, win_start: 540, win_end: 780, confirm_sent_at: t0 }));
  const flexTexted = await put(h, owner, J({ day: d1, win_start: 600, win_end: 840, win_flex: true, confirm_sent_at: t0 }));
  const flexWin = await put(h, owner, J({ day: d1, win_start: 660, win_end: 900, win_flex: true, confirm_sent_at: t0 }));
  const flexNoText = await put(h, owner, J({ day: d1, win_start: 720, win_end: 960, win_flex: true }));
  const flexWinNoConfirm = await put(h, owner, J({ day: d1, win_start: 780, win_end: 1020, win_flex: true }));
  const flexBookedLocked = await put(h, owner, J({ day: d1, win_start: 540, win_end: 780, win_flex: true, confirm_sent_at: t0 }));
  const flexStill = await put(h, owner, J({ day: d3, win_start: null, win_end: null, win_flex: true, confirm_sent_at: t0 }));
  const never = await put(h, owner, J({ day: d3, win_start: 600, win_end: 840 }));
  const cancelled = await put(h, owner, J({ day: d3, status: 'cancelled', win_start: 540, win_end: 780, confirm_sent_at: t0 }));
  const past = await put(h, owner, J({ day: dm1, win_start: 540, win_end: 780, confirm_sent_at: t0 }));
  const blockJob = await put(h, owner, J({ day: d3, block: 'pm', win_start: null, win_end: null, confirm_sent_at: t0 }));
  await h.as(null);
  // the evening lock fixed the windows of three flexible ones at t1; a window text went after it for one, before for none
  for (const id of [flexTexted, flexWin, flexNoText, flexWinNoConfirm]) {
    await h.q(`insert into public.activity (entity, entity_id, action, data, at) values ('job', $1, 'window_fixed', '{}'::jsonb, $2)`, [id, t1]);
  }
  for (const id of [flexWin, flexWinNoConfirm]) {
    await h.q(`insert into public.messages (job_id, customer_id, kind, status, created_at) values ($1, $2, 'window', 'sent', $3)`, [id, c, t2]);
  }
  await h.q(`insert into public.messages (job_id, customer_id, kind, status, created_at) values ($1, $2, 'window', 'failed', $3)`, [flexTexted, c, t2]);
  const acts = Number(await h.val(`select count(*) from public.activity`));
  const n1 = await h.val(`select public.told_install()`);
  const told = async (id) => { const r = await row(h, id); return [r.told_day, r.told_start, r.told_end, r.told_at && new Date(r.told_at).toISOString(), r.told_how]; };
  const iso = (t) => new Date(t).toISOString();
  assert.deepEqual(await told(texted), [d3, 540, 780, iso(t0), 'install'], 'texted: told the hours it has');
  assert.deepEqual(await told(flexTexted), [d1, null, null, iso(t0), 'install'], 'flexible texted, locked after, no window text: « dans la journée »');
  assert.deepEqual(await told(flexWin), [d1, 660, 900, iso(t2), 'install'], 'flexible, its window text sent after the lock: told that window');
  assert.deepEqual(await told(flexNoText), [null, null, null, null, null], 'flexible locked, never texted: left never told');
  assert.deepEqual(await told(flexWinNoConfirm), [d1, 780, 1020, iso(t2), 'install'], 'no confirmation but a window text after the lock: its window');
  assert.deepEqual(await told(flexBookedLocked), [d1, 540, 780, iso(t0), 'install'], 'booked into a day already locked (no lock since): its confirmation said the window');
  assert.deepEqual(await told(flexStill), [d3, null, null, iso(t0), 'install'], 'still flexible, texted: « dans la journée »');
  assert.deepEqual(await told(never), [null, null, null, null, null], 'never texted: left (the first press’s N)');
  assert.deepEqual(await told(cancelled), [null, null, null, null, null], 'cancelled: untouched');
  assert.deepEqual(await told(past), [null, null, null, null, null], 'past: untouched');
  assert.deepEqual(await told(blockJob), [d3, 720, 960, iso(t0), 'install'], 'a block job: told its block’s hours');
  assert.ok(n1 >= 7, `the seven of this world (and any other coming one of a database not fresh): ${n1}`);
  assert.equal(Number(await h.val(`select count(*) from public.activity`)), acts, 'no activity row');
  assert.equal(await h.val(`select public.told_install()`), 0, 'run again: nothing more');
  assert.deepEqual(await told(texted), [d3, 540, 780, iso(t0), 'install']);
  // the OLD notify texts two customers between run 1 and run 2 (a booking resent: confirm_sent_at; a window text)
  const t3 = new Date(Date.now() - 60000).toISOString();
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  await h.q(`update public.jobs set confirm_sent_at = $2 where id = $1`, [texted, t3]);
  await h.q(`insert into public.messages (job_id, customer_id, kind, status, created_at) values ($1, $2, 'window', 'sent', $3)`, [flexTexted, c, t3]);
  assert.ok(await h.val(`select public.told_install()`) >= 2, 'run 2 marks the two texted since');
  assert.deepEqual(await told(texted), [d3, 540, 780, iso(t3), 'install']);
  assert.deepEqual(await told(flexTexted), [d1, 600, 840, iso(t3), 'install'], 'its window text: now told its window, not due');
  await h.as(owner);
  assert.equal((await ruleOf(h, owner, await row(h, flexTexted))).state, 'ok');
  assert.equal((await ruleOf(h, owner, await row(h, never))).state, 'new');
}));

/* ------------------------------------------------------------------------------------------------------------------
   T3 — what clears it
   ------------------------------------------------------------------------------------------------------------------ */

test('T3 a new phone number clears told on that customer’s booked jobs only; « Changer de client » clears it; a name change keeps it', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  await h.as(owner);
  const c = await h.customer('Ana', ...near), c2 = await h.customer('Bob', ...near, { phone: '5145550222' });
  const d3 = await dayOf(h, 3);
  const told = { told_day: d3, told_start: 540, told_end: 780, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms', told_by: owner };
  const J = (x) => ({ customer_id: c, block: 'am', status: 'booked', day: d3, lat: near[0], lng: near[1], ...told, ...x });
  const a = await put(h, owner, J({})), done = await put(h, owner, J({ status: 'done' })), other = await put(h, owner, J({ customer_id: c2 }));
  await h.as(null);
  await h.q(`update public.customers set first_name = 'Anna' where id = $1`, [c]);
  assert.equal((await row(h, a)).told_at !== null, true, 'a name change: kept');
  await h.q(`update public.customers set phone = '514 555 0999' where id = $1`, [c]);
  const ra = await row(h, a);
  assert.deepEqual([ra.told_day, ra.told_start, ra.told_end, ra.told_at, ra.told_how, ra.told_by], [null, null, null, null, null, null], 'a new number never got the text');
  assert.notEqual((await row(h, done)).told_at, null, 'a job done keeps it');
  assert.notEqual((await row(h, other)).told_at, null, 'another customer keeps his');
  await h.q(`update public.customers set phone = '(514) 555-0999' where id = $1`, [c]);   // the same digits written otherwise
  // « Changer de client »
  const b = await put(h, owner, J({ customer_id: c2, block: 'pm' }));
  await h.as(owner);
  const r = await h.rpc('job_customer', { p_op: uuid(), p_job: b, p_customer: c, p_vehicle: null });
  assert.equal(r.ok, true);
  const rb = await row(h, b);
  assert.deepEqual([rb.told_day, rb.told_at, rb.told_how], [null, null, null], 'another customer on the job: never told');
}));

/* ------------------------------------------------------------------------------------------------------------------
   T4 / T5 — the lease and the told write
   ------------------------------------------------------------------------------------------------------------------ */

async function dueWorld(h) {
  const owner = await h.person('Hassan', ['owner']);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const c = await h.customer('Ana', ...near);
  const d3 = await dayOf(h, 3);
  const J = (x) => ({ customer_id: c, block: 'day', status: 'booked', day: d3, lat: near[0], lng: near[1], win_start: 540, win_end: 780, eta_min: 600, ...x });
  const told = { told_day: d3, told_start: 540, told_end: 780, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms' };
  return { owner, c, d3, J, told };
}
const take = (h, ids, again = null, token = 7, force = false) =>
  h.val(`select public.tell_take($1::uuid[], $2::uuid[], $3::int, $4::boolean)`, [ids, again, token, force]);

test('T4 tell_take: the second call is busy; a lease older than 2 minutes is taken again; a job told meanwhile is already; « Renvoyer » takes a « peut-être »; force takes a told job; a slip of today is never taken', () => tx(async (h) => {
  const w = await dueWorld(h);
  const never = await put(h, w.owner, w.J({}));
  await h.as(null);
  const t1 = await take(h, [never], null, 11);
  assert.equal(t1[0].take, true); assert.equal(t1[0].kind, 'booking'); assert.equal(t1[0].state, 'new');
  assert.deepEqual(t1[0].now, { day: w.d3, start: 540, end: 780, rewin: false, ws: 540, we: 780 });
  assert.equal(t1[0].job.id, never);
  assert.deepEqual(await take(h, [never], null, 12), [{ id: never, busy: true }], 'a second press while the first sends');
  await h.q(`update public.rate_limits set at = now() - interval '3 minutes' where key = $1`, ['tell:' + never]);
  assert.equal((await take(h, [never], null, 13))[0].take, true, 'an old lease (a text that never answered) is taken over');
  // the text went: told, the lease dropped
  await h.q(`select public.tell_done($1, 13, $2::jsonb, 'sms', null, 'booking')`, [never, JSON.stringify(t1[0].now)]);
  assert.deepEqual(await take(h, [never], null, 14), [{ id: never, already: true }], 'told meanwhile: nothing to send');
  // « peut-être parti » then « Renvoyer »
  const maybe = await put(h, w.owner, w.J({ ...w.told, told_how: 'maybe' }));
  await h.as(null);
  assert.deepEqual(await take(h, [maybe]), [{ id: maybe, already: true }]);
  assert.equal((await take(h, [maybe], [maybe]))[0].take, true, '« Renvoyer » takes it');
  const sure = await put(h, w.owner, w.J({ ...w.told }));
  await h.as(null);
  assert.deepEqual(await take(h, [sure], [sure]), [{ id: sure, already: true }], '« again » only for a « peut-être »');
  const forced = (await take(h, [sure], null, 7, true))[0];
  assert.equal(forced.take, true, 'the single path’s resend');
  // today, told = planned, the arrival slipped: never taken (the « en route » text gives the time)
  await h.q(`create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select 600 $$`);
  const today = await dayOf(h, 0);
  const slip = await put(h, w.owner, w.J({ ...w.told, day: today, told_day: today, eta_min: 785 }));
  await h.as(null);
  assert.deepEqual(await take(h, [slip]), [{ id: slip, already: true }], 'a slip of today: never texted by the button');
  // gone: cancelled, past, unknown
  const cancelled = await put(h, w.owner, w.J({ status: 'cancelled' }));
  await h.as(null);
  const unknown = uuid();
  const many = await take(h, [cancelled, unknown]);
  assert.deepEqual(many.sort((a, b) => a.id.localeCompare(b.id)), [{ id: cancelled, gone: true }, { id: unknown, gone: true }].sort((a, b) => a.id.localeCompare(b.id)));
}));

test('T5 tell_done writes told (and the window of his arrival when it is still the one the text was cut from), never over a newer told, confirm_sent_at for booking / moved, not for window; tell_release drops only its own lease', () => tx(async (h) => {
  const w = await dueWorld(h);
  // pushed late by an automatic plan: the window of his arrival is what he must be told
  const late = await put(h, w.owner, w.J({ ...w.told, eta_min: 830 }));
  await h.as(null);
  const t = (await take(h, [late], null, 21))[0];
  assert.equal(t.take, true); assert.equal(t.kind, 'moved');
  assert.deepEqual(t.now, { day: w.d3, start: 780, end: 1020, rewin: true, ws: 540, we: 780 });
  await h.q(`select public.tell_done($1, 21, $2::jsonb, 'sms', $3, 'moved')`, [late, JSON.stringify(t.now), w.owner]);
  let r = await row(h, late);
  assert.deepEqual([r.told_day, r.told_start, r.told_end, r.told_how, r.told_by], [w.d3, 780, 1020, 'sms', w.owner]);
  assert.deepEqual([r.win_start, r.win_end], [780, 1020], 'his window is the one he was just told');
  assert.notEqual(r.confirm_sent_at, null);
  assert.equal(Number(await h.val(`select count(*) from public.rate_limits where key = $1 and at > now() - interval '2 minutes'`, ['tell:' + late])), 0, 'the lease dropped');
  // the window moved between the take and the text: told written, the window left as it is now
  const moved = await put(h, w.owner, w.J({ ...w.told, eta_min: 830 }));
  await h.as(null);
  const t2 = (await take(h, [moved], null, 22))[0];
  await h.q(`select set_config('garage.rpc', 'on', true)`);
  await h.q(`update public.jobs set win_start = 600, win_end = 840 where id = $1`, [moved]);
  await h.q(`select public.tell_done($1, 22, $2::jsonb, 'sms', null, 'moved')`, [moved, JSON.stringify(t2.now)]);
  r = await row(h, moved);
  assert.deepEqual([r.told_start, r.told_end, r.win_start, r.win_end], [780, 1020, 600, 840]);
  // a newer told is never replaced
  const newer = await put(h, w.owner, w.J({ ...w.told, told_at: new Date(Date.now() + 3600e3).toISOString(), told_how: 'call' }));
  await h.as(null);
  await h.q(`select public.tell_done($1, null, $2::jsonb, 'sms', null, 'booking')`, [newer, JSON.stringify({ day: w.d3, start: 600, end: 840, rewin: false })]);
  r = await row(h, newer);
  assert.deepEqual([r.told_start, r.told_how], [540, 'call']);
  // window: no confirm_sent_at
  const flex = await put(h, w.owner, w.J({ win_flex: true, told_day: w.d3, told_start: null, told_end: null, told_at: '2026-11-20T15:00:00+00:00', told_how: 'sms' }));
  await h.as(null);
  const t3 = (await take(h, [flex], null, 23))[0];
  assert.equal(t3.kind, 'window');
  await h.q(`select public.tell_done($1, 23, $2::jsonb, 'sms', null, 'window')`, [flex, JSON.stringify(t3.now)]);
  r = await row(h, flex);
  assert.deepEqual([r.told_start, r.told_end, r.confirm_sent_at], [540, 780, null]);
  // tell_release: only its own token's lease
  const rel = await put(h, w.owner, w.J({}));
  await h.as(null);
  assert.equal((await take(h, [rel], null, 31))[0].take, true);
  await h.q(`select public.tell_release($1, 99)`, [rel]);
  assert.deepEqual(await take(h, [rel], null, 32), [{ id: rel, busy: true }], 'another token does not drop it');
  await h.q(`select public.tell_release($1, 31)`, [rel]);
  assert.equal((await take(h, [rel], null, 33))[0].take, true, 'its own token does');
}));

/* ------------------------------------------------------------------------------------------------------------------
   T6 — « Je l'ai averti » / « C'est envoyé »
   ------------------------------------------------------------------------------------------------------------------ */

test('T6 tell_mark: the hours shown = tell_now → told « call » / « hand »; other hours → changed; the same op twice → the first answer; a mechanic: « call » refused, « hand » on the job of his truck marked', () => tx(async (h) => {
  const w = await dueWorld(h);
  await h.as(null);
  const saleh = await h.person('Saleh', ['mechanic']);
  const tk = await h.truck('Camion', saleh, WEEK);
  const a = await put(h, w.owner, w.J({ truck_id: tk, eta_min: 830, ...w.told }));       // due: 13 h à 17 h
  const b = await put(h, w.owner, w.J({ truck_id: tk }));                                 // never told: 9 h à 13 h
  const mark = (id, how, start, end, kind = 'moved') => ({ id, how, kind, day: w.d3, start, end });
  await h.as(w.owner);
  const op = uuid();
  const r1 = await h.rpc('tell_mark', { p_op: op, p_marks: [mark(a, 'call', 780, 1020), mark(b, 'call', 600, 840, 'booking')] });
  assert.deepEqual([r1.ok, r1.marked, r1.changed, r1.busy], [true, [a], [b], []]);
  const ra = await row(h, a);
  assert.deepEqual([ra.told_start, ra.told_end, ra.told_how, ra.told_by, ra.win_start, ra.win_end], [780, 1020, 'call', w.owner, 780, 1020], 'told, and his window is the told one');
  assert.ok(r1.rows.jobs.some((x) => x.id === a));
  assert.equal((await row(h, b)).told_at, null, 'b: other hours than shown → still due');
  assert.deepEqual(await h.rpc('tell_mark', { p_op: op, p_marks: [] }), r1, 'the same op: the first answer');
  // a mechanic
  await h.as(saleh);
  const e = await h.fails(() => h.rpc('tell_mark', { p_op: uuid(), p_marks: [mark(b, 'call', 540, 780, 'booking')] }));
  assert.equal(e?.hint, 'not_allowed');
  const r2 = await h.rpc('tell_mark', { p_op: uuid(), p_marks: [mark(b, 'hand', 540, 780, 'booking')] });
  assert.deepEqual(r2.marked, [b], '« C’est envoyé » by the mechanic of the job');
  assert.equal((await row(h, b)).told_how, 'hand');
  // not his truck: refused, all undone
  const other = await put(h, w.owner, w.J({}));
  await h.as(saleh);
  assert.equal((await h.fails(() => h.rpc('tell_mark', { p_op: uuid(), p_marks: [mark(other, 'hand', 540, 780, 'booking')] })))?.hint, 'not_allowed');
  // a bad list
  await h.as(w.owner);
  assert.equal((await h.fails(() => h.rpc('tell_mark', { p_op: uuid(), p_marks: [{ id: a, how: 'sms', day: w.d3, start: 1, end: 2 }] })))?.hint, 'bad_list');
}));

/* ------------------------------------------------------------------------------------------------------------------
   T7 — the list, and who may read it
   ------------------------------------------------------------------------------------------------------------------ */

test('T7 tell_list: owner and office yes, a mechanic, an inactive member and an account with no staff row no; the rows of day = D and told_day = D; a slip with kind null; a « Réserver » account without « Agenda » gets only the jobs it may open; phone_ok, sms_ok, kind_on', () => tx(async (h) => {
  const w = await dueWorld(h);
  await h.as(null);
  const office = await h.person('Lina', ['office']);
  const saleh = await h.person('Saleh', ['mechanic']);
  const booker = await h.person('Omar', ['mechanic'], { rights: { book: true } });
  const tk = await h.truck('Camion', saleh, WEEK), tk2 = await h.truck('Voiture', booker, WEEK);
  const d4 = await dayOf(h, 4), today = await dayOf(h, 0);
  await clock(h, w.owner, 600);
  const cNo = await h.customer('Sans', ...near, { phone: '12' });
  const movedAway = await put(h, w.owner, w.J({ truck_id: tk, day: d4, ...w.told }));             // told d3, now d4
  const never = await put(h, w.owner, w.J({ truck_id: tk2, customer_id: cNo }));                 // never told, no cell
  const ok = await put(h, w.owner, w.J({ truck_id: tk, ...w.told }));                             // nothing to tell
  const slip = await put(h, w.owner, w.J({ truck_id: tk, day: today, ...w.told, told_day: today, eta_min: 785 }));
  for (const who of [w.owner, office]) {
    await h.as(who);
    const l3 = await h.rpc('tell_list', { p_day: w.d3 });
    const ids = l3.map((x) => x.id);
    assert.ok(ids.includes(movedAway) && ids.includes(never) && !ids.includes(ok), 'day = D and told_day = D, nothing for « ok »');
    const m = l3.find((x) => x.id === movedAway);
    assert.deepEqual([m.state, m.kind, m.told.day, m.now.day, m.phone_ok, m.sms_ok, m.kind_on], ['changed', 'moved', w.d3, d4, true, true, true]);
    const n = l3.find((x) => x.id === never);
    assert.deepEqual([n.state, n.kind, n.told, n.phone_ok], ['new', 'booking', null, false]);
    assert.ok((await h.rpc('tell_list', { p_day: d4 })).some((x) => x.id === movedAway), 'and on the day he has now');
    const lt = await h.rpc('tell_list', { p_day: today });
    const s = lt.find((x) => x.id === slip);
    assert.deepEqual([s?.state, s?.kind], ['drift', null], 'today’s slip: listed apart, no kind');
  }
  await h.as(saleh);
  assert.equal((await h.fails(() => h.rpc('tell_list', { p_day: w.d3 })))?.hint, 'not_allowed', 'a mechanic');
  await h.as(booker);
  const lb = await h.rpc('tell_list', { p_day: w.d3 });
  assert.deepEqual(lb.map((x) => x.id), [never], '« Réserver » without « Agenda »: only the jobs of his truck');
  await h.as(null);
  await h.q(`update public.staff set active = false where id = $1`, [office]);
  await h.as(office);
  assert.equal((await h.fails(() => h.rpc('tell_list', { p_day: w.d3 })))?.hint, 'not_allowed', 'an inactive member');
  const stranger = randomUUID();
  await h.as(null);
  await h.q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [stranger, `${stranger.slice(0, 8)}@test.local`]);
  await h.as(stranger);
  assert.equal((await h.fails(() => h.rpc('tell_list', { p_day: w.d3 })))?.hint, 'not_allowed', 'no staff row');
  assert.equal((await h.fails(() => h.rpc('tell_mark', { p_op: uuid(), p_marks: [] })))?.hint, 'not_allowed', 'tell_mark: no staff row');
}));

/* ------------------------------------------------------------------------------------------------------------------
   T8 — who may call what
   ------------------------------------------------------------------------------------------------------------------ */

test('T8 the app may call day_order_preview, day_order_save, tell_list, tell_mark; every helper of Part 28 is the server’s own; each has its search_path fixed', () => tx(async (h) => {
  const app = ['day_order_preview', 'day_order_save', 'tell_list', 'tell_mark'];
  const own = ['day_rewin_on', 'told_hours', 'tell_now', 'tell_state', 'day_order_core', 'tell_take', 'tell_done', 'tell_release', 'told_install',
    'jobs_told_reset', 'customers_told_reset'];
  const rows = await h.q(`select p.proname n, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon,
      has_function_privilege('service_role', p.oid, 'execute') svc, p.prosecdef def,
      exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') sp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...app, ...own]]);
  assert.equal(rows.length, app.length + own.length, 'one form of each');
  for (const r of rows) {
    assert.equal(r.auth, app.includes(r.n), `${r.n}: the app ${app.includes(r.n) ? 'may' : 'may not'}`);
    assert.equal(r.anon, false, `${r.n}: never the public key`);
    assert.equal(r.svc, true, `${r.n}: the server key`);
    assert.equal(r.def && r.sp, true, `${r.n}: security definer, search_path fixed`);
  }
  const src = readFileSync(new URL('./refonte-droits.test.mjs', import.meta.url), 'utf8');
  for (const n of app) assert.match(src, new RegExp(`'${n}'`), `${n} is in APP of refonte-droits.test.mjs`);
}));

/* ------------------------------------------------------------------------------------------------------------------
   T4b — two connections: a row another transaction holds is skipped, never waited for (code F4)
   ------------------------------------------------------------------------------------------------------------------ */

test('T4b a job held by another transaction: tell_take([it, another]) answers busy for it and takes the other at once; tell_take([it]) alone waits, then takes it; tell_mark skips it (busy)', async () => {
  const c = await pool.connect(), k = await pool.connect(), k2 = await pool.connect();
  const owner = randomUUID(), cust = randomUUID();
  const ids = [randomUUID(), randomUUID()];
  const ops = [randomUUID()];
  const within = (p, ms) => Promise.race([p.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r('waiting'), ms))]);
  try {
    await c.query('begin');
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Hassan T4b', 'Hassan', '{owner}', '{}', $2)`, [owner, `${owner.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'T4b', 'Test', '5145550101', $2, $3, '1 rue Test')`, [cust, ...near]);
    await c.query(`select set_config('garage.rpc', 'on', true)`);
    for (const id of ids) {
      await c.query(`insert into public.jobs (id, customer_id, day, block, status, duration_min, lat, lng) values ($1, $2, public.local_today() + 34, 'am', 'booked', 60, $3, $4)`, [id, cust, ...near]);
    }
    await c.query('commit');
    const [held, free] = ids;
    await k.query('begin');
    await k.query(`update public.jobs set notes = notes where id = $1`, [held]);
    const t0 = Date.now();
    const r = (await c.query(`select public.tell_take($1::uuid[], null, 5, false) v`, [[held, free]])).rows[0].v;
    assert.ok(Date.now() - t0 < 2000, 'without waiting');
    assert.deepEqual(r.find((x) => x.id === held), { id: held, busy: true });
    assert.equal(r.find((x) => x.id === free).take, true);
    // tell_mark skips it too
    await k2.query('begin');
    await k2.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' }), owner]);
    await k2.query('set local role authenticated');
    const day = (await k2.query(`select (public.local_today() + 34)::text d`)).rows[0].d;
    const m = (await k2.query(`select public.tell_mark($1, $2::jsonb) v`, [ops[0], JSON.stringify([{ id: held, how: 'call', kind: 'booking', day, start: 480, end: 720 }])])).rows[0].v;
    assert.deepEqual(m.busy, [held], 'tell_mark: busy, not waited for');
    await k2.query('rollback');
    // alone, it waits for its row, then takes it
    const p = c.query(`select public.tell_take($1::uuid[], null, 6, false) v`, [[held]]);
    assert.equal(await within(p, 400), 'waiting', 'one id: it waits');
    await k.query('commit');
    const alone = (await p).rows[0].v;
    assert.equal(alone[0].take, true);
  } finally {
    await k.query('rollback').catch(() => {}); k.release();
    await k2.query('rollback').catch(() => {}); k2.release();
    await c.query('begin');
    await c.query(`select set_config('garage.rpc', 'on', true)`);
    await c.query(`delete from public.rate_limits where key = any($1::text[])`, [ids.map((x) => 'tell:' + x)]);
    await c.query(`delete from public.jobs where id = any($1::uuid[])`, [ids]);
    await c.query(`delete from public.customers where id = $1`, [cust]);
    await c.query(`delete from public.op_log where op = any($1::uuid[])`, [ops]);
    await c.query(`delete from public.activity where entity_id = any($1::uuid[]) or entity_id = $2 or xmin = pg_current_xact_id()::xid`, [ids, cust]);
    await c.query(`delete from public.staff where id = $1`, [owner]);
    await c.query(`delete from auth.users where id = $1`, [owner]);
    await c.query('commit');
    c.release();
  }
});
