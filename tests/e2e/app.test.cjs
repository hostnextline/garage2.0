// The whole app, end to end, on the local copy of the server: the production build, real sign-in, the real
// database rules, real writes. The database is saved before and put back exactly as it was after.
//   bash tests/stack/start.sh && node --test tests/e2e/app.test.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness.cjs');

const PW = 'Garage-e2e-2026';
const who = {};
let originalCounts;
const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const SVC_OIL = '5e7a0000-0000-4000-8000-000000000001';
let julie, jobId;

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  who.owner = { email: `hassan-${n}@test.local`, id: await h.makePerson({ email: `hassan-${n}@test.local`, password: PW, name: 'Hassan Jeha', short: 'Hassan', roles: ['owner'] }) };
  who.saleh = { email: `saleh-${n}@test.local`, id: await h.makePerson({ email: `saleh-${n}@test.local`, password: PW, name: 'Saleh Ismail', short: 'Saleh', roles: ['mechanic'], truck: 'Camion Complet' }) };
  who.nadia = { email: `nadia-${n}@test.local`, id: await h.makePerson({ email: `nadia-${n}@test.local`, password: PW, name: 'Nadia Bureau', short: 'Nadia', roles: ['office'] }) };
  who.louis = { email: `louis-${n}@test.local`, id: await h.makePerson({ email: `louis-${n}@test.local`, password: PW, name: 'Louis Comptes', short: 'Louis', roles: ['treasurer'] }) };
  julie = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('Julie', 'Tremblay', '514 555-0141', '1250 rue Graham, Mont-Royal, QC', 'H3P 2C9', 45.5205, -73.6489, 'fr', true) returning id`);
  h.buildApp();
  await h.startApp();
});
after(async () => {
  await h.closeAll();
  h.stopApp();
  h.restoreDb();
  const now = h.rowCounts();
  const diff = Object.keys(originalCounts).filter((k) => originalCounts[k] !== now[k]);
  assert.deepEqual(diff, [], 'the database is back exactly as it was');
});

// a failing step leaves a picture of every open page (tests/out/fail-*.png)
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
const step = (name, fn) => test(name, async () => {
  try { await fn(); }
  catch (e) {
    let i = 0;
    for (const p of pages) {
      const tag = `fail-${name.slice(0, 20).replace(/\W+/g, '-')}-${i++}`;
      try { await h.shot(p, tag); } catch { /* closed */ }
      try { require('node:fs').writeFileSync(require('node:path').join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
    }
    throw e;
  }
});
const dismissSheets = async (page) => { for (let i = 0; i < 3; i++) { if (await page.locator('[role=dialog]').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
h.openW = async (o) => { const r = await h.open(o); watch(r.page); return r; };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'no page errors');

step('the office books Julie: customer, service, block, truck; the job is on the agenda', async () => {
  const { page } = await h.openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + '#/book');
  await page.getByTestId('book-screen').waitFor();
  await page.getByTestId('customer-search').fill('Julie');
  await page.getByTestId('customer-option').first().click();
  await page.getByTestId('customer-picked').waitFor();
  await page.getByTestId(`svc-${SVC_OIL}`).click();
  await page.locator('[data-testid="book-options"] summary').click();
  await page.locator('[data-testid="book-options"] button.chip', { hasText: 'Camion Complet' }).click();
  // the server suggests blocks near Julie: take the first one
  await page.getByTestId('bp-sugg').first().click();
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  await h.shot(page, 'e2e-1-booked');
  const row = h.sql(`select id || '|' || status || '|' || coalesce(truck_id::text, '') || '|' || duration_min from public.jobs where customer_id = '${julie}'`).split('|');
  jobId = row[0];
  assert.deepEqual([row[1], row[2]], ['booked', T.complet]);
  assert.equal(Number(h.sql(`select count(*) from public.job_items where job_id = '${jobId}' and service_id = '${SVC_OIL}'`)), 1);
  // no text service connected: the app gives the message to send by hand (never fails silently)
  await dismissSheets(page);
  await page.goto(h.APP + '#/agenda');
  await page.getByTestId('agenda-screen').waitFor();
  assert.ok(await page.getByText('Julie').first().isVisible(), 'Julie is on the agenda');
  noErrors(page);
  await page.context().close();
});

step('Saleh’s day: start, I’m leaving, I’ve arrived, signature, invoice, cash with change, finished', async () => {
  const { page } = await h.openW({ kind: 'phone' });
  await h.signIn(page, who.saleh.email, PW);
  await page.getByTestId('today-screen').waitFor();
  await page.getByTestId('shift-start').click();
  await page.getByTestId('shift-end').waitFor();
  // the job may be later today: open it from the agenda of its day
  await page.goto(h.APP + `#/job/${jobId}`);
  await page.getByTestId('job-screen').waitFor();
  const day = h.sql(`select day::text from public.jobs where id = '${jobId}'`);
  const today = h.sql(`select public.local_today()::text`);
  if (day !== today) h.sql(`update public.jobs set day = public.local_today(), block = 'am' where id = '${jobId}'`) && await page.reload();
  await page.getByTestId('step-leave').click();
  // texts not connected: the message with the tracking link is ready to send by hand
  await page.getByTestId('text-outcome').waitFor({ timeout: 15000 }).catch(() => undefined);
  await dismissSheets(page);
  await page.getByTestId('step-arrive').click();
  // « Je suis arrivé » sends the invoice to pay during the work (texts not connected: the message is ready to send by hand)
  await page.getByTestId('text-outcome').waitFor({ timeout: 15000 });
  assert.match(await page.getByTestId('text-outcome-message').innerText(), /Votre facture : [\d ,]+\$ taxes incluses/);
  await dismissSheets(page);
  await page.getByTestId('step-waiver').click();
  await page.getByTestId('waiver-sheet').waitFor();
  const pad = await page.getByTestId('waiver-pad').locator('canvas').boundingBox();
  await page.mouse.move(pad.x + 30, pad.y + pad.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + 30 + i * 18, pad.y + pad.height / 2 + (i % 2 ? -22 : 22));
  await page.mouse.up();
  await page.getByTestId('waiver-save').click();
  await page.getByTestId('step-invoice').click();
  await page.getByTestId('invoice-finish').click({ timeout: 15000 });
  await page.getByTestId('step-pay').click({ timeout: 15000 });
  await page.getByTestId('pay-sheet').waitFor();
  await page.getByTestId('pay-cash').click();
  const due = Number(h.sql(`select total_cents from public.invoices where job_id = '${jobId}' and status = 'issued'`));
  // « Montant reçu »: a bill bigger than what is due; the change is shown and only what is due is recorded
  await page.locator('[data-testid="pay-sheet"] input.input-money').nth(1).fill(String(Math.ceil(due / 100) + 10));
  await page.getByTestId('pay-change').waitFor();
  await page.getByTestId('pay-confirm').click();
  await page.getByTestId('step-finish').click({ timeout: 15000 });
  await page.getByTestId('stamp-paid').waitFor({ timeout: 15000 });
  await h.shot(page, 'e2e-2-done');
  const j = h.sql(`select status || '|' || (waiver_signed_at is not null) from public.jobs where id = '${jobId}'`);
  assert.equal(j, 'done|true');
  const inv = h.sql(`select status || '|' || number || '|' || total_cents || '|' || paid_cents from public.invoices where job_id = '${jobId}' and status <> 'void'`).split('|');
  assert.equal(inv[0], 'paid');
  assert.equal(inv[2], inv[3], 'paid in full, not a cent more (the change was given back)');
  assert.equal(h.sql(`select method from public.payments where job_id = '${jobId}'`), 'cash');
  assert.equal(Number(h.sql(`select count(*) from public.attachments where job_id = '${jobId}' and kind = 'signature'`)), 1);
  noErrors(page);
  await page.context().close();
});

