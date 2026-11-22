// Part 28 « Envoyer les heures aux clients »: the server function notify, its day's button ({ action: 'day' }) and the
// single texts under the same lease (REARRANGE.md §1.5, §1.6, §3.3–3.5, §3.7; tests A1–A15 of §6.2). The real notify
// through the gateway, the fake GoHighLevel on 8021 (tests/stack/mocks.mjs: ghl=fail, ghl_ms, ghl_msg_ms, ghl_fail),
// real accounts and sign-in. The worlds are WRITTEN (jobs inserted with their window, arrival and what they were told),
// each on a day of its own, so the planner never moves them; the days the planner does touch (a booking, a move, a
// rearranged day) are the server's own answers. Everything made here is removed at the end, the settings, the secrets,
// the fake's knobs and the server's clock put back as they were.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import pg from '../stack/node_modules/pg/lib/index.js';

const K = JSON.parse(readFileSync(new URL('../stack/keys.json', import.meta.url)));
const API = 'http://127.0.0.1:54331', MOCK = 'http://127.0.0.1:8021', BASE = 'http://127.0.0.1:4173/';
const db = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 3 });
const made = { users: [], customers: [], trucks: [], jobs: [] };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function adminUser(email, password) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: K.service, authorization: `Bearer ${K.service}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }) });
  const d = await r.json();
  assert.ok(d.id, 'user created: ' + JSON.stringify(d));
  made.users.push(d.id);
  return d.id;
}
async function signIn(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return r.json();
}
async function fn(name, body, jwt) {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt || K.anon}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
}
async function rpc(name, args, jwt) {
  const r = await fetch(`${API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message), d);
  return d;
}
const control = (qs) => fetch(`${MOCK}/control?${qs}`);
const mockLog = async () => (await fetch(`${MOCK}/log`)).json();
const clearLog = () => fetch(`${MOCK}/log/clear`, { method: 'POST' });
/** the fake GoHighLevel's contact id of a number (+1 and the ten digits, as _shared/ghl.ts sends it) */
const contactOf = (phone) => 'ct_1' + String(phone).replace(/\D/g, '').slice(-10);
/** the texts that reached GoHighLevel (answered, not given up) for a number, or for everybody */
async function texts(phone) {
  return (await mockLog()).filter((x) => x.svc === 'ghl' && x.path === '/conversations/messages' && !x.aborted && (!phone || x.body?.contactId === contactOf(phone)));
}
/** the texts GoHighLevel RECEIVED (logged at once when it is slow), for a number */
async function arrived(phone) {
  return (await mockLog()).filter((x) => x.svc === 'ghl-arrived' && x.path === '/conversations/messages' && x.contact === contactOf(phone));
}

let owner, ownerJwt, truck, snap, ghlBefore, startedAt, dayN = 20;
/** a day of its own for each world (nothing plans it but what the test does) */
const newDay = async () => (await q(`select (public.local_today() + $1::int)::text d`, [dayN++]))[0].d;
const sameIds = (a, b, what) => assert.deepEqual([...(a || [])].sort(), [...b].sort(), what);

let phoneN = 0;
const phoneOf = () => `514 7${String(10 + (process.pid % 80)).padStart(2, '0')}-${String(1000 + (++phoneN) * 7 + Math.floor(Math.random() * 6)).slice(-4)}`;
/** a customer (a cell that takes texts unless said) */
async function customer(first, o = {}) {
  const id = randomUUID(); made.customers.push(id);
  const phone = o.phone === undefined ? phoneOf() : o.phone;
  await q(`insert into public.customers (id, first_name, last_name, phone, lang, sms_ok, lat, lng) values ($1, $2, 'Test', $3, $4, $5, $6, $7)`,
    [id, first, phone, o.lang || 'fr', o.sms_ok ?? true, o.lat ?? null, o.lng ?? null]);
  return { id, phone, first };
}
/** an appointment written as the planner and the texts left it: its window, its arrival, what the customer was told */
async function job(c, day, o = {}) {
  const id = randomUUID(); made.jobs.push(id);
  const told = o.told;   // { day, start, end, at?, how? } | undefined (never told)
  await q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, eta_min, win_start, win_end, win_flex, stop_order, lat, lng,
      told_day, told_start, told_end, told_at, told_how, confirm_sent_at, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [id, c.id, day, o.block || 'day', o.truck === undefined ? truck : o.truck, o.status || 'booked', o.dur ?? 30, o.eta ?? null,
      o.ws ?? null, o.we ?? null, o.flex ?? false, o.order ?? null, o.lat ?? null, o.lng ?? null,
      told ? told.day : null, told ? told.start : null, told ? told.end : null, told ? (told.at || new Date(Date.now() - 3600000).toISOString()) : null,
      told ? (told.how || 'sms') : null, told ? (told.at || new Date(Date.now() - 3600000).toISOString()) : null, o.by || owner]);
  await q(`insert into public.job_items (job_id, description, unit_cents, status, sort) values ($1, 'Vidange d’huile', 7999, 'planned', 0)`, [id]);
  return id;
}
const toldOf = async (id) => (await q(`select told_day::text, told_start, told_end, told_how, told_by, told_at is not null as told, confirm_sent_at is not null as confirmed,
  confirm_sent_at, win_start, win_end, day::text from public.jobs where id = $1`, [id]))[0];
/** the day's button as the app presses it: the list it showed, a new op */
const press = (day, only, o = {}, jwt = ownerJwt) => fn('notify', { action: 'day', day, base: BASE, op: o.op || randomUUID(), only, ...(o.again ? { again: o.again } : {}) }, jwt);
const msgs = async (id) => q(`select kind, status, body from public.messages where job_id = $1 order by created_at`, [id]);
/** a lease held right now on that appointment (tell_release makes it old: the next send takes it over at once) */
const lease = async (id) => (await q(`select count(*)::int n from public.rate_limits where key = $1 and at > now() - interval '2 minutes'`, [`tell:${id}`]))[0].n;

