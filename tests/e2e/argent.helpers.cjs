// The helpers of tests/e2e/argent.test.cjs (money end to end). Most are COPIES of small helpers that app.test.cjs keeps
// to itself (step with its pictures, openW, noErrors, dismissSheets, draw, until, jwtOf, callAs, rpcAs, blockNow): that
// file is not changed, so they are copied here as they are there. The others are this file's own: a job at the door, the
// red button and the kit's « confirm » buttons, the fake Stripe of tests/stack/mocks.mjs, the sums of the books.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const h = require('./harness.cjs');

const PW = 'Garage-e2e-2026';
// the fake outside services (tests/stack/mocks.mjs), as the harness names them (the lanes rewrite this address)
const MOCK = 'http://127.0.0.1:8021';
// this file's own Stripe account at the fake Stripe (each key is its own account there): nothing another test file
// leaves at the fake is ever in this file's lists
const STRIPE_KEY = 'sk_test_e2eArgent2026Money';
const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };

/* ---------- copied from app.test.cjs: a failing step leaves a picture of every open page (tests/out/fail-*.png) ---------- */
const pages = new Set();
const watch = (page) => {
  pages.add(page); page.on('close', () => pages.delete(page));
  // what the app asked the server, to understand a failure (written next to its picture)
  page.netlog = [];
  const t0 = Date.now();
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!/\/(rest|functions|auth)\/v1\//.test(u.pathname)) return;
    let rows = ''; try { const b = await r.json(); rows = Array.isArray(b) ? `rows=${b.length}` : ''; } catch { /* not json */ }
    page.netlog.push(`${Date.now() - t0}ms ${r.request().method()} ${u.pathname.replace(/^.*\/v1\//, '')}${u.search.length > 60 ? u.search.slice(0, 60) + '…' : u.search} ${r.status()} ${rows}`);
  });
  page.on('requestfailed', (r) => page.netlog.push(`${Date.now() - t0}ms FAILED ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page.netlog.push(`${Date.now() - t0}ms console.${m.type()} ${m.text().slice(0, 200)}`); });
  return page;
};
const run = (name, fn) => async () => {
  try { await fn(); }
  catch (e) {
    let i = 0;
    for (const p of pages) {
      const tag = `fail-${name.slice(0, 20).replace(/\W+/g, '-')}-${i++}`;
      try { await h.shot(p, tag); } catch { /* closed */ }
      try { writeFileSync(path.join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
    }
    // (this file's own addition) the pages of a failed step are closed: the next step's pictures show only its own pages
    for (const p of [...pages]) { try { await p.context().close(); } catch { /* closed */ } }
    throw e;
  }
};
const step = (name, fn) => test(name, run(name, fn));
/** a step that asserts the RIGHT behaviour but cannot pass yet: `why` starts with « BUG <id> » or « WAITS <request> » */
step.skip = (name, why, fn) => test(name, { skip: why }, run(name, fn));
const openW = async (o) => { const r = await h.open(o); watch(r.page); return r; };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'no page errors');
const dismissSheets = async (page) => { for (let i = 0; i < 3; i++) { if (await page.locator('[role=dialog]').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
/* a signature with the mouse: hover() first, so Playwright waits for the pad to be still (a sheet rising) and in view before
   the canvas is measured; then a zigzag */
const draw = async (page, testid) => {
  const canvas = page.getByTestId(testid).locator('canvas');
  await canvas.hover();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + box.height / 2 + (i % 2 ? -22 : 22));
  await page.mouse.up();
};
const until = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 500)); } return v; };
const jwtOf = async (email) => (await (await fetch(`${h.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
const callAs = async (jwt, name, body) => (await fetch(`${h.API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const rpcAs = async (jwt, name, args) => {
  const r = await fetch(`${h.API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(JSON.stringify(d)), d);
  return d;
};
/* today's block that is still on (the morning after noon is over: a job brought to today goes in the current block) */
const blockNow = () => h.sql(`select case when public.now_min() < 720 then 'am' when public.now_min() < 960 then 'pm' else 'eve' end`);

/* ---------- this file's own ---------- */
const q = (s) => String(s).replace(/'/g, "''");
const int = (s) => Number(h.sql(s) || 0);
const today = () => h.sql(`select public.local_today()::text`);
let vinSeq = 0;
/** a VIN of 17 characters nobody else has (no I, O, Q) */
const newVin = () => `2HGFC2F5${String(Date.now() % 1e6).padStart(6, '0')}${String(++vinSeq).padStart(3, '0')}`.slice(0, 17);

/** A customer with a car that has its VIN, and today's appointment on Camion Complet (Saleh's truck) with its work.
    `at`: 'on_site' = the mechanic is at the door and the authorization is signed (the existing steps of app.test.cjs
    follow « Je pars », « Je suis arrivé » and the signature on the screens; here they are the arrangement of the step:
    written with the timestamps those steps write, so one step never waits on another one's job); 'en_route' = on the way;
    'booked'. Returns { customer, vehicle, job, items: [ids], number }. */
function atDoor({ first, last, phone, items, at = 'on_site', lang = 'fr' }) {
  const customer = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('${q(first)}', '${q(last)}', '${q(phone)}', '4500 rue Saint-Denis, Montréal, QC', 'H2J 2L3', 45.5262, -73.5845, '${lang}', true) returning id`);
  const vehicle = h.sql(`insert into public.vehicles (customer_id, year, make, model, vin) values ('${customer}', 2019, 'Honda', 'Civic', '${newVin()}') returning id`);
  const job = h.sql(`insert into public.jobs (customer_id, vehicle_id, day, block, truck_id, status, duration_min)
    values ('${customer}', '${vehicle}', public.local_today(), '${blockNow()}', '${T.complet}', 'booked', 60) returning id`);
  const ids = items.map((it, i) => h.sql(`insert into public.job_items (job_id, description, unit_cents, qty, kind, status, taxable, sort)
    values ('${job}', '${q(it.description)}', ${it.unit_cents}, ${it.qty ?? 1}, '${it.kind ?? 'service'}', 'planned', true, ${i}) returning id`));
  if (at === 'en_route' || at === 'on_site') h.sql(`update public.jobs set status = 'en_route', started_at = now() - interval '25 minutes' where id = '${job}'`);
  if (at === 'on_site') {
    h.sql(`update public.jobs set status = 'on_site', arrived_at = now() - interval '10 minutes', waiver_signed_at = now() - interval '9 minutes',
      waiver_signer = '${q(`${first} ${last}`)}', waiver_version = '1' where id = '${job}'`);
  }
  return { customer, vehicle, job, items: ids, number: h.sql(`select number from public.jobs where id = '${job}'`) };
}
const invoiceRow = (job) => {
  const r = h.sql(`select id || '|' || status || '|' || coalesce(number::text, '') || '|' || total_cents || '|' || paid_cents || '|' || subtotal_cents || '|' || tps_cents || '|' || tvq_cents
    from public.invoices where job_id = '${job}' and status <> 'void' and deleted_at is null`);
  if (!r) return null;
  const [id, status, number, total, paid, subtotal, tps, tvq] = r.split('|');
  return { id, status, number, total: Number(total), paid: Number(paid), subtotal: Number(subtotal), tps: Number(tps), tvq: Number(tvq) };
};
/** the job's payments, oldest first: [method, cents, on the invoice?, by whom (staff id or '')] */
const paymentsOf = (job) => {
  const r = h.sql(`select coalesce(string_agg(p.method || ':' || p.amount_cents || ':' || (p.invoice_id is not null) || ':' || coalesce(p.created_by::text, ''), ',' order by p.paid_at, p.created_at), '')
    from public.payments p left join public.invoices v on v.id = p.invoice_id
    where p.deleted_at is null and (p.job_id = '${job}' or v.job_id = '${job}')`);
  return r ? r.split(',').map((x) => { const [m, c, on, by] = x.split(':'); return [m, Number(c), on === 'true', by]; }) : [];
};
const jobStatus = (job) => h.sql(`select status from public.jobs where id = '${job}'`);
/** what a money amount reads on the screen, in French: 22995 → /229,95\s\$/ (the space before the $ is a narrow one) */
const fr = (c) => new RegExp(`${c < 0 ? '[-−]\\s?' : ''}${Math.floor(Math.abs(c) / 100).toLocaleString('fr-CA').replace(/\s/g, '\\s')},${String(Math.abs(c) % 100).padStart(2, '0')}\\s\\$`);
/** 22995 → « 229,95 » (what a person types in a money field) */
const typed = (c) => `${Math.floor(c / 100)},${String(c % 100).padStart(2, '0')}`;

/* ---------- the kit's buttons ---------- */
/** a « confirm » button: the first tap arms it (it says the question), a second tap once its short pause is over does it.
    The pause shows as aria-disabled (ui/Button.tsx), which Playwright's click waits for; waiting for « is-armed » first
    makes sure the second tap is not taken before the first one was drawn. */
const tapTwice = async (loc) => {
  await loc.click();
  await loc.and(loc.page().locator('.is-armed')).waitFor({ timeout: 5000 });
  await loc.click();
};
/** the job's screen on a phone, signed in */
async function jobPhone(email, job, kind = 'phone') {
  const r = await openW({ kind });
  await h.signIn(r.page, email, PW);
  await r.page.goto(h.APP + `#/job/${job}`);
  await r.page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  return r;
}
/** « Faire la facture », then « Terminer la facture »: the invoice gets its number (screen and server) */
async function makeAndFinish(page, job) {
  await page.getByTestId('step-invoice').click({ timeout: 15000 });
  await page.getByTestId('invoice-finish').click({ timeout: 15000 });
  const inv = await until(() => invoiceRow(job), (v) => v && v.status === 'issued', 15000);
  assert.equal(inv?.status, 'issued', 'the invoice is finished on the server');
  await page.getByTestId('step-pay').waitFor({ timeout: 15000 });
  return inv;
}
/** the pay sheet's amount field (« Montant payé maintenant ») and, for cash, « Montant reçu » */
const amountField = (page) => page.locator('[data-testid="pay-sheet"] .pay-amount input.input-money').first();
const receivedField = (page) => page.getByTestId('pay-cash').locator('input.input-money');

/* ---------- the fake Stripe (tests/stack/mocks.mjs) ---------- */
const mockLog = async () => (await fetch(`${MOCK}/log`)).json();
const clearMock = () => fetch(`${MOCK}/log/clear`, { method: 'POST' });
const mockGet = async (p) => (await fetch(MOCK + p)).json();
/** the card page as the fake Stripe holds it (this file's account) */
const stripeSession = async (id) => (await fetch(`${MOCK}/stripe/v1/checkout/sessions/${id}`, { headers: { authorization: `Bearer ${STRIPE_KEY}` } })).json();
/** The customer's phone pays on Stripe's card page: the page opened by « Payer » is answered here like Stripe's own page
    would be (the fake marks the session paid and sends its signed notice to the garage TWICE — two notices about the same
    page — and the very same notice once more), then Stripe sends the browser back to the garage's page (its success_url).
    `paid` collects what the fake answered: { session, hook, result }. */
async function payOnStripe(page, paid) {
  await page.route(/\/pay\/cs_test_\w+/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const r = await mockGet(`/pay/${id}?twice=1&replay=1`);
    const s = await stripeSession(id);
    paid.push({ session: id, hook: r.hook, result: r.result, amount: s.amount_total, metadata: s.metadata });
    await route.fulfill({ status: 303, headers: { location: s.success_url } });
  });
}

/* ---------- the reconciliation's brake ---------- */
/** « Vérifier maintenant » runs at most once a minute for the whole garage (recon_now: rate_hit('recon_now', 60, 1), a
    window of the wall-clock minute). A step that checks twice within a minute takes that brake off first: the brake is
    the server's rule for a person tapping again and again, not what this test is about. */
const freeReconBrake = () => h.sql(`delete from public.rate_limits where key = 'recon_now'`);

module.exports = {
  PW, MOCK, STRIPE_KEY, T, step, openW, noErrors, dismissSheets, draw, until, jwtOf, callAs, rpcAs, blockNow,
  q, int, today, atDoor, invoiceRow, paymentsOf, jobStatus, fr, typed, tapTwice, jobPhone, makeAndFinish, amountField, receivedField,
  mockLog, clearMock, mockGet, stripeSession, payOnStripe, freeReconBrake, randomUUID
};