step('the customer’s page: the appointment, the invoice paid, in the customer’s language', async () => {
  const s = await (await fetch(`${h.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: who.owner.email, password: PW }) })).json();
  const r = await (await fetch(`${h.API}/functions/v1/notify`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'invoice', job_id: jobId, base: h.APP }) })).json();
  assert.ok(r.link, 'a link to the customer page: ' + JSON.stringify(r));
  const { page } = await h.openW({ kind: 'phone' });
  await page.goto(r.link);
  await page.getByTestId('client-appointment').waitFor({ timeout: 15000 });
  await page.getByText(/Payé|Paid/).first().waitFor();
  await h.shot(page, 'e2e-3-client');
  noErrors(page);
  await page.context().close();
});

step('no signal: the office books anyway; the booking leaves when the signal is back', async () => {
  const { ctx, page } = await h.openW({ kind: 'phone' });
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + '#/book');
  await page.getByTestId('book-screen').waitFor();
  await page.getByTestId('customer-search').fill('Julie');
  await page.getByTestId('customer-option').first().click();
  await page.getByTestId(`svc-${SVC_OIL}`).click();
  await ctx.setOffline(true);
  // no suggestions without signal: pick a day in the calendar (tomorrow's afternoon on Camion Complet's next working day)
  // (a block already started, full or closed says so with aria-disabled: the first one still open, whatever the hour)
  const cell = page.locator('[data-testid^="bp-cell-"]:not([disabled]):not([aria-disabled="true"])').first();
  await cell.click();
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('sync-chip').waitFor();
  await page.waitForTimeout(2500);
  const before = Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}'`));
  assert.equal(before, 1, 'nothing reached the server while offline');
  await ctx.setOffline(false);
  for (let i = 0; i < 40 && Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}'`)) < 2; i++) await page.waitForTimeout(500);
  assert.equal(Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}'`)), 2, 'sent once the signal came back');
  await h.shot(page, 'e2e-4-offline-sent');
  noErrors(page);
  await ctx.close();
});

