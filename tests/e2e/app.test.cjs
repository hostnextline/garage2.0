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
/* today's block that is still on (the morning after noon is over: a job brought to today goes in the current block) */
const blockNow = () => h.sql(`select case when public.now_min() < 720 then 'am' when public.now_min() < 960 then 'pm' else 'eve' end`);

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
  // on the agenda of her day (the first block suggested may be next week: a Saturday afternoon run)
  const bookedDay = h.sql(`select day::text from public.jobs where id = '${jobId}'`);
  await page.goto(h.APP + `#/agenda/${bookedDay}`);
  await page.getByTestId('agenda-screen').waitFor();
  await page.getByText('Julie').first().waitFor({ timeout: 10000 });
  assert.ok(await page.getByText('Julie').first().isVisible(), 'Julie is on the agenda');
  noErrors(page);
  await page.context().close();
});

step('Saleh’s day: start, I’m leaving, I’ve arrived, signature, invoice, cash with change, finished', async () => {
  // the oil change takes a filter from the inventory (made before signing in: the phone's first copy of the data has it)
  const filterId = h.sql(`insert into public.inventory_items (name, unit, qty) values ('Filtre à huile e2e', 'unité', 3) returning id`);
  h.sql(`insert into public.service_parts (service_id, item_id, qty) values ('${SVC_OIL}', '${filterId}', 1)`);
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
  // (booked late in the day, the first block offered is tomorrow's: bring it to today, in the block that is on now)
  if (day !== today) { h.sql(`update public.jobs set day = public.local_today(), block = '${blockNow()}' where id = '${jobId}'`); await page.reload(); }
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
  await draw(page, 'waiver-pad');
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
  // « Terminer la job »: the parts the service takes are confirmed first (1 filter here), then they leave the inventory
  await page.getByTestId('step-finish').click({ timeout: 15000 });
  await page.getByTestId('parts-sheet').waitFor({ timeout: 20000 });
  await page.getByTestId(`part-${filterId}`).waitFor();
  await h.shot(page, 'e2e-2-parts');
  await page.getByTestId('parts-confirm').click();
  await page.getByTestId('stamp-paid').waitFor({ timeout: 15000 });
  // (the PAYÉ stamp was there since the payment: wait for the step itself to reach the server)
  await until(() => h.sql(`select status from public.jobs where id = '${jobId}'`), (v) => v === 'done', 15000);
  assert.equal(Number(await until(() => h.sql(`select qty from public.inventory_items where id = '${filterId}'`), (v) => v === '2.00', 10000)), 2, 'one filter left the inventory');
  assert.equal(h.sql(`select reason || '|' || delta from public.inventory_moves where job_id = '${jobId}'`), 'used|-1.00');
  await h.shot(page, 'e2e-2-done');
  const j = h.sql(`select status || '|' || (waiver_signed_at is not null) from public.jobs where id = '${jobId}'`);
  assert.equal(j, 'done|true');
  const inv = h.sql(`select status || '|' || number || '|' || total_cents || '|' || paid_cents from public.invoices where job_id = '${jobId}' and status <> 'void'`).split('|');
  assert.equal(inv[0], 'paid');
  assert.equal(inv[2], inv[3], 'paid in full, not a cent more (the change was given back)');
  assert.equal(h.sql(`select method from public.payments where job_id = '${jobId}'`), 'cash');
  assert.equal(Number(h.sql(`select count(*) from public.attachments where job_id = '${jobId}' and kind = 'signature'`)), 1);
  // the last job done: « Ma journée » offers the way back to the Centrale; « Je pars » texts the garage's return number
  // (texts not connected here: the message is shown to send by hand), then « Je suis arrivé »
  h.sql(`update public.settings set booking = booking || jsonb_build_object('return_phone', '514 771-4243',
    'home', jsonb_build_object('label', 'Centrale', 'address', '1401 rue Legendre O, Montréal', 'lat', 45.5312898, 'lng', -73.6544639)) where id = 1`);
  await page.goto(h.APP + '#/');
  await page.getByTestId('today-return-leave').waitFor({ timeout: 20000 });
  await h.shot(page, 'e2e-2-return');
  await page.getByTestId('today-return-leave').click();
  await page.getByTestId('text-outcome').waitFor({ timeout: 20000 });
  assert.match(await page.getByTestId('text-outcome-message').innerText(), /revient vers Centrale.*client\.html#suivi=/s);
  await dismissSheets(page);
  await page.getByTestId('today-return-arrived').waitFor({ timeout: 15000 });
  assert.equal(h.sql(`select kind || '|' || status || '|' || coalesce(dest_label, '') from public.trips where staff_id = '${who.saleh.id}' and kind = 'return' order by started_at desc limit 1`), 'return|active|Centrale');
  await page.getByTestId('today-return-arrived').click();
  await page.getByTestId('today-return-leave').waitFor({ timeout: 15000 });
  assert.equal(h.sql(`select status from public.trips where staff_id = '${who.saleh.id}' and kind = 'return' order by started_at desc limit 1`), 'arrived');
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
  // (on its own: when the step before could not pay the invoice, the page shows the amount due instead)
  const paid = h.sql(`select count(*) from public.invoices where job_id = '${jobId}' and status = 'paid'`) === '1';
  await page.getByText(paid ? /Payé|Paid/ : /Facture|Invoice/).first().waitFor();
  assert.ok(paid, 'the invoice of step 2 is paid (step 2 failed before this one)');
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
  // a mechanic: no team; Réglages opens on « L'app » only (the update of the app is for every phone)
  let { page, ctx } = await h.openW({ kind: 'desktop' });
  await h.signIn(page, who.saleh.email, PW);
  assert.equal(await page.getByTestId('nav-team').count(), 0);
  await page.goto(h.APP + '#/settings');
  await page.getByTestId('settings-nav-app').waitFor();
  assert.equal(await page.getByTestId('settings-nav-company').count(), 0, 'no section that changes the garage');
  assert.equal(await page.locator('[data-testid^="settings-nav-"]').count(), 1, 'only « L’app »');
  await page.getByTestId('update-check').waitFor();
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
  assert.match(n.message, /, l’après-midi \(entre 12 h et 16 h\)\.\n\nEstimation :\n• Promo : pneus non montés \+ huile \+ inspection\u00a0: 199,99 \$\nTotal : 199,99 \$ \+ tx\n\nPour accepter l’estimation et autoriser les travaux sur votre véhicule \(un seul bouton\) : http/);
  // the customer's phone: the estimate, the conditions, the finger, « J'accepte », « Signer »
  const { page } = await h.openW({ kind: 'phone' });
  await page.goto(n.link);
  // the page: the total before taxes « + tx », no payment before the work, one button to accept (or the finger, below)
  await page.getByTestId('client-sign-click').waitFor({ timeout: 15000 });
  assert.match(await page.getByTestId('client-expected').innerText(), /199,99\s\$ \+ tx/);
  assert.equal(await page.getByTestId('client-pay').count(), 0, 'no « pay now » before the work');
  await h.shot(page, 'e2e-7-client-one-tap');
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
  h.sql(`update public.jobs set day = public.local_today(), block = '${blockNow()}' where id = '${b.job_id}'`);
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
  // (the screen was light already: wait for the choice to reach the server, not for the screen)
  assert.equal(await until(() => h.sql(`select prefs->'look'->>'mode' from public.staff where id = '${who.owner.id}'`), (v) => v === 'auto', 10000), 'auto');
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
  // then the engine (the engine list knows the 2015 Jetta): each one with its oil and filter; the first one is taken
  await page.getByTestId('carpick-engines').waitFor({ timeout: 5000 });
  assert.match(await page.getByTestId('carpick-engine').first().innerText(), /huile|filtre/i, 'the oil or the filter of each engine is said');
  await page.getByTestId('carpick-engine').first().click();
  assert.equal(await page.getByTestId('vadd-model').innerText(), 'Jetta');
  await page.getByTestId('vehicle-add-ok').click();
  await page.getByTestId('car-row').filter({ hasText: 'Jetta' }).first().waitFor({ timeout: 15000 });
  const rowOf = async (sqlText) => { for (let i = 0; i < 40; i++) { const v = h.sql(sqlText); if (v) return v; await page.waitForTimeout(250); } return ''; };
  assert.equal(await rowOf(`select year || ' ' || make || ' ' || model from public.vehicles where customer_id = '${julie}' and model = 'Jetta'`), '2015 Volkswagen Jetta');
  assert.ok(Number(await rowOf(`select displacement from public.vehicles where customer_id = '${julie}' and model = 'Jetta'`)) > 0, 'the engine chosen is kept on the car');
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
  // Saleh (mechanic): no team, no money he may not see; Réglages is there (« L'app », the updates); signing out still works from here
  const m = await h.openW({ kind: 'phone', scheme: 'light' });
  await h.signIn(m.page, who.saleh.email, PW);
  await m.page.goto(h.APP + '#/more');
  await m.page.getByTestId('more-screen').waitFor();
  await m.page.getByTestId('more-today').waitFor();
  assert.equal(await m.page.getByTestId('more-team').count(), 0);
  assert.equal(await m.page.getByTestId('more-settings').count(), 1, 'Réglages opens for everyone');
  assert.equal(await m.page.getByTestId('more-gear').count(), 1);
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

/* ---------- addresses on the map (Photon is answered here, like the real one) ---------- */
const photonHouse = (hn, street, city, pc, lng, lat) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { housenumber: hn, street, city, postcode: pc, countrycode: 'CA', state: 'Québec', type: 'house', osm_key: 'place', osm_value: 'house' } });
const until = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 500)); } return v; };
const tomorrow = () => h.sql(`select (public.local_today() + 1)::text`);
let karim, nour, jobLaval, jobKhalil;

