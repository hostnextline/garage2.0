// « Refonte », the server functions of money and of the customer: the Stripe notice (a payment is never lost, refunds as
// Stripe really sends them), one open card page per job, the customer signs only what the page showed, the shared kit
// (totals, refusals, fingerprint, version), the texts (same send twice, a treasurer, the date of an invoice).
// Same stack and helpers as functions.test.mjs: real accounts, real sign-in, fake GoHighLevel and Stripe
// (tests/stack/mocks.mjs: its Stripe behaves like the real one, « charge.refunded » carries NO list of refunds).
// Everything created here is removed at the end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
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
async function fn(name, body, jwt, headers = {}) {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt || K.anon}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
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
const mockGet = async (path) => (await fetch(MOCK + path)).json();
const sessionOf = (url) => url.split('/').pop();
/** the card page as the fake Stripe holds it */
const stripeSession = async (id) => (await fetch(`${MOCK}/stripe/v1/checkout/sessions/${id}`, { headers: { authorization: 'Bearer sk_test_abcdefghijklmnop' } })).json();
const sha = (s) => createHash('sha256').update(s).digest('hex');

let owner, ownerJwt, day, counter, truck;
before(async () => {
  const email = `owner-${randomUUID().slice(0, 6)}@test.local`;
  owner = await adminUser(email, 'motdepasse-1');
  await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, 'Hassan Jeha', 'Hassan', '{owner}', $2)`, [owner, email]);
  ownerJwt = (await signIn(email, 'motdepasse-1')).access_token;
  assert.ok(ownerJwt);
  day = (await q(`select (public.local_today() + 2)::text d`))[0].d;
  counter = (await q(`select next_value from public.counters where name = 'invoice'`))[0].next_value;
  await q(`update public.settings set company = company || '{"name":"Mécanique Mobile H.I.S","phone":"438 901-6606"}'::jsonb where id = 1`);
  // texts and card payment switched on (a test copy of the server takes Stripe test keys)
  await q(`insert into public.secrets (key, value) values ('stripe_test_ok', 'on') on conflict (key) do update set value = 'on'`);
  const sk = await fn('team', { action: 'secrets-set', ghl_token: 'pit-abcdef1234567890', ghl_location: 'LOC12345678', stripe_key: 'sk_test_abcdefghijklmnop' }, ownerJwt);
  assert.equal(sk.ok, true, JSON.stringify(sk));
  truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active) values ($1, 'Camion Complet', true)`, [truck]);
  await fetch(`${MOCK}/control?stripe=ok&ghl=ok&ghl_ms=0`);
});
after(async () => {
  await fetch(`${MOCK}/control?stripe=ok&ghl=ok&ghl_ms=0`);
  await q(`delete from public.payments where invoice_id in (select id from public.invoices where customer_id = any($1)) or job_id in (select id from public.jobs where customer_id = any($1))`, [made.customers]);
  await q(`delete from public.payments where job_id is null and invoice_id is null and method = 'card_online'`);
  await q(`delete from public.invoices where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.jobs where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.customers where id = any($1)`, [made.customers]);
  await q(`delete from public.trucks where id = any($1)`, [made.trucks]);
  await q(`delete from public.secrets`); await q(`delete from public.public_links`); await q(`delete from public.stripe_events`);
  await q(`delete from public.staff where id = any($1)`, [made.users]);
  await q(`delete from auth.users where id = any($1)`, [made.users]);
  await q(`update public.settings set company = '{}'::jsonb where id = 1`);
  await q(`delete from public.op_log`); await q(`delete from public.activity`); await q(`delete from public.messages`); await q(`delete from public.rate_limits`);
  await q(`update public.counters set next_value = $1 where name = 'invoice'`, [counter]);
  await db.end();
});

/** a customer and a coming appointment with its work lines (planned unless said) */
async function newJob({ items = [{ description: 'Vidange d’huile', unit_cents: 10000 }], first = 'Luc', status = 'booked' } = {}) {
  const cust = randomUUID(); made.customers.push(cust);
  const four = String(1000 + Math.floor(Math.random() * 8999));
  await q(`insert into public.customers (id, first_name, last_name, phone, lat, lng, lang) values ($1, $2, 'Gagnon', $3, 45.52, -73.62, 'fr')`, [cust, first, `514 555-${four}`]);
  const job = randomUUID();
  await q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min) values ($1, $2, $3, 'pm', $4, $5, 60)`, [job, cust, day, truck, status]);
  const ids = [];
  for (const [i, it] of items.entries()) {
    ids.push((await q(`insert into public.job_items (job_id, description, unit_cents, qty, kind, status, sort) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [job, it.description, it.unit_cents, it.qty ?? 1, it.kind ?? 'service', it.status ?? 'planned', i]))[0].id);
  }
  return { job, cust, items: ids };
}
/** a secret link of the customer's page for that job (as a text makes one) */
async function linkFor(job) {
  const token = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40);
  await q(`insert into public.public_links (token_hash, job_id, expires_at) values ($1, $2, now() + interval '30 days')`, [sha(token), job]);
  return token;
}
/** the mechanic is there; the invoice is made and finished: its id */
async function issue(job) {
  await q(`update public.jobs set status = 'on_site' where id = $1`, [job]);
  const inv = await rpc('invoice_for_job', { p_op: randomUUID(), p_job: job, p_refresh: true }, ownerJwt);
  const id = inv.rows.invoices[0].id;
  await rpc('invoice_finish', { p_op: randomUUID(), p_invoice: id }, ownerJwt);
  return id;
}

/* ---------- edge-functions-01: a card payment Stripe took is never lost ---------- */

test('a card page paid after its invoice was cancelled: the money is recorded on the job, Stripe gets 2xx, the page shows no error', async () => {
  await clearLog();
  const { job } = await newJob({ items: [{ description: 'Freins avant', unit_cents: 20000 }] });
  const inv = await issue(job);
  const t = await linkFor(job);
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p.url, JSON.stringify(p));
  // the office cancels the invoice to redo it while the customer's card page is still open
  await rpc('invoice_void', { p_op: randomUUID(), p_invoice: inv, p_reason: 'à refaire' }, ownerJwt);
  // the customer pays; Stripe sends its notice, the same notice again, and a second notice about the same page
  const paid = await (await fetch(p.url + '?replay=1&twice=1')).json();
  assert.equal(paid.hook, 200, paid.result);
  const hooks = (await mockLog()).filter((x) => x.svc === 'stripe-webhook');
  assert.equal(hooks.length, 3);
  assert.ok(hooks.every((h) => h.status === 200), 'never a refusal Stripe would retry for days: ' + JSON.stringify(hooks));
  const rows = await q(`select amount_cents, method, job_id, invoice_id from public.payments where stripe_session = $1`, [sessionOf(p.url)]);
  assert.equal(rows.length, 1, 'recorded once');
  assert.deepEqual([rows[0].amount_cents, rows[0].method, rows[0].job_id, rows[0].invoice_id], [22995, 'card_online', job, null], 'on the job: the next invoice takes it');
  const notes = await q(`select action from public.activity where entity_id = $1 and action in ('payment_moved', 'payment_unmatched')`, [job]);
  assert.ok(notes.length >= 1, 'the office is told the payment is not where it was meant to go');
  // back from Stripe, the customer's page answers normally
  const ck = await fn('client', { action: 'check', token: t });
  assert.equal(ck.ok, true, JSON.stringify(ck));
  assert.equal(ck.status, 200);
});

test('a paid card page the books can never take is kept aside for the office: 2xx to Stripe, noted once, never asked again', async () => {
  // a card page whose job does not exist (made straight at Stripe): nothing can hold the payment
  const ghost = randomUUID();
  const body = new URLSearchParams({ mode: 'payment', 'line_items[0][price_data][unit_amount]': '4599', 'metadata[job_id]': ghost, success_url: 'x', cancel_url: 'x' });
  const s = await (await fetch(`${MOCK}/stripe/v1/checkout/sessions`, { method: 'POST', headers: { authorization: 'Bearer sk_test_abcdefghijklmnop', 'content-type': 'application/x-www-form-urlencoded' }, body })).json();
  assert.ok(s.id, JSON.stringify(s));
  await clearLog();
  const paid = await (await fetch(s.url + '?twice=1')).json();
  assert.equal(paid.hook, 200, paid.result);
  const hooks = (await mockLog()).filter((x) => x.svc === 'stripe-webhook');
  assert.ok(hooks.length === 2 && hooks.every((h) => h.status === 200), JSON.stringify(hooks));
  const noted = await q(`select action from public.activity where data->>'session' = $1 and action in ('payment_parked', 'payment_unmatched')`, [s.id]);
  assert.equal(noted.length, 1, 'written once where the owner sees it: ' + JSON.stringify(noted));
  assert.equal((await q(`select count(*)::int n from public.stripe_events where id = any($1)`, [hooks.map((h) => h.event)]))[0].n, 2, 'both notices handled');
});