step('rights: each person sees and does only what is theirs', async () => {
  // a mechanic: no team, no settings
  let { page, ctx } = await h.openW({ kind: 'desktop' });
  await h.signIn(page, who.saleh.email, PW);
  assert.equal(await page.getByTestId('nav-team').count(), 0);
  assert.equal(await page.getByTestId('nav-settings').count(), 0);
  await page.goto(h.APP + '#/team');
  await page.getByText(/n’as pas accès|don’t have access/).first().waitFor();
  await ctx.close();
  // the office: no treasury (the owner's choice in the old app)
  ({ page, ctx } = await h.openW({ kind: 'desktop' }));
  await h.signIn(page, who.nadia.email, PW);
  assert.equal(await page.getByTestId('nav-treasury').count(), 0);
  await ctx.close();
  // the treasurer: the report, the numbers; an expense goes to the database
  ({ page, ctx } = await h.openW({ kind: 'desktop' }));
  await h.signIn(page, who.louis.email, PW);
  await page.goto(h.APP + '#/treasury');
  await page.getByTestId('treasury-report').waitFor({ timeout: 15000 });
  await page.goto(h.APP + '#/treasury?add=1');
  await page.getByTestId('expense-sheet').waitFor();
  await page.getByTestId('expense-vendor').fill('Lordco Pièces d’auto');
  await page.locator('[data-testid="expense-sheet"] input.input-money').first().fill('114,98');
  await page.getByTestId('expense-save').click();
  for (let i = 0; i < 20 && !Number(h.sql(`select count(*) from public.expenses where vendor like 'Lordco%'`)); i++) await page.waitForTimeout(500);
  const ex = h.sql(`select subtotal_cents || '|' || tps_cents || '|' || tvq_cents || '|' || total_cents from public.expenses where vendor like 'Lordco%'`).split('|').map(Number);
  assert.equal(ex[3], 11498, 'the total typed');
  assert.equal(ex[0] + ex[1] + ex[2], ex[3], 'subtotal + taxes = total');
  noErrors(page);
  await ctx.close();
});

