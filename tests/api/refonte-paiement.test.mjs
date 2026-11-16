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
  await fetch(`${MOCK}/control?stripe=ok&ghl=ok`);
});
after(async () => {
  await fetch(`${MOCK}/control?stripe=ok&ghl=ok`);
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