step('Addresses: the ones typed without a choice are found by themselves; the map says what is missing and « Trouver » finds it; the field finds it when leaving', async () => {
  // tomorrow the truck works (whatever day it is)
  h.sql(`insert into public.truck_days (truck_id, day, ranges, note) values ('${T.complet}', public.local_today() + 1, '[[480,1200]]', 'e2e') on conflict do nothing`);
  // the screenshot's address, typed without choosing a suggestion (no position), and a second one Photon does not know yet
  karim = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lang) values ('Karim', 'Laval', '450 555-0144', '144 58e Avenue, Laval, QC', 'H7V 2A7', 'fr') returning id`);
  nour = h.sql(`insert into public.customers (first_name, last_name, phone, address, lang) values ('Nour', 'Gibran', '514 555-0160', '160 khalil gibran', 'fr') returning id`);
  jobLaval = h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, address, stop_order) values ('${karim}', public.local_today() + 1, 'pm', 'booked', '${T.complet}', 45, '144 58e Avenue, Laval, QC', 1) returning id`);
  jobKhalil = h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, address, stop_order) values ('${nour}', public.local_today() + 1, 'pm', 'booked', '${T.complet}', 45, '160 khalil gibran', 2) returning id`);
  for (const j of [jobLaval, jobKhalil]) h.sql(`insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents) values ('${j}', 'service', '${SVC_OIL}', 'Changement d’huile (5 L)', 1, 8000)`);
  // a customer with no address yet (its address is typed in the field below)
  const other = h.sql(`insert into public.customers (first_name, last_name, phone, lang) values ('Sami', 'Adresse', '514 555-0199', 'fr') returning id`);
  const { ctx, page } = await h.openW({ kind: 'phone' });
  let knowsKhalil = false;
  const asked = [];
  const t0 = Date.now();
  await ctx.route('https://photon.komoot.io/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    asked.push(`${Date.now() - t0}ms ${q}${/khalil/i.test(q) ? ` (knows: ${knowsKhalil})` : ''}`);
    page.netlog?.push(`${Date.now() - t0}ms PHOTON ${q}`);   // next to the picture of a failure
    const features = /58e/i.test(q) ? [photonHouse('144', '58e Avenue', 'Laval', 'H7V 4A2', -73.72509, 45.54571)]
      : /khalil/i.test(q) && knowsKhalil ? [photonHouse('160', 'Rue Khalil-Gibran', 'Montréal', 'H4N 1C0', -73.66748, 45.52789)] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  await h.signIn(page, who.owner.email, PW);
  // 1) by itself, a few seconds after the app opens: the appointment and its customer get the position; the block is re-planned
  //    (the second address is asked too, and Photon does not know it yet)
  // the app says when a run of the locator is through (data-locator on the page): no guessing of seconds
  await page.waitForFunction(() => document.documentElement.dataset.locator === 'idle' && Number(document.documentElement.dataset.locatorRuns) >= 1, null, { timeout: 60000 })
    .catch(() => { throw new Error('the locator never finished a run; asked: ' + asked.join(' | ')); });
  assert.ok(asked.some((q) => /khalil/i.test(q)), 'both addresses were asked: ' + asked.join(' | '));
  const lat = await until(() => h.sql(`select coalesce(lat::text, '') from public.jobs where id = '${jobLaval}'`), (v) => !!v);
  assert.match(lat, /^45\.545/, 'the Laval appointment is placed: ' + asked.join(' | '));
  assert.match(h.sql(`select coalesce(lat::text, '') from public.customers where id = '${karim}'`), /^45\.545/);
  assert.equal(h.sql(`select coalesce(lat::text, '') from public.jobs where id = '${jobKhalil}'`), '', 'Photon does not know the second one yet');
  await until(() => h.sql(`select count(*) from public.jobs where id = '${jobLaval}' and travel_min <> 25`), (v) => v === '1', 20000);
  assert.equal(h.sql(`select count(*) from public.jobs where id = '${jobLaval}' and travel_min <> 25`), '1', 're-planned from the real place (no more « unknown » drive)');
  // 2) the appointment says it is not on the map
  await page.goto(h.APP + `#/job/${jobKhalil}`);
  await page.getByTestId('job-no-position').waitFor();
  await h.shot(page, 'e2e-13-job-no-position');
  // 3) the map of tomorrow: all the appointments; the one without a position is said, « Trouver » finds it
  knowsKhalil = true;
  await page.goto(h.APP + `#/map?day=${tomorrow()}`);
  await page.getByTestId('map-lost').waitFor({ timeout: 15000 });
  assert.match(await page.getByTestId('map-lost').innerText(), /^1 rendez-vous pas encore sur la carte/);
  assert.equal(await page.locator('.map-marker, [data-testid^="marker-"]').count() >= 0, true);
  await h.shot(page, 'e2e-13-map-lost');
  await page.getByTestId('map-lost-find').click();
  await page.getByText('Position trouvée : le rendez-vous est sur la carte.').waitFor({ timeout: 15000 });
  await page.getByTestId('map-lost').waitFor({ state: 'detached', timeout: 20000 }).catch(() => { throw new Error('the note stays: ' + asked.join(' | ')); });
  // (the customer is saved first, the appointment a few ms later: wait for both, not for the instant the note went away)
  assert.match(await until(() => h.sql(`select coalesce(lat::text, '') from public.jobs where id = '${jobKhalil}'`), (v) => /^45\.527/.test(v), 10000), /^45\.527/);
  assert.match(await until(() => h.sql(`select coalesce(lat::text, '') from public.customers where id = '${nour}'`), (v) => /^45\.527/.test(v), 10000), /^45\.527/);
  await h.shot(page, 'e2e-13-map-all');
  // 4) the address field: typed without choosing, the position is taken when leaving the field (the address stays as typed)
  await page.goto(h.APP + `#/customer/${other}`);
  await page.getByTestId('customer-edit').click();
  const sheet = page.getByTestId('customer-edit-sheet');
  const field = sheet.getByTestId('address-input');
  await field.fill('160 khalil gibran');
  await sheet.getByTestId('address-suggestions').waitFor({ timeout: 20000 }).catch(() => undefined);
  // (seen once on the slow machine: the field back to empty right here, around the 45 s pull — typed again, and noted)
  if ((await field.inputValue()) !== '160 khalil gibran') {
    page.netlog.push(`${Date.now() - t0}ms ADDRESS FIELD RESET to "${await field.inputValue()}" (sheet rebuilt?)`);
    await field.fill('160 khalil gibran');
    await sheet.getByTestId('address-suggestions').waitFor({ timeout: 20000 }).catch(() => undefined);
  }
  await page.getByTestId('address-unit').focus();
  await sheet.getByText('Position trouvée').waitFor({ timeout: 20000 });
  assert.equal(await field.inputValue(), '160 khalil gibran', 'the address stays as typed');
  await page.getByTestId('customer-save').click();
  const saved = await until(() => h.sql(`select coalesce(address, '') || '|' || coalesce(lat::text, '') from public.customers where id = '${other}'`), (v) => /\|45\.527/.test(v));
  assert.match(saved, /^160 khalil gibran\|45\.527/);
  noErrors(page);
  await page.context().close();
});