step('the owner: truck hours for one day, an invitation, the company name, an estimate without a customer, English', async () => {
  const { page, ctx } = await h.openW({ kind: 'desktop' });
  await h.signIn(page, who.owner.email, PW);
  // an estimate on the spot, no customer file
  await page.goto(h.APP + '#/quote/new');
  await page.getByTestId('quote-items').waitFor({ timeout: 15000 });
  await page.getByTestId('quote-contact').fill('Client au stationnement');
  await page.getByTestId('add-catalog').click();
  await page.getByTestId('catalog-sheet').waitFor();
  await page.getByTestId(`svc-${SVC_OIL}`).click();
  await page.getByTestId('catalog-add').click();
  const saved = () => Number(h.sql(`select count(*) from public.quotes where jsonb_array_length(items) >= 1 and contact_name = 'Client au stationnement'`));
  for (let i = 0; i < 40 && !saved(); i++) await page.waitForTimeout(500);
  assert.equal(saved(), 1, 'the estimate is saved with its line and the contact, no customer file needed');
  assert.ok(Number(h.sql(`select number from public.quotes where contact_name = 'Client au stationnement'`)) > 0, 'it got its number from the server');
  // the « fenêtre vitrée »: Voiture works Saturday 10 h to 12 h this week only (it is normally off on Saturdays)
  await page.goto(h.APP + `#/hours/${T.voiture}`);
  await page.getByTestId('hours-grid').waitFor();
  await page.getByTestId('hours-mode').locator('button').nth(1).click();
  const a = await page.locator('[data-testid="hours-grid"] [data-d="6"][data-u="600"]').boundingBox();
  const z = await page.locator('[data-testid="hours-grid"] [data-d="6"][data-u="690"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('hours-apply-btn').click();
  const sat = () => h.sql(`select ranges::text from public.truck_days where truck_id = '${T.voiture}' and extract(dow from day) = 6 and day >= public.local_today() and deleted_at is null order by day limit 1`);
  for (let i = 0; i < 20 && !sat(); i++) await page.waitForTimeout(500);
  assert.equal(sat(), '[[600, 720]]', 'this Saturday: 10 h to 12 h');
  assert.equal(h.sql(`select ranges::text from public.truck_week where truck_id = '${T.voiture}' and dow = 6`), '[]', 'the usual week is unchanged');
  // invite someone: the link comes back to share
  await page.goto(h.APP + '#/team');
  await page.getByTestId('team-invite').click();
  await page.getByTestId('invite-sheet').waitFor();
  await page.waitForTimeout(400);   // the sheet settles (a person doesn't type within the first few milliseconds)
  await page.getByTestId('invite-name').fill('Ezzo Test');
  await page.getByTestId('invite-email').fill(`ezzo-${Date.now().toString(36)}@test.local`);
  await page.getByTestId('invite-roles').locator('button', { hasText: 'Mécanicien' }).click();
  await page.getByTestId('invite-roles').locator('button', { hasText: 'Trésorier' }).click();
  await page.getByTestId('invite-sheet').locator('[data-testid="send-how"] button').last().click();
  await page.getByTestId('invite-send').click();
  await page.getByTestId('invite-link').waitFor({ timeout: 15000 });
  assert.equal(h.sql(`select array_to_string(roles, ',') from public.invitations where full_name = 'Ezzo Test'`), 'treasurer');
  await dismissSheets(page);
  // company name
  await page.goto(h.APP + '#/settings/company');
  await page.getByTestId('company-name').fill('Mécanique Mobile H.I.S (test)');
  await page.getByTestId('settings-save').click();
  for (let i = 0; i < 20 && !h.sql(`select company->>'name' from public.settings`).includes('(test)'); i++) await page.waitForTimeout(500);
  assert.equal(h.sql(`select company->>'name' from public.settings`), 'Mécanique Mobile H.I.S (test)');
  await ctx.close();
  // English
  const en = await h.openW({ kind: 'phone', locale: 'en-CA' });
  await h.signIn(en.page, who.owner.email, PW);
  await en.page.getByText('Today').first().waitFor();
  await h.shot(en.page, 'e2e-6-english');
  noErrors(en.page);
  await en.ctx.close();
});

/* ---------- the estimate signed online, the invoice at the door ---------- */
const jwtOf = async (email) => (await (await fetch(`${h.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
const callAs = async (jwt, name, body) => (await fetch(`${h.API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const rpcAs = async (jwt, name, args) => {
  const r = await fetch(`${h.API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
};
const draw = async (page, testid) => {
  const box = await page.getByTestId(testid).locator('canvas').boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + box.height / 2 + (i % 2 ? -22 : 22));
  await page.mouse.up();
};

step('the estimate signed online from the confirmation link; at the door nothing is left to sign; « Je suis arrivé » sends the invoice', async () => {
  const jwt = await jwtOf(who.owner.email);
  const karim = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('Karim', 'Haddad', '514 555-0199', '1000 rue Sherbrooke O, Montréal, QC', 'H3A 3G4', 45.5048, -73.5772, 'fr', true) returning id`);
  // a coming day when Camion Complet works
  const day = h.sql(`select d::date::text from generate_series(public.local_today() + 1, public.local_today() + 10, interval '1 day') d
    where exists (select 1 from public.truck_week w where w.truck_id = '${T.complet}' and w.dow = extract(dow from d) and jsonb_array_length(w.ranges) > 0) limit 1`);
  const b = await rpcAs(jwt, 'book_job', { p_op: require('node:crypto').randomUUID(), p_job: { customer_id: karim, day, block: 'pm', truck_id: T.complet, duration_min: 60 },
    p_items: [{ description: 'Promo : pneus non montés + huile + inspection', unit_cents: 19999, duration_min: 60 }] });
  const n = await callAs(jwt, 'notify', { kind: 'booking', job_id: b.job_id, base: h.APP });
  assert.ok(n.link, JSON.stringify(n));
  assert.match(n.message, /, l’après-midi \(entre 12 h et 16 h\)\. Estimation : 229,94 \$ taxes incluses\. Pour voir et signer votre estimation : http/);
  // the customer's phone: the estimate, the conditions, the finger, « J'accepte », « Signer »
  const { page } = await h.openW({ kind: 'phone' });
  await page.goto(n.link);
  await page.getByTestId('client-sign-open').click({ timeout: 15000 });
  await page.getByTestId('client-sign-submit').click();
  await page.getByText('Écrivez votre nom.').waitFor();
  await page.getByTestId('client-sign-name').fill('Karim Haddad');
  await draw(page, 'client-sign-pad');
  await page.getByTestId('client-sign-agree').check();
  await h.shot(page, 'e2e-7-client-sign');
  await page.getByTestId('client-sign-submit').click();
  await page.getByTestId('client-signed').waitFor({ timeout: 15000 });
  await h.shot(page, 'e2e-7-client-signed');
  assert.equal(h.sql(`select waiver_via || '|' || estimate_signer || '|' || estimate_cents from public.jobs where id = '${b.job_id}'`), 'online|Karim Haddad|22994');
  assert.equal(h.sql(`select kind from public.attachments where id = (select estimate_attachment from public.jobs where id = '${b.job_id}')`), 'signature');
  // the day comes: Saleh leaves, arrives; nothing to sign at the door; the invoice goes to the customer
  h.sql(`update public.jobs set day = public.local_today(), block = 'am' where id = '${b.job_id}'`);
  const m = await h.openW({ kind: 'phone' });
  await h.signIn(m.page, who.saleh.email, PW);
  await m.page.goto(h.APP + `#/job/${b.job_id}`);
  await m.page.getByTestId('job-screen').waitFor();
  await m.page.getByTestId('waiver-state').getByText(/Signée en ligne par Karim Haddad/).waitFor();
  await m.page.getByTestId('step-leave').click();
  await m.page.getByTestId('text-outcome').waitFor({ timeout: 15000 }).catch(() => undefined);
  await dismissSheets(m.page);
  await m.page.getByTestId('step-arrive').click();
  await m.page.getByTestId('text-outcome').waitFor({ timeout: 15000 });
  assert.match(await m.page.getByTestId('text-outcome-message').innerText(), /^Bonjour Karim, Saleh de Mécanique Mobile H\.I\.S( \(test\))? est arrivé\. Votre facture : 229,94 \$ taxes incluses\. Détails : http/);
  await dismissSheets(m.page);
  await m.page.getByTestId('step-invoice').waitFor({ timeout: 15000 });
  assert.equal(await m.page.getByTestId('step-waiver').count(), 0, 'already signed online: no signature at the door');
  await h.shot(m.page, 'e2e-7-mechanic-arrived');
  assert.equal(h.sql(`select status || '|' || total_cents from public.invoices where job_id = '${b.job_id}'`), 'draft|22994');
  // the customer's page: the invoice of the work, while the mechanic is there
  await page.reload();
  await page.getByTestId('client-bill').waitFor({ timeout: 15000 });
  assert.match(await page.getByTestId('client-expected').innerText(), /229,94/);
  await h.shot(page, 'e2e-7-client-bill');
  noErrors(page); noErrors(m.page);
  await page.context().close(); await m.page.context().close();
});

/* ---------- the look, the updates, no green mark at the top ---------- */
step('Mon compte: H.I.S light, dark or automatic; Réglages: « Vérifier les mises à jour »; nothing shown at the top when all is sent', async () => {
  const { page } = await h.openW({ kind: 'phone', scheme: 'light' });
  await h.signIn(page, who.owner.email, PW);
  await page.getByTestId('today-screen').waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.getByTestId('sync-chip').count(), 0, 'no « À jour » mark when everything is sent');
  await page.goto(h.APP + '#/account');
  await page.getByTestId('account-follow').getByRole('button', { name: /mien|own/i }).click().catch(async () => { await page.getByTestId('account-follow').locator('button').nth(1).click(); });
  await page.getByTestId('theme-his-dark').click();
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
  await h.shot(page, 'e2e-8-his-dark');
  await page.getByTestId('theme-his-light').click();
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'light');
  await page.getByTestId('theme-his-auto').click();
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'light');   // the phone is light
  assert.equal(h.sql(`select prefs->'look'->>'mode' from public.staff where id = '${who.owner.id}'`), 'auto');
  await page.getByTestId('account-update').waitFor();
  await page.goto(h.APP + '#/settings/app');
  await page.getByTestId('settings-app').waitFor();
  await page.getByTestId('update-check').click();
  await page.getByTestId('update-none').waitFor({ timeout: 30000 });
  await h.shot(page, 'e2e-8-update');
  noErrors(page);
  await page.context().close();
});

/* ---------- a car without typing: the lists, and the VIN read by the camera ---------- */
step('a car without typing: Année → Marque → Modèle from the lists; the VIN barcode read by the camera fills the car', async () => {
  const { chromium, devices } = require('playwright');
  const { y4m } = require('./code39.cjs');
  // a camera that films the VIN label of a door frame (Code 39, like on the real sticker)
  const video = y4m(require('node:path').join(h.OUT, 'vin-door.y4m'), '1HGCM82633A004352', { module: 2 });
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  // no service worker here: the page's own requests to NHTSA are answered by the test (like NHTSA would)
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-CA', timezoneId: 'America/Toronto', serviceWorkers: 'block', permissions: ['camera'] });
  const asked = [];
  await ctx.route('https://vpic.nhtsa.dot.gov/**', (route) => {
    const u = route.request().url();
    asked.push(u);
    const type = /vehicletype\/(\w+)/.exec(u)?.[1];
    const models = type === 'car' ? ['Jetta', 'Golf', 'Passat', 'CC', 'Beetle'] : type === 'mpv' ? ['Tiguan', 'Touareg'] : [];
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ Count: models.length, Results: models.map((m) => ({ Make_Name: 'VOLKSWAGEN', Model_Name: m })) }) });
  });
  const page = watch(await ctx.newPage());
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  try {
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + `#/customer/${julie}`);
  await page.getByTestId('cars-panel').waitFor();
  // 1) by the lists: 2015 → Volkswagen → Jetta
  await page.getByTestId('car-add').click();
  await page.getByTestId('vadd-year').click();
  await page.getByTestId('carpick-year-2015').click();
  await page.getByTestId('carpick-make-Volkswagen').click();
  await page.getByTestId('carpick-model').filter({ hasText: 'Jetta' }).first().waitFor({ timeout: 15000 });
  await h.shot(page, 'e2e-9-models');
  assert.ok(asked.some((u) => /make\/volkswagen\/modelyear\/2015\/vehicletype\/car/.test(u)), 'the models of that year were asked');
  await page.getByTestId('carpick-model').filter({ hasText: 'Jetta' }).first().click();
  assert.equal(await page.getByTestId('vadd-model').innerText(), 'Jetta');
  await page.getByTestId('vehicle-add-ok').click();
  await page.getByTestId('car-row').filter({ hasText: 'Jetta' }).first().waitFor({ timeout: 15000 });
  const rowOf = async (sqlText) => { for (let i = 0; i < 40; i++) { const v = h.sql(sqlText); if (v) return v; await page.waitForTimeout(250); } return ''; };
  assert.equal(await rowOf(`select year || ' ' || make || ' ' || model from public.vehicles where customer_id = '${julie}' and model = 'Jetta'`), '2015 Volkswagen Jetta');
  // 2) by the VIN: the camera reads the door-frame barcode, the server says what car it is
  await page.getByTestId('car-add').click();
  await page.getByTestId('vehicle-add-mode').getByRole('button', { name: 'NIV' }).click();
  await page.getByTestId('vin-scan').click();
  await page.getByTestId('vin-scan-sheet').waitFor();
  await page.getByTestId('vin-photo').waitFor();
  // read live (ZXing, our own WebAssembly file): the sheet closes and the VIN is in the field
  await page.getByTestId('vin-scan-sheet').waitFor({ state: 'detached', timeout: 30000 });
  assert.equal(await page.getByTestId('vin-input').inputValue(), '1HGCM82633A004352');
  await page.getByTestId('vadd-make').getByText('Honda').waitFor({ timeout: 15000 });
  assert.equal(await page.getByTestId('vadd-year').innerText(), '2003');
  assert.equal(await page.getByTestId('vadd-model').innerText(), 'Accord');
  await h.shot(page, 'e2e-9-vin-read');
  await page.getByTestId('vehicle-add-ok').click();
  await page.getByTestId('car-row').filter({ hasText: 'Accord' }).first().waitFor({ timeout: 15000 });
  assert.equal(await rowOf(`select vin || ' ' || year || ' ' || make || ' ' || model from public.vehicles where customer_id = '${julie}' and vin is not null`), '1HGCM82633A004352 2003 Honda Accord');
  assert.deepEqual(page.errors, [], 'no page errors');
  } finally {
    await browser.close();
  }
});