/* ---------- x-branches-02 / x-branches-05: refunds, as Stripe really sends them ---------- */

test('money given back in Stripe (the notice carries no list of refunds): one negative card payment per refund, once; a refund on its way waits; Stripe down = 5xx, asked again', async () => {
  const { job } = await newJob({ items: [{ description: 'Pneus d’hiver', unit_cents: 40000 }] });
  const t = await linkFor(job);
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p.url, JSON.stringify(p));
  const sid = sessionOf(p.url);
  assert.equal((await mockGet(`/pay/${sid}`)).hook, 200);
  const neg = async () => q(`select amount_cents, method, reference, stripe_session from public.payments where job_id = $1 and amount_cents < 0 order by created_at`, [job]);
  // a part given back (the same refund notice comes twice)
  const r1 = await mockGet(`/refund/${sid}?amount=5000&twice=1`);
  assert.equal(r1.hook, 200, r1.result);
  let rows = await neg();
  assert.deepEqual(rows.map((r) => [r.amount_cents, r.method, r.reference, r.stripe_session]), [[-5000, 'card_online', r1.refund, `${sid}#${r1.refund}`]]);
  // a refund still on its way: nothing yet; written when Stripe says it went through
  const r2 = await mockGet(`/refund/${sid}?amount=1000&status=pending`);
  assert.equal(r2.hook, 200, r2.result);
  assert.equal((await neg()).length, 1, 'a pending refund is not money given back yet');
  assert.equal((await mockGet(`/refund-update/${r2.refund}?status=succeeded`)).hook, 200);
  rows = await neg();
  assert.deepEqual(rows.map((r) => r.amount_cents), [-5000, -1000]);
  // Stripe's list of refunds does not answer: a 5xx, the notice is NOT marked handled (Stripe sends it again)
  await fetch(`${MOCK}/control?stripe=refunds`);
  let r3;
  try { r3 = await mockGet(`/refund/${sid}?amount=2000`); } finally { await fetch(`${MOCK}/control?stripe=ok`); }
  assert.equal(r3.hook, 500, r3.result);
  assert.equal((await q(`select count(*)::int n from public.stripe_events where id = $1`, [r3.event]))[0].n, 0);
  assert.equal((await neg()).length, 2);
  // the next notice (Stripe trying again, or the refund's update) records it
  assert.equal((await mockGet(`/refund-update/${r3.refund}?status=succeeded`)).hook, 200);
  rows = await neg();
  assert.deepEqual(rows.map((r) => r.amount_cents), [-5000, -1000, -2000]);
  const net = (await q(`select sum(amount_cents)::int s from public.payments where job_id = $1`, [job]))[0].s;
  assert.equal(net, 45990 - 8000, 'the books say what the customer really paid');
});

/* ---------- client-page-02 / x-branches-03: one open card page per job ---------- */

test('one open card page per job: two texts give the same page, a new amount closes the old page at Stripe, after a prepayment the rest gets its own page', async () => {
  const { job } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 10000 }] });
  const a = await linkFor(job), b = await linkFor(job);
  // two texts tapped at the same moment
  const [pa, pb] = await Promise.all([fn('client', { action: 'pay', token: a, base: BASE }), fn('client', { action: 'pay', token: b, base: BASE })]);
  assert.ok(pa.url, JSON.stringify(pa));
  assert.equal(pb.url, pa.url, 'two links, ONE payable page');
  assert.equal((await fn('client', { action: 'pay', token: b, base: BASE })).url, pa.url);
  // the work changes: a new amount; the old page is closed at Stripe and can no longer be paid
  await q(`insert into public.job_items (job_id, description, unit_cents, sort) values ($1, 'Essuie-glaces', 2000, 5)`, [job]);
  const pc = await fn('client', { action: 'pay', token: a, base: BASE });
  assert.ok(pc.url && pc.url !== pa.url, JSON.stringify(pc));
  assert.equal((await stripeSession(sessionOf(pa.url))).status, 'expired');
  assert.equal((await fetch(pa.url)).status, 410, 'the old page cannot take money any more');
  assert.equal((await fn('client', { action: 'pay', token: b, base: BASE })).url, pc.url, 'the other text opens the new page');
  assert.equal((await stripeSession(sessionOf(pc.url))).amount_total, 13797);
  // paid; then extra work is added: a page for what is left, not « already paid »
  assert.equal((await mockGet(`/pay/${sessionOf(pc.url)}`)).hook, 200);
  await q(`insert into public.job_items (job_id, description, unit_cents, sort) values ($1, 'Balais', 1000, 6)`, [job]);
  const pe = await fn('client', { action: 'pay', token: b, base: BASE });
  assert.ok(pe.url && pe.url !== pc.url, 'a new page for the rest: ' + JSON.stringify(pe));
  assert.equal((await stripeSession(sessionOf(pe.url))).amount_total, 1150);
});

test('Stripe refusing or not answering: the customer is told to pay on site or call, never « the server had a problem »', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  await fetch(`${MOCK}/control?stripe=all`);
  let r;
  try { r = await fn('client', { action: 'pay', token: t, base: BASE }); } finally { await fetch(`${MOCK}/control?stripe=ok`); }
  assert.deepEqual([r.status, r.ok, r.code], [502, false, 'pay_unavailable'], JSON.stringify(r));
  assert.match(r.error, /payez sur place ou appelez le garage/);
  assert.equal(r.garage?.name, 'Mécanique Mobile H.I.S', 'the refusal still says who to call');
});

/* ---------- client-page-01: the customer signs only what the page showed ---------- */

test('signing with shown_cents: another amount since = 409 amount_changed, nothing written; the amount shown = signed; without it, as before', async () => {
  const { job, items } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 10000 }] });
  const t = await linkFor(job);
  const v = await fn('client', { action: 'view', token: t });
  assert.equal(v.expected.total, 11498);
  // the office changes the price while the customer's tab stays open
  await q(`update public.job_items set unit_cents = 20000 where id = $1`, [items[0]]);
  const r = await fn('client', { action: 'sign', token: t, click: true, confirm: true, shown_cents: v.expected.total });
  assert.deepEqual([r.status, r.ok, r.code, r.current_cents], [409, false, 'amount_changed', 22995], JSON.stringify(r));
  assert.match(r.error, /montant .+ a changé/);
  const j = (await q(`select estimate_signed_at, waiver_signed_at from public.jobs where id = $1`, [job]))[0];
  assert.deepEqual([j.estimate_signed_at, j.waiver_signed_at], [null, null], 'nothing signed');
  assert.equal((await q(`select count(*)::int n from public.activity where entity_id = $1 and action = 'signed_online'`, [job]))[0].n, 0);
  // the page shows the new total; signed with it (the proof keeps the amount shown and a keyed fingerprint of the address)
  const ok = await fn('client', { action: 'sign', token: t, click: true, confirm: true, shown_cents: 22995 }, null, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.estimate.cents, 22995);
  const proof = (await q(`select data from public.activity where entity_id = $1 and action = 'signed_online'`, [job]))[0].data;
  assert.equal(proof.shown_cents, 22995);
  // x-branches A8: the address is kept as a fingerprint made with a secret of the server (never a plain sha256 anyone can reverse)
  assert.match(proof.ip, /^[0-9a-f]{24}$/);
  assert.notEqual(proof.ip, sha('sig:203.0.113.9').slice(0, 24));
  // yesterday's page (no shown_cents): as before
  await q(`insert into public.job_items (job_id, description, unit_cents, sort) values ($1, 'Filtre à air', 3000, 3)`, [job]);
  const old = await fn('client', { action: 'sign', token: t, click: true, confirm: true });
  assert.equal(old.ok, true, JSON.stringify(old));
  assert.equal(old.estimate.cents, 26444);
});