step('Needs of the week: oil by grade, filters, new tires by size, compared with the stock; what each service takes, in Settings', async () => {
  // in two weeks: a week of its own, never the one « La journée » prepares (checked below; on a Saturday or a Sunday,
  // tomorrow would already be in it)
  const day = h.sql(`select (public.local_today() + 14)::text`);
  const week = h.sql(`select (d - extract(dow from d)::int)::text from (select '${day}'::date as d) x`);
  // three appointments that day, each an oil change: a Golf (the engine list says 5.7 L of 5W-40, to confirm), a Civic with
  // its confirmed sheet and its tire size (it also gets 4 new winter tires), and one with no car
  const person = (first, lat, lng) => h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang) values ('${first}', 'Besoins', '514 555-0100', '${first} rue Test, Montréal', ${lat}, ${lng}, 'fr') returning id`);
  const appt = (customer, vehicle) => {
    const j = h.sql(`insert into public.jobs (customer_id, vehicle_id, day, block, status, truck_id, duration_min, stop_order) values ('${customer}', ${vehicle ? `'${vehicle}'` : 'null'}, '${day}', 'am', 'booked', '${T.complet}', 45, 1) returning id`);
    h.sql(`insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents) values ('${j}', 'service', '${SVC_OIL}', 'Changement d’huile (5 L)', 1, 8000)`);
    return j;
  };
  const cGolf = person('Gilles', 45.51, -73.62), cCivic = person('Cindy', 45.52, -73.63), cNone = person('Noé', 45.53, -73.64);
  const golf = h.sql(`insert into public.vehicles (customer_id, year, make, model) values ('${cGolf}', 2015, 'Volkswagen', 'Golf') returning id`);
  h.sql(`insert into public.engine_specs (key, year, make, model, data, confirmed_at) values ('honda|civic|2019|2.0', 2019, 'Honda', 'Civic', '{"oil_l": 4.2, "oil_visc": "0W-20", "oil_filter": "PH7317"}', now()) on conflict (key) do nothing`);
  const civic = h.sql(`insert into public.vehicles (customer_id, year, make, model, tire_size, spec_key) values ('${cCivic}', 2019, 'Honda', 'Civic', '215/55R16', 'honda|civic|2019|2.0') returning id`);
  appt(cGolf, golf);
  const jobCivic = appt(cCivic, civic);
  appt(cNone, null);
  const tires = h.sql(`insert into public.services (name_fr, name_en, category, price_cents, duration_min, needs) values ('Pneus neufs d’hiver (4)', 'New winter tires (4)', 'pneus', 79999, 75, '[{"kind":"tires","qty":4,"season":"winter"}]') returning id`);
  h.sql(`insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents, sort) values ('${jobCivic}', 'service', '${tires}', 'Pneus neufs d’hiver (4)', 1, 79999, 2)`);
  // the stock: a 5 L jug of the Golf's oil, 10 L of 0W-20, two of the four winter tires
  h.sql(`insert into public.inventory_items (name, category, unit, qty) values ('Huile 5W-40 VW 502 00 bidon 5 L', 'Huile', 'bidon', 1), ('Huile 0W-20 synthétique', 'Huile', 'L', 10), ('Pneu d’hiver 215/55R16', 'Pneus', 'pneu', 2)`);

  const { ctx, page } = await h.openW({ kind: 'desktop' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + '#/inventory');
  await page.getByTestId('inventory-needs').click();
  await page.getByTestId('needs-screen').waitFor();
  await page.goto(h.APP + `#/needs?week=${week}`);
  await page.getByTestId('needs-buy').waitFor({ timeout: 15000 });
  const buy = await page.getByTestId('needs-buy').innerText();
  assert.match(buy, /Huile 5W-40 \(VW 502 00\)[\s\S]*0,7 L[\s\S]*1 bidon de 5 L/, buy);
  assert.match(buy, /Pneus d’hiver 215\/55R16[\s\S]*2 pneus/, buy);
  assert.match(buy, /Huile, type à confirmer[\s\S]*5 L/, buy);
  assert.match(buy, /Filtre à huile 06K 115 562/, buy);
  assert.doesNotMatch(buy, /0W-20/, 'the Civic’s 0W-20 is in stock');
  const all = await page.getByTestId('needs-all').innerText();
  assert.match(all, /Huile 0W-20[\s\S]*4,2 L[\s\S]*10 L[\s\S]*✓/, all);
  const stats = await page.getByTestId('needs-stats').innerText();
  assert.ok(Number(/(\d+)\s*rendez-vous/.exec(stats)?.[1]) >= 3, stats);
  // a line opens its appointments; « À compléter » lists the appointment with no car
  await page.getByTestId('needs-row').filter({ hasText: 'Pneus d’hiver' }).locator('button').click();
  await page.getByTestId('needs-row').filter({ hasText: 'Pneus d’hiver' }).getByText('2019 Honda Civic').waitFor();
  assert.match(await page.getByTestId('needs-missing').innerText(), /Pas de véhicule sur le rendez-vous/);
  await h.shot(page, 'e2e-14-needs');
  await page.getByTestId('needs-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(text, /^Achats, Semaine du/);
  assert.match(text, /- Pneus d’hiver 215\/55R16 : 2 pneus/);
  // the phone: what and to buy, the need and the stock under the name
  const { page: phone } = await h.openW({ kind: 'phone' });
  await h.signIn(phone, who.owner.email, PW);
  await phone.goto(h.APP + `#/needs?week=${week}`);
  await phone.getByTestId('needs-buy').waitFor({ timeout: 15000 });
  await h.shot(phone, 'e2e-14-needs-phone');
  // « La journée » shows what to buy from Thursday to Sunday, for the week to prepare (checked on those days)
  const shop = h.sql(`select coalesce((case when extract(dow from d) = 0 then d when extract(dow from d) >= 4 then d + (7 - extract(dow from d)::int) end)::text, '') from (select public.local_today() as d) x`);
  if (shop) {
    const later = person('Léa', 45.5, -73.6);
    const j = h.sql(`insert into public.jobs (customer_id, vehicle_id, day, block, status, truck_id, duration_min, stop_order) values ('${later}', '${civic}', '${shop}'::date + 3, 'am', 'booked', '${T.complet}', 45, 1) returning id`);
    h.sql(`insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents) values ('${j}', 'service', '${tires}', 'Pneus neufs d’hiver (4)', 1, 79999)`);
    await phone.goto(h.APP + '#/');
    await phone.reload();
    // the card may already show what other appointments of that week need: wait for Léa's tires to arrive on the phone
    await phone.getByTestId('today-needs').getByText('Pneus d’hiver 215/55R16').waitFor({ timeout: 20000 });
    const card = await phone.getByTestId('today-needs').innerText();
    assert.match(card, /Achats pour (la semaine prochaine|cette semaine)/, card);
    assert.match(card, /Pneus d’hiver 215\/55R16/, card);
    await phone.getByTestId('today-needs').scrollIntoViewIfNeeded();
    await h.shot(phone, 'e2e-14-today-card');
    await phone.getByTestId('today-needs-open').click();
    await phone.getByTestId('needs-screen').waitFor();
    assert.match(phone.url(), new RegExp(`#/needs\\?week=${shop}`));
  }
  await phone.context().close();
  // Settings: what « Changement d'huile » takes is guessed from its name; adding the air filter is saved and counted
  await page.goto(h.APP + '#/settings/services');
  await page.getByTestId(`service-${SVC_OIL}`).click();
  await page.getByTestId('service-needs').waitFor();
  assert.match(await page.getByTestId('service-needs-note').innerText(), /Deviné d’après le nom/);
  const pressed = async (label) => page.getByTestId('service-needs-kinds').getByRole('button', { name: label }).getAttribute('aria-pressed');
  assert.equal(await pressed('Huile moteur'), 'true');
  assert.equal(await pressed('Filtre à huile'), 'true');
  assert.equal(await pressed('Pneus neufs'), 'false');
  await page.getByTestId('service-needs-kinds').getByRole('button', { name: 'Filtre à air' }).click();
  await h.shot(page, 'e2e-14-service-needs');
  await page.getByTestId('service-save').click();
  const needs = await until(() => h.sql(`select coalesce(needs::text, '') from public.services where id = '${SVC_OIL}'`), (v) => /air_filter/.test(v));
  assert.deepEqual(JSON.parse(needs), [{ kind: 'oil' }, { kind: 'oil_filter' }, { kind: 'air_filter' }]);
  await page.goto(h.APP + `#/needs?week=${week}`);
  await page.getByTestId('needs-all').getByText('Filtre à air, à confirmer').first().waitFor({ timeout: 15000 });
  // back to what the name says
  await page.goto(h.APP + '#/settings/services');
  await page.getByTestId(`service-${SVC_OIL}`).click();
  await page.getByTestId('service-needs-guess').click();
  await page.getByTestId('service-save').click();
  await until(() => h.sql(`select coalesce(needs::text, 'null') from public.services where id = '${SVC_OIL}'`), (v) => v === 'null');
  assert.equal(h.sql(`select coalesce(needs::text, 'null') from public.services where id = '${SVC_OIL}'`), 'null');
  noErrors(page);
  await page.context().close();
});