/* ---------- « Plus »: the glass tiles, the filters, today in numbers ---------- */
step('Plus: a tile for each part the person may open, the filters, today in numbers, the first steps', async () => {
  const { page } = await h.openW({ kind: 'phone', scheme: 'dark' });
  await h.signIn(page, who.owner.email, PW);
  await page.getByTestId('tab-more').click();
  await page.getByTestId('more-screen').waitFor();
  // the owner opens everything: one tile per part of the app, my account in the header
  for (const k of ['today', 'agenda', 'map', 'customers', 'quotes', 'invoices', 'treasury', 'dashboard', 'hours', 'inventory', 'team', 'settings', 'guide']) {
    await page.getByTestId(`more-${k}`).waitFor();
  }
  await page.getByTestId('more-account').waitFor();
  await page.getByTestId('more-gear').waitFor();
  await page.getByTestId('more-help').waitFor();
  // today's numbers are the database's
  const day = h.sql(`select public.local_today()::text`);
  const count = (where) => h.sql(`select count(*) from public.jobs where day = '${day}' and deleted_at is null and ${where}`);
  assert.equal((await page.getByTestId('more-stat-booked').locator('.more-stat-n').innerText()).trim(), count(`status = 'booked'`));
  assert.equal((await page.getByTestId('more-stat-live').locator('.more-stat-n').innerText()).trim(), count(`status in ('en_route', 'on_site')`));
  assert.equal((await page.getByTestId('more-stat-done').locator('.more-stat-n').innerText()).trim(), count(`status = 'done'`));
  const owed = Number(h.sql(`select coalesce(sum(total_cents - paid_cents), 0) from public.invoices where status = 'issued' and deleted_at is null and total_cents > paid_cents`));
  const shown = (await page.getByTestId('more-stat-due').locator('.more-due-n').innerText()).replace(/[^\d,]/g, '').replace(',', '.');
  assert.equal(Math.round(Number(shown) * 100), owed, 'what customers still owe');
  // « Bureau »: only the office's parts, in the order of the menu
  await page.getByTestId('more-filter-office').click();
  const keys = await page.getByTestId('more-grid').locator('a').evaluateAll((l) => l.map((a) => a.dataset.testid));
  assert.deepEqual(keys, ['more-customers', 'more-quotes', 'more-invoices', 'more-treasury', 'more-dashboard']);
  await h.shot(page, 'e2e-10-plus-office');
  await page.getByTestId('more-filter-all').click();
  // the first steps still to do: the ring leads to « Par où commencer »
  await page.getByTestId('more-setup').click();
  await page.waitForFunction(() => location.hash === '#/guide');
  // a tile opens its part; back on « Plus », the filter chosen is kept
  await page.goto(h.APP + '#/more');
  await page.getByTestId('more-filter-office').click();
  await page.getByTestId('more-invoices').click();
  await page.waitForFunction(() => location.hash.startsWith('#/invoices'));
  await page.goBack();
  await page.getByTestId('more-filter-office').waitFor();
  assert.equal(await page.getByTestId('more-filter-office').getAttribute('aria-pressed'), 'true');
  noErrors(page);
  await page.context().close();
  // Saleh (mechanic): no team, no settings, no money he may not see; signing out still works from here
  const m = await h.openW({ kind: 'phone', scheme: 'light' });
  await h.signIn(m.page, who.saleh.email, PW);
  await m.page.goto(h.APP + '#/more');
  await m.page.getByTestId('more-screen').waitFor();
  await m.page.getByTestId('more-today').waitFor();
  assert.equal(await m.page.getByTestId('more-team').count(), 0);
  assert.equal(await m.page.getByTestId('more-settings').count(), 0);
  assert.equal(await m.page.getByTestId('more-gear').count(), 0);
  const canInvoices = await m.page.getByTestId('more-invoices').count();
  assert.equal(await m.page.getByTestId('more-stat-due').count(), canInvoices, 'the money owed only with the invoices');
  await h.shot(m.page, 'e2e-10-plus-mechanic');
  await m.page.getByTestId('sign-out').click();
  await m.page.getByTestId('login-email').waitFor({ timeout: 15000 });
  noErrors(m.page);
  await m.page.context().close();
});

