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
  const cell = page.locator('[data-testid^="bp-cell-"]:not([disabled])').first();
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