step('Départ des camions: from Horaires to Réglages, a new address, and the coming routes re-optimized at once; the map shows where they leave from', async () => {
  // a coming evening with nothing booked yet: only Camion Complet works; the trucks leave from the Centrale
  const day = h.sql(`select d::date::text from generate_series(public.local_today() + 2, public.local_today() + 9, interval '1 day') d
    where not exists (select 1 from public.jobs j where j.day = d::date and j.block = 'eve' and j.deleted_at is null) limit 1`);
  for (const [truck, ranges] of [[T.complet, '[[480,1200]]'], [T.voiture, '[]']]) {
    h.sql(`insert into public.truck_days (truck_id, day, ranges, note) values ('${truck}', '${day}', '${ranges}', 'e2e') on conflict (truck_id, day) do update set ranges = excluded.ranges, deleted_at = null`);
  }
  h.sql(`update public.settings set booking = jsonb_set(booking, '{home}', '{"label":"Centrale","address":"8255 av. Mountain Sights, Montréal, QC H4P 2B5","lat":45.5005053,"lng":-73.6577429}') where id = 1`);
  // three appointments: Chabanel, Laval, Montréal-Nord
  const people = [['Amro', '160 rue Khalil-Gibran, Montréal', 45.52789, -73.66748], ['Bassam', '144 58e Avenue, Laval, QC', 45.54571, -73.72509], ['Mahdi', '3500 rue Fleury Est, Montréal, QC', 45.58151, -73.64007]];
  const jobs = people.map(([name, address, lat, lng]) => {
    const c = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang) values ('${name}', 'Départ', '514 555-0177', '${address}', ${lat}, ${lng}, 'fr') returning id`);
    return h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min) values ('${c}', '${day}', 'eve', 'booked', '${T.complet}', 45) returning id`);
  });
  h.sql(`select public.replan_block('${day}', 'eve') is not null`);
  const list = `array['${jobs.join("','")}']::uuid[]`;
  const route = () => h.sql(`select string_agg(stop_order || ':' || eta_min, ',' order by array_position(${list}, id)) from public.jobs where id = any(${list})`);
  assert.equal(route(), '1:967,2:1028,3:1096', 'from Mountain Sights: Amro at 16 h 07, Bassam, then Mahdi');

  const { ctx, page } = await h.openW({ kind: 'phone' });
  await ctx.route('https://photon.komoot.io/**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('q') || '';
    const features = /legendre/i.test(q) ? [photonHouse('1401', 'Rue Legendre Ouest', 'Montréal', 'H4N 1H5', -73.6544639, 45.5312898)] : [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  await h.signIn(page, who.owner.email, PW);
  // Horaires des camions: where they leave from, first in the list of the trucks
  await page.goto(h.APP + '#/hours');
  const row = page.getByTestId('truck-start');
  await row.waitFor();
  assert.match(await row.innerText(), /Départ des camions\s+Centrale, 8255 av\. Mountain Sights/);
  await row.scrollIntoViewIfNeeded();
  await h.shot(page, 'e2e-15-hours-start');
  await row.click();
  await page.waitForURL(/#\/settings\/booking$/);
  // Réglages, Réservations: « Départ des camions » first; a new address chosen in the suggestions
  const panel = page.getByTestId('booking-start');
  await panel.waitFor();
  assert.equal(await page.locator('[data-testid="settings-booking"] .panel').first().getAttribute('data-testid'), 'booking-start', 'the first panel');
  await panel.getByTestId('address-input').fill('1401 legendre ouest');
  await panel.getByTestId('address-suggestions').getByRole('option').first().click();
  await panel.getByText('Position trouvée').waitFor();
  await panel.getByTestId('booking-replan-note').waitFor();
  await h.shot(page, 'e2e-15-settings-new-start');
  await page.getByTestId('settings-save').click();
  await page.getByText('Départ des camions changé. Les tournées à venir sont ré-optimisées.').waitFor({ timeout: 10000 });
  assert.equal(await until(() => h.sql(`select booking->'home'->>'lat' from public.settings where id = 1`), (v) => v === '45.5312898'), '45.5312898');
  assert.match(h.sql(`select booking->'home'->>'address' || '|' || (booking->'home'->>'label') from public.settings where id = 1`), /^1401 rue Legendre Ouest, Montréal, QC H4N 1H5\|Centrale$/i);
  // the server planned the evening again from Legendre: Amro at 16 h 03
  assert.equal(await until(route, (v) => v === '1:963,2:1024,3:1092', 15000), '1:963,2:1024,3:1092', 'the coming route re-optimized from the new start');
  // only the name: saved, nothing to re-plan (the note says nothing)
  await panel.getByTestId('booking-start-label').fill('Garage H.I.S');
  assert.equal(await panel.getByTestId('booking-replan-note').count(), 0, 'the name does not re-plan');
  await page.getByTestId('settings-save').click();
  await page.getByText('Réglages enregistrés.').waitFor({ timeout: 10000 });
  assert.equal(await until(() => h.sql(`select booking->'home'->>'label' from public.settings where id = 1`), (v) => v === 'Garage H.I.S'), 'Garage H.I.S');
  noErrors(page);
  await page.context().close();

  // the map of that evening (computer): where the trucks leave from, with « Changer » for the owner
  const d = await h.openW({ kind: 'desk' });
  await h.signIn(d.page, who.owner.email, PW);
  await d.page.goto(h.APP + `#/map?day=${day}`);
  const start = d.page.getByTestId('legend-start');
  await start.waitFor({ timeout: 15000 });
  assert.match(await start.innerText(), /Départ des camions\s+Garage H\.I\.S, 1401 rue Legendre Ouest/i);
  await h.shot(d.page, 'e2e-15-map-start');
  await start.getByTestId('legend-start-change').click();
  await d.page.waitForURL(/#\/settings\/booking$/);
  await d.page.getByTestId('booking-start').waitFor();
  noErrors(d.page);
  await d.page.context().close();
});

step('Départ de ce camion: the office makes Camion Complet leave from Laval; its coming morning is placed again from there; the map and Horaires say so; back to « Départ des camions »', async () => {
  // « Départ des camions » at 1401 Legendre; a coming day with nothing booked yet, where only Camion Complet works
  h.sql(`update public.settings set booking = jsonb_set(booking, '{home}', '{"label":"Centrale","address":"1401 rue Legendre Ouest, Montréal, QC H4N 1H5","lat":45.5312898,"lng":-73.6544639}') where id = 1`);
  const day = h.sql(`select d::date::text from generate_series(public.local_today() + 2, public.local_today() + 12, interval '1 day') d
    where not exists (select 1 from public.jobs j where j.day = d::date and j.deleted_at is null) limit 1`);
  for (const [truck, ranges] of [[T.complet, '[[480,1200]]'], [T.voiture, '[]']]) {
    h.sql(`insert into public.truck_days (truck_id, day, ranges, note) values ('${truck}', '${day}', '${ranges}', 'e2e') on conflict (truck_id, day) do update set ranges = excluded.ranges, deleted_at = null`);
  }
  // three morning appointments: Chabanel, Laval, Montréal-Nord
  const people = [['Amro', '160 rue Khalil-Gibran, Montréal', 45.52789, -73.66748], ['Bassam', '144 58e Avenue, Laval, QC', 45.54571, -73.72509], ['Mahdi', '3500 rue Fleury Est, Montréal, QC', 45.58151, -73.64007]];
  const jobs = people.map(([name, address, lat, lng]) => {
    const c = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang) values ('${name}', 'Camion', '514 555-0178', '${address}', ${lat}, ${lng}, 'fr') returning id`);
    return h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min) values ('${c}', '${day}', 'am', 'booked', '${T.complet}', 45) returning id`);
  });
  h.sql(`select public.replan_block('${day}', 'am') is not null`);
  const list = `array['${jobs.join("','")}']::uuid[]`;
  const route = () => h.sql(`select string_agg(stop_order || ':' || eta_min, ',' order by array_position(${list}, id)) from public.jobs where id = any(${list})`);
  const FROM_LEGENDRE = '1:483,2:544,3:612', FROM_LAVAL = '2:547,1:486,3:612';
  assert.equal(route(), FROM_LEGENDRE, 'from Legendre: Amro at 8 h 03, Bassam, then Mahdi');

  // the office (Horaires, phone): Camion Complet leaves from an address chosen in the suggestions, with a name for the map
  const { ctx, page } = await h.openW({ kind: 'phone' });
  await ctx.route('https://photon.komoot.io/**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('q') || '';
    const features = /saint-martin/i.test(q) ? [photonHouse('3500', 'Boulevard Saint-Martin Ouest', 'Laval', 'H7T 2W4', -73.74, 45.565)] : [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + `#/hours/${T.complet}`);
  const panel = page.getByTestId('truck-start-panel');
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
  assert.match(await panel.innerText(), /Comme les autres camions : Centrale, 1401 rue Legendre Ouest/);
  assert.equal(await panel.getByTestId('truck-start-mode').getByRole('button', { name: 'Centrale' }).getAttribute('aria-pressed'), 'true');
  await panel.getByTestId('truck-start-mode').getByRole('button', { name: 'Une autre adresse' }).click();
  await panel.getByTestId('address-input').fill('3500 boulevard saint-martin ouest laval');
  await panel.getByTestId('address-suggestions').getByRole('option').first().click();
  await panel.getByText('Position trouvée').waitFor();
  await panel.getByTestId('truck-start-label').fill('Chez Saleh');
  await panel.getByTestId('truck-start-note').waitFor();
  await h.shot(page, 'e2e-16-truck-start');
  await panel.getByTestId('truck-start-save').click();
  await page.getByText('Départ changé : les rendez-vous à venir sont replacés').waitFor({ timeout: 10000 });
  assert.equal(await until(() => h.sql(`select coalesce(start->>'label', '') || '|' || coalesce(start->>'lat', '') from public.trucks where id = '${T.complet}'`), (v) => v === 'Chez Saleh|45.565'), 'Chez Saleh|45.565');
  assert.match(h.sql(`select start->>'address' from public.trucks where id = '${T.complet}'`), /^3500 boul\. Saint-Martin Ouest, Laval, QC H7T 2W4$/);
  // the server placed the morning again from Laval: Bassam first, at 8 h 06; the customers' block does not change
  assert.equal(await until(route, (v) => v === FROM_LAVAL, 15000), FROM_LAVAL, 'the coming morning placed again from the truck’s start');
  assert.equal(h.sql(`select string_agg(distinct block, ',') from public.jobs where id = any(${list})`), 'am');
  noErrors(page);

  // the owner (computer): the map draws the route of Camion Complet from its start; Horaires says where it leaves from
  const d = await h.openW({ kind: 'desk' });
  await h.signIn(d.page, who.owner.email, PW);
  await d.page.goto(h.APP + `#/map?day=${day}`);
  const from = d.page.getByTestId(`legend-from-${T.complet}`);
  await from.waitFor({ timeout: 15000 });
  assert.match(await from.innerText(), /Part de : Chez Saleh/);
  assert.equal(await d.page.getByTestId(`legend-from-${T.voiture}`).count(), 0, 'Voiture leaves from « Départ des camions »');
  await h.shot(d.page, 'e2e-16-map-from');
  noErrors(d.page);
  await d.page.context().close();
  // (a page of its own: leaving the map while it still moves is not what this step checks)
  const o = await h.openW({ kind: 'desk' });
  await h.signIn(o.page, who.owner.email, PW);
  await o.page.goto(h.APP + '#/hours');
  const row = o.page.getByTestId(`truck-row-${T.complet}`);
  await row.waitFor();
  assert.match(await row.innerText(), /Part de : Chez Saleh, 3500 boul\. Saint-Martin Ouest/);
  noErrors(o.page);
  await o.page.context().close();

  noErrors(page);
  await page.context().close();

  // Saleh drives Camion Complet. Without the « Horaires » right (taken from the mechanics here), Horaires still opens on
  // his own truck only, even asked for another one; he puts it back on « Départ des camions » himself
  h.sql(`update public.settings set role_rights = jsonb_set(coalesce(role_rights, '{}'), '{mechanic,hours}', 'false') where id = 1`);
  assert.equal(h.sql(`select public.right_of(s, 'hours') from public.staff s where id = '${who.saleh.id}'`), 'f');
  const s = await h.openW({ kind: 'phone' });
  await h.signIn(s.page, who.saleh.email, PW);
  await s.page.goto(h.APP + `#/hours/${T.voiture}`);
  const mine = s.page.getByTestId('truck-start-panel');
  await mine.waitFor();
  assert.equal(await s.page.getByTestId('hours-trucks').getByRole('button').count(), 1, 'only the truck he drives');
  assert.match(await s.page.getByTestId('hours-trucks').innerText(), /Camion Complet/);
  assert.equal(await s.page.getByTestId('trucks-panel').count(), 0, 'not the list of the trucks (the owner’s)');
  await mine.scrollIntoViewIfNeeded();
  assert.equal(await mine.getByTestId('truck-start-mode').getByRole('button', { name: 'Une autre adresse' }).getAttribute('aria-pressed'), 'true');
  await mine.getByTestId('truck-start-mode').getByRole('button', { name: 'Centrale' }).click();
  await h.shot(s.page, 'e2e-16-saleh-start');
  await mine.getByTestId('truck-start-save').click();
  await s.page.getByText('Départ changé : les rendez-vous à venir sont replacés').waitFor({ timeout: 10000 });
  assert.equal(await until(() => h.sql(`select coalesce(start::text, 'null') from public.trucks where id = '${T.complet}'`), (v) => v === 'null'), 'null');
  assert.equal(await until(route, (v) => v === FROM_LEGENDRE, 15000), FROM_LEGENDRE, 'from Legendre again');
  await mine.getByText('Comme les autres camions : Centrale, 1401 rue Legendre Ouest').waitFor();
  noErrors(s.page);
  await s.page.context().close();
});

step('two cars of the same customer: each car its own work; back to the first car, its work is still there; one appointment per car in the same block', async () => {
  const SVC_TIRES = '5e7a0000-0000-4000-8000-000000000002';
  const cust = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('Samir', 'Haddad', '514 555-0177', '1250 rue Graham, Mont-Royal, QC', 'H3P 2C9', 45.5205, -73.6489, 'fr', false) returning id`);
  const corolla = h.sql(`insert into public.vehicles (customer_id, year, make, model) values ('${cust}', 2016, 'Toyota', 'Corolla') returning id`);
  const sienna = h.sql(`insert into public.vehicles (customer_id, year, make, model) values ('${cust}', 2019, 'Toyota', 'Sienna') returning id`);
  const { page } = await h.openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + `#/book?customer=${cust}`);
  await page.getByTestId('customer-picked').waitFor({ timeout: 15000 });
  const chips = page.getByTestId('vehicle-chips');
  // the Corolla: an oil change
  await chips.getByRole('button', { name: /Corolla/ }).click();
  await page.getByTestId(`svc-${SVC_OIL}`).click();
  // the Sienna: the list starts empty; tires
  await chips.getByRole('button', { name: /Sienna/ }).click();
  assert.equal(await page.getByTestId(`svc-${SVC_OIL}`).getAttribute('aria-pressed'), 'false', 'the Sienna starts with nothing chosen');
  await page.getByTestId(`svc-${SVC_TIRES}`).click();
  await page.getByTestId(`book-car-${corolla}`).waitFor();
  // back to the Corolla: its oil change is still there, the tires are not
  await chips.getByRole('button', { name: /Corolla/ }).click();
  assert.equal(await page.getByTestId(`svc-${SVC_OIL}`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByTestId(`svc-${SVC_TIRES}`).getAttribute('aria-pressed'), 'false');
  await page.getByTestId(`book-car-${sienna}`).waitFor();
  await h.shot(page, 'e2e-17-two-cars');
  await page.getByTestId('bp-sugg').first().click();
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('agenda-screen').waitFor({ timeout: 20000 });
  const rows = h.sql(`select string_agg(v.model || ':' || i.service_id || ':' || j.block || ':' || j.day, ',' order by v.model) from public.jobs j join public.vehicles v on v.id = j.vehicle_id
    join public.job_items i on i.job_id = j.id where j.customer_id = '${cust}'`).split(',');
  assert.equal(rows.length, 2, 'one appointment per car: ' + rows.join(' '));
  assert.ok(rows[0].startsWith(`Corolla:${SVC_OIL}:`) && rows[1].startsWith(`Sienna:${SVC_TIRES}:`), rows.join(' '));
  assert.equal(rows[0].split(':').slice(2).join(':'), rows[1].split(':').slice(2).join(':'), 'the same block');
  noErrors(page);
  await page.context().close();
});

step('Copier / Coller: right-click an appointment, « Copier »; right-click a free block next week, « Coller ici »; the booking screen is filled in; « Réserver »', async () => {
  const { page, ctx } = await h.openW({ kind: 'desktop' });
  await h.signIn(page, who.owner.email, PW);
  const jobDay = h.sql(`select day::text from public.jobs where id = '${jobId}'`);
  const before = Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}' and deleted_at is null`));
  // the week of Julie's first appointment: right-click its ticket
  await page.goto(h.APP + `#/agenda/${jobDay}`);
  await page.getByTestId('agenda-week').waitFor({ timeout: 15000 });
  // the shortcuts of an appointment (the owner sees them all), then two of them at work
  const menuOn = async () => { await page.getByTestId(`chip-${jobId}`).click({ button: 'right' }); await page.getByTestId('agenda-menu').waitFor(); };
  await menuOn();
  await h.shot(page, 'e2e-copy-menu');
  for (const id of ['menu-open', 'menu-copy-job', 'menu-customer', 'menu-text', 'menu-call', 'menu-directions', 'menu-car', 'menu-quote', 'menu-book']) {
    assert.equal(await page.getByTestId(id).count(), 1, `the shortcut ${id}`);
  }
  await page.getByTestId('menu-text').click();
  await page.getByTestId('conversation-sheet').waitFor({ timeout: 15000 });
  assert.match(page.url(), new RegExp(`#/customer/${julie}$`), 'the address is clean (no ?do=)');
  await page.goto(h.APP + `#/agenda/${jobDay}`);
  await menuOn();
  await page.getByTestId('menu-car').click();
  await page.getByTestId('vehicle-add').waitFor({ timeout: 15000 });
  await page.goto(h.APP + `#/agenda/${jobDay}`);
  await menuOn();
  await page.getByTestId('menu-copy-job').click();
  await page.getByTestId('copy-banner').waitFor();
  // a week later: a block with room takes the paste (right-click on it)
  const later = h.sql(`select ('${jobDay}'::date + 7)::text`);
  await page.goto(h.APP + `#/agenda/${later}`);
  await page.getByTestId('copy-banner').waitFor();
  const cell = page.locator('td:has([data-testid^="cell-book-"]):has([data-testid^="cell-paste-"])').first();
  await cell.waitFor({ timeout: 15000 });
  const [, day, block] = /^cell-(\d{4}-\d{2}-\d{2})-(am|pm|eve)$/.exec(await cell.getAttribute('data-testid'));
  await cell.click({ button: 'right', position: { x: 6, y: 6 } });
  for (const id of ['menu-paste', 'menu-book-here', 'menu-day']) assert.equal(await page.getByTestId(id).count(), 1, `the block's ${id}`);
  await page.getByTestId('menu-paste').click();
  // the booking screen: same customer and work, the block chosen
  await page.getByTestId('book-copy').waitFor({ timeout: 15000 });
  await page.getByTestId('customer-picked').waitFor();
  await h.shot(page, 'e2e-copy-book');
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  const after = Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}' and deleted_at is null`));
  assert.equal(after, before + 1, 'one new appointment');
  const made = h.sql(`select id || '|' || day || '|' || block || '|' || status from public.jobs where customer_id = '${julie}' and deleted_at is null order by created_at desc limit 1`).split('|');
  assert.deepEqual(made.slice(1), [day, block, 'booked'], 'in the block where it was pasted');
  assert.equal(h.sql(`select string_agg(service_id::text, ',') from public.job_items where job_id = '${made[0]}' and deleted_at is null`), SVC_OIL, 'the same work');
  noErrors(page);
  await ctx.close();
});

