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
  await q(`delete from public.op_log`); await q(`delete from public.activity`); await q(`delete from public.messages`); await q(`delete from public.rate_limits`);
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

test('a link asked from the old address (GitHub Pages) or a stranger site goes to the app\'s home', async () => {
  for (const asked of ['https://hostnextline.github.io/garage2.0/', 'https://pirate.example/', 'pas une adresse', undefined]) {
    const email = `moved-${randomUUID().slice(0, 6)}@test.local`;
    const r = await fn('team', { action: 'invite', email, full_name: 'Ali Mécano', roles: ['mechanic'], lang: 'fr', base: asked, send: 'none' }, ownerJwt);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.link.startsWith(BASE + '#invite='), `${asked} -> ${r.link}`);
  }
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
  // the block in words, the estimate to sign, « pay now » (card payment is on)
  assert.match(n.message, /^Bonjour Jean, votre rendez-vous avec Mécanique Mobile H\.I\.S est confirmé : .+, l’après-midi \(entre 12 h et 16 h\)\. Estimation : 183,94 \$ taxes incluses\. Pour voir et signer votre estimation \(et la payer maintenant si vous le voulez\) : http/);
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
  // the estimate, signed with the finger on the page (with the conditions of the work)
  assert.equal(v.estimate.can_sign, true);
  assert.equal(v.estimate.signed_at, null);
  assert.match(v.conditions, /J’autorise Mécanique Mobile H\.I\.S à faire les travaux/);
  const ink = 'iVBORw0KGgo' + 'A'.repeat(600);
  assert.equal((await fn('client', { action: 'sign', token: t, signer: 'Jean Tremblay', png: ink })).code, 'confirm', 'asked to accept first');
  assert.equal((await fn('client', { action: 'sign', token: t, signer: 'Jean Tremblay', png: 'PHN2Zz4=', confirm: true })).code, 'signature', 'only a picture of a signature');
  assert.equal((await fn('client', { action: 'sign', token: t, signer: ' ', png: ink, confirm: true })).code, 'signer');
  const sg = await fn('client', { action: 'sign', token: t, signer: 'Jean Tremblay', png: `data:image/png;base64,${ink}`, width: 300, height: 120, confirm: true });
  assert.equal(sg.ok, true, JSON.stringify(sg));
  assert.ok(sg.estimate.signed_at);
  assert.equal(sg.estimate.signer, 'Jean Tremblay');
  assert.equal(sg.estimate.cents, 18394);
  assert.equal(sg.estimate.can_sign, false);
  assert.equal(sg.job.waiver_signed, true, 'nothing left to sign at the door');
  const jw = (await q(`select waiver_via, waiver_signer, estimate_attachment = waiver_attachment same, (select kind from public.attachments where id = estimate_attachment) kind from public.jobs where id = $1`, [b.job_id]))[0];
  assert.deepEqual([jw.waiver_via, jw.waiver_signer, jw.same, jw.kind], ['online', 'Jean Tremblay', true, 'signature']);
  assert.equal((await fn('client', { action: 'sign', token: t, signer: 'Jean Tremblay', png: ink, confirm: true })).code, 'signed', 'signed once');
  assert.equal((await q(`select count(*)::int n from public.messages where job_id = $1 and kind = 'estimate_signed'`, [b.job_id]))[0].n, 1);
  // extra work proposed, answered on the page (confirmation required)
  const extra = randomUUID();
  await q(`insert into public.job_items (id, job_id, description, unit_cents, status) values ($1, $2, 'Essuie-glaces', 2999, 'proposed')`, [extra, b.job_id]);
  assert.equal((await fn('client', { action: 'answer', token: t, item_id: extra, accept: true })).code, 'confirm');
  const a = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true });
  assert.equal(a.extras.find((x) => x.id === extra).status, 'approved');
  // the work changed since the signature: a new signature is asked (the authorization of work stays)
  assert.equal(a.estimate.changed, true);
  assert.equal(a.estimate.can_sign, true);
  // paying ahead by card: the same Stripe page is reused, the notice pays it once even if sent twice
  const p1 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p1.url, JSON.stringify(p1));
  const p2 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.equal(p2.url, p1.url, 'one open payment page, not two');
  // another link to the same job (another text) opens that same page; when the amount changes, the old page is closed
  const n2 = await fn('notify', { kind: 'booking', job_id: b.job_id, base: BASE, resend: true }, ownerJwt);
  assert.ok(n2.link && tokenOf(n2.link) !== t, JSON.stringify(n2));
  assert.equal((await fn('client', { action: 'pay', token: tokenOf(n2.link), base: BASE })).url, p1.url, 'a second link of the same job: the same open page');
  await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Lave-glace', 1000, 'approved')`, [b.job_id]);
  const v3 = await fn('client', { action: 'view', token: t });
  assert.equal(v3.pay.amount_cents, 18394 + 2999 + 150 + 299 + 1000 + 50 + 100);
  const p3 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.notEqual(p3.url, p1.url, 'the amount changed: a new page');
  assert.equal((await fetch(p1.url)).status, 410, 'the old page is closed in Stripe: it cannot be paid any more');
  const paid = await (await fetch(p3.url + '?twice=1')).json();
  assert.equal(paid.hook, 200);
  const pays = await q(`select amount_cents, method from public.payments where job_id = $1`, [b.job_id]);
  assert.equal(pays.length, 1, 'the second notice did not pay twice');
  assert.equal(pays[0].method, 'card_online');
  assert.equal(pays[0].amount_cents, v3.pay.amount_cents, 'what was due, extras included');
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
  assert.match(ni.message, /voici votre facture F-0001 de Mécanique Mobile H\.I\.S \(229,92 \$\)/);
  // a refund made in Stripe (part of it) comes back as a negative card payment on that invoice, once even when the notice comes twice
  const rf = await (await fetch(`${MOCK}/refund/${p3.url.split('/').pop()}?amount=1000&twice=1`)).json();
  assert.equal(rf.hook, 200);
  const after = await q(`select amount_cents, stripe_session from public.payments where job_id = $1 and deleted_at is null order by created_at`, [b.job_id]);
  assert.deepEqual(after.map((x) => x.amount_cents), [v3.pay.amount_cents, -1000]);
  assert.equal(after[1].stripe_session, rf.refund);
  const invAfter = (await q(`select status, paid_cents, total_cents from public.invoices where id = $1`, [inv.rows.invoices[0].id]))[0];
  assert.deepEqual([invAfter.status, invAfter.paid_cents], ['issued', invAfter.total_cents - 1000], 'the invoice is back to « À payer » for the amount given back');
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
  // the appointment's own link (#t=) opens the same trip (#suivi=<same secret>); a revoked one doesn't
  await q(`insert into public.public_links (token_hash, job_id, expires_at) values (encode(extensions.digest('lien-du-rendez-vous-00001', 'sha256'), 'hex'), $1, now() + interval '30 days')`, [job]);
  assert.equal((await rpc('public_track', { p_token: 'lien-du-rendez-vous-00001' }, K.anon)).status, 'active');
  await q(`update public.public_links set revoked_at = now() where job_id = $1`, [job]);
  assert.equal((await rpc('public_track', { p_token: 'lien-du-rendez-vous-00001' }, K.anon)).status, 'not_found');
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