test('extra work answered with shown_cents: a price changed since = 409 amount_changed and still to answer; the price shown = accepted; without it, as before', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  const extra = (await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed') returning id`, [job]))[0].id;
  const v = await fn('client', { action: 'view', token: t });
  const shown = v.extras.find((x) => x.id === extra).total_cents;
  assert.equal(shown, 12000);
  await q(`update public.job_items set unit_cents = 22000 where id = $1`, [extra]);
  const r = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true, shown_cents: shown });
  assert.deepEqual([r.status, r.ok, r.code, r.current_cents], [409, false, 'amount_changed', 22000], JSON.stringify(r));
  assert.equal((await q(`select status from public.job_items where id = $1`, [extra]))[0].status, 'proposed', 'not accepted at a price never shown');
  const a = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true, shown_cents: 22000 });
  assert.equal(a.extras.find((x) => x.id === extra).status, 'approved', JSON.stringify(a));
  // yesterday's page
  const extra2 = (await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Lave-glace', 900, 'proposed') returning id`, [job]))[0].id;
  const b = await fn('client', { action: 'answer', token: t, item_id: extra2, accept: false, confirm: true });
  assert.equal(b.extras.find((x) => x.id === extra2).status, 'declined', JSON.stringify(b));
});

/* ---------- the shared kit ---------- */

test('a database error that is not one of our refusals never reaches the public page as words: 500, a short reference', async () => {
  const [{ def }] = await q(`select pg_get_functiondef('public.web_services'::regproc) def`);
  const [{ res }] = await q(`select pg_get_function_result('public.web_services'::regproc) res`);
  try {
    // a server bug whose Postgres error carries a « hint » (as « Perhaps you meant … » does)
    await q(`create or replace function public.web_services() returns ${res} language plpgsql security definer set search_path = public as $f$
      begin raise exception 'column s.prix does not exist' using errcode = '42703', hint = 'Perhaps you meant to reference the column "s.price".'; end $f$`);
    const r = await fn('book', { action: 'info' });
    assert.deepEqual([r.status, r.ok, r.code], [500, false, 'server'], JSON.stringify(r));
    assert.doesNotMatch(JSON.stringify(r), /prix|Perhaps/);
    assert.match(String(r.ref), /^[a-z0-9]{6}$/, 'a reference to find the real error in the log');
  } finally {
    await q(def);
  }
  assert.equal((await fn('book', { action: 'info' })).ok, true);
});

test('« which version are you? »: GET ?version and { action: "version" } answer the commit', async () => {
  for (const name of ['client', 'book', 'notify', 'stripe']) {
    const g = await (await fetch(`${API}/functions/v1/${name}?version`, { headers: { apikey: K.anon } })).json();
    assert.deepEqual(g, { ok: true, commit: 'local' }, name);
    const p = await fn(name, { action: 'version' });
    assert.deepEqual([p.status, p.ok, p.commit], [200, true, 'local'], name);
  }
});

test('online booking with a day that is not a date: refused with words (bad_block), not « the server had a problem »', async () => {
  const oil = (await q(`insert into public.services (name_fr, name_en, price_cents, duration_min) values ('Huile date', 'Oil date', 8000, 45) returning id`))[0].id;
  try {
    const r = await fn('book', { action: 'book', base: BASE, lang: 'fr', services: [oil], day: '2026-02-31', block: 'pm', first_name: 'Nadia', last_name: 'Web',
      phone: '514 555-7788', address: '1250 rue Graham, Mont-Royal', lat: 45.53, lng: -73.62, vehicle: { year: '2020', make: 'Honda', model: 'Civic' } }, null, { 'x-forwarded-for': '198.51.100.4' });
    assert.deepEqual([r.status, r.ok, r.code], [400, false, 'bad_block'], JSON.stringify(r));
  } finally {
    await q(`delete from public.rate_limits`);
    await q(`delete from public.services where id = $1`, [oil]);
  }
});

test('totals of the texts: a discount line is taken off ({total} of the booking text), like the invoice', async () => {
  const [{ booking: tpl }] = await q(`select messages->'fr'->'booking' booking from public.settings where id = 1`);
  await q(`update public.settings set messages = jsonb_set(messages, '{fr,booking}', '"Total {total} {lien}"') where id = 1`);
  try {
    const { job } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 10000 }, { description: 'Rabais client fidèle', unit_cents: 2000, kind: 'discount' }] });
    const n = await fn('notify', { kind: 'booking', job_id: job, base: BASE }, ownerJwt);
    assert.equal(n.ok, true, JSON.stringify(n));
    assert.match(n.message, /^Total 91,98\s\$ http/, JSON.stringify(n.message));
  } finally {
    await q(`update public.settings set messages = jsonb_set(messages, '{fr,booking}', $1::jsonb) where id = 1`, [JSON.stringify(tpl)]);
  }
});

test('argent-app-05: the customer’s estimate counts each line as the database does (1,333 h stays 1,333 h; an option at 0 costs nothing)', async () => {
  const items = [{ description: 'Main-d’œuvre 1 h 20', qty: 1.333, unit_cents: 9000, taxable: true }, { description: 'Option', qty: 0, unit_cents: 5000, taxable: true },
    { description: 'Pièce', qty: 1.15, unit_cents: 1999, taxable: true }, { description: 'Sans quantité', unit_cents: 1000, taxable: true }];
  const cust = randomUUID(); made.customers.push(cust);
  await q(`insert into public.customers (id, first_name, last_name, phone, lang) values ($1, 'Estimé', 'Exact', '514 555-0133', 'fr')`, [cust]);
  const quote = (await q(`insert into public.quotes (customer_id, items) values ($1, $2::jsonb) returning id`, [cust, JSON.stringify(items)]))[0].id;
  const token = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 40);
  await q(`insert into public.public_links (token_hash, quote_id, expires_at) values ($1, $2, now() + interval '30 days')`, [sha(token), quote]);
  try {
    const v = await fn('client', { action: 'view', token });
    assert.equal(v.kind, 'quote', JSON.stringify(v));
    // what the database's own rule (invoice_totals) gives for the same lines
    const [want] = await q(`select sum(round(coalesce((l->>'qty')::numeric, 1) * (l->>'unit_cents')::numeric))::int s from jsonb_array_elements($1::jsonb) l`, [JSON.stringify(items)]);
    assert.equal(want.s, 11997 + 0 + 2299 + 1000);
    assert.deepEqual([v.totals.subtotal, v.totals.tps, v.totals.tvq, v.totals.total], [want.s, Math.round(want.s * 0.05), Math.round(want.s * 0.09975), want.s + Math.round(want.s * 0.05) + Math.round(want.s * 0.09975)]);
    assert.deepEqual(v.items.map((i) => i.qty), [1.333, 0, 1.15, 1], 'the lines shown are the lines counted');
  } finally {
    await q(`delete from public.public_links where quote_id = $1`, [quote]);
    await q(`delete from public.quotes where id = $1`, [quote]);
  }
});

test('edge-functions-18 / -30: each line of the booking text is worth what the invoice will say (one rule), and a customer with no first name is greeted « Bonjour, »', async () => {
  const [{ booking: tpl }] = await q(`select messages->'fr'->'booking' booking from public.settings where id = 1`);
  await q(`update public.settings set messages = jsonb_set(messages, '{fr,booking}', '"Bonjour {prenom}, voici :\\n{services}\\nTotal : {soustotal} {lien}"') where id = 1`);
  try {
    // half a « rabais » of -19,99 $: -9,995 $, which the database rounds away from zero (-10,00 $)
    const { job, cust } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 10000 }, { description: 'Rabais', unit_cents: -1999, qty: 0.5, kind: 'discount' }] });
    await q(`update public.customers set first_name = null, company = 'Transport Lavoie' where id = $1`, [cust]);
    const n = await fn('notify', { kind: 'booking', job_id: job, base: BASE }, ownerJwt);
    assert.equal(n.ok, true, JSON.stringify(n));
    assert.match(n.message, /^Bonjour, voici :\n/, JSON.stringify(n.message));
    const [{ c }] = await q(`select round(0.5 * -1999)::int c`);
    assert.equal(c, -1000);
    assert.ok(n.message.includes(`0,5 × Rabais\u00a0: -10,00 $`), JSON.stringify(n.message));
    assert.match(n.message, /Total : 90,00\s\$ \+ tx/, 'the total of the lines as written');
  } finally {
    await q(`update public.settings set messages = jsonb_set(messages, '{fr,booking}', $1::jsonb) where id = 1`, [JSON.stringify(tpl)]);
  }
});