/* ---------- behind the glass: the road at night, my own photo on this phone ---------- */
step('Behind the glass: the road at night through almost clear glass; my own photo on this phone, kept, then back to H.I.S', async () => {
  const { page } = await h.openW({ kind: 'phone', scheme: 'dark' });
  await h.signIn(page, who.owner.email, PW);
  await page.getByTestId('today-screen').waitFor();
  const backdrop = () => page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
  assert.match(await backdrop(), /his-night[^)]*\.webp/, 'the road at night behind the glass');
  // a pane lets the picture through: it only tints a little
  const alpha = await page.evaluate(() => {
    const m = getComputedStyle(document.querySelector('.panel.glass')).backgroundColor.match(/rgba\(([^)]+)\)/);
    return m ? Number(m[1].split(',')[3]) : 1;
  });
  assert.ok(alpha < 0.4, `the pane is almost clear (${alpha})`);
  // my photo (made here: a warm room), on this phone only
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 1800); g.addColorStop(0, '#6b4a33'); g.addColorStop(1, '#2a1c14'); x.fillStyle = g; x.fillRect(0, 0, 2400, 1800);
    x.fillStyle = '#c9a27a'; x.fillRect(240, 600, 840, 520); x.fillStyle = '#f2e3c9'; x.fillRect(1500, 500, 400, 280);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  });
  const file = require('node:path').join(h.OUT, 'my-photo.jpg');
  require('node:fs').writeFileSync(file, Buffer.from(b64, 'base64'));
  await page.goto(h.APP + '#/account');
  await page.getByTestId('account-backdrop').waitFor();
  await page.getByTestId('backdrop-file').setInputFiles(file);
  await page.waitForFunction(() => document.documentElement.dataset.photo === 'mine', null, { timeout: 15000 });
  assert.match(await backdrop(), /data:image\/jpeg/, 'my photo is behind the glass');
  const kept = await page.evaluate(() => { const s = localStorage.getItem('his.backdrop.photo') || ''; const i = new Image(); i.src = s; return i.decode().then(() => ({ kb: Math.round(s.length / 1024), w: i.naturalWidth, h: i.naturalHeight })); });
  assert.deepEqual([kept.w, kept.h], [1600, 1200], 'made smaller before it is kept');
  assert.ok(kept.kb < 600, `small enough for the phone (${kept.kb} KB)`);
  await h.shot(page, 'e2e-11-my-photo');
  // still there when the app opens again; nothing sent to the server
  await page.reload();
  await page.getByTestId('app').waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.photo === 'mine');
  assert.equal(h.sql(`select count(*) from public.staff where id = '${who.owner.id}' and prefs::text like '%data:image%'`), '0', 'the photo stays on the phone');
  // back to the H.I.S picture
  await page.goto(h.APP + '#/account');
  await page.getByTestId('backdrop-reset').click();
  await page.waitForFunction(() => !document.documentElement.dataset.photo);
  assert.match(await backdrop(), /his-night/);
  assert.equal(await page.evaluate(() => localStorage.getItem('his.backdrop.photo')), null);
  noErrors(page);
  await page.context().close();
});