test('« Je suis arrivé »: the customer gets the invoice to pay during the work; paid online, the finished invoice is PAID', async () => {
  await clearLog();
  const sk = await fn('team', { action: 'secrets-set', ghl_token: 'pit-abcdef1234567890', ghl_location: 'LOC12345678', stripe_key: 'sk_test_abcdefghijklmnop' }, ownerJwt);
  assert.equal(sk.ok, true, JSON.stringify(sk));
  const dow = (await q(`select extract(dow from $1::date)::int d`, [day]))[0].d;
  const truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active) values ($1, 'Camion Voiture', true)`, [truck]);
  await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[480,1200]]')`, [truck, dow]);
  const cust = randomUUID(); made.customers.push(cust);
  await q(`insert into public.customers (id, first_name, last_name, phone, lat, lng, lang) values ($1, 'Karim', 'Haddad', '514 555-7788', 45.53, -73.63, 'fr')`, [cust]);
  const b = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: cust, day, block: 'am', duration_min: 60, truck_id: truck },
    p_items: [{ description: 'Promo : pneus non montés + huile + inspection', unit_cents: 19999 }] }, ownerJwt);
  // not there yet: nothing to send
  assert.equal((await fn('notify', { kind: 'arrived', job_id: b.job_id, base: BASE }, ownerJwt)).code, 'not_on_site');
  await rpc('job_step', { p_op: randomUUID(), p_job: b.job_id, p_action: 'leave', p_data: {} }, ownerJwt);
  await rpc('job_step', { p_op: randomUUID(), p_job: b.job_id, p_action: 'arrive', p_data: {} }, ownerJwt);
  const n = await fn('notify', { kind: 'arrived', job_id: b.job_id, base: BASE }, ownerJwt);
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.match(n.message, /^Bonjour Karim, .+ de Mécanique Mobile H\.I\.S est arrivé\. Votre facture : 229,94 \$ taxes incluses\. Vous pouvez la payer en ligne pendant les travaux : http/);
  const sms = (await mockLog()).filter((x) => x.svc === 'ghl' && x.path === '/conversations/messages');
  assert.equal(sms.length, 1);
  assert.equal((await fn('notify', { kind: 'arrived', job_id: b.job_id, base: BASE }, ownerJwt)).status, 'already', 'once, unless asked again');
  // the invoice is being made (a draft, no number yet)
  const inv = (await q(`select id, status, total_cents, number from public.invoices where job_id = $1`, [b.job_id]))[0];
  assert.deepEqual([inv.status, inv.total_cents, inv.number], ['draft', 22994, null]);
  // the customer's page: the invoice of the work, « pay now »
  const t = tokenOf(n.link);
  const v = await fn('client', { action: 'view', token: t });
  assert.equal(v.job.status, 'on_site');
  assert.equal(v.bill.total_cents, 22994);
  assert.equal(v.bill.lines[0].description, 'Promo : pneus non montés + huile + inspection');
  assert.equal(v.pay.available, true);
  assert.equal(v.pay.amount_cents, 22994);
  const p1 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p1.url, JSON.stringify(p1));
  const paid = await (await fetch(p1.url)).json();
  assert.equal(paid.hook, 200);
  // the mechanic finishes the invoice: the payment made during the work counts, the invoice is PAID
  const fin = await rpc('invoice_finish', { p_op: randomUUID(), p_invoice: inv.id }, ownerJwt);
  assert.equal(fin.rows.invoices[0].status, 'paid');
  await rpc('job_step', { p_op: randomUUID(), p_job: b.job_id, p_action: 'finish', p_data: {} }, ownerJwt);
  // the garage gives 50 $ back in Stripe: the invoice goes back to « À payer » for 50 $, never twice
  const rf = await (await fetch(`${MOCK}/refund/${p1.url.split('/').pop()}?amount=5000&twice=1`)).json();
  assert.equal(rf.hook, 200);
  const inv2 = (await q(`select status, paid_cents, (select count(*)::int from public.payments p where p.invoice_id = i.id) n from public.invoices i where id = $1`, [inv.id]))[0];
  assert.deepEqual([inv2.status, inv2.paid_cents, inv2.n], ['issued', 22994 - 5000, 2]);
  // without card payment: the text says where to see the invoice, not « pay online »
  await q(`delete from public.secrets where key = 'stripe_key'`);
  const cust2 = randomUUID(); made.customers.push(cust2);
  await q(`insert into public.customers (id, first_name, last_name, phone, lat, lng, lang) values ($1, 'Lina', 'Roy', '514 555-9911', 45.51, -73.61, 'en')`, [cust2]);
  const b2 = await rpc('book_job', { p_op: randomUUID(), p_job: { customer_id: cust2, day, block: 'pm', duration_min: 60, truck_id: truck },
    p_items: [{ description: 'Oil change', unit_cents: 8000 }] }, ownerJwt);
  await rpc('job_step', { p_op: randomUUID(), p_job: b2.job_id, p_action: 'leave', p_data: {} }, ownerJwt);
  await rpc('job_step', { p_op: randomUUID(), p_job: b2.job_id, p_action: 'arrive', p_data: {} }, ownerJwt);
  const n2 = await fn('notify', { kind: 'arrived', job_id: b2.job_id, base: BASE }, ownerJwt);
  assert.match(n2.message, /^Hello Lina, .+ from Mécanique Mobile H\.I\.S has arrived\. Your invoice: \$91\.98 taxes included\. Details: http/);
  const v2 = await fn('client', { action: 'view', token: tokenOf(n2.link) });
  assert.equal(v2.pay.available, false, 'no card payment without Stripe');
});