test('edge-functions-05: extra work accepted on the customer’s page goes on the invoice being made: the amount due and « Payer » include it', async () => {
  const { job } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 10000 }] });
  await q(`update public.jobs set status = 'on_site' where id = $1`, [job]);
  await rpc('invoice_for_job', { p_op: randomUUID(), p_job: job, p_refresh: true }, ownerJwt);   // the mechanic is there: the draft
  const extra = (await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed') returning id`, [job]))[0].id;
  const t = await linkFor(job);
  const v = await fn('client', { action: 'view', token: t });
  assert.deepEqual([v.bill?.total_cents, v.pay.amount_cents], [11498, 11498], JSON.stringify(v.bill));
  const a = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true, shown_cents: 12000 });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual([a.bill.total_cents, a.pay.amount_cents], [25295, 25295], 'the accepted work is billed: ' + JSON.stringify(a.bill));
  assert.ok(a.bill.lines.some((l) => l.item_id === extra), 'its line is on the invoice being made');
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.equal((await stripeSession(sessionOf(p.url))).amount_total, 25295, 'the card page asks for it too');
});

test('edge-functions-06: texting a finished invoice never changes its totals, even after the tax rates changed in Réglages', async () => {
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  const inv = await issue(job);
  const before = (await q(`select subtotal_cents, tps_cents, tvq_cents, total_cents from public.invoices where id = $1`, [inv]))[0];
  const [{ taxes }] = await q(`select taxes from public.settings where id = 1`);
  await q(`update public.settings set taxes = coalesce(taxes, '{}'::jsonb) || '{"tps": 0.06}'::jsonb where id = 1`);
  try {
    const r = await fn('notify', { kind: 'invoice', job_id: job, base: BASE }, ownerJwt);
    assert.equal(r.status, 'sent', JSON.stringify(r));
    const after = (await q(`select subtotal_cents, tps_cents, tvq_cents, total_cents, sent_at from public.invoices where id = $1`, [inv]))[0];
    assert.ok(after.sent_at, 'sent_at written');
    delete after.sent_at;
    assert.deepEqual(after, before, 'the totals as issued');
  } finally {
    await q(`update public.settings set taxes = $1::jsonb where id = 1`, [taxes === null ? null : JSON.stringify(taxes)]);
  }
});

/* ---------- the texts (notify) ---------- */

test('the same text sent twice with the same op (the answer was lost, the person taps again, or two taps at once): texted once, the same answer', async () => {
  const { job } = await newJob();
  await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed')`, [job]);
  await clearLog();
  const op = randomUUID();
  const [x, y] = await Promise.all([fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt), fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt)]);
  const first = x.message ? x : y;
  assert.equal(first.status, 'sent', JSON.stringify([x, y]));
  const z = await fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt);
  assert.deepEqual([z.status, z.message, z.link], ['sent', first.message, first.link], 'the first answer again');
  const sms = (await mockLog()).filter((m) => m.svc === 'ghl' && m.path === '/conversations/messages');
  assert.equal(sms.length, 1, 'the customer got it once');
  assert.equal((await q(`select count(*)::int n from public.messages where job_id = $1 and kind = 'extras'`, [job]))[0].n, 1);
  // another op is another send
  assert.equal((await fn('notify', { kind: 'extras', job_id: job, base: BASE, op: randomUUID() }, ownerJwt)).status, 'sent');
});

test('a treasurer (the invoices, not the agenda) texts an invoice; still no other text for that job', async () => {
  const email = `tresor-${randomUUID().slice(0, 6)}@test.local`;
  const tr = await adminUser(email, 'garage-2026');
  await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, 'Ibra Trésor', 'Ibra', '{treasurer}', $2)`, [tr, email]);
  const jwt = (await signIn(email, 'garage-2026')).access_token;
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  await issue(job);
  const r = await fn('notify', { kind: 'invoice', job_id: job, base: BASE }, jwt);
  assert.equal(r.status, 'sent', JSON.stringify(r));
  assert.match(r.message, /voici votre facture F-\d+ de Mécanique Mobile H\.I\.S \(172,46\s\$\)/);
  assert.equal((await fn('notify', { kind: 'booking', job_id: job, base: BASE }, jwt)).code, 'not_found');
});

test('securite-01: « Factures » alone never texts the invoice of a job one cannot see (a mechanic of another truck), and « arrived » needs the job, as before', async () => {
  const account = async (roles, name) => {
    const email = `${name}-${randomUUID().slice(0, 6)}@test.local`;
    const id = await adminUser(email, 'garage-2026');
    await q(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, $2, $2, $3, $4)`, [id, name, roles, email]);
    return (await signIn(email, 'garage-2026')).access_token;
  };
  const mech = await account('{mechanic}', 'Saleh'), tres = await account('{treasurer}', 'Ibra');
  // the job is on a truck Saleh does not drive; he has « Factures » (a mechanic's default) and sees every invoice
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  await issue(job);   // finished, the mechanic still on site
  await clearLog();
  for (const kind of ['invoice', 'payment_reminder', 'arrived']) {
    const r = await fn('notify', { kind, job_id: job, base: BASE }, mech);
    assert.deepEqual([r.ok, r.code], [false, 'not_found'], `${kind}: ${JSON.stringify(r)}`);
    assert.equal(r.link, undefined, 'no customer link handed out');
  }
  // the treasurer keeps the books: the invoice and its reminder, never « your mechanic is here »
  const a = await fn('notify', { kind: 'arrived', job_id: job, base: BASE, resend: true }, tres);
  assert.deepEqual([a.ok, a.code], [false, 'not_found'], JSON.stringify(a));
  assert.equal((await fn('notify', { kind: 'payment_reminder', job_id: job, base: BASE }, tres)).status, 'sent');
  const sms = (await mockLog()).filter((m) => m.svc === 'ghl' && m.path === '/conversations/messages');
  assert.equal(sms.length, 1, 'only the treasurer’s reminder was texted: ' + JSON.stringify(sms.map((m) => m.body?.message)));
  assert.equal((await q(`select count(*)::int n from public.public_links where job_id = $1`, [job]))[0].n, 1, 'one link made: the reminder’s');
});

test('the payment reminder says the Montréal day of the invoice (finished at 19 h 30, not the next day)', async () => {
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  const inv = await issue(job);
  await q(`update public.invoices set issued_at = '2026-11-17T00:30:00Z' where id = $1`, [inv]);
  const r = await fn('notify', { kind: 'payment_reminder', job_id: job, base: BASE }, ownerJwt);
  assert.equal(r.status, 'sent', JSON.stringify(r));
  assert.match(r.message, /du lundi 16 novembre/, r.message);
});

test('a text whose link could not be kept is not sent (never a text with a dead link)', async () => {
  const { job } = await newJob();
  await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed')`, [job]);
  await clearLog();
  await q(`alter table public.public_links add constraint refonte_test_no_link check (false) not valid`);
  let r;
  try { r = await fn('notify', { kind: 'extras', job_id: job, base: BASE }, ownerJwt); } finally {
    await q(`alter table public.public_links drop constraint refonte_test_no_link`);
  }
  assert.deepEqual([r.status, r.ok, r.code], [500, false, 'server'], JSON.stringify(r));
  assert.equal((await mockLog()).filter((m) => m.svc === 'ghl' && m.path === '/conversations/messages').length, 0, 'nothing texted');
  // the link can be kept again: the text goes
  assert.equal((await fn('notify', { kind: 'extras', job_id: job, base: BASE }, ownerJwt)).status, 'sent');
});

/* ---------- the customer's page (client): what the page is told ---------- */

test('the database not answering: the customer is not told the link is invalid (500 with a reference, the link still works after)', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  await q(`revoke select on public.public_links from service_role`);
  let r;
  try { r = await fn('client', { action: 'view', token: t }); } finally { await q(`grant select on public.public_links to service_role`); }
  assert.deepEqual([r.status, r.code], [500, 'server'], JSON.stringify(r));
  assert.doesNotMatch(String(r.error), /lien/);
  assert.equal((await fn('client', { action: 'view', token: t })).ok, true);
});

test('extra work can no longer be accepted on the page once the appointment is cancelled (409 closed, still to answer)', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  const extra = (await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed') returning id`, [job]))[0].id;
  await q(`update public.jobs set status = 'cancelled' where id = $1`, [job]);
  const r = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true });
  assert.deepEqual([r.status, r.ok, r.code], [409, false, 'closed'], JSON.stringify(r));
  assert.equal((await q(`select status from public.job_items where id = $1`, [extra]))[0].status, 'proposed');
});