step('The old address (GitHub Pages) tells the team where the app lives now; links made from there go to the app\'s home', async () => {
  const { chromium, devices } = require('playwright');
  // a browser that finds « hostnextline.github.io » on this computer: the same app, opened under its old address
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP hostnextline.github.io 127.0.0.1'] });
  try {
    const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'fr-CA', timezoneId: 'America/Toronto' });
    const page = watch(await ctx.newPage());
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    const OLD = 'http://hostnextline.github.io:4173/';
    const HOME = 'https://mecanique-mobile-his.vercel.app/';
    await page.goto(OLD);
    await page.getByTestId('login').waitFor();
    const note = page.getByTestId('moved-banner');
    await note.waitFor();
    assert.match(await note.innerText(), /nouvelle adresse : mecanique-mobile-his\.vercel\.app/);
    const open = page.getByTestId('moved-open');
    assert.equal(await open.getAttribute('href'), HOME, 'the button opens the new address');
    assert.equal(await open.getAttribute('target'), '_blank');
    const box = await note.boundingBox();
    assert.ok(box && box.width <= 390 && box.height < 260, `the note fits a phone (${JSON.stringify(box)})`);
    await h.shot(page, 'e2e-12-old-address-sign-in');
    // signed in: the note above every screen
    await page.getByTestId('login-email').fill(who.owner.email);
    await page.locator('input[type=password]').fill(PW);
    await page.getByTestId('login-submit').click();
    await page.getByTestId('app').waitFor({ timeout: 15000 });
    await page.getByTestId('moved-banner').waitFor();
    await h.shot(page, 'e2e-12-old-address-app');
    // the install guide gives the new address, not this one
    await page.goto(OLD + '#/guide');
    await page.getByTestId('guide-install').waitFor();
    assert.equal(await page.locator('[data-testid="guide-install"] .guide-url code').innerText(), HOME);
    assert.equal(await page.getByTestId('guide-install-open').getAttribute('href'), HOME);
    assert.equal(await page.getByTestId('guide-install').locator('ol').count(), 0, 'no steps to install the old address');
    // a link made from here (a team invitation) points to the app's home, never to the old address
    const jwt = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('his.auth')).access_token; } catch { return null; } });
    assert.ok(jwt, 'signed in on the old address');
    const r = await page.evaluate(async ([api, key, token, base]) => {
      const res = await fetch(api + '/functions/v1/team', { method: 'POST', headers: { 'content-type': 'application/json', apikey: key, authorization: 'Bearer ' + token },
        body: JSON.stringify({ action: 'invite', email: 'demenage-' + Date.now() + '@test.local', full_name: 'Test Déménagement', roles: ['mechanic'], lang: 'fr', base, send: 'none' }) });
      return res.json();
    }, [h.API, h.K.anon, jwt, OLD]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.link.startsWith(h.APP + '#invite='), `the link goes to the app's home: ${r.link}`);
    // hidden until the app is opened again
    await page.goto(OLD + '#/today');
    await page.getByTestId('moved-hide').click();
    await page.getByTestId('moved-banner').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByTestId('app').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByTestId('moved-banner').count(), 0, 'hidden for the rest of this visit');
    assert.deepEqual(page.errors, [], 'no page errors');
    // on the app's own address: no note
    const { page: home } = await h.openW({ kind: 'phone' });
    await home.goto(h.APP);
    await home.getByTestId('login').waitFor();
    await home.waitForTimeout(300);
    assert.equal(await home.getByTestId('moved-banner').count(), 0);
    await home.context().close();
  } finally {
    await b.close();
  }
});