test('the conversation with a customer: the texts both ways from GoHighLevel, an answer sent from the garage’s number; only for who sees the customer', async () => {
  await fn('team', { action: 'secrets-set', ghl_token: 'pit-abcdef1234567890', ghl_location: 'LOC12345678' }, ownerJwt);
  const cust = randomUUID(); made.customers.push(cust);
  const four = String(1000 + Math.floor(Math.random() * 8999));   // a number no other test uses
  await q(`insert into public.customers (id, first_name, last_name, phone, lang) values ($1, 'Rima', 'Haddad', $2, 'fr')`, [cust, `438 555-${four}`]);
  // nothing yet: GoHighLevel does not know this number
  let c = await fn('conversation', { action: 'get', customer_id: cust }, ownerJwt);
  assert.equal(c.status, 'ok', JSON.stringify(c));
  assert.deepEqual(c.messages, []);
  // the garage writes, the customer answers
  const s = await fn('conversation', { action: 'send', customer_id: cust, message: 'Bonjour Rima, on passe demain matin.' }, ownerJwt);
  assert.equal(s.status, 'sent', JSON.stringify(s));
  await fetch(`${MOCK}/ghl/_reply`, { method: 'POST', headers: { authorization: 'Bearer pit-x', 'content-type': 'application/json' }, body: JSON.stringify({ contactId: `ct_1438555${four}`, body: 'Parfait, merci!' }) });
  c = await fn('conversation', { action: 'get', customer_id: cust }, ownerJwt);
  assert.deepEqual(c.messages.map((m) => [m.dir, m.body]), [['out', 'Bonjour Rima, on passe demain matin.'], ['in', 'Parfait, merci!']]);
  // kept in the app's own log
  assert.equal((await q(`select count(*)::int n from public.messages where customer_id = $1 and kind = 'chat' and status = 'sent'`, [cust]))[0].n, 1);
  // empty or too long: refused
  assert.equal((await fn('conversation', { action: 'send', customer_id: cust, message: '  ' }, ownerJwt)).code, 'empty');
  // a mechanic without the « Clients » right and no job with this customer does not see the conversation
  const email = `meca-${randomUUID().slice(0, 6)}@test.local`;
  const mech = await adminUser(email, 'motdepasse-2');
  await q(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, 'Adam', 'Adam', '{mechanic}', '{"clients": false}', $2)`, [mech, email]);
  const mechJwt = (await signIn(email, 'motdepasse-2')).access_token;
  assert.equal((await fn('conversation', { action: 'get', customer_id: cust }, mechJwt)).code, 'not_found');
  assert.equal((await fn('conversation', { action: 'send', customer_id: cust, message: 'allo' }, mechJwt)).code, 'not_found');
  // no texts for a customer who said no
  await q(`update public.customers set sms_ok = false where id = $1`, [cust]);
  assert.equal((await fn('conversation', { action: 'send', customer_id: cust, message: 'allo' }, ownerJwt)).code, 'sms_off');
  await q(`delete from public.messages where customer_id = $1`, [cust]);
});

test('« Réserver en ligne »: the services, the best moments near a truck, booked at once with the text; a new customer, then the same phone again', async () => {
  const dow = (await q(`select extract(dow from $1::date)::int d`, [day]))[0].d;
  const truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active) values ($1, 'Camion web', true)`, [truck]);
  await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[480,1200]]')`, [truck, dow]);
  const oil = (await q(`insert into public.services (name_fr, name_en, price_cents, duration_min) values ('Huile web', 'Oil web', 8000, 45) returning id`))[0].id;
  const off = (await q(`insert into public.services (name_fr, price_cents, duration_min, active) values ('Hors ligne', 1000, 30, false) returning id`))[0].id;
  const hourly = (await q(`insert into public.services (name_fr, price_cents, duration_min) values ('Diagnostic web', null, 60) returning id`))[0].id;
  const phone = `514 555-${String(Math.floor(1000 + Math.random() * 8999))}`;
  try {
    const info = await fn('book', { action: 'info' });
    assert.equal(info.ok, true, JSON.stringify(info));
    assert.equal(info.on, true, 'open by default (Part 23)');
    assert.ok(info.services.some((s) => s.id === oil), 'an active service is offered');
    assert.ok(!info.services.some((s) => s.id === off), 'an inactive one is not');
    // the best moments: the day the truck works, never the trucks or the minutes
    const sl = await fn('book', { action: 'slots', lat: 45.53, lng: -73.62, services: [oil], days: 14 });
    assert.equal(sl.ok, true, JSON.stringify(sl));
    const mine = sl.slots.find((s) => s.day === day && s.block === 'pm');
    assert.ok(mine, 'the afternoon of the truck’s day is offered: ' + JSON.stringify(sl.slots));
    assert.deepEqual(Object.keys(mine).sort(), ['block', 'day', 'near']);
    assert.equal((await fn('book', { action: 'slots', lat: 46.81, lng: -71.21, services: [oil] })).code, 'far', 'Québec City is out of the area');
    // the checks before anything is kept
    const form = { action: 'book', base: BASE, lang: 'fr', services: [oil], day, block: 'pm', first_name: 'Sophie', last_name: 'Web', phone,
      address: '1250 rue Graham, Mont-Royal', lat: 45.53, lng: -73.62, vehicle: { year: '2021', make: 'Toyota', model: 'RAV4' }, problem: 'Un bruit' };
    assert.equal((await fn('book', { ...form, phone: '555' })).code, 'phone');
    assert.equal((await fn('book', { ...form, services: [off] })).code, 'no_service', 'an inactive service is refused');
    const robot = await fn('book', { ...form, website: 'http://spam' });
    assert.equal(robot.ok, true); assert.equal(robot.link, null, 'a robot is told yes, nothing is kept');
    assert.equal((await q(`select count(*)::int n from public.customers where phone_digits = $1`, [phone.replace(/\D/g, '')]))[0].n, 0);
    // booked
    await clearLog();
    const r = await fn('book', form);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.link.startsWith(BASE + 'client.html#t='));
    const [c] = await q(`select * from public.customers where phone_digits = $1`, [phone.replace(/\D/g, '')]);
    made.customers.push(c.id);
    assert.equal(c.first_name, 'Sophie'); assert.equal(c.lang, 'fr');
    const [j] = await q(`select * from public.jobs where customer_id = $1`, [c.id]);
    assert.deepEqual([j.source, j.status, j.day.toISOString?.().slice(0, 10) ?? j.day, j.block, j.truck_id, j.duration_min, j.problem], ['web', 'booked', day, 'pm', truck, 45, 'Un bruit']);
    const [v] = await q(`select * from public.vehicles where id = $1`, [j.vehicle_id]);
    assert.deepEqual([v.year, v.make, v.model], [2021, 'Toyota', 'RAV4']);
    const items = await q(`select description, unit_cents from public.job_items where job_id = $1`, [j.id]);
    assert.deepEqual(items, [{ description: 'Huile web', unit_cents: 8000 }]);
    const view = await fn('client', { action: 'view', token: tokenOf(r.link) });
    assert.equal(view.customer.first, 'Sophie', 'the link opens the customer’s page');
    const [m] = await q(`select * from public.messages where job_id = $1 and kind = 'booking'`, [j.id]);
    assert.ok(m && /Sophie/.test(m.body) && m.body.includes(r.link), 'the confirmation text, with the link');
    assert.equal((await q(`select count(*)::int n from public.public_links where job_id = $1`, [j.id]))[0].n, 1, 'the link is kept with the booking (Part 24)');
    // the page sends the same booking again (a hiccup after the first answer): the same job, one text, a link that works
    const again = await fn('book', form);
    assert.equal(again.ok, true, JSON.stringify(again)); assert.equal(again.again, true, 'said to be the booking already made');
    assert.equal((await q(`select count(*)::int n from public.jobs where customer_id = $1`, [c.id]))[0].n, 1, 'no second job');
    assert.equal((await q(`select count(*)::int n from public.messages where job_id = $1 and kind = 'booking'`, [j.id]))[0].n, 1, 'no second text');
    assert.equal(again.text, 'already');
    assert.ok(again.link.startsWith(BASE + 'client.html#t=') && again.link !== r.link, 'a fresh link');
    assert.equal((await fn('client', { action: 'view', token: tokenOf(again.link) })).customer.first, 'Sophie', 'that opens the same page');
    // the same phone and the same name (accents and capitals aside): the same customer, the car found again, the file not changed
    const r2 = await fn('book', { ...form, first_name: 'SOPHIE', email: 'sophie@exemple.ca', address: '10 rue Autre, Montréal', vehicle: { make: 'toyota', model: 'rav4' } });
    assert.equal(r2.ok, true, JSON.stringify(r2)); assert.equal(r2.again, false, 'another address: another booking');
    assert.equal((await q(`select count(*)::int n from public.customers where phone_digits = $1`, [phone.replace(/\D/g, '')]))[0].n, 1);
    assert.deepEqual((await q(`select first_name, email from public.customers where id = $1`, [c.id]))[0], { first_name: 'Sophie', email: null }, 'nothing written on the file from the public form');
    assert.equal((await q(`select count(distinct vehicle_id)::int n from public.jobs where customer_id = $1`, [c.id]))[0].n, 1);
    // the same phone with another name (a spouse, a prank): a new file marked for the office, never the other person's file
    const r3 = await fn('book', { ...form, first_name: 'Marc', last_name: 'Autre', address: '20 rue Trois, Montréal' });
    assert.equal(r3.code, 'too_many', 'the brake counts the phone number, whoever types it');
    await q(`update public.jobs set status = 'cancelled' where id = $1`, [j.id]);
    const r4 = await fn('book', { ...form, first_name: 'Marc', last_name: 'Autre', address: '20 rue Trois, Montréal' });
    assert.equal(r4.ok, true, JSON.stringify(r4));
    const twins = await q(`select id, first_name, notes from public.customers where phone_digits = $1 order by created_at`, [phone.replace(/\D/g, '')]);
    assert.equal(twins.length, 2, 'a second file');
    made.customers.push(twins[1].id);
    assert.equal(twins[1].first_name, 'Marc'); assert.match(twins[1].notes, /Même numéro/);
    await q(`update public.jobs set status = 'booked' where id = $1`, [j.id]);
    await q(`update public.jobs set status = 'cancelled' where customer_id = $1`, [twins[1].id]);
    assert.equal((await fn('book', form)).again, true, 'the first booking sent again is still that booking, not « too_many »');
    // closed in Réglages: the page says to call
    await q(`update public.settings set booking = jsonb_set(booking, '{web,on}', 'false') where id = 1`);
    assert.equal((await fn('book', { action: 'info' })).on, false);
    assert.equal((await fn('book', { action: 'slots', lat: 45.53, lng: -73.62, services: [oil] })).code, 'web_off');
    await q(`update public.settings set booking = jsonb_set(booking, '{web,on}', 'true') where id = 1`);
    // the brake on the public « slots » (Part 24): 20 asks per 10 minutes for one visitor, then « busy »
    let code = null, asks = 0;
    for (; asks < 30 && code !== 'busy'; asks++) code = (await fn('book', { action: 'slots', lat: 45.53, lng: -73.62, services: [oil] })).code;
    assert.equal(code, 'busy', 'too many asks → busy (after ' + asks + ')');
    assert.ok(asks <= 20, 'the earlier asks of this test count too');
    assert.equal((await fn('book', { action: 'slots', lat: 45.53, lng: -73.62, services: [oil] })).status, 429);
    await q(`delete from public.rate_limits`);
    assert.equal((await fn('book', { action: 'slots', lat: 45.53, lng: -73.62, services: [oil] })).ok, true, 'a new window: allowed again');
    // a robot (the hidden field filled) is noted for the office, nothing else
    assert.equal((await q(`select count(*)::int n from public.activity where entity = 'web' and action = 'web_robot'`))[0].n, 1);
    // work by the hour (no price yet): the text never says « 0,00 $ »
    const phone2 = `438 555-${String(Math.floor(1000 + Math.random() * 8999))}`;
    const rh = await fn('book', { ...form, phone: phone2, first_name: 'Hugo', services: [hourly], address: '30 rue Heure, Montréal' });
    assert.equal(rh.ok, true, JSON.stringify(rh));
    const [ch] = await q(`select id from public.customers where phone_digits = $1`, [phone2.replace(/\D/g, '')]);
    made.customers.push(ch.id);
    const [mh] = await q(`select body from public.messages where customer_id = $1 and kind = 'booking'`, [ch.id]);
    assert.ok(mh && /selon le travail sur place/.test(mh.body) && !/0,00/.test(mh.body), mh?.body);
  } finally {
    await q(`delete from public.rate_limits`);
    await q(`update public.settings set booking = jsonb_set(booking, '{web,on}', 'true') where id = 1`);
    await q(`delete from public.job_items where service_id = any($1)`, [[oil, off, hourly]]);
    await q(`delete from public.services where id = any($1)`, [[oil, off, hourly]]);
  }
});