test('back from Stripe: « check » says what became of the card page (paid even when Stripe’s notice never came; unknown when Stripe is down)', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  const c0 = await fn('client', { action: 'check', token: t });
  assert.deepEqual([c0.session, c0.checked], ['none', null], 'R10: the page reads « checked »');
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  const c1 = await fn('client', { action: 'check', token: t });
  assert.deepEqual([c1.session, c1.checked], ['open', 'open']);
  // Stripe not answering: the page still opens, « unknown »
  await fetch(`${MOCK}/control?stripe=all`);
  let d;
  try { d = await fn('client', { action: 'check', token: t }); } finally { await fetch(`${MOCK}/control?stripe=ok`); }
  assert.deepEqual([d.status, d.ok, d.session], [200, true, 'unknown'], JSON.stringify(d));
  assert.equal('checked' in d, false, 'unknown: the page is not told anything it would believe');
  // paid, but Stripe's notice is late: the page itself records it, once
  assert.equal((await mockGet(`/pay/${sessionOf(p.url)}?quiet=1`)).hook, null);
  const c = await fn('client', { action: 'check', token: t });
  assert.deepEqual([c.ok, c.session, c.checked, c.pay.available], [true, 'paid', 'paid', false], JSON.stringify(c));
  assert.equal((await q(`select count(*)::int n from public.payments where stripe_session = $1`, [sessionOf(p.url)]))[0].n, 1);
  assert.equal((await fn('client', { action: 'check', token: t })).session, 'none', 'the paid page is forgotten by the link');
  assert.equal((await q(`select count(*)::int n from public.payments where stripe_session = $1`, [sessionOf(p.url)]))[0].n, 1, 'still once');
});

test('R12: the card page speaks the language the customer’s page is shown in (« lang »); yesterday’s page (no lang): the file’s language', async () => {
  const sessions = async () => (await mockLog()).filter((x) => x.svc === 'stripe' && x.method === 'POST' && x.path === '/v1/checkout/sessions');
  const { job } = await newJob();                     // a French-speaking customer
  const t = await linkFor(job);
  await clearLog();
  const p = await fn('client', { action: 'pay', token: t, base: BASE, lang: 'en' });
  assert.ok(p.url, JSON.stringify(p));
  let [made] = await sessions();
  assert.equal(made.form.locale, 'en');
  assert.match(made.form['line_items[0][price_data][product_data][name]'], /^Appointment of /);
  assert.ok(made.form.success_url.endsWith('&l=en&retour=paye') && made.form.cancel_url.endsWith('&l=en'), JSON.stringify(made.form));
  const { job: job2 } = await newJob();
  const t2 = await linkFor(job2);
  await clearLog();
  assert.ok((await fn('client', { action: 'pay', token: t2, base: BASE })).url);
  [made] = await sessions();
  assert.deepEqual([made.form.locale, /^Rendez-vous du /.test(made.form['line_items[0][price_data][product_data][name]']), made.form.cancel_url.includes('&l=en')], ['fr-CA', true, false]);
});

/* ---------- review round 1 ---------- */

/** the operation id the functions give a Stripe object (_shared/payments.ts stripeOp) */
const stripeOp = (what) => { const h = sha(`stripe:${what}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`; };
/** the card pages of a job the fake Stripe holds open */
const openPages = async (job) => ((await (await fetch(`${MOCK}/stripe/v1/checkout/sessions?limit=100`, { headers: { authorization: 'Bearer sk_test_abcdefghijklmnop' } })).json()).data || []).filter((s) => s.metadata?.job_id === job && s.status === 'open');
/** a card page made straight at Stripe for a job that does not exist (nothing in the books can hold it) */
async function ghostPage(cents = 4599) {
  const body = new URLSearchParams({ mode: 'payment', 'line_items[0][price_data][unit_amount]': String(cents), 'metadata[job_id]': randomUUID(), success_url: 'x', cancel_url: 'x' });
  const s = await (await fetch(`${MOCK}/stripe/v1/checkout/sessions`, { method: 'POST', headers: { authorization: 'Bearer sk_test_abcdefghijklmnop', 'content-type': 'application/x-www-form-urlencoded' }, body })).json();
  assert.ok(s.id, JSON.stringify(s));
  return s;
}

test('pay-claim-split: many taps at once on several texts of the same job (however they interleave): ONE card page at Stripe, every tap gets it', async () => {
  for (let round = 0; round < 3; round++) {
    const { job } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 10000 + round }] });
    const links = [await linkFor(job), await linkFor(job), await linkFor(job)];
    const taps = await Promise.all([...links, ...links].map((t) => fn('client', { action: 'pay', token: t, base: BASE })));
    assert.ok(taps.every((x) => x.ok && x.url), JSON.stringify(taps));
    assert.equal(new Set(taps.map((x) => x.url)).size, 1, 'one page for every tap: ' + JSON.stringify(taps.map((x) => x.url)));
    assert.equal((await openPages(job)).length, 1, 'one payable page at Stripe');
    assert.equal((await q(`select count(*)::int n from public.op_log where op = $1`, [stripeOp(`pay-claim:${job}`)]))[0].n, 0, 'the claim is freed');
  }
  // the interleaving that split the old two-window brake (A takes one window, B the other: both lost, both made a page),
  // reproduced by holding the second window as a tap in between would
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  const a = await linkFor(job), b = await linkFor(job);
  const amount = (await fn('client', { action: 'view', token: a })).pay.amount_cents;
  await q(`select public.rate_hit($1, 31, 1)`, [`pay+:${job}:${amount}`]);
  const [pa, pb] = await Promise.all([fn('client', { action: 'pay', token: a, base: BASE }), fn('client', { action: 'pay', token: b, base: BASE })]);
  assert.ok(pa.url && pa.url === pb.url, 'one page: ' + JSON.stringify([pa, pb]));
  assert.equal((await openPages(job)).length, 1, 'one payable page at Stripe');
});

test('pay-claim-split: a claim left by a function that died is taken over (the customer is not stuck)', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  await q(`insert into public.op_log (op, name, result, at) values ($1, 'client_pay', null, now() - interval '1 minute')`, [stripeOp(`pay-claim:${job}`)]);
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p.ok && p.url, JSON.stringify(p));
  assert.equal((await openPages(job)).length, 1);
});

test('pay-same-link-orphan: the same link asking twice for the same amount gets the SAME page back from Stripe, never a page nobody remembers', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  const slice = () => Math.floor(Date.now() / 600000);
  const s0 = slice();
  const p1 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p1.url, JSON.stringify(p1));
  // the link lost what it held (two requests that both got through, the second writing over the first)
  await q(`update public.public_links set last_session = null, last_session_url = null, last_session_amount = null, last_session_expires = null where token_hash = $1`, [sha(t)]);
  const p2 = await fn('client', { action: 'pay', token: t, base: BASE });
  if (slice() !== s0) return;                     // the 10-minute slice turned in between: another request for Stripe
  assert.equal(p2.url, p1.url, 'Stripe gives the same page back for the same request');
  assert.equal((await openPages(job)).length, 1, 'no page left payable that no link remembers');
});

/** The books refuse every card payment of that Stripe page, and of its refunds, for good: a refusal of public.fail, as
    the database before Part 27 answered a page nothing could hold. Part 27's payment_add takes them all (see the
    « with Part 27 » tests), so this is how the function's own « keep aside for the office » path is reached. */