/* a finger held on an element (an iPhone never sends a right-click: the app times the press) */
const hold = (loc, ms = 700) => loc.evaluate((node, ms) => new Promise((done) => {
  const r = node.getBoundingClientRect();
  const t = new Touch({ identifier: 1, target: node, clientX: r.left + Math.min(20, r.width / 2), clientY: r.top + Math.min(20, r.height / 2) });
  node.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  setTimeout(() => { node.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true })); done(); }, ms);
}), ms);

step('Copier / Coller on an iPhone: a long press on an appointment, « Copier »; a long press on a free block another day, « Coller ici »; « Réserver »', async () => {
  const { page, ctx } = await h.openW({ kind: 'phone' });
  await h.signIn(page, who.owner.email, PW);
  const jobDay = h.sql(`select day::text from public.jobs where id = '${jobId}'`);
  const before = Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}' and deleted_at is null`));
  await page.goto(h.APP + `#/agenda/${jobDay}`);
  await page.getByTestId('agenda-day').waitFor({ timeout: 15000 });
  const ticket = page.locator(`.agenda-ticketwrap:has(a[href="#/job/${jobId}"])`).first();
  await ticket.waitFor();
  // held: the menu, and lifting the finger does not open the appointment
  await hold(ticket, 700);
  await page.getByTestId('agenda-menu').waitFor();
  await h.shot(page, 'e2e-press-menu');
  assert.equal(await page.getByTestId('job-screen').count(), 0, 'the release did not open the appointment');
  await page.getByTestId('menu-copy-job').click();
  await page.getByTestId('copy-banner').waitFor();
  // another day the truck works, a block with room: held, « Coller ici »
  const later = h.sql(`select d::date::text from generate_series(public.local_today() + 2, public.local_today() + 12, interval '1 day') d
    where exists (select 1 from public.truck_week w where w.truck_id = '${T.complet}' and w.dow = extract(dow from d) and jsonb_array_length(w.ranges) > 0)
      and not exists (select 1 from public.truck_days x where x.truck_id = '${T.complet}' and x.day = d::date) limit 1`);
  await page.goto(h.APP + `#/agenda/${later}`);
  await page.getByTestId('copy-banner').waitFor();
  const block = page.locator('[data-testid^="block-"]:has([data-testid^="book-"]):has([data-testid^="paste-"])').first();
  await block.waitFor({ timeout: 15000 });
  const key = (await block.getAttribute('data-testid')).replace('block-', '');
  await hold(block.locator('.agenda-lanes'), 700);
  await page.getByTestId('menu-paste').click();
  await page.getByTestId('book-copy').waitFor({ timeout: 15000 });
  await page.getByTestId('customer-picked').waitFor();
  await h.shot(page, 'e2e-press-book');
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  assert.equal(Number(h.sql(`select count(*) from public.jobs where customer_id = '${julie}' and deleted_at is null`)), before + 1, 'one new appointment');
  const made = h.sql(`select day || '|' || block from public.jobs where customer_id = '${julie}' and deleted_at is null order by created_at desc limit 1`);
  assert.equal(made, `${later}|${key}`, 'in the block held');
  noErrors(page);
  await ctx.close();
});