before(async () => {
  startedAt = (await q(`select now() t`))[0].t;
  const email = `owner-tj-${randomUUID().slice(0, 6)}@test.local`;
  owner = await adminUser(email, 'motdepasse-1');
  await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, 'Hassan Jeha', 'Hassan', '{owner}', $2)`, [owner, email]);
  ownerJwt = (await signIn(email, 'motdepasse-1')).access_token;
  assert.ok(ownerJwt);
  [snap] = await q(`select booking, company, messages from public.settings where id = 1`);
  ghlBefore = await q(`select key, value from public.secrets where key in ('ghl_token', 'ghl_location')`);
  await q(`update public.settings set company = coalesce(company, '{}'::jsonb) || '{"name":"Mécanique Mobile H.I.S","phone":"438 901-6606"}'::jsonb where id = 1`);
  await q(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  // window mode (« Plages d’arrivée »), as the owner turns it on; « Vraies routes » stays off (every arrival is sure)
  if (snap.booking?.windows_on !== true) {
    const sw = await rpc('windows_switch', { p_op: randomUUID(), p_on: true }, ownerJwt);
    assert.equal(sw.ok, true, JSON.stringify(sw));
  }
  truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active) values ($1, 'Camion textos', true)`, [truck]);
  for (let dow = 0; dow < 7; dow++) await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[480,1200]]') on conflict do nothing`, [truck, dow]);
  await control('ghl=ok&ghl_ms=0&ghl_msg_ms=0&ghl_fail=');
  await clearLog();
});
after(async () => {
  await control('ghl=ok&ghl_ms=0&ghl_msg_ms=0&ghl_fail=');
  try {
    if (snap.booking?.windows_on !== true) {
      try { await rpc('windows_switch', { p_op: randomUUID(), p_on: false }, ownerJwt); } catch { await q(`update public.settings set booking = booking - 'windows_on' where id = 1`); }
    }
    const jobs = (await q(`select id from public.jobs where customer_id = any($1)`, [made.customers])).map((r) => r.id);
    await q(`delete from public.rate_limits where key like 'tell:%' or key like 'book:%'`);
    await q(`delete from public.messages where job_id = any($1) or customer_id = any($2)`, [jobs, made.customers]);
    await q(`delete from public.public_links where job_id = any($1)`, [jobs]);
    await q(`delete from public.activity where entity_id = any($1) or at >= $2`, [jobs, startedAt]);
    await q(`delete from public.op_log where at >= $1`, [startedAt]);
    await q(`delete from public.job_items where job_id = any($1)`, [jobs]);
    await q(`delete from public.jobs where id = any($1)`, [jobs]);
    await q(`delete from public.vehicles where customer_id = any($1)`, [made.customers]);
    await q(`delete from public.customers where id = any($1)`, [made.customers]);
    await q(`delete from public.trucks where id = any($1)`, [made.trucks]);
    await q(`delete from public.staff where id = any($1)`, [made.users]);
    await q(`delete from auth.users where id = any($1)`, [made.users]);
    await q(`delete from public.secrets where key in ('ghl_token', 'ghl_location')`);
    for (const s of ghlBefore) await q(`insert into public.secrets (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [s.key, s.value]);
    await q(`update public.settings set company = $1::jsonb, messages = $2::jsonb where id = 1`, [JSON.stringify(snap.company ?? {}), JSON.stringify(snap.messages ?? {})]);
  } finally { await db.end(); }
});

/* ---------- A1, A2: the button texts each customer owed his hours, once, with the words of his state ---------- */

test('A1 / A2: « Envoyer les heures aux clients » texts exactly the customers owed their hours (booking / window / moved words), writes told, never twice; the same op answers the first answer', async () => {
  const day = await newDay();
  const a = await customer('Omar'), b = await customer('Chloé'), c = await customer('Denis'), d = await customer('Ines'), e = await customer('Alice');
  // never told anything → the whole confirmation; told « dans la journée » and now a window the same day → the window
  // text; told 8–12, now 14–18 → « a changé »; told what holds → nothing; two cars → one text per appointment
  const ja = await job(a, day, { ws: 600, we: 840, eta: 650 });
  const jb = await job(b, day, { ws: 720, we: 960, eta: 750, flex: true, told: { day, start: null, end: null } });
  const jc = await job(c, day, { ws: 840, we: 1080, eta: 900, told: { day, start: 480, end: 720 } });
  const jd = await job(d, day, { ws: 600, we: 840, eta: 650, told: { day, start: 600, end: 840 } });
  const je1 = await job(e, day, { ws: 480, we: 720, eta: 500 }), je2 = await job(e, day, { ws: 480, we: 720, eta: 560 });
  const list = await rpc('tell_list', { p_day: day }, ownerJwt);
  const due = list.filter((x) => x.state === 'new' || x.state === 'changed').map((x) => x.id);
  sameIds(due, [ja, jb, jc, je1, je2], 'the server lists exactly the ones owed their hours: ' + JSON.stringify(list));
  assert.deepEqual(Object.fromEntries(list.map((x) => [x.id, x.kind])), { [ja]: 'booking', [jb]: 'window', [jc]: 'moved', [je1]: 'booking', [je2]: 'booking' });
  await clearLog();
  const op = randomUUID();
  const r = await press(day, [ja, jb, jc, jd, je1, je2], { op });
  assert.deepEqual([r.ok, r.status, r.day], [true, 'done', day], JSON.stringify(r));
  sameIds(r.sent, [ja, jb, jc, je1, je2], 'sent: ' + JSON.stringify(r));
  sameIds(r.already, [jd], 'nothing new to tell Ines');
  for (const k of ['maybe', 'busy', 'gone', 'quiet', 'no_phone', 'failed', 'by_hand', 'left']) assert.deepEqual(r[k], [], `${k}: ${JSON.stringify(r)}`);
  assert.equal((await texts()).length, 5, 'exactly five texts went');
  assert.equal((await texts(e.phone)).length, 2, 'two cars: one text per appointment');
  // the words: the same templates as the single texts, with the hours he must be told
  const [ma] = await msgs(ja), [mb] = await msgs(jb), [mc] = await msgs(jc);
  assert.deepEqual([ma.kind, mb.kind, mc.kind, ma.status, mb.status, mc.status], ['booking', 'window', 'moved', 'sent', 'sent', 'sent']);
  assert.match(ma.body, /^Bonjour Omar, votre rendez-vous avec Mécanique Mobile H\.I\.S est confirmé : [^\n]+, entre 10 h et 14 h\.\n\nEstimation :\n• Vidange d’huile\u00a0: 79,99 \$\nTotal : 79,99 \$ \+ tx\n\nPour accepter l’estimation/, ma.body);
  assert.match(mb.body, /^Bonjour Chloé, votre plage d’arrivée est confirmée : Mécanique Mobile H\.I\.S vient [^\n]+, entre 12 h et 16 h\. Pour changer : 438 901-6606$/, mb.body);
  assert.match(mc.body, /^Bonjour Denis, votre rendez-vous avec Mécanique Mobile H\.I\.S a changé : [^\n]+, entre 14 h et 18 h\. Détails : http/, mc.body);
  assert.equal((await texts(c.phone))[0].body.message, mc.body, 'what GoHighLevel got is what is kept');
  // told = the hours that text said, by the person who pressed; confirm_sent_at for booking / moved, not for the window
  const ta = await toldOf(ja), tb = await toldOf(jb), tc = await toldOf(jc);
  assert.deepEqual([ta.told_day, ta.told_start, ta.told_end, ta.told_how, ta.told_by, ta.confirmed], [day, 600, 840, 'sms', owner, true]);
  assert.deepEqual([tb.told_day, tb.told_start, tb.told_end, tb.told_how], [day, 720, 960, 'sms']);
  assert.ok(new Date(tb.confirm_sent_at) < new Date(Date.now() - 1800000), 'the window text leaves confirm_sent_at as it was');
  assert.deepEqual([tc.told_day, tc.told_start, tc.told_end, tc.told_how, tc.confirmed], [day, 840, 1080, 'sms', true]);
  for (const id of [ja, jb, jc, je1, je2]) assert.equal(await lease(id), 0, 'every lease dropped');
  assert.deepEqual((await rpc('tell_list', { p_day: day }, ownerJwt)).filter((x) => x.state !== 'drift'), [], 'nobody owed anything now');

  // A2: pressed again with a new op (the app's way after a lost answer): nothing to send; the same op: the first answer
  await clearLog();
  const again = await press(day, [ja, jb, jc, jd, je1, je2]);
  sameIds(again.already, [ja, jb, jc, jd, je1, je2], JSON.stringify(again));
  assert.deepEqual(again.sent, []);
  assert.equal((await texts()).length, 0, 'never twice');
  const same = await press(day, [ja], { op });
  assert.deepEqual(same, r, 'the same op: the first answer, nothing texted');
  assert.equal((await texts()).length, 0);
});

/* ---------- A3: two presses at once ---------- */

test('A3: two people press at the same second: each customer texted ONCE, the other press says « busy » or « already »', async () => {
  const day = await newDay();
  const cs = [await customer('Paul'), await customer('Rita'), await customer('Sami'), await customer('Tina')];
  const ids = [];
  for (const [i, c] of cs.entries()) ids.push(await job(c, day, { ws: 480 + i * 60, we: 720 + i * 60, eta: 500 + i * 60 }));
  await clearLog();
  const [x, y] = await Promise.all([press(day, ids), press(day, ids)]);
  for (const id of ids) {
    const inX = x.sent.includes(id), inY = y.sent.includes(id);
    assert.ok(inX !== inY, `${id} sent by exactly one press: ${JSON.stringify([x, y])}`);
    const other = inX ? y : x;
    assert.ok(other.busy.includes(id) || other.already.includes(id), 'the other press: busy or already');
  }
  for (const c of cs) assert.equal((await texts(c.phone)).length, 1, `${c.first} texted once`);
});

/* ---------- A3b: a single text in flight and the button at the same time ---------- */

test('A3b: the booking text still in flight (slow GoHighLevel) when the button is pressed → ONE text; the same with a single « window » text', async () => {
  const day = await newDay();
  const e = await customer('Émile'), f = await customer('Fanny');
  const je = await job(e, day, { ws: 600, we: 840, eta: 620 });
  const jf = await job(f, day, { ws: 720, we: 960, eta: 760, flex: true, told: { day, start: null, end: null } });
  await clearLog();
  await control('ghl_ms=9000');
  let single, btn, single2, btn2;
  try {
    const s1 = fn('notify', { kind: 'booking', job_id: je, base: BASE }, ownerJwt);
    const s2 = fn('notify', { kind: 'window', job_id: jf, base: BASE }, ownerJwt);
    await sleep(2500);   // both single texts hold their lease (their contact call is waiting at GoHighLevel)
    [btn, btn2] = await Promise.all([press(day, [je]), press(day, [jf])]);
    [single, single2] = await Promise.all([s1, s2]);
  } finally { await control('ghl_ms=0'); }
  assert.deepEqual([btn.busy, btn.sent], [[je], []], 'the button leaves him to the text in flight: ' + JSON.stringify(btn));
  assert.deepEqual([btn2.busy, btn2.sent], [[jf], []], JSON.stringify(btn2));
  assert.deepEqual([single.status, single2.status], ['sent', 'sent'], JSON.stringify([single, single2]));
  assert.equal((await texts(e.phone)).length, 1, 'Émile got one text');
  assert.equal((await texts(f.phone)).length, 1, 'Fanny got one text');
  const te = await toldOf(je), tf = await toldOf(jf);
  assert.deepEqual([te.told_day, te.told_start, te.told_end, te.told_how, te.confirmed], [day, 600, 840, 'sms', true]);
  assert.deepEqual([tf.told_day, tf.told_start, tf.told_end, tf.told_how], [day, 720, 960, 'sms']);
  // afterwards the button has nothing for them
  await clearLog();
  const later = await press(day, [je, jf]);
  sameIds(later.already, [je, jf], JSON.stringify(later));
  assert.equal((await texts()).length, 0);
});

/* ---------- A4: GoHighLevel refuses ---------- */

test('A4: GoHighLevel refuses (DND, STOP): `failed` with what to tell by hand, nobody told; « Je l’ai averti » marks one, the next press texts only the other; a refusal for one number leaves the others sent', async () => {
  const day = await newDay();
  const g = await customer('Gilles'), h = await customer('Hugo'), k = await customer('Karim');
  const jg = await job(g, day, { ws: 600, we: 840, eta: 650 });
  const jh = await job(h, day, { ws: 840, we: 1080, eta: 900, told: { day, start: 480, end: 720 } });
  const jk = await job(k, day, { ws: 480, we: 720, eta: 500 });
  await clearLog();
  await control('ghl=fail');
  let r;
  try { r = await press(day, [jg, jh]); } finally { await control('ghl=ok'); }
  assert.deepEqual(r.sent, [], JSON.stringify(r));
  const fg = r.failed.find((x) => x.id === jg), fh = r.failed.find((x) => x.id === jh);
  assert.ok(fg && fh, JSON.stringify(r.failed));
  assert.deepEqual([fg.told, fg.kind, fg.phone], [{ day, start: 600, end: 840 }, 'booking', g.phone]);
  assert.deepEqual([fh.told, fh.kind], [{ day, start: 840, end: 1080 }, 'moved']);
  assert.match(fh.error, /GoHighLevel 422|DND/, fh.error);
  assert.equal((await toldOf(jg)).told, false, 'nobody told');
  assert.deepEqual([(await toldOf(jh)).told_start, (await toldOf(jh)).told_end], [480, 720], 'Hugo still told his old hours');
  assert.equal(await lease(jg) + await lease(jh), 0, 'the leases dropped: he may be texted again');
  // « Je l’ai averti » (called) on Hugo with what the list showed
  const m = await rpc('tell_mark', { p_op: randomUUID(), p_marks: [{ id: jh, how: 'call', kind: fh.kind, day, start: fh.told.start, end: fh.told.end }] }, ownerJwt);
  assert.deepEqual(m.marked, [jh], JSON.stringify(m));
  assert.equal((await toldOf(jh)).told_how, 'call');
  await clearLog();
  const r2 = await press(day, [jg, jh]);
  assert.deepEqual([r2.sent, r2.already], [[jg], [jh]], JSON.stringify(r2));
  assert.equal((await texts()).length, 1, 'only Gilles');
  // one number refused among the day's customers: the others go
  const k2 = await customer('Lina');
  const jl = await job(k2, day, { ws: 480, we: 720, eta: 520 });
  await clearLog();
  await control(`ghl_fail=${k.phone.replace(/\D/g, '')}`);
  let r3;
  try { r3 = await press(day, [jk, jl]); } finally { await control('ghl_fail='); }
  assert.deepEqual([r3.sent, r3.failed.map((x) => x.id)], [[jl], [jk]], JSON.stringify(r3));
  assert.equal((await toldOf(jk)).told, false);
  assert.equal((await toldOf(jl)).told_how, 'sms');
  // a single booking text that fails answers what it said too (« C’est envoyé » on the « send by hand » sheet)
  const n = await customer('Nadia');
  const jn = await job(n, day, { ws: 720, we: 960, eta: 760 });
  await control('ghl=fail');
  let one;
  try { one = await fn('notify', { kind: 'booking', job_id: jn, base: BASE }, ownerJwt); } finally { await control('ghl=ok'); }
  assert.deepEqual([one.ok, one.status, one.told, one.kind, one.job_id], [false, 'error', { day, start: 720, end: 960 }, 'booking', jn], JSON.stringify(one));
  assert.equal((await toldOf(jn)).told, false);
  assert.equal(await lease(jn), 0);
});

/* ---------- A5: texting not set up ---------- */

test('A5: texting not set up (no GoHighLevel secrets): every one handed back to send by hand (message, link, told); « C’est envoyé » marks him, the list is then empty', async () => {
  const day = await newDay();
  const o = await customer('Olivier'), p = await customer('Pia');
  const jo = await job(o, day, { ws: 600, we: 840, eta: 650 });
  const jp = await job(p, day, { ws: 840, we: 1080, eta: 900, told: { day, start: 480, end: 720 } });
  const keep = await q(`select key, value from public.secrets where key in ('ghl_token', 'ghl_location')`);
  await q(`delete from public.secrets where key in ('ghl_token', 'ghl_location')`);
  let r, one;
  try {
    await clearLog();
    r = await press(day, [jo, jp]);
    // the single path says what its message tells too
    const x = await customer('Xavier');
    one = await fn('notify', { kind: 'booking', job_id: await job(x, day, { ws: 480, we: 720, eta: 500 }), base: BASE }, ownerJwt);
  } finally {
    for (const s of keep) await q(`insert into public.secrets (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [s.key, s.value]);
  }
  assert.equal((await texts()).length, 0, 'nothing reached GoHighLevel');
  assert.deepEqual(r.sent, [], JSON.stringify(r));
  const ho = r.by_hand.find((x) => x.id === jo), hp = r.by_hand.find((x) => x.id === jp);
  assert.ok(ho && hp, JSON.stringify(r.by_hand));
  assert.deepEqual([ho.told, ho.kind, ho.phone], [{ day, start: 600, end: 840 }, 'booking', o.phone]);
  assert.match(ho.message, /^Bonjour Olivier, votre rendez-vous .+ est confirmé : [^\n]+, entre 10 h et 14 h\./);
  assert.ok(ho.message.includes(ho.link) && ho.link.startsWith(BASE + 'client.html#t='), 'the text carries its link');
  assert.deepEqual([hp.told, hp.kind], [{ day, start: 840, end: 1080 }, 'moved']);
  assert.match(hp.message, /a changé : [^\n]+, entre 14 h et 18 h\. Détails : /);
  assert.equal((await toldOf(jo)).told, false, 'nothing told before « C’est envoyé »');
  assert.deepEqual([one.status, one.told?.start, one.kind], ['off', 480, 'booking'], JSON.stringify(one));
  // « C’est envoyé »: told 'hand' with what that message said
  const m = await rpc('tell_mark', { p_op: randomUUID(), p_marks: [ho, hp].map((x) => ({ id: x.id, how: 'hand', kind: x.kind, day: x.told.day, start: x.told.start, end: x.told.end })) }, ownerJwt);
  sameIds(m.marked, [jo, jp], JSON.stringify(m));
  assert.deepEqual([(await toldOf(jo)).told_how, (await toldOf(jp)).told_how], ['hand', 'hand']);
  const left = (await rpc('tell_list', { p_day: day }, ownerJwt)).filter((x) => [jo, jp].includes(x.id));
  assert.deepEqual(left, [], 'the list is empty for them');
});

/* ---------- A6: no phone, refuses texts, the kind off ---------- */

test('A6: no cell, « ne veut pas de textos », « Rendez-vous changé » off in Réglages: to tell by hand, nothing sent, stays owed; « Je l’ai averti » works', async () => {
  const day = await newDay();
  const p = await customer('Pierre', { phone: null }), r0 = await customer('Rose', { sms_ok: false }), s0 = await customer('Sacha');
  const jp = await job(p, day, { ws: 600, we: 840, eta: 650 });
  const jr = await job(r0, day, { ws: 600, we: 840, eta: 660 });
  const js = await job(s0, day, { ws: 840, we: 1080, eta: 900, told: { day, start: 480, end: 720 } });
  const list = await rpc('tell_list', { p_day: day }, ownerJwt);
  const row = (id) => list.find((x) => x.id === id);
  assert.deepEqual([row(jp).phone_ok, row(jr).sms_ok, row(js).kind_on], [false, false, true], JSON.stringify(list));
  await q(`update public.settings set messages = jsonb_set(messages, '{on,moved}', 'false') where id = 1`);
  let r;
  try {
    await clearLog();
    r = await press(day, [jp, jr, js]);
  } finally { await q(`update public.settings set messages = jsonb_set(messages, '{on,moved}', 'true') where id = 1`); }
  assert.equal((await texts()).length, 0, 'nothing sent');
  assert.deepEqual(r.no_phone, [jp], JSON.stringify(r));
  assert.deepEqual(r.quiet.map((x) => [x.id, x.why]).sort(), [[jr, 'sms_ok'], [js, 'kind_off']].sort());
  assert.deepEqual(r.sent, []);
  for (const id of [jp, jr]) assert.equal((await toldOf(id)).told, false, 'stays owed');
  assert.equal(await lease(jp) + await lease(jr) + await lease(js), 0);
  const m = await rpc('tell_mark', { p_op: randomUUID(), p_marks: [{ id: jp, how: 'call', kind: 'booking', day, start: 600, end: 840 }] }, ownerJwt);
  assert.deepEqual(m.marked, [jp], JSON.stringify(m));
  assert.equal((await toldOf(jp)).told_how, 'call');
});

/* ---------- A7: out of time, and « peut-être parti » ---------- */

test('A7: a slow GoHighLevel: the ones not reached in time come back in `left`, the next call (new op) sends them; every customer texted once', async () => {
  const day = await newDay();
  const cs = [], ids = [];
  for (let i = 0; i < 8; i++) { const c = await customer(`Client${i}`); cs.push(c); ids.push(await job(c, day, { ws: 480 + (i % 4) * 60, we: 720 + (i % 4) * 60, eta: 500 + (i % 4) * 60 })); }
  await clearLog();
  await control('ghl_ms=7000');
  let r1;
  const t0 = Date.now();
  try { r1 = await press(day, ids); } finally { await control('ghl_ms=0'); }
  assert.ok(Date.now() - t0 < 38000, `answered in ${Date.now() - t0} ms (the app waits 40 s)`);
  assert.ok(r1.left.length > 0, 'some left for the next call: ' + JSON.stringify(r1));
  assert.ok(r1.sent.length > 0, JSON.stringify(r1));
  for (const id of r1.left) assert.equal((await toldOf(id)).told, false, 'a customer left is not told');
  const r2 = await press(day, r1.left);
  // a text not started in time is « not sent » (never sent twice): sent again by a third press
  const r3 = r1.failed.length ? await press(day, r1.failed.map((x) => x.id)) : { sent: [] };
  sameIds([...r1.sent, ...r2.sent, ...r3.sent], ids, JSON.stringify([r1, r2, r3]));
  for (const c of cs) assert.equal((await texts(c.phone)).length, 1, `${c.first} texted once`);
});

test('A7 / A11: the text taken by GoHighLevel answered too late (« peut-être parti »): counted told (maybe), never texted again by the button; « Renvoyer » (again) sends it once more; the same for a single booking text', async () => {
  const day = await newDay();
  const m = await customer('Marc'), n = await customer('Noé');
  const jm = await job(m, day, { ws: 600, we: 840, eta: 650 });
  const jn = await job(n, day, { ws: 720, we: 960, eta: 760 });
  await clearLog();
  await control('ghl_msg_ms=40000');
  let r, one;
  const t0 = Date.now();
  try { [r, one] = await Promise.all([press(day, [jm]), fn('notify', { kind: 'booking', job_id: jn, base: BASE }, ownerJwt)]); }
  finally { await control('ghl_msg_ms=0'); }
  assert.ok(Date.now() - t0 < 38000, `answered in ${Date.now() - t0} ms`);
  assert.deepEqual([r.maybe, r.sent, r.failed], [[jm], [], []], JSON.stringify(r));
  assert.deepEqual([one.ok, one.status, one.maybe], [false, 'error', true], JSON.stringify(one));
  assert.match(one.error, /peut-être parti/);
  assert.deepEqual([(await toldOf(jm)).told_how, (await toldOf(jm)).told_start], ['maybe', 600]);
  assert.deepEqual([(await toldOf(jn)).told_how, (await toldOf(jn)).told_start, (await toldOf(jn)).confirmed], ['maybe', 720, true]);
  assert.equal((await arrived(m.phone)).length, 1, 'GoHighLevel got Marc’s text once');
  assert.equal((await arrived(n.phone)).length, 1);
  // pressed again: nothing (a text that may have gone is never sent again by itself)
  const r2 = await press(day, [jm, jn]);
  sameIds(r2.already, [jm, jn], JSON.stringify(r2));
  assert.equal((await arrived(m.phone)).length + (await arrived(n.phone)).length, 2, 'nothing more reached GoHighLevel');
  // « Renvoyer » after looking at his conversation: once more (the late answer of the first one may still come: not counted)
  const [first] = await msgs(jm);
  const r3 = await press(day, [jm], { again: [jm] });
  assert.deepEqual(r3.sent, [jm], JSON.stringify(r3));
  assert.equal((await texts(m.phone)).filter((x) => x.body.message !== first.body).length, 1, 'sent once more');
  assert.equal((await toldOf(jm)).told_how, 'sms');
  const r4 = await press(day, [jm], { again: [jm] });
  assert.deepEqual(r4.already, [jm], '« again » only for a « peut-être parti »: ' + JSON.stringify(r4));
});

/* ---------- A8: only the list the person saw ---------- */

test('A8: `only` = the list the person saw: an appointment booked after it was drawn is not texted; ids the person cannot open are not texted; a list too long is refused', async () => {
  const day = await newDay();
  const a = await customer('Amir'), b = await customer('Béa');
  const ja = await job(a, day, { ws: 600, we: 840, eta: 650 });
  const jb = await job(b, day, { ws: 600, we: 840, eta: 700 });   // « booked after the list was drawn »
  await clearLog();
  const r = await press(day, [ja]);
  assert.deepEqual(r.sent, [ja], JSON.stringify(r));
  assert.equal((await texts(b.phone)).length, 0);
  assert.equal((await toldOf(jb)).told, false, 'still owed: the next list shows her');
  const many = Array.from({ length: 101 }, () => randomUUID());
  const bad = await press(day, many);
  assert.deepEqual([bad.status, bad.code], [400, 'bad_list'], JSON.stringify(bad));
  assert.deepEqual([(await press(day, ['pas-un-id'])).code, (await press('demain', [ja])).code], ['bad_list', 'bad_list']);
  // nothing asked of the day's button still answers « kind » (the cutover's check: POST {} → 400 kind)
  const none = await fn('notify', {}, ownerJwt);
  assert.deepEqual([none.status, none.code], [400, 'kind']);
});

/* ---------- A9: a rearranged day, and a customer pushed late ---------- */

test('A9: a customer whose window the « Réorganiser » save moved, and one pushed out of her window by an exact move: both texted their new window; the second’s window written when she is told', async () => {
  const day = await newDay();
  const a = await customer('Anne', { lat: 45.515, lng: -73.64 }), b = await customer('Bruno', { lat: 45.51, lng: -73.655 });
  const ja = await job(a, day, { ws: 480, we: 720, eta: 500, order: 1, dur: 60, lat: 45.515, lng: -73.64, told: { day, start: 480, end: 720 } });
  const jb = await job(b, day, { ws: 480, we: 720, eta: 600, order: 2, dur: 300, lat: 45.51, lng: -73.655, told: { day, start: 480, end: 720 } });
  // Bruno (5 h of work) dragged first: Anne is pushed past noon, the save gives her the window of her new arrival
  const was = {};
  for (const r of await q(`select id, truck_id, block, stop_order, win_start, win_end, arrive_at, status from public.jobs where id = any($1)`, [[ja, jb]])) {
    was[r.id] = [r.truck_id, r.block, r.stop_order, r.win_start, r.win_end, r.arrive_at, r.status];
  }
  const args = { p_day: day, p_lists: [{ truck, block: 'day', jobs: [jb, ja] }], p_moved: [jb], p_was: was, p_auto: false };
  const pv = await rpc('day_order_preview', args, ownerJwt);
  assert.equal(pv.ok, true, JSON.stringify(pv));
  const sv = await rpc('day_order_save', { p_op: randomUUID(), ...args, p_accept: pv.accept }, ownerJwt);
  assert.equal(sv.saved, true, JSON.stringify(sv));
  const after1 = await toldOf(ja);
  assert.ok(after1.win_start > 480, 'Anne got a later window: ' + JSON.stringify(after1));
  assert.deepEqual([after1.told_start, after1.told_end], [480, 720], 'the save tells nobody');
  await clearLog();
  const r = await press(day, [ja, jb]);
  assert.deepEqual([r.sent, r.already], [[ja], [jb]], JSON.stringify(r));
  const h = (m) => `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;
  assert.ok((await texts(a.phone))[0].body.message.includes(`, entre ${h(after1.win_start)} et ${h(after1.win_end)}. Détails : `), (await texts(a.phone))[0]?.body?.message);
  const ta = await toldOf(ja);
  assert.deepEqual([ta.told_start, ta.told_end], [after1.win_start, after1.win_end]);

  // Carla booked 8 h – 12 h and told so; Dan (5 h of work) put at 9 h exactly by « Déplacer à l'heure choisie », Carla
  // accepted late: her window is kept (the exact move cuts none), her sure arrival is now after noon
  const day2 = await newDay();
  const ca = await customer('Carla', { lat: 45.515, lng: -73.64 }), dn = await customer('Dan', { lat: 45.51, lng: -73.655 });
  const bc = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: ca.id, day: day2, block: 'day', win_start: 480, duration_min: 60, truck_id: truck }, p_items: [] }, ownerJwt);
  const bd = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: dn.id, day: day2, block: 'day', win_start: 840, duration_min: 300, truck_id: truck }, p_items: [] }, ownerJwt);
  made.jobs.push(bc.job_id, bd.job_id);
  assert.equal((await fn('notify', { kind: 'booking', job_id: bc.job_id, base: BASE }, ownerJwt)).status, 'sent');
  assert.deepEqual([(await toldOf(bc.job_id)).told_start, (await toldOf(bc.job_id)).told_end], [480, 720]);
  const mp = await rpc('move_preview', { p_job: bd.job_id, p_day: day2, p_truck: truck, p_at: 540 }, ownerJwt);
  const late = (mp.stops || []).filter((x) => x.late).map((x) => x.id);
  assert.ok(late.includes(bc.job_id), 'the preview says Carla would be late: ' + JSON.stringify(mp));
  const mv = await rpc('move_job', { p_op: randomUUID(), p_job: bd.job_id, p_day: day2, p_block: 'day', p_truck: truck, p_win_start: null, p_win_flex: false,
    p_exact: { at: 540, late_ok: [...late, bd.job_id] } }, ownerJwt);
  assert.equal(mv.ok, true, JSON.stringify(mv));
  const [cj] = await q(`select eta_min, win_start, win_end from public.jobs where id = $1`, [bc.job_id]);
  assert.ok(cj.eta_min > 720 && cj.win_start === 480 && cj.win_end === 720, 'pushed past her window, her window kept: ' + JSON.stringify(cj));
  const [w] = await q(`select win_start, win_end from public.win_for($1)`, [cj.eta_min]);
  await clearLog();
  const r2 = await press(day2, [bc.job_id]);
  assert.deepEqual(r2.sent, [bc.job_id], JSON.stringify(r2));
  assert.ok((await texts(ca.phone))[0].body.message.includes(`, entre ${h(w.win_start)} et ${h(w.win_end)}. Détails : `), (await texts(ca.phone))[0]?.body?.message);
  const tc = await toldOf(bc.job_id);
  assert.deepEqual([tc.told_start, tc.told_end, tc.win_start, tc.win_end], [w.win_start, w.win_end, w.win_start, w.win_end], 'her window = what she was told, written at that moment');
});

/* ---------- A10: the question's « Envoyer le texto » ---------- */

test('A10: « Envoyer le texto » after a move (single « moved » under the lease): one text with the new hours, told written, the button then texts him nothing; again → « already »; « resend » → sent; while the button holds his lease → « already »', async () => {
  const d1 = await newDay(), d2 = await newDay();
  const c = await customer('Julie', { lat: 45.52, lng: -73.62 });
  const b = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: c.id, day: d1, block: 'day', win_start: 840, duration_min: 60, truck_id: truck }, p_items: [{ description: 'Vidange d’huile', unit_cents: 7999 }] }, ownerJwt);
  made.jobs.push(b.job_id);
  const bk = await fn('notify', { kind: 'booking', job_id: b.job_id, base: BASE }, ownerJwt);
  assert.equal(bk.status, 'sent', JSON.stringify(bk));
  const t0 = await toldOf(b.job_id);
  assert.deepEqual([t0.told_day, t0.told_start, t0.told_end, t0.told_how], [d1, 840, 1080, 'sms'], 'the booking text tells his hours');
  const mv = await rpc('move_job', { p_op: randomUUID(), p_job: b.job_id, p_day: d2, p_block: 'day', p_truck: truck, p_win_start: 600, p_win_flex: false }, ownerJwt);
  assert.equal(mv.ok, true, JSON.stringify(mv));
  const moved = await toldOf(b.job_id);
  assert.deepEqual([moved.day, moved.win_start, moved.win_end, moved.told_day], [d2, 600, 840, d1], 'moved, not told yet');
  await clearLog();
  const s = await fn('notify', { kind: 'moved', job_id: b.job_id, base: BASE }, ownerJwt);
  assert.equal(s.status, 'sent', JSON.stringify(s));
  assert.match(s.message, /^Bonjour Julie, votre rendez-vous avec Mécanique Mobile H\.I\.S a changé : [^\n]+, entre 10 h et 14 h\. Détails : /, s.message);
  assert.equal((await texts(c.phone)).length, 1);
  assert.deepEqual((await msgs(b.job_id)).map((x) => x.kind), ['booking', 'moved']);
  const t1 = await toldOf(b.job_id);
  assert.deepEqual([t1.told_day, t1.told_start, t1.told_end, t1.told_how, t1.told_by], [d2, 600, 840, 'sms', owner]);
  assert.equal(await lease(b.job_id), 0);
  // the button: nothing new for him, on either day
  for (const d of [d1, d2]) assert.deepEqual((await press(d, [b.job_id])).already, [b.job_id]);
  // the same question answered again: nothing new to tell him
  await clearLog();
  assert.equal((await fn('notify', { kind: 'moved', job_id: b.job_id, base: BASE }, ownerJwt)).status, 'already');
  // (by his number: the late answers of the « peut-être parti » test before may still land in the fake's log)
  assert.equal((await mockLog()).filter((x) => x.svc === 'ghl' && (x.body?.contactId === contactOf(c.phone) || x.body?.phone === '+1' + c.phone.replace(/\D/g, ''))).length, 0, 'not even a contact call');
  assert.equal((await fn('notify', { kind: 'moved', job_id: b.job_id, base: BASE, resend: true }, ownerJwt)).status, 'sent', '« resend » sends whatever');
  // the day's button holding his lease right now: no second text
  await q(`insert into public.rate_limits (key, bucket, n, at) values ($1, 0, 424242, now()) on conflict (key, bucket) do update set n = 424242, at = now()`, [`tell:${b.job_id}`]);
  try {
    await clearLog();
    assert.equal((await fn('notify', { kind: 'moved', job_id: b.job_id, base: BASE, resend: true }, ownerJwt)).status, 'already');
    assert.equal((await texts(c.phone)).length, 0);
  } finally { await q(`delete from public.rate_limits where key = $1`, [`tell:${b.job_id}`]); }
});

/* ---------- A11: single booking / window write told ---------- */

test('A11: single booking and window texts write told; a « window » text after the button told him → « already »', async () => {
  const day = await newDay();
  const a = await customer('Yves'), b = await customer('Zoé'), c = await customer('Wassim');
  const ja = await job(a, day, { ws: 600, we: 840, eta: 650 });
  const jb = await job(b, day, { ws: 720, we: 960, eta: 750, flex: true, told: { day, start: null, end: null } });
  const jc = await job(c, day, { ws: 840, we: 1080, eta: 900, flex: true, told: { day, start: null, end: null } });
  assert.equal((await fn('notify', { kind: 'booking', job_id: ja, base: BASE }, ownerJwt)).status, 'sent');
  const ta = await toldOf(ja);
  assert.deepEqual([ta.told_day, ta.told_start, ta.told_end, ta.told_how, ta.confirmed], [day, 600, 840, 'sms', true]);
  const before = (await toldOf(jb)).confirm_sent_at;
  assert.equal((await fn('notify', { kind: 'window', job_id: jb, base: BASE }, ownerJwt)).status, 'sent');
  const tb = await toldOf(jb);
  assert.deepEqual([tb.told_start, tb.told_end, tb.told_how], [720, 960, 'sms']);
  assert.equal(String(tb.confirm_sent_at), String(before), 'the window text leaves confirm_sent_at');
  assert.deepEqual((await press(day, [jc])).sent, [jc]);
  await clearLog();
  assert.equal((await fn('notify', { kind: 'window', job_id: jc, base: BASE }, ownerJwt)).status, 'already');
  assert.equal((await texts(c.phone)).length, 0);
});

/* ---------- A12: who may press ---------- */

test('A12: rights: the truck’s own mechanic (no « Réserver ») 403; signed out refused; a member switched off 403 no_access; « Réserver » without « Agenda »: the appointments he cannot open are not texted', async () => {
  const day = await newDay();
  const account = async (name, roles, rights = {}) => {
    const email = `${name}-${randomUUID().slice(0, 6)}@test.local`;
    const id = await adminUser(email, 'garage-2026');
    await q(`insert into public.staff (id, full_name, short_name, roles, email, rights) values ($1, $2, $2, $3, $4, $5::jsonb)`, [id, name, roles, email, JSON.stringify(rights)]);
    return { id, jwt: (await signIn(email, 'garage-2026')).access_token };
  };
  const mech = await account('Saleh', '{mechanic}');
  const t2 = randomUUID(); made.trucks.push(t2);
  await q(`insert into public.trucks (id, name, active, driver_id) values ($1, 'Voiture textos', true, $2)`, [t2, mech.id]);
  const c1 = await customer('Rami'), c2 = await customer('Sofia');
  const mine = await job(c1, day, { ws: 600, we: 840, eta: 650, truck: t2 });
  const not = await job(c2, day, { ws: 600, we: 840, eta: 660, truck });
  const r1 = await press(day, [mine], {}, mech.jwt);
  assert.deepEqual([r1.status, r1.code], [403, 'not_allowed'], JSON.stringify(r1));
  assert.match(r1.error, /Seuls le propriétaire et le bureau envoient les heures aux clients/);
  const r2 = await press(day, [mine], {}, null);
  assert.equal(r2.status, 401, JSON.stringify(r2));
  // « Réserver » without « Agenda »: he opens his truck's appointments only
  await q(`update public.staff set rights = '{"book": true}'::jsonb where id = $1`, [mech.id]);
  await clearLog();
  const r3 = await press(day, [mine, not], {}, mech.jwt);
  assert.equal(r3.status, 'done', JSON.stringify(r3));
  assert.deepEqual(r3.sent, [mine], JSON.stringify(r3));
  for (const k of ['already', 'busy', 'gone', 'left']) assert.ok(!r3[k].includes(not), `${k} does not name it`);
  assert.equal((await texts(c2.phone)).length, 0, 'Sofia not texted');
  assert.equal((await toldOf(not)).told, false);
  assert.equal((await toldOf(mine)).told_by, mech.id, 'told by the person who pressed');
  // switched off: no access at all
  await q(`update public.staff set active = false where id = $1`, [mech.id]);
  const r4 = await press(day, [mine], {}, mech.jwt);
  assert.deepEqual([r4.status, r4.code], [403, 'no_access'], JSON.stringify(r4));
});

/* ---------- A13: the web booking ---------- */

test('A13: « Réserver en ligne » (book): the confirmation goes under the lease and writes told (booking, by nobody)', async () => {
  const day = (await q(`select (public.local_today() + 2)::text d`))[0].d;
  const oil = (await q(`insert into public.services (name_fr, name_en, price_cents, duration_min) values ('Huile textos', 'Oil texts', 8000, 45) returning id`))[0].id;
  const phone = phoneOf();
  const [{ on }] = await q(`select coalesce((booking->'web'->>'on')::boolean, true) as on from public.settings where id = 1`);
  await q(`update public.settings set booking = jsonb_set(booking, '{web,on}', 'true') where id = 1`);
  try {
    await clearLog();
    const r = await fn('book', { action: 'book', base: BASE, lang: 'fr', services: [oil], day, block: 'day', win_flex: true, first_name: 'Webster', last_name: 'Test', phone,
      address: '1250 rue Graham, Mont-Royal', lat: 45.53, lng: -73.62, vehicle: { year: '2021', make: 'Toyota', model: 'RAV4' } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.text, 'sent', JSON.stringify(r));
    const [c] = await q(`select id from public.customers where phone_digits = $1`, [phone.replace(/\D/g, '')]);
    made.customers.push(c.id);
    const [j] = await q(`select id from public.jobs where customer_id = $1`, [c.id]);
    const t = await toldOf(j.id);
    assert.deepEqual([t.told_day, t.told_start, t.told_end, t.told_how, t.told_by, t.confirmed], [day, null, null, 'sms', null, true], 'told « dans la journée », by nobody');
    assert.equal(await lease(j.id), 0, 'its lease dropped');
    assert.equal((await texts(phone)).length, 1);
    // the button then has nothing for him
    assert.deepEqual((await press(day, [j.id])).already, [j.id]);
  } finally {
    await q(`update public.settings set booking = jsonb_set(booking, '{web,on}', $1::jsonb) where id = 1`, [JSON.stringify(on)]);
    await q(`delete from public.job_items where service_id = $1`, [oil]);
    await q(`delete from public.services where id = $1`, [oil]);
  }
});

/* ---------- A14: the customer's page ---------- */

test('A14: the customer’s page shows what he was TOLD while booked (the block word only for a block’s exact hours), the new hours once texted, the real trip once en route', async () => {
  const d1 = await newDay(), d2 = await newDay();
  const link = async (jobId) => {
    const token = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40);
    await q(`insert into public.public_links (token_hash, job_id, expires_at) values ($1, $2, now() + interval '30 days')`, [sha(token), jobId]);
    return token;
  };
  const view = async (token) => (await fn('client', { action: 'view', token })).job;
  const pick = (v) => [v.day, v.block, v.start, v.end, v.flex];
  const a = await customer('Denise');
  // told Thursday 13–17, moved to Monday 9–13 and not told yet
  const ja = await job(a, d2, { ws: 540, we: 780, eta: 600, told: { day: d1, start: 780, end: 1020 } });
  const ta = await link(ja);
  const v1 = await view(ta);
  assert.deepEqual(pick(v1), [d1, 'day', 780, 1020, false], JSON.stringify(v1));
  assert.equal(typeof v1.day_label_fr, 'string');
  assert.ok(v1.day_label_fr.length > 5);
  // the button tells him: his page follows
  assert.deepEqual((await press(d2, [ja])).sent, [ja]);
  assert.deepEqual(pick(await view(ta)), [d2, 'day', 540, 780, false]);
  // a block appointment told exactly a block's hours keeps its word; told other hours: the hours alone
  const b = await customer('Bianca'), c = await customer('Cyril'), e = await customer('Elsa');
  const jb = await job(b, d1, { block: 'pm', told: { day: d1, start: 480, end: 720 } });
  const jc = await job(c, d1, { block: 'pm', told: { day: d1, start: 540, end: 780 } });
  assert.deepEqual(pick(await view(await link(jb))), [d1, 'am', 480, 720, false], 'told the morning: « Matin »');
  assert.deepEqual(pick(await view(await link(jc))), [d1, 'day', 540, 780, false], 'other hours: no block word');
  // flexible, told « dans la journée »
  const je = await job(e, d1, { flex: true, ws: 600, we: 840, eta: 650, told: { day: d1, start: null, end: null } });
  assert.deepEqual(pick(await view(await link(je))), [d1, 'day', null, null, true]);
  // never told: as before (his planned window); en route: as before
  const f = await customer('Félix');
  const jf = await job(f, d1, { ws: 600, we: 840, eta: 650 });
  assert.deepEqual(pick(await view(await link(jf))), [d1, 'day', 600, 840, false]);
  await q(`update public.jobs set status = 'en_route' where id = $1`, [jc]);
  const vr = await view(await link(jc));
  assert.deepEqual([vr.day, vr.block, vr.status], [d1, 'pm', 'en_route'], 'en route: the appointment as it is');
});

/* ---------- A15: today, an arrival that slipped ---------- */

test('A15: today, a customer whose sure arrival slipped out of a window told = planned is listed apart (« drift »), never texted by the button; one whose hours really changed is', async () => {
  const [{ def }] = await q(`select pg_get_functiondef('public.now_min()'::regprocedure) def`);
  await q(`create or replace function public.now_min() returns integer language sql stable set search_path = public, extensions as $$ select 540 $$`);
  try {
    const [{ today }] = await q(`select public.local_today()::text today`);
    const h = await customer('Hélène'), g = await customer('Gaston');
    const jh = await job(h, today, { ws: 600, we: 840, eta: 870, told: { day: today, start: 600, end: 840 } });
    const jg = await job(g, today, { ws: 840, we: 1080, eta: 900, told: { day: today, start: 600, end: 840 } });
    const list = (await rpc('tell_list', { p_day: today }, ownerJwt)).filter((x) => [jh, jg].includes(x.id));
    const row = (id) => list.find((x) => x.id === id);
    assert.deepEqual([row(jh)?.state, row(jh)?.kind], ['drift', null], JSON.stringify(list));
    assert.deepEqual([row(jg)?.state, row(jg)?.kind], ['changed', 'moved']);
    await clearLog();
    const r = await press(today, [jh, jg]);
    assert.deepEqual([r.sent, r.already], [[jg], [jh]], JSON.stringify(r));
    assert.equal((await texts(h.phone)).length, 0, 'the « en route » text will give her the hour');
    assert.equal((await toldOf(jh)).told_start, 600);
  } finally { await q(def); }
});