async function refuseInBooks(session) {
  const id = String(session).replace(/'/g, "''");
  await q(`create or replace function public.t_refuse_card() returns trigger language plpgsql as $f$ begin
    if split_part(new.stripe_session, '#', 1) = '${id}' then perform public.fail('not_found', 'Refusé pour le test.'); end if;
    return new; end $f$`);
  await q(`create trigger t_refuse_card before insert on public.payments for each row execute function public.t_refuse_card()`);
}
async function acceptInBooks() {
  await q(`drop trigger if exists t_refuse_card on public.payments`);
  await q(`drop function if exists public.t_refuse_card()`);
}
/** the history (activity) cannot be written for those actions for a moment: the disk is full (SQLSTATE 53100) */
async function historyFull(actions) {
  await q(`create or replace function public.t_fail_parked() returns trigger language plpgsql as $f$ begin
    if new.action = any(array[${actions.map((a) => `'${a}'`).join(',')}]) then raise exception 'disque plein' using errcode = '53100'; end if;
    return new; end $f$`);
  await q(`create trigger t_fail_parked before insert on public.activity for each row execute function public.t_fail_parked()`);
}
async function historyBack() {
  await q(`drop trigger if exists t_fail_parked on public.activity`);
  await q(`drop function if exists public.t_fail_parked()`);
}
const inBooks = async (session) => q(`select amount_cents, job_id, invoice_id, reference from public.payments where stripe_session = $1`, [session]);
const notesOf = async (action, session) => q(`select entity, entity_id, data from public.activity where action = $1 and data->>'session' = $2 order by id`, [action, session]);

test('parked-note-unchecked: a payment kept aside whose history row cannot be written is NOT marked handled: 5xx, Stripe sends it again, then it is noted', async () => {
  const s = await ghostPage(3100);
  await refuseInBooks(s.id);
  try {
    await historyFull(['payment_parked']);
    let first;
    await clearLog();
    try { first = await mockGet(`/pay/${s.id}`); } finally { await historyBack(); }
    assert.equal(first.hook, 500, 'Stripe must try again: ' + JSON.stringify(first));
    const ev = (await mockLog()).filter((x) => x.svc === 'stripe-webhook').map((h) => h.event);
    assert.equal((await q(`select count(*)::int n from public.stripe_events where id = any($1)`, [ev]))[0].n, 0, 'not marked handled');
    // Stripe's next try: kept aside and written for the office, once
    assert.equal((await mockGet(`/pay/${s.id}`)).hook, 200);
    assert.equal((await notesOf('payment_parked', s.id)).length, 1);
  } finally { await acceptInBooks(); }
  // the books would take it now (Part 27 applied meanwhile): kept aside stays kept aside, the office enters it by hand,
  // so another notice about that page never puts it in the books a second time
  assert.equal((await mockGet(`/pay/${s.id}`)).hook, 200);
  assert.deepEqual(await inBooks(s.id), [], 'never in the books behind the office’s back');
  assert.equal((await notesOf('payment_parked', s.id)).length, 1, 'still noted once');
});

test('parked-note-unchecked, with Part 27: the database keeps the payment and its note together; the note cannot be written = nothing written, 5xx; the next try = in the books once, noted once', async () => {
  // a card page whose job does not exist: Part 27's payment_add keeps it on nothing, with its note « payment_unmatched »
  const s = await ghostPage(3300);
  await historyFull(['payment_unmatched', 'payment_parked']);
  let first;
  await clearLog();
  try { first = await mockGet(`/pay/${s.id}`); } finally { await historyBack(); }
  assert.equal(first.hook, 500, 'Stripe must try again: ' + JSON.stringify(first));
  const ev = (await mockLog()).filter((x) => x.svc === 'stripe-webhook').map((h) => h.event);
  assert.equal((await q(`select count(*)::int n from public.stripe_events where id = any($1)`, [ev]))[0].n, 0, 'not marked handled');
  assert.deepEqual(await inBooks(s.id), [], 'no money without its note');
  // Stripe's next try (twice: two notices about the same page)
  assert.equal((await mockGet(`/pay/${s.id}?twice=1`)).hook, 200);
  assert.deepEqual((await inBooks(s.id)).map((p) => [p.amount_cents, p.job_id, p.invoice_id]), [[3300, null, null]], 'in the books once, on nothing (the nightly reconciliation lists it: M4.orphan)');
  const notes = await notesOf('payment_unmatched', s.id);
  assert.deepEqual(notes.map((n) => [n.data.why, n.data.amount]), [['no_job', 3300]], 'noted once, by the database');
  assert.equal((await notesOf('payment_parked', s.id)).length, 0, 'never also kept aside by the function (it would be entered by hand: counted twice)');
});

test('never() = refusalOf: a bare « raise exception » of the database (P0001 without a hint) is a hiccup, not a refusal: 5xx, nothing kept aside, the next notice puts the money in the books', async () => {
  const { job } = await newJob({ items: [{ description: 'Batterie', unit_cents: 18000 }] });
  const t = await linkFor(job);
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  const sid = sessionOf(p.url);
  const id = sid.replace(/'/g, "''");
  // a server bug (or a passing state) of the books: an exception with no code of ours
  await q(`create or replace function public.t_bare_raise() returns trigger language plpgsql as $f$ begin
    if new.stripe_session = '${id}' then raise exception 'état imprévu'; end if; return new; end $f$`);
  await q(`create trigger t_bare_raise before insert on public.payments for each row execute function public.t_bare_raise()`);
  let first;
  await clearLog();
  try { first = await mockGet(`/pay/${sid}`); } finally {
    await q(`drop trigger if exists t_bare_raise on public.payments`);
    await q(`drop function if exists public.t_bare_raise()`);
  }
  assert.equal(first.hook, 500, 'Stripe must try again: ' + JSON.stringify(first));
  const ev = (await mockLog()).filter((x) => x.svc === 'stripe-webhook').map((h) => h.event);
  assert.equal((await q(`select count(*)::int n from public.stripe_events where id = any($1)`, [ev]))[0].n, 0, 'not marked handled');
  assert.equal((await notesOf('payment_parked', sid)).length, 0, 'never kept aside for good');
  // Stripe's next notice (the bug fixed): in the books, once
  assert.equal((await mockGet(`/pay/${sid}?twice=1`)).hook, 200);
  assert.deepEqual((await inBooks(sid)).map((x) => [x.amount_cents, x.job_id]), [[(await stripeSession(sid)).amount_total, job]]);
  assert.equal((await stripeSession(sid)).amount_total, 20696);
});

test('refund-of-unrecorded-payment: a refund whose payment notice never came records the payment first, then the refund', async () => {
  const { job } = await newJob({ items: [{ description: 'Alternateur', unit_cents: 20000 }] });
  const t = await linkFor(job);
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  const sid = sessionOf(p.url);
  assert.equal((await mockGet(`/pay/${sid}?quiet=1`)).hook, null, 'the payment notice is lost');
  const r = await mockGet(`/refund/${sid}?amount=7000`);
  assert.equal(r.hook, 200, r.result);
  const rows = await q(`select amount_cents, stripe_session from public.payments where job_id = $1 order by amount_cents desc`, [job]);
  assert.deepEqual(rows.map((x) => [x.amount_cents, x.stripe_session]), [[22995, sid], [-7000, `${sid}#${r.refund}`]], 'the books say what really happened');
});

test('refund-of-unrecorded-payment: a refund of a payment kept aside for the office is kept aside beside it (once), never silently dropped', async () => {
  const s = await ghostPage(5200);
  await refuseInBooks(s.id);
  try {
    assert.equal((await mockGet(`/pay/${s.id}`)).hook, 200);
    assert.equal((await notesOf('payment_parked', s.id)).length, 1, 'the payment is kept aside');
  } finally { await acceptInBooks(); }
  // the money is given back from Stripe's screens, once the books would take that page (Part 27 applied meanwhile)
  const r = await mockGet(`/refund/${s.id}?amount=5200&twice=1`);
  assert.equal(r.hook, 200, r.result);
  const notes = await notesOf('payment_parked', `${s.id}#${r.refund}`);
  assert.equal(notes.length, 1, 'written once for the office: ' + JSON.stringify(notes));
  assert.deepEqual([notes[0].data.kind, notes[0].data.amount_cents, notes[0].data.reference], ['refund', -5200, r.refund]);
  // both by hand for the office, together: neither the payment nor its refund is put in the books behind its back
  assert.deepEqual([await inBooks(s.id), await inBooks(`${s.id}#${r.refund}`)], [[], []]);
  assert.equal((await notesOf('payment_parked', s.id)).length, 1);
});

test('refund-of-unrecorded-payment, with Part 27: a page nothing can hold is in the books on nothing, noted once by the database; its refund goes beside it, once, noted too', async () => {
  const s = await ghostPage(5400);
  assert.equal((await mockGet(`/pay/${s.id}?twice=1`)).hook, 200);
  const paid = await inBooks(s.id);
  assert.deepEqual(paid.map((p) => [p.amount_cents, p.job_id, p.invoice_id]), [[5400, null, null]]);
  assert.equal((await notesOf('payment_unmatched', s.id)).length, 1);
  const r = await mockGet(`/refund/${s.id}?amount=5400&twice=1`);
  assert.equal(r.hook, 200, r.result);
  const back = await inBooks(`${s.id}#${r.refund}`);
  assert.deepEqual(back.map((p) => [p.amount_cents, p.job_id, p.invoice_id, p.reference]), [[-5400, null, null, r.refund]], 'beside the payment, once');
  const unmatched = await notesOf('payment_unmatched', `${s.id}#${r.refund}`);
  assert.deepEqual(unmatched.map((n) => [n.data.why, n.data.amount, n.data.reference]), [['no_job', -5400, r.refund]], 'noted once for the owner');
  const refund = await notesOf('payment_refund', `${s.id}#${r.refund}`);
  assert.equal(refund.length, 1);
  assert.equal(refund[0].data.of, (await q(`select id from public.payments where stripe_session = $1`, [s.id]))[0].id, 'the refund names the payment it gives back');
  assert.equal((await q(`select count(*)::int n from public.activity where action = 'payment_parked' and data->>'session' like $1`, [`${s.id}%`]))[0].n, 0, 'nothing kept aside twice');
  assert.equal((await q(`select sum(amount_cents)::int s from public.payments where split_part(stripe_session, '#', 1) = $1`, [s.id]))[0].s, 0, 'the books say what Stripe holds: nothing');
});

test('refund-no-key-loops: a refund notice while the garage has no Stripe key is written for the owner and answered 2xx (no retry loop)', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  const p = await fn('client', { action: 'pay', token: t, base: BASE });
  const sid = sessionOf(p.url);
  assert.equal((await mockGet(`/pay/${sid}`)).hook, 200);
  const key = (await q(`select value from public.secrets where key = 'stripe_key'`))[0].value;
  await q(`delete from public.secrets where key = 'stripe_key'`);
  let r;
  try { r = await mockGet(`/refund/${sid}?amount=1000&twice=1`); }
  finally { await q(`insert into public.secrets (key, value) values ('stripe_key', $1) on conflict (key) do update set value = excluded.value`, [key]); }
  assert.equal(r.hook, 200, r.result);
  const pi = (await stripeSession(sid)).payment_intent;
  assert.equal((await q(`select count(*)::int n from public.activity where action = 'payment_parked' and data->>'session' = $1`, [`refund:${pi}`]))[0].n, 1, 'the owner sees it, once');
});

test('notify-op-parallel: two sends with the same op at once while texts fail: neither is told the text went', async () => {
  const { job } = await newJob();
  await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed')`, [job]);
  const op = randomUUID();
  await fetch(`${MOCK}/control?ghl=fail`);
  let x, y;
  try { [x, y] = await Promise.all([fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt), fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt)]); }
  finally { await fetch(`${MOCK}/control?ghl=ok`); }
  assert.ok(x.ok !== true && y.ok !== true, 'nothing went: ' + JSON.stringify([x, y]));
  // the same op once texts work again: sent
  assert.equal((await fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt)).status, 'sent');
});

