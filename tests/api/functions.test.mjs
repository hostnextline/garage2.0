// The server functions, end to end on the local copy (real accounts, real sign-in, fake GoHighLevel and Stripe).
// Everything created here is removed at the end (the database is left as it was).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from '../stack/node_modules/pg/lib/index.js';

const K = JSON.parse(readFileSync(new URL('../stack/keys.json', import.meta.url)));
const API = 'http://127.0.0.1:54331', MOCK = 'http://127.0.0.1:8021', BASE = 'http://127.0.0.1:4173/';
const db = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 3 });
const made = { users: [], customers: [], trucks: [] };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

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
const mockLog = async () => (await fetch(`${MOCK}/log`)).json();
const clearLog = () => fetch(`${MOCK}/log/clear`, { method: 'POST' });
const tokenOf = (link) => /[#&](?:t|suivi|invite)=([\w-]+)/.exec(link)[1];

let owner, ownerJwt, day, counter;
before(async () => {
  const email = `owner-${randomUUID().slice(0, 6)}@test.local`;
  owner = await adminUser(email, 'motdepasse-1');
  await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, 'Hassan Jeha', 'Hassan', '{owner}', $2)`, [owner, email]);
  ownerJwt = (await signIn(email, 'motdepasse-1')).access_token;
  assert.ok(ownerJwt);
  day = (await q(`select (public.local_today() + 2)::text d`))[0].d;
  counter = (await q(`select next_value from public.counters where name = 'invoice'`))[0].next_value;
  await q(`update public.settings set company = company || '{"name":"Mécanique Mobile H.I.S","phone":"438 901-6606"}'::jsonb where id = 1`);
});
after(async () => {
  // back to how it was: everything these tests made
  await q(`delete from public.payments where invoice_id in (select id from public.invoices where customer_id = any($1)) or job_id in (select id from public.jobs where customer_id = any($1))`, [made.customers]);
  await q(`delete from public.invoices where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.jobs where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.customers where id = any($1)`, [made.customers]);
  await q(`delete from public.trucks where id = any($1)`, [made.trucks]);
  await q(`delete from public.secrets`); await q(`delete from public.invitations`); await q(`delete from public.public_links`); await q(`delete from public.stripe_events`);
  await q(`delete from public.staff where id = any($1)`, [made.users]);
  await q(`delete from auth.users where id = any($1)`, [made.users]);
  await q(`update public.settings set company = '{}'::jsonb where id = 1`);
  await q(`delete from public.op_log`); await q(`delete from public.activity`); await q(`delete from public.messages`);
  await q(`update public.counters set next_value = $1 where name = 'invoice'`, [counter]);
  await db.end();
});

test('an invitation: the link, the person chooses a password, signs in, gets the roles given', async () => {
  const email = `saleh-${randomUUID().slice(0, 6)}@test.local`;
  const r = await fn('team', { action: 'invite', email, full_name: 'Saleh Mécano', short_name: 'Saleh', roles: ['mechanic'], lang: 'fr', base: BASE, send: 'none' }, ownerJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.link.startsWith(BASE + '#invite='));
  const token = tokenOf(r.link);
  const info = await fn('team', { action: 'invite-info', token });
  assert.deepEqual([info.name, info.email, info.roles], ['Saleh', email, ['mechanic']]);
  assert.equal((await fn('team', { action: 'invite-accept', token, password: 'court' })).code, 'weak');
  const ok = await fn('team', { action: 'invite-accept', token, password: 'garage-2026' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const s = await signIn(email, 'garage-2026');
  assert.ok(s.access_token, 'he can sign in');
  made.users.push(s.user.id);
  const acc = await rpc('my_access', {}, s.access_token);
  assert.deepEqual(acc.roles, ['mechanic']);
  assert.equal((await fn('team', { action: 'invite-accept', token, password: 'garage-2026' })).code, 'used', 'the link works once');
  // a mechanic cannot invite
  assert.equal((await fn('team', { action: 'invite', email: 'x@y.ca', full_name: 'X', roles: ['owner'], base: BASE }, s.access_token)).code, 'not_allowed');
  // nobody without an account
  assert.equal((await fn('team', { action: 'secrets' })).code, 'signin');
});

test('texts and card payment: keys saved, appointment text with total, the customer page, a paid card, a notice sent twice', async () => {
  await clearLog();
  const sk = await fn('team', { action: 'secrets-set', ghl_token: 'pit-abcdef1234567890', ghl_location: 'LOC12345678', stripe_key: 'sk_test_abcdefghijklmnop' }, ownerJwt);
  assert.equal(sk.ok, true, JSON.stringify(sk));
  const sec = await fn('team', { action: 'secrets' }, ownerJwt);
  assert.equal(sec.ghl.on, true); assert.equal(sec.stripe.on, true); assert.equal(sec.stripe.test, true); assert.equal(sec.stripe.webhook, true);
  assert.equal(sec.ghl.token_end, '7890', 'only the end of a key comes back');
  // a truck, a customer, a booking
  const dow = (await q(`select extract(dow from $1::date)::int d`, [day]))[0].d;
  const truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active) values ($1, 'Camion Complet', true)`, [truck]);
  await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[480,1200]]')`, [truck, dow]);
  const cust = randomUUID(); made.customers.push(cust);
  await q(`insert into public.customers (id, first_name, last_name, phone, lat, lng, lang) values ($1, 'Jean', 'Tremblay', '514 555-1234', 45.52, -73.62, 'fr')`, [cust]);
  const b = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: cust, day, block: 'pm', duration_min: 60 },
    p_items: [{ description: 'Vidange d’huile + changement de filtre', unit_cents: 7999 }, { description: 'Pneus non montés · 15 à 17 po', unit_cents: 7999 }] }, ownerJwt);
  const n = await fn('notify', { kind: 'booking', job_id: b.job_id, base: BASE }, ownerJwt);
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.match(n.message, /^Bonjour Jean, votre rendez-vous avec Mécanique Mobile H\.I\.S est confirmé : .+, entre 12 h et 16 h\. Total prévu : 183,94 \$ \(taxes incluses\)\. Détails : http/);
  const sms = (await mockLog()).filter((x) => x.svc === 'ghl' && x.path === '/conversations/messages');
  assert.equal(sms.length, 1);
  assert.equal(sms[0].body.type, 'SMS');
  assert.equal(sms[0].version, '2021-04-15');
  assert.equal((await fn('notify', { kind: 'booking', job_id: b.job_id, base: BASE }, ownerJwt)).status, 'already', 'never twice unless asked');
  // the customer's page
  const t = tokenOf(n.link);
  const v = await fn('client', { action: 'view', token: t });
  assert.equal(v.kind, 'job');
  assert.equal(v.customer.first, 'Jean');
  assert.equal(v.expected.total, 18394);
  assert.equal(v.pay.available, true);
  assert.equal(v.pay.kind, 'prepay');
  assert.equal((await fn('client', { action: 'view', token: 'x'.repeat(30) })).code, 'bad_link');
  // extra work proposed, answered on the page (confirmation required)
  const extra = randomUUID();
  await q(`insert into public.job_items (id, job_id, description, unit_cents, status) values ($1, $2, 'Essuie-glaces', 2999, 'proposed')`, [extra, b.job_id]);
  assert.equal((await fn('client', { action: 'answer', token: t, item_id: extra, accept: true })).code, 'confirm');
  const a = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true });
  assert.equal(a.extras.find((x) => x.id === extra).status, 'approved');
  // paying ahead by card: the same Stripe page is reused, the notice pays it once even if sent twice
  const p1 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p1.url, JSON.stringify(p1));
  const p2 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.equal(p2.url, p1.url, 'one open payment page, not two');
  const paid = await (await fetch(p1.url + '?twice=1')).json();
  assert.equal(paid.hook, 200);
  const pays = await q(`select amount_cents, method from public.payments where job_id = $1`, [b.job_id]);
  assert.equal(pays.length, 1, 'the second notice did not pay twice');
  assert.equal(pays[0].method, 'card_online');
  assert.equal(pays[0].amount_cents, 18394 + 2999 + 150 + 299, 'what was due, extras included');
  // a forged notice is refused
  const forged = await fetch(`${API}/functions/v1/stripe`, { method: 'POST', headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`, 'content-type': 'application/json' }, body: '{"id":"evt_x","type":"checkout.session.completed"}' });
  assert.equal(forged.status, 400);
  // the invoice later counts the prepayment
  await q(`update public.jobs set status = 'on_site' where id = $1`, [b.job_id]);
  const inv = await rpc('invoice_for_job', { p_op: randomUUID(), p_job: b.job_id, p_refresh: true }, ownerJwt);
  const fin = await rpc('invoice_finish', { p_op: randomUUID(), p_invoice: inv.rows.invoices[0].id }, ownerJwt);
  assert.equal(fin.rows.invoices[0].status, 'paid', 'paid ahead: the invoice is paid when finished');
  // the invoice text
  await clearLog();
  const ni = await fn('notify', { kind: 'invoice', job_id: b.job_id, base: BASE }, ownerJwt);
  assert.match(ni.message, /voici votre facture F-0001 de Mécanique Mobile H\.I\.S \(218,42 \$\)/);
});

test('« Je pars »: en route, the tracking link texted, the customer follows the truck', async () => {
  await clearLog();
  const dow = (await q(`select extract(dow from public.local_today())::int d`))[0].d;
  const mechEmail = `adam-${randomUUID().slice(0, 6)}@test.local`;
  const mech = await adminUser(mechEmail, 'garage-2026');
  await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, 'Adam Mécano', 'Adam', '{mechanic}', $2)`, [mech, mechEmail]);
  const jwt = (await signIn(mechEmail, 'garage-2026')).access_token;
  const truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active, driver_id) values ($1, 'Voiture', true, $2)`, [truck, mech]);
  await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[0,1440]]')`, [truck, dow]);
  const cust = randomUUID(); made.customers.push(cust);
  await q(`insert into public.customers (id, first_name, phone, lat, lng, lang) values ($1, 'Marie', '438 555-0101', 45.53, -73.61, 'en')`, [cust]);
  // a job today on his truck (inserted directly: the blocks of today may already be past)
  const job = randomUUID();
  await q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min) values ($1, $2, public.local_today(), 'am', $3, 'booked', 60)`, [job, cust, truck]);
  await rpc('shift_start', {}, jwt);
  const r = await fn('enroute', { action: 'start', job_id: job, base: BASE, pos: { lat: 45.50, lng: -73.66 } }, jwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sms, 'sent');
  assert.match(r.message, /^Hello Marie, Adam from Mécanique Mobile H\.I\.S is on the way to you: arriving around .+ \(about \d+ min\)\. Follow the trip live: http.+client\.html#suivi=.+&l=en$/);
  assert.ok(r.minutes > 0 && r.km > 0);
  assert.equal(r.route_source, 'osrm');
  assert.equal((await q(`select status from public.jobs where id = $1`, [job]))[0].status, 'en_route');
  // the customer's tracking page (no account)
  const t = await rpc('public_track', { p_token: tokenOf(r.link) }, K.anon);
  assert.equal(t.status, 'active');
  assert.equal(t.mechanic, 'Adam');
  assert.ok(t.pos, 'the truck is on the map');
  assert.ok(Array.isArray(t.route) && t.route.length >= 2);
  // arriving ends the tracking
  await rpc('job_step', { p_op: randomUUID(), p_job: job, p_action: 'arrive', p_data: {} }, jwt);
  assert.equal((await rpc('public_track', { p_token: tokenOf(r.link) }, K.anon)).status, 'arrived');
  await rpc('shift_end', {}, jwt);
  // VIN
  const v = await fn('vin', { vin: '1HGCM82633A004352' }, jwt);
  assert.deepEqual([v.vehicle.year, v.vehicle.make, v.vehicle.model, v.vehicle.displacement, v.vehicle.cylinders, v.vehicle.fuel, v.vehicle.drive], [2003, 'Honda', 'Accord', 3, 6, 'essence', 'fwd']);
  assert.equal((await fn('vin', { vin: 'NOPE' }, jwt)).code, 'vin');
  await q(`delete from public.trips where job_id = $1`, [job]);
  await q(`delete from public.shifts where staff_id = $1`, [mech]);
  await q(`delete from public.positions where id = $1`, [mech]);
  await q(`delete from public.position_log where staff_id = $1`, [mech]);
});

test('« Mot de passe oublié »: same answer for everyone; a link only to the address on file; at most 3 an hour', async () => {
  const email = `adam-${randomUUID().slice(0, 6)}@test.local`;
  const id = await adminUser(email, 'ancien-mdp-1');
  await q(`insert into public.staff (id, full_name, roles, email, phone) values ($1, 'Adam Mécano', '{mechanic}', $2, '514 555-0102')`, [id, email]);
  const before = Number((await q(`select count(*) n from public.invitations where email = $1`, [email]))[0].n);
  const unknown = await fn('team', { action: 'forgot', email: 'personne@nulle.part', base: BASE });
  const known = await fn('team', { action: 'forgot', email, base: BASE });
  assert.deepEqual([unknown.ok, known.ok], [true, true], 'the same answer: nobody learns who has an account');
  assert.equal(Number((await q(`select count(*) n from public.invitations where email = $1 and kind = 'reset'`, [email]))[0].n), before + 1);
  for (let i = 0; i < 4; i++) await fn('team', { action: 'forgot', email, base: BASE });
  assert.equal(Number((await q(`select count(*) n from public.invitations where email = $1 and kind = 'reset'`, [email]))[0].n), 3, 'no more than 3 links an hour');
  // the latest link works: new password, old one refused
  await q(`update public.invitations set token_hash = encode(extensions.digest('lien-de-test-mot-de-passe-0001', 'sha256'), 'hex') where id = (select id from public.invitations where email = $1 and used_at is null order by created_at desc limit 1)`, [email]);
  const ok = await fn('team', { action: 'invite-accept', token: 'lien-de-test-mot-de-passe-0001', password: 'nouveau-mdp-2' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.ok((await signIn(email, 'nouveau-mdp-2')).access_token);
  assert.ok(!(await signIn(email, 'ancien-mdp-1')).access_token);
  await q(`delete from public.invitations where email = $1`, [email]);
});

test('backups: only with a GitHub ticket of the backup repository; every row, page by page; never the service keys', async () => {
  const ticket = async (o = {}) => (await (await fetch(`${MOCK}/github/token?${new URLSearchParams(o)}`)).json()).value;
  const call = async (body, t) => {
    const r = await fetch(`${API}/functions/v1/backup`, { method: 'POST', headers: { apikey: K.anon, 'x-github-oidc': t || '', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  // refused: no ticket, another repository, another audience, an expired ticket, a forged signature
  assert.equal((await call({ action: 'tables' })).status, 401);
  assert.equal((await call({ action: 'tables' }, await ticket({ repository: 'quelquun/autre' }))).status, 403);
  assert.equal((await call({ action: 'tables' }, await ticket({ aud: 'autre-chose' }))).status, 401);
  assert.equal((await call({ action: 'tables' }, await ticket({ exp: -120 }))).status, 401);
  const good = await ticket();
  const forged = good.slice(0, good.lastIndexOf('.') + 1) + Buffer.from('faux').toString('base64url');
  assert.equal((await call({ action: 'tables' }, forged)).status, 401);
  // a key of an outside service is set: it must never come out
  await q(`insert into public.secrets (key, value) values ('stripe_key', 'sk_test_ne_doit_pas_sortir') on conflict (key) do update set value = excluded.value`);
  // 1 205 customers: more than one page
  const ids = (await q(`insert into public.customers (first_name, last_name, phone) select 'Client', 'Sauvegarde ' || g, '514555' || lpad(g::text, 4, '0') from generate_series(1, 1205) g returning id`)).map((r) => r.id);
  made.customers.push(...ids);
  const list = await call({ action: 'tables' }, good);
  assert.equal(list.ok, true, JSON.stringify(list));
  const names = list.tables.map((t) => t.name);
  assert.ok(names.includes('customers') && names.includes('invoices') && names.includes('attachments'));
  assert.ok(!names.includes('secrets'), 'the service keys are not in the backup');
  let rows = [], from = 0;
  for (;;) {
    const page = await call({ action: 'rows', table: 'customers', from }, good);
    assert.equal(page.ok, true, JSON.stringify(page).slice(0, 200));
    rows = rows.concat(page.rows);
    if (page.next == null) break;
    from = page.next;
  }
  assert.equal(rows.length, list.tables.find((t) => t.name === 'customers').count);
  assert.ok(rows.length >= 1205);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'no row twice');
  assert.equal((await call({ action: 'rows', table: 'secrets' }, good)).code, 'table');
  await q(`delete from public.secrets`);
});

test('inviting a mechanic with his truck: once he activates his access, he drives it (« Ma journée » shows his jobs)', async () => {
  const truck = (await q(`insert into public.trucks (name, active) values ('Camion test invitation', true) returning id`))[0].id;
  made.trucks.push(truck);
  const email = `meca-${randomUUID().slice(0, 6)}@test.local`;
  assert.equal((await fn('team', { action: 'invite', email, full_name: 'Nouveau Mécano', roles: ['mechanic'], truck_id: randomUUID(), base: BASE, send: 'none' }, ownerJwt)).code, 'truck');
  const r = await fn('team', { action: 'invite', email, full_name: 'Nouveau Mécano', roles: ['mechanic'], truck_id: truck, base: BASE, send: 'none' }, ownerJwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  const list = await fn('team', { action: 'list' }, ownerJwt);
  assert.equal(list.invitations.find((i) => i.email === email).truck_id, truck);
  const ok = await fn('team', { action: 'invite-accept', token: tokenOf(r.link), password: 'camion-2026' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const uid = (await q(`select id from auth.users where email = $1`, [email]))[0].id;
  made.users.push(uid);
  assert.equal((await q(`select driver_id from public.trucks where id = $1`, [truck]))[0].driver_id, uid);
  const jwt = (await signIn(email, 'camion-2026')).access_token;
  assert.deepEqual((await rpc('my_access', {}, jwt)).trucks, [truck]);
  await q(`update public.trucks set driver_id = null where id = $1`, [truck]);
});