test('notify-op-parallel: two sends with the same op at once: both get the first one’s real answer (the text and its link)', async () => {
  const { job } = await newJob();
  await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed')`, [job]);
  const op = randomUUID();
  const [x, y] = await Promise.all([fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt), fn('notify', { kind: 'extras', job_id: job, base: BASE, op }, ownerJwt)]);
  assert.deepEqual([x.status, y.status], ['sent', 'sent'], JSON.stringify([x, y]));
  assert.equal(y.link, x.link);
  assert.equal(y.message, x.message);
});

/* ---------- round 2: the fake services (tests/stack/mocks.mjs) and GoHighLevel's time ---------- */

test('R205: the fake Stripe lists card pages a page at a time, newest first, like Stripe (limit, starting_after, has_more, created)', async () => {
  // an account of its own: nothing another test left behind is in its lists
  const sk = { authorization: `Bearer sk_test_liste${randomUUID().replace(/-/g, '')}`, 'content-type': 'application/x-www-form-urlencoded' };
  const make = async (cents) => (await (await fetch(`${MOCK}/stripe/v1/checkout/sessions`, { method: 'POST', headers: sk,
    body: new URLSearchParams({ 'line_items[0][price_data][unit_amount]': String(cents), 'metadata[job_id]': randomUUID() }) })).json()).id;
  const a = await make(1000), b = await make(2000), c = await make(3000);
  assert.equal((await (await fetch(`${MOCK}/age/${a}?hours=1`)).json()).ok, true);   // a is an hour old
  const list = async (qs) => (await fetch(`${MOCK}/stripe/v1/checkout/sessions?${qs}`, { headers: sk })).json();
  const p1 = await list('limit=2');
  assert.deepEqual([p1.data.map((x) => x.id), p1.has_more], [[c, b], true], 'newest first, two of them, more to come');
  assert.ok(p1.data.every((x) => Number.isInteger(x.created)), 'created in seconds');
  const p2 = await list(`limit=2&starting_after=${p1.data[1].id}`);
  assert.deepEqual([p2.data.map((x) => x.id), p2.has_more], [[a], false]);
  const since = Math.floor(Date.now() / 1000) - 600;
  const recent = await list(`limit=100&created%5Bgte%5D=${since}`);
  assert.deepEqual([recent.data.map((x) => x.id).sort(), recent.has_more], [[b, c].sort(), false], 'created[gte] leaves out the hour-old page');
  assert.equal((await list('')).data.length, 3, 'ten at most when no limit is said');
  assert.equal((await fetch(`${MOCK}/stripe/v1/checkout/sessions?limit=101`, { headers: sk })).status, 400, 'over 100: refused, like Stripe');
});

test('R206: the fake Stripe can refuse the key (401): the customer is told to pay on site; a GitHub ticket can carry the repository’s numbers', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  await fetch(`${MOCK}/control?stripe=refuse`);
  let r, raw;
  try {
    raw = await fetch(`${MOCK}/stripe/v1/checkout/sessions/cs_test_x`, { headers: { authorization: 'Bearer sk_test_abcdefghijklmnop' } });
    r = await fn('client', { action: 'pay', token: t, base: BASE });
  } finally { await fetch(`${MOCK}/control?stripe=ok`); }
  assert.equal(raw.status, 401);
  assert.match((await raw.json()).error.message, /Invalid API Key provided/);
  assert.deepEqual([r.status, r.ok, r.code], [502, false, 'pay_unavailable'], JSON.stringify(r));
  const claims = async (o) => JSON.parse(Buffer.from((await (await fetch(`${MOCK}/github/token?${new URLSearchParams(o)}`)).json()).value.split('.')[1], 'base64url'));
  const withIds = await claims({ repository: 'hostnextline/garage2.0-sauvegardes', repository_id: '123456', repository_owner_id: '7890' });
  assert.deepEqual([withIds.repository_id, withIds.repository_owner_id], ['123456', '7890']);
  const without = await claims({ repository: 'hostnextline/garage2.0-sauvegardes' });
  assert.deepEqual(['repository_id' in without, 'repository_owner_id' in without], [false, false], 'as before when not given');
});

test('R208: a slow GoHighLevel: the send stops within its budget (the app is answered before it gives up at 20 s) and the call given up is really stopped', async () => {
  const { job } = await newJob();
  await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed')`, [job]);
  await clearLog();
  // each of the two calls of one text takes 9 s: 18 s in all, each under the old 15 s limit (the text « went » after the
  // app had given up, and the person sent it again)
  await fetch(`${MOCK}/control?ghl_ms=9000`);
  const t0 = Date.now();
  let r;
  try { r = await fn('notify', { kind: 'extras', job_id: job, base: BASE }, ownerJwt); } finally { await fetch(`${MOCK}/control?ghl_ms=0`); }
  const took = Date.now() - t0;
  assert.ok(took < 18500, `answered in ${took} ms`);
  assert.deepEqual([r.ok, r.status], [false, 'error'], JSON.stringify(r));
  assert.equal((await q(`select status from public.messages where job_id = $1 and kind = 'extras'`, [job]))[0]?.status, 'failed', 'the team sees « not sent »');
  // the mock answers the stopped call 9 s after it started (at about 18 s): wait for it
  await new Promise((res) => setTimeout(res, Math.max(0, t0 + 18500 - Date.now())));
  const ghl = (await mockLog()).filter((m) => m.svc === 'ghl' && m.path === '/conversations/messages');
  assert.deepEqual(ghl.map((m) => m.aborted === true), [true], 'the text call was stopped, never sent behind the answer: ' + JSON.stringify(ghl));
  assert.equal((await fn('notify', { kind: 'extras', job_id: job, base: BASE }, ownerJwt)).status, 'sent', 'GoHighLevel back: the text goes');
});

test('compat: on a database where the new migrations are not applied yet (no op_begin), the customer still gets a card page', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  await q(`alter function public.op_begin(uuid, text) rename to op_begin_pas_encore`);
  let p;
  try { p = await fn('client', { action: 'pay', token: t, base: BASE }); }
  finally { await q(`alter function public.op_begin_pas_encore(uuid, text) rename to op_begin`); }
  assert.ok(p.ok && p.url, JSON.stringify(p));
  assert.equal((await openPages(job)).length, 1);
  assert.equal((await fn('client', { action: 'pay', token: t, base: BASE })).url, p.url, 'the same page again once op_begin is back');
});

test('x-errors-19 (secrets): the database not answering is never « card payment not offered »: 500 with a reference, and it works again after', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  await q(`revoke select on public.secrets from service_role`);
  let v, p;
  try {
    v = await fn('client', { action: 'view', token: t });
    p = await fn('client', { action: 'pay', token: t, base: BASE });
  } finally { await q(`grant select on public.secrets to service_role`); }
  assert.deepEqual([v.status, v.code], [500, 'server'], 'not a page without « Payer »: ' + JSON.stringify(v).slice(0, 200));
  assert.deepEqual([p.status, p.code], [500, 'server'], 'not « no_stripe »: ' + JSON.stringify(p));
  const again = await fn('client', { action: 'view', token: t });
  assert.equal(again.pay.available, true, JSON.stringify(again.pay));
});

test('x-errors-19 (answer, sign): a read that fails is never « this proposal no longer exists » or « signed as Client », and an electronic signature never goes without its proof', async () => {
  const { job } = await newJob();
  const t = await linkFor(job);
  const extra = (await q(`insert into public.job_items (job_id, description, unit_cents, status) values ($1, 'Plaquettes', 12000, 'proposed') returning id`, [job]))[0].id;
  await q(`revoke select on public.job_items from service_role`);
  let r;
  try { r = await fn('client', { action: 'answer', token: t, item_id: extra, accept: true, confirm: true }); }
  finally { await q(`grant select on public.job_items to service_role`); }
  assert.deepEqual([r.status, r.code], [500, 'server'], 'not « gone »: ' + JSON.stringify(r));
  assert.equal((await q(`select status from public.job_items where id = $1`, [extra]))[0].status, 'proposed');
  assert.equal((await fn('client', { action: 'answer', token: t, item_id: 'pas-un-id', accept: true, confirm: true })).code, 'gone', 'a wrong id is still « gone »');
  // the proof of the signature cannot be written: nothing is signed
  await q(`revoke insert on public.activity from service_role`);
  let s;
  try { s = await fn('client', { action: 'sign', token: t, click: true, confirm: true }); }
  finally { await q(`grant insert on public.activity to service_role`); }
  assert.deepEqual([s.status, s.code], [500, 'server'], JSON.stringify(s));
  assert.deepEqual(Object.values((await q(`select estimate_signed_at, waiver_signed_at from public.jobs where id = $1`, [job]))[0]), [null, null], 'not signed without its proof');
  const ok = await fn('client', { action: 'sign', token: t, click: true, confirm: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.estimate.signer, 'Luc Gagnon', 'signed in the name on the file');
  assert.equal((await q(`select count(*)::int n from public.activity where entity_id = $1 and action = 'signed_online'`, [job]))[0].n, 1);
});

test('x-errors-19 (notify): « the mechanic is here » never texts an amount due that forgot a payment because a read failed', async () => {
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  await q(`update public.jobs set status = 'on_site' where id = $1`, [job]);
  await q(`insert into public.payments (job_id, amount_cents, method) values ($1, 5000, 'cash')`, [job]);   // paid ahead
  // a garage whose text says what is left to pay
  const [{ arrived: tpl }] = await q(`select messages->'fr'->'arrived' arrived from public.settings where id = 1`);
  await q(`update public.settings set messages = jsonb_set(messages, '{fr,arrived}', '"Reste à payer : {montant} {lien}"') where id = 1`);
  try {
    await clearLog();
    await q(`revoke select on public.payments from service_role`);
    let r;
    try { r = await fn('notify', { kind: 'arrived', job_id: job, base: BASE }, ownerJwt); }
    finally { await q(`grant select on public.payments to service_role`); }
    assert.deepEqual([r.status, r.code], [500, 'server'], JSON.stringify(r));
    assert.equal((await mockLog()).filter((m) => m.svc === 'ghl' && m.path === '/conversations/messages').length, 0, 'nothing texted');
    const ok = await fn('notify', { kind: 'arrived', job_id: job, base: BASE }, ownerJwt);
    assert.equal(ok.status, 'sent', JSON.stringify(ok));
    assert.match(ok.message, /^Reste à payer : 122,46\s\$/, 'what is left to pay (172,46 $ − 50,00 $): ' + ok.message);
  } finally {
    await q(`update public.settings set messages = jsonb_set(messages, '{fr,arrived}', $1::jsonb) where id = 1`, [JSON.stringify(tpl)]);
  }
});

test('argent-serveur-02: the amount changes and changes back within ten minutes: « Payer » opens a page that can still be paid (Stripe gives back its first answer for the same key)', async () => {
  const payable = async (url) => (await stripeSession(sessionOf(url))).status === 'open';
  // the same words: Stripe gives back the answer it saved (« open » then), the page has been closed since
  const { job, items } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 8000 }] });
  const t = await linkFor(job);
  const p1 = await fn('client', { action: 'pay', token: t, base: BASE });
  const extra = (await q(`insert into public.job_items (job_id, description, unit_cents, sort) values ($1, 'Balais', 2500, 4) returning id`, [job]))[0].id;
  const p2 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p2.url !== p1.url && !(await payable(p1.url)), 'the first page is closed');
  await q(`update public.job_items set deleted_at = now() where id = $1`, [extra]);   // « no blades »: the first amount again
  const p3 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.ok(p3.ok && p3.url, JSON.stringify(p3));
  assert.ok(await payable(p3.url), 'a page that can be paid: ' + JSON.stringify(await stripeSession(sessionOf(p3.url))));
  assert.equal((await fetch(p3.url + '?quiet=1')).status, 200, 'the customer can pay it');
  // other words since (the mechanic is there now: « Travaux du … »): Stripe refuses the same key, a new page is made
  const b = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 8100 }] });
  const tb = await linkFor(b.job);
  await fn('client', { action: 'pay', token: tb, base: BASE });
  const xb = (await q(`insert into public.job_items (job_id, description, unit_cents, sort) values ($1, 'Balais', 2500, 4) returning id`, [b.job]))[0].id;
  await fn('client', { action: 'pay', token: tb, base: BASE });
  await q(`update public.job_items set deleted_at = now() where id = $1`, [xb]);
  await q(`update public.jobs set status = 'on_site' where id = $1`, [b.job]);
  const r = await fn('client', { action: 'pay', token: tb, base: BASE });
  assert.ok(r.ok && r.url, 'not « pay_unavailable »: ' + JSON.stringify(r));
  assert.ok(await payable(r.url));
  void items;
});

test('argent-serveur-03: a job « Payé par le Coffre » while the mechanic is still there: no « Payer » by card on the customer’s page', async () => {
  const { job } = await newJob({ items: [{ description: 'Freins', unit_cents: 15000 }] });
  await q(`update public.jobs set status = 'on_site' where id = $1`, [job]);
  const t = await linkFor(job);
  assert.equal((await fn('client', { action: 'view', token: t })).pay.available, true, 'before the Coffre: payable');
  await rpc('coffre_add', { p_op: randomUUID(), p_jobs: [job], p_amount: 0, p_note: 'Le frère du patron' }, ownerJwt);
  const [{ coffre_id: box }] = await q(`select coffre_id from public.jobs where id = $1`, [job]);
  try {
    assert.ok(box, 'in the Coffre');
    const v = await fn('client', { action: 'view', token: t });
    assert.equal(v.pay.available, false, JSON.stringify(v.pay));
    const p = await fn('client', { action: 'pay', token: t, base: BASE });
    assert.deepEqual([p.ok, p.code], [false, 'nothing'], JSON.stringify(p));
    assert.equal((await openPages(job)).length, 0, 'no card page made');
  } finally {
    await q(`update public.jobs set coffre_id = null where id = $1`, [job]);
    await q(`delete from public.coffre where id = $1`, [box]);
  }
});

test('argent-serveur-02, the other side: a page paid by a slow means (complete, not paid yet) stays the one page: never a second page to pay meanwhile', async () => {
  const { job } = await newJob({ items: [{ description: 'Vidange d’huile', unit_cents: 8200 }] });
  const t = await linkFor(job);
  const p1 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.equal((await mockGet(`/complete/${sessionOf(p1.url)}`)).ok, true);
  const p2 = await fn('client', { action: 'pay', token: t, base: BASE });
  assert.equal(p2.url, p1.url, JSON.stringify(p2));
  assert.equal((await openPages(job)).length, 0, 'no other page to pay');
});
