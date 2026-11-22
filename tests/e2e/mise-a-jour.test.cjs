// The update on a real phone: yesterday's app (the LIVE one, commit acf46c3) with its data and its waiting changes, then the
// rebuilt app on the same phone; the way back (a rollback); and two phones at once on the rebuilt app.
// Both apps are built for the local copy of the server and served one after the other at the SAME address, to browsers that
// keep their profile on disk (IndexedDB « his-garage-<uid> », localStorage, the installed service worker): mise-a-jour.helpers.cjs.
// The database is saved before and put back exactly as it was after.
//   bash <lane>/e2e-file.sh tests/e2e/mise-a-jour.test.cjs ["part of a step's name"]
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./harness.cjs');
const m = require('./mise-a-jour.helpers.cjs');
const { step, until, until2, dismissSheets, noErrors, draw, blockNow, openVin, jwtOf, rpcAs } = m;

const PW = 'Garage-e2e-2026';
const who = {};
let originalCounts;
const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const SVC_OIL = '5e7a0000-0000-4000-8000-000000000001';
const VIN = '2HGFC2F59KH512345';
const KM = '87654';
const KM2 = '87700';
const NOTE = 'Rappeler en mars pour les pneus d’été (e2e mise à jour)';
let julie, karim, marc;
/** what yesterday's phones did, for the next steps */
const y = { jobA: null, jobP: null, dueP: 0, mech: { entries: [], labels: [] }, office: { entries: [], labels: [] } };

/** a coming day when Camion Complet works the afternoon (as app.test.cjs): the owner books there, then the job is brought to today */
async function bookToday(jwt, customer, label, truck = T.complet) {
  const days = h.sql(`select string_agg(d::date::text, ',' order by d) from generate_series(public.local_today() + 1, public.local_today() + 14, interval '1 day') d
    where exists (select 1 from public.truck_week w where w.truck_id = '${T.complet}' and w.dow = extract(dow from d) and jsonb_array_length(w.ranges) > 0)`).split(',');
  for (const d of days) {
    try {
      const b = await rpcAs(jwt, 'book_job', { p_op: require('node:crypto').randomUUID(), p_job: { customer_id: customer, day: d, block: 'pm', truck_id: truck, duration_min: 60 },
        p_items: [{ description: label, unit_cents: 9999, duration_min: 60 }] });
      h.sql(`update public.jobs set day = public.local_today(), block = '${blockNow()}', truck_id = '${truck}' where id = '${b.job_id}'`);
      return b.job_id;
    } catch (e) { if (!/block_closed|block_full|needs_truck/.test(String(e?.message || e))) throw e; }
  }
  throw new Error('no afternoon of Camion Complet in the next two weeks');
}

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  who.owner = { email: `hassan-maj-${n}@test.local`, id: await h.makePerson({ email: `hassan-maj-${n}@test.local`, password: PW, name: 'Hassan Jeha', short: 'Hassan', roles: ['owner'] }) };
  who.saleh = { email: `saleh-maj-${n}@test.local`, id: await h.makePerson({ email: `saleh-maj-${n}@test.local`, password: PW, name: 'Saleh Ismail', short: 'Saleh', roles: ['mechanic'], truck: 'Camion Complet' }) };
  who.nadia = { email: `nadia-maj-${n}@test.local`, id: await h.makePerson({ email: `nadia-maj-${n}@test.local`, password: PW, name: 'Nadia Bureau', short: 'Nadia', roles: ['office'] }) };
  julie = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('Julie', 'Tremblay', '514 555-0141', '1250 rue Graham, Mont-Royal, QC', 'H3P 2C9', 45.5205, -73.6489, 'fr', true) returning id`);
  karim = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('Karim', 'Haddad', '514 555-0199', '1000 rue Sherbrooke O, Montréal, QC', 'H3A 3G4', 45.5048, -73.5772, 'fr', true) returning id`);
  marc = h.sql(`insert into public.customers (first_name, last_name, phone, address, postal_code, lat, lng, lang, sms_ok)
    values ('Marc', 'Gagnon', '514 555-0177', '4500 rue Saint-Denis, Montréal, QC', 'H2J 2L3', 45.5262, -73.5850, 'fr', true) returning id`);
  // Marc's appointment of this morning: done, « payer plus tard » (he comes to pay at the office): made by the owner
  const jwt = await jwtOf(who.owner.email, PW);
  y.jobP = await bookToday(jwt, marc, 'Vidange e2e Marc');
  for (const a of ['leave', 'arrive']) await rpcAs(jwt, 'job_step', { p_op: require('node:crypto').randomUUID(), p_job: y.jobP, p_action: a, p_data: {} });
  await rpcAs(jwt, 'job_step', { p_op: require('node:crypto').randomUUID(), p_job: y.jobP, p_action: 'waiver', p_data: { signer: 'Marc Gagnon', version: 'e2e' } });
  const inv = await rpcAs(jwt, 'invoice_for_job', { p_op: require('node:crypto').randomUUID(), p_job: y.jobP, p_refresh: true });
  await rpcAs(jwt, 'invoice_finish', { p_op: require('node:crypto').randomUUID(), p_invoice: inv.rows.invoices[0].id });
  await rpcAs(jwt, 'job_step', { p_op: require('node:crypto').randomUUID(), p_job: y.jobP, p_action: 'finish', p_data: { pay_later: true, reason: 'passe payer au bureau' } });
  y.dueP = Number(h.sql(`select total_cents - paid_cents from public.invoices where job_id = '${y.jobP}' and status = 'issued'`));
  assert.ok(y.dueP > 0, 'Marc owes his invoice');
  // the two apps, built for this server (through the signal switch), and the web server at the app's address
  const nw = m.buildNew();
  const old = m.buildOld();
  console.log(`# old app ${old.head.slice(0, 7)} ${old.cached ? '(build kept from an earlier run)' : 'built'}: ${m.mainScript(m.DIST_OLD)}; new app ${nw.cached ? '(build kept)' : 'built'}: ${m.mainScript(m.DIST_NEW)}`);
  await m.signal.start();
  await m.site.start();
  m.site.serve(m.DIST_OLD);
});
after(async () => {
  await m.closePhones();
  await h.closeAll();
  await m.site.stop();
  await m.signal.stop();
  h.restoreDb();
  const now = h.rowCounts();
  const diff = Object.keys(originalCounts).filter((k) => originalCounts[k] !== now[k]);
  assert.deepEqual(diff, [], 'the database is back exactly as it was');
});

/** signed in on a phone that keeps its profile; the app's service worker installed and in control (as on a phone used yesterday) */
async function signInPhone(p, email) {
  await h.signIn(p.page, email, PW);
  await p.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true), null, { timeout: 20000 });
  await p.page.reload();
  await p.page.getByTestId('app').waitFor({ timeout: 15000 });
  await p.page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
}
const T0 = Date.now();
const show = (label, x) => console.log(`# ${Math.round((Date.now() - T0) / 1000)}s ${label}: ${typeof x === 'string' ? x : JSON.stringify(x, null, 1)}`);

step('yesterday’s app: the office books Julie, Saleh starts his day and leaves for her; he picks English, dark and his own photo', async () => {
  // the office (a phone)
  const o = await m.phone('bureau', { fresh: true });
  await signInPhone(o, who.nadia.email);
  assert.equal(await m.whichApp(o.page), 'old', 'yesterday’s app');
  await o.page.goto(h.APP + '#/book');
  await o.page.getByTestId('book-screen').waitFor();
  await o.page.getByTestId('customer-search').fill('Julie');
  await o.page.getByTestId('customer-option').first().click();
  await o.page.getByTestId('customer-picked').waitFor();
  await o.page.getByTestId(`svc-${SVC_OIL}`).click();
  await o.page.getByTestId('bp-sugg').first().click();
  await o.page.getByTestId('book-confirm').click();
  await o.page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  y.jobA = h.sql(`select id from public.jobs where customer_id = '${julie}' and deleted_at is null`);
  assert.ok(y.jobA, 'Julie is booked');
  await dismissSheets(o.page);
  // her appointment is today, in the block that is on now, on Saleh's truck
  h.sql(`update public.jobs set day = public.local_today(), block = '${blockNow()}', truck_id = '${T.complet}' where id = '${y.jobA}'`);
  noErrors(o.page);
  await m.putAway(o);

  // Saleh (his phone)
  const p = await m.phone('mecano', { fresh: true });
  await signInPhone(p, who.saleh.email);
  const { page } = p;
  await page.getByTestId('today-screen').waitFor();
  await page.getByTestId('shift-start').click();
  await page.getByTestId('shift-end').waitFor();
  await page.goto(h.APP + '#/agenda');
  await page.getByTestId('agenda-screen').waitFor();
  await page.getByText('Julie').first().waitFor({ timeout: 15000 });
  await page.goto(h.APP + `#/job/${y.jobA}`);
  await page.getByTestId('job-screen').waitFor();
  await page.getByTestId('step-leave').click();
  await page.getByTestId('text-outcome').waitFor({ timeout: 15000 }).catch(() => undefined);
  await dismissSheets(page);
  await page.getByTestId('step-arrive').waitFor({ timeout: 15000 });
  assert.equal(await until(() => h.sql(`select status from public.jobs where id = '${y.jobA}'`), (v) => v === 'en_route', 15000), 'en_route');
  // English, dark, his own photo behind the glass
  await page.goto(h.APP + '#/account');
  await page.getByTestId('account-follow').locator('button, [role=radio]').filter({ hasText: /mien|own/i }).click();
  await page.getByTestId('theme-his-dark').click();
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
  await page.getByTestId('account-lang').locator('button', { hasText: 'English' }).click();
  await page.getByText('Today').first().waitFor({ timeout: 5000 });
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d');
    x.fillStyle = '#1d3b2a'; x.fillRect(0, 0, 1200, 900); x.fillStyle = '#e8d9b0'; x.fillRect(200, 300, 500, 300);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const photo = path.join(h.OUT, 'maj-photo.jpg');
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
  await page.getByTestId('account-backdrop').waitFor();
  await page.getByTestId('backdrop-file').setInputFiles(photo);
  await page.waitForFunction(() => document.documentElement.dataset.photo === 'mine', null, { timeout: 15000 });
  assert.equal(await until(() => h.sql(`select lang || '|' || coalesce(prefs->'look'->>'mode', '') from public.staff where id = '${who.saleh.id}'`), (v) => v === 'en|dark', 15000), 'en|dark');
  await h.shot(page, 'maj-1-old-app');
  noErrors(page);
  await m.putAway(p);
});

step('yesterday’s app with no signal: Saleh arrives, types the VIN and the km, Julie signs; the office books Karim, takes Marc’s cash, writes a note; everything waits on the phones', async () => {
  const p = await m.phone('mecano');
  const { page } = p;
  await page.goto(h.APP + `#/job/${y.jobA}`);
  await page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  await p.ctx.setOffline(true);
  await page.getByTestId('step-arrive').click();
  await dismissSheets(page).catch(() => undefined);
  await openVin(page);
  await h.shot(page, 'maj-2-car-check');
  await page.getByTestId('vin-input').fill(VIN);
  await page.getByTestId('car-check-km').fill(KM);
  await page.getByTestId('car-check-save').click();
  await page.getByTestId('car-check').waitFor({ state: 'detached', timeout: 10000 });
  await page.getByTestId('step-waiver').click({ timeout: 15000 });
  await page.getByTestId('waiver-sheet').waitFor();
  await draw(page, 'waiver-pad');
  await page.getByTestId('waiver-save').click();
  await page.getByTestId('waiver-sheet').waitFor({ state: 'detached', timeout: 15000 });
  await h.shot(page, 'maj-2-mechanic-offline');
  const dev = await m.readDevice(page, who.saleh.id);
  // the entries as yesterday's app writes them (the proof of their shape, in the report)
  show('mechanic outbox', dev.outbox.map((e) => ({ seq: e.seq, kind: e.kind, table: e.table, rpc: e.rpc, op: e.op, label: e.label, tries: e.tries, state: e.state, keys: Object.keys(e) })));
  y.mech.entries = dev.outbox;
  y.mech.labels = [...new Set(dev.outbox.map((e) => e.label).filter(Boolean))];
  const ms = await m.syncSheet(page);
  show('mechanic sync sheet', ms);
  for (const l of y.mech.labels) assert.ok(ms.text.includes(l), `« ${l} » is listed as waiting`);
  assert.equal(h.sql(`select status from public.jobs where id = '${y.jobA}'`), 'en_route', 'nothing reached the server');
  noErrors(page);
  await m.putAway(p);

  const o = await m.phone('bureau');
  const op = o.page;
  await op.goto(h.APP + '#/book');
  await op.getByTestId('book-screen').waitFor({ timeout: 15000 });
  await op.getByTestId('customer-search').fill('Karim');
  await op.getByTestId('customer-option').first().click();
  await op.getByTestId(`svc-${SVC_OIL}`).click();
  await o.ctx.setOffline(true);
  await op.locator('[data-testid^="bp-cell-"]:not([disabled]):not([aria-disabled="true"])').first().click();
  await op.getByTestId('book-confirm').click();
  await op.getByTestId('sync-chip').waitFor({ timeout: 15000 });
  await dismissSheets(op);
  await op.goto(h.APP + `#/job/${y.jobP}`);
  await op.getByTestId('job-screen').waitFor({ timeout: 15000 });
  await op.getByTestId('invoice-pay').click({ timeout: 15000 });
  await op.getByTestId('pay-sheet').waitFor();
  await op.getByTestId('pay-cash').click();
  await op.getByTestId('pay-confirm').click();
  await op.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
  await op.goto(h.APP + `#/customer/${julie}`);
  await op.getByTestId('notes-panel').waitFor({ timeout: 15000 });
  await op.getByTestId('note-body').fill(NOTE);
  await op.getByTestId('note-add').click();
  await op.getByTestId('notes-list').getByText(NOTE).waitFor({ timeout: 10000 });
  await h.shot(op, 'maj-2-office-offline');
  const od = await m.readDevice(op, who.nadia.id);
  show('office outbox', od.outbox.map((e) => ({ seq: e.seq, kind: e.kind, table: e.table, rpc: e.rpc, op: e.op, label: e.label, tries: e.tries, state: e.state })));
  y.office.entries = od.outbox;
  y.office.labels = [...new Set(od.outbox.map((e) => e.label).filter(Boolean))];
  const os = await m.syncSheet(op);
  show('office sync sheet', os);
  for (const l of y.office.labels) assert.ok(os.text.includes(l), `« ${l} » is listed as waiting`);
  assert.equal(Number(h.sql(`select count(*) from public.jobs where customer_id = '${karim}'`)), 0, 'nothing reached the server');
  noErrors(op);
  await m.putAway(o);
});

/** the labels of the changes the sync sheet lists as waiting (what the person reads) */
const waitingLabels = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
/** the page is (or becomes) the rebuilt app: it reloads by itself once the new version takes over */
const becomes = (page, which, ms = 30000) => until2(async () => { try { return await m.whichApp(page); } catch { return 'loading'; } }, (v) => v === which, ms);
/** what the rebuilt app shows from the phone's copy, with no signal: the person, the day, the look, the work kept */
async function sameAsYesterday(page) {
  await page.getByTestId('app').waitFor({ timeout: 20000 });
  assert.equal(await page.getByTestId('login').count(), 0, 'still signed in');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.mode), 'dark', 'his dark look');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.photo), 'mine', 'his photo behind the glass');
  await page.goto(h.APP + '#/');
  await page.getByTestId('today-screen').waitFor({ timeout: 15000 });
  await page.getByText('Today').first().waitFor({ timeout: 10000 });
  await page.getByTestId('today-screen').getByText('Julie').first().waitFor({ timeout: 10000 });
}

step('the update: the next morning the phones open the same address, now the rebuilt app; with no signal they keep the person, the day, the look and the waiting work', async () => {
  m.site.serve(m.DIST_NEW);
  // the server does not answer yet: only the app's files come (a weak signal)
  m.signal.set(false);
  // Saleh, still no signal at all: the phone opens yesterday's app (its service worker), his work still waiting
  const p = await m.phone('mecano', { offline: true });
  const { page } = p;
  await page.goto(h.APP);
  await page.getByTestId('app').waitFor({ timeout: 20000 });
  assert.equal(await m.whichApp(page), 'old', 'no signal: yesterday’s app, from the phone');
  const hisKeys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => /^his[.-]/.test(k)).sort());
  const keptBefore = await hisKeys();
  // the files come: yesterday's app finds the new version when it opens, downloads it and says so
  await p.ctx.setOffline(false);
  await page.reload();
  const notice = page.getByTestId('toast-info').or(page.locator('.toast')).filter({ hasText: /Important app update|Mise à jour importante/ }).first();
  await notice.waitFor({ timeout: 30000 });
  const said = await notice.innerText();
  show('yesterday’s app says', said);
  await h.shot(page, 'maj-3-update-offered');
  // « Update now »: the new version takes over and the page reloads by itself
  await notice.getByRole('button', { name: /Update now|Mettre à jour/ }).click();
  assert.equal(await becomes(page, 'new'), 'new', 'the rebuilt app runs after « Update now »');
  await p.ctx.setOffline(true);
  await sameAsYesterday(page);
  // what yesterday's app kept in the browser's small storage is all still there (the session, the language, the look, the photo…)
  const keptAfter = await hisKeys();
  show('his.* keys before → after', { before: keptBefore, after: keptAfter });
  assert.deepEqual(keptBefore.filter((k) => !keptAfter.includes(k)), [], 'no key of yesterday’s app lost');
  // his work of yesterday is shown as done on the phone, and listed as waiting
  await page.goto(h.APP + `#/job/${y.jobA}`);
  await page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  await page.getByTestId('step-invoice').waitFor({ timeout: 10000 });
  const sheet = await m.syncSheet(page);
  show('the rebuilt app lists', sheet);
  for (const l of y.mech.labels) assert.ok(sheet.text.includes(l), `« ${l} » is listed as waiting`);
  assert.doesNotMatch(sheet.text, /refus/i, 'nothing refused');
  const dev = await m.readDevice(page, who.saleh.id);
  assert.deepEqual(dev.outbox.map((e) => [e.seq, e.op, e.state]), y.mech.entries.map((e) => [e.seq, e.op, 'pending']), 'the same changes, in the same order, still waiting');
  show('the outbox after the update', dev.outbox.map((e) => ({ seq: e.seq, op: e.op, tries: e.tries, sent: e.sent, v: e.v })));
  await h.shot(page, 'maj-3-new-app-offline');
  noErrors(page);
  // the phone is restarted with no signal at all: the rebuilt app opens from the phone
  await m.putAway(p);
  const p2 = await m.phone('mecano', { offline: true });
  await p2.page.goto(h.APP);
  await p2.page.getByTestId('app').waitFor({ timeout: 20000 });
  assert.equal(await m.whichApp(p2.page), 'new', 'the rebuilt app opens with no signal');
  await sameAsYesterday(p2.page);

  // the office: the notice is not tapped; the app is closed, then opened again
  const o = await m.phone('bureau');
  await o.page.goto(h.APP);
  await o.page.getByTestId('app').waitFor({ timeout: 20000 });
  assert.equal(await m.whichApp(o.page), 'old');
  await o.page.getByTestId('toast-info').or(o.page.locator('.toast')).filter({ hasText: /Mise à jour importante|Important app update/ }).first().waitFor({ timeout: 30000 });
  await m.putAway(o);
  const o2 = await m.phone('bureau', { offline: true });
  await o2.page.goto(h.APP);
  await o2.page.getByTestId('app').waitFor({ timeout: 20000 });
  assert.equal(await m.whichApp(o2.page), 'new', 'opened again: the rebuilt app');
  const os = await m.syncSheet(o2.page);
  show('the office’s rebuilt app lists', os);
  for (const l of y.office.labels) assert.ok(os.text.includes(l), `« ${l} » is listed as waiting`);
  assert.doesNotMatch(os.text, /refus/i, 'nothing refused');
  await o2.page.goto(h.APP + `#/customer/${julie}`);
  await o2.page.getByTestId('notes-list').getByText(NOTE).waitFor({ timeout: 10000 });
  // Marc's cash taken yesterday is counted as waiting: the rebuilt app does not offer to take it a second time
  await o2.page.goto(h.APP + `#/job/${y.jobP}`);
  await o2.page.getByTestId('pay-waiting').waitFor({ timeout: 15000 });
  assert.equal(await o2.page.getByTestId('invoice-pay').count(), 0, 'no « Encaisser » for a payment already taken');
  await h.shot(o2.page, 'maj-3-office-new-app-offline');
  noErrors(o2.page);
});

step('the signal comes back: every change of yesterday’s app is sent once, in order; nothing is refused; the screens show the server’s truth', async () => {
  const mech = await m.phone('mecano', { offline: true });
  const office = await m.phone('bureau', { offline: true });
  for (const x of [mech, office]) { await x.page.goto(h.APP); await x.page.getByTestId('app').waitFor({ timeout: 20000 }); assert.equal(await m.whichApp(x.page), 'new'); }
  const mark = m.signal.log.length;
  m.signal.set(true);
  await mech.ctx.setOffline(false);
  await office.ctx.setOffline(false);
  // everything leaves the phones
  for (const [x, uid] of [[mech, who.saleh.id], [office, who.nadia.id]]) {
    const left = await until2(async () => (await m.readDevice(x.page, uid)).outbox, (o) => o.length === 0, 60000);
    assert.deepEqual(left.map((e) => [e.label, e.state, e.error]), [], 'nothing left waiting, nothing refused');
  }
  // the database: each change once
  assert.equal(h.sql(`select status || '|' || (arrived_at is not null) || '|' || (waiver_signed_at is not null) || '|' || coalesce(odometer_km::text, '') from public.jobs where id = '${y.jobA}'`), `on_site|true|true|${KM}`);
  assert.equal(h.sql(`select count(*) || '|' || coalesce(max(v.vin), '') from public.vehicles v where v.customer_id = '${julie}' and v.deleted_at is null`), `1|${VIN}`, 'one car made from the VIN');
  assert.equal(h.sql(`select (vehicle_id = (select id from public.vehicles where customer_id = '${julie}'))::text from public.jobs where id = '${y.jobA}'`), 'true', 'the job has that car');
  assert.equal(h.sql(`select count(*) from public.attachments where job_id = '${y.jobA}' and kind = 'signature'`), '1', 'one signature');
  assert.equal(h.sql(`select count(*) || '|' || string_agg(status, ',') from public.trips where job_id = '${y.jobA}'`), '1|arrived', 'one trip, ended by « I’ve arrived »');
  assert.equal(h.sql(`select count(*) from public.jobs where customer_id = '${karim}' and deleted_at is null`), '1', 'Karim booked once');
  assert.equal(h.sql(`select count(*) || '|' || sum(amount_cents) || '|' || string_agg(method, ',') from public.payments where job_id = '${y.jobP}'`), `1|${y.dueP}|cash`, 'Marc’s cash recorded once');
  assert.equal(h.sql(`select status from public.invoices where job_id = '${y.jobP}' and status <> 'void'`), 'paid');
  assert.equal(h.sql(`select count(*) from public.customer_notes where customer_id = '${julie}' and body = '${NOTE.replace(/'/g, "''")}'`), '1', 'the note once');
  // each operation reached the server once (op_log), and each change left the phone once, in the order it was made
  for (const e of [...y.mech.entries, ...y.office.entries]) {
    const reached = m.signal.since(mark).filter((r) => r.status !== 'dropped' && r.method !== 'OPTIONS' && (e.kind === 'rpc' ? r.op === e.op : r.id === e.id && r.path.endsWith('/' + e.table)));
    assert.equal(reached.length, 1, `« ${e.label} » (${e.kind} ${e.rpc || e.table}) sent once: ${JSON.stringify(reached.map((r) => [r.method, r.path, r.status]))}`);
    assert.equal(reached[0].status >= 200 && reached[0].status < 300, true, `« ${e.label} » taken by the server (${reached[0].status})`);
    e.reachedAt = m.signal.log.indexOf(reached[0]);
    if (e.kind === 'rpc') assert.equal(h.sql(`select count(*) from public.op_log where op = '${e.op}'`), '1', `op_log holds « ${e.label} » once`);
  }
  for (const list of [y.mech.entries, y.office.entries]) {
    const order = list.map((e) => e.reachedAt);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sent in the order they were made');
  }
  // the screens: the server's truth, nothing refused
  for (const x of [mech, office]) await x.page.getByTestId('sync-chip').waitFor({ state: 'detached', timeout: 20000 });
  await mech.page.goto(h.APP + `#/job/${y.jobA}`);
  await mech.page.getByTestId('step-invoice').waitFor({ timeout: 15000 });
  await office.page.goto(h.APP + `#/job/${y.jobP}`);
  await office.page.getByTestId('stamp-paid').waitFor({ timeout: 20000 });
  const day = h.sql(`select day::text from public.jobs where customer_id = '${karim}'`);
  await office.page.goto(h.APP + `#/agenda/${day}`);
  await office.page.getByText('Karim').first().waitFor({ timeout: 20000 });
  await h.shot(mech.page, 'maj-4-mechanic-sent');
  await h.shot(office.page, 'maj-4-office-sent');
  noErrors(mech.page); noErrors(office.page);
  await m.putAway(mech); await m.putAway(office);
});

step('the way back (a rollback): a phone that ran the rebuilt app, with a change kept offline in its format, is given yesterday’s app again; it opens and sends that change once', async () => {
  const p = await m.phone('mecano');
  const { page } = p;
  await page.goto(h.APP + `#/job/${y.jobA}`);
  await page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  assert.equal(await m.whichApp(page), 'new');
  await page.getByTestId('job-km').waitFor({ timeout: 15000 });
  await p.ctx.setOffline(true);
  // a change kept on the phone by the rebuilt app: the km of the visit, corrected
  await page.getByTestId('job-km-edit').click();
  await page.getByTestId('car-check').waitFor();
  await page.getByTestId('car-check-km').fill(KM2);
  await page.getByTestId('car-check-save').click();
  await page.getByTestId('car-check').waitFor({ state: 'detached', timeout: 10000 });
  const dev = await m.readDevice(page, who.saleh.id);
  show('the rebuilt app’s waiting change', dev.outbox);
  assert.equal(dev.outbox.length, 1, 'one change waits');
  const kept = dev.outbox[0];
  assert.equal(kept.v, 2, 'written in the rebuilt app’s format');
  await m.putAway(p);

  // yesterday's app is published again; the server does not answer yet (only the files come)
  m.site.serve(m.DIST_OLD);
  m.signal.set(false);
  const q = await m.phone('mecano');
  await q.page.goto(h.APP);
  await q.page.getByTestId('app').waitFor({ timeout: 20000 });
  let how = 'by itself, as the app opened';
  if (await becomes(q.page, 'old', 20000) !== 'old') {
    how = 'Settings → App → « Check for updates » → « Update now »';
    await q.page.goto(h.APP + '#/settings/app');
    await q.page.getByTestId('update-check').click({ timeout: 15000 });
    await q.page.getByTestId('update-apply').click({ timeout: 40000 });
  }
  assert.equal(await becomes(q.page, 'old'), 'old', 'yesterday’s app runs again');
  show('the way back happened', how);
  await q.ctx.setOffline(true);
  await q.page.goto(h.APP + `#/job/${y.jobA}`);
  await q.page.getByTestId('job-screen').waitFor({ timeout: 15000 });
  assert.equal(await q.page.getByTestId('login').count(), 0, 'still signed in');
  const sheet = await m.syncSheet(q.page);
  show('yesterday’s app lists', sheet);
  assert.ok(sheet.text.includes(kept.label), `« ${kept.label} » is listed as waiting`);
  assert.doesNotMatch(sheet.text, /refus/i, 'nothing refused');
  await h.shot(q.page, 'maj-5-rollback-offline');
  // the signal comes back: yesterday's app sends the rebuilt app's change, once
  const mark = m.signal.log.length;
  m.signal.set(true);
  await q.ctx.setOffline(false);
  assert.equal(await until(() => h.sql(`select odometer_km::text from public.jobs where id = '${y.jobA}'`), (v) => v === KM2, 60000), KM2, 'the corrected km reached the server');
  const left = await until2(async () => (await m.readDevice(q.page, who.saleh.id)).outbox, (o) => o.length === 0, 30000);
  assert.deepEqual(left, [], 'nothing left waiting');
  const reached = m.signal.since(mark).filter((r) => r.status !== 'dropped' && r.method === 'PATCH' && r.path.endsWith('/jobs') && r.id === y.jobA);
  assert.equal(reached.length, 1, `sent once: ${JSON.stringify(reached.map((r) => r.status))}`);
  noErrors(q.page);
  await m.putAway(q);
});

/* ---------- two phones at once on the rebuilt app ---------- */
/** a coming day when only Camion Complet works (the planner cannot put the appointment on the other vehicle) */
function dayOnlyComplet() {
  return h.sql(`select d::date::text from generate_series(public.local_today() + 1, public.local_today() + 13, interval '1 day') d
    where exists (select 1 from public.truck_week w, jsonb_array_elements(w.ranges) r where w.truck_id = '${T.complet}' and w.dow = extract(dow from d) and w.deleted_at is null
                    and (r->>0)::int <= 720 and (r->>1)::int >= 960)
      and not exists (select 1 from public.truck_week w where w.truck_id = '${T.voiture}' and w.dow = extract(dow from d) and w.deleted_at is null and jsonb_array_length(w.ranges) > 0)
      and not exists (select 1 from public.truck_days t where t.day = d::date and t.deleted_at is null)
    order by d limit 1`);
}
/** a phone on the rebuilt app, signed in; `settled` resolves once its start-up work is over (the first pull, then the check
    « what do I still see? » 4 s after the start, which reads every table: its last one is « messages »). A change made
    after that reaches the phone only by the app's own following (realtime on the real server, the 45 s pull here). */
async function phoneNew(email, kind = 'phone') {
  const { ctx, page } = await h.open({ kind });
  m.watch(page);
  const settled = page.waitForResponse((r) => /\/rest\/v1\/messages\?select=id%2Cupdated_at/.test(r.url()), { timeout: 30000 });
  await h.signIn(page, email, PW);
  assert.equal(await m.whichApp(page), 'new', 'the rebuilt app');
  return { ctx, page, settled };
}

step('two phones at once on the rebuilt app: the office moves an appointment Saleh has open, his screen follows; the office takes a payment, his phone shows it; both press « Je pars » on the same job: once, and the second is told why', async () => {
  m.site.serve(m.DIST_NEW);
  m.signal.set(true);
  const jwt = await jwtOf(who.owner.email, PW);
  const rid = () => require('node:crypto').randomUUID();
  // Julie's appointment of the morning (steps before) waits for her payment at the office: it does not hold the truck
  h.sql(`update public.jobs set pay_later = true where customer_id = '${julie}' and status = 'on_site'`);
  const lina = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang) values ('Lina', 'Roy', '514 555-0123', '200 rue Jean-Talon E, Montréal, QC', 45.5340, -73.6140, 'fr') returning id`);
  const omar = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang) values ('Omar', 'Diallo', '514 555-0124', '6000 boul. Saint-Laurent, Montréal, QC', 45.5280, -73.6010, 'fr') returning id`);
  const zoe = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang) values ('Zoé', 'Lapointe', '514 555-0125', '300 rue Beaubien E, Montréal, QC', 45.5330, -73.6050, 'fr') returning id`);
  const X = await bookToday(jwt, lina, 'Freins e2e Lina');
  const Y = await bookToday(jwt, omar, 'Vidange e2e Omar');
  const Z = await bookToday(jwt, zoe, 'Pneus e2e Zoé');
  for (const a of ['leave', 'arrive']) await rpcAs(jwt, 'job_step', { p_op: rid(), p_job: Y, p_action: a, p_data: {} });
  await rpcAs(jwt, 'job_step', { p_op: rid(), p_job: Y, p_action: 'waiver', p_data: { signer: 'Omar Diallo', version: 'e2e' } });
  const inv = await rpcAs(jwt, 'invoice_for_job', { p_op: rid(), p_job: Y, p_refresh: true });
  await rpcAs(jwt, 'invoice_finish', { p_op: rid(), p_invoice: inv.rows.invoices[0].id });
  const target = dayOnlyComplet();
  assert.ok(target, 'a coming day when only Camion Complet works');

  const s = await phoneNew(who.saleh.email);
  const o = await phoneNew(who.nadia.email);
  await s.settled; await o.settled;
  // Saleh has Lina's appointment open
  await s.page.goto(h.APP + `#/job/${X}`);
  await s.page.getByTestId('job-moment').getByText(/Today|Aujourd/).first().waitFor({ timeout: 15000 });
  // the day of the move, as the job screen writes it (« Saturday, November 21 » / « Samedi 21 novembre »); tomorrow it
  // writes « Demain » / « Tomorrow » and no number (STATE 2026-11-21 00:50: the step failed every day that was so)
  const isTomorrow = target === h.sql(`select (public.local_today() + 1)::text`);
  const dayNum = isTomorrow ? '' : String(Number(target.slice(8)));
  // the office moves it to another day (same truck)
  await o.page.goto(h.APP + `#/job/${X}`);
  await o.page.getByTestId('job-move').click({ timeout: 15000 });
  await o.page.getByTestId('move-sheet').waitFor();
  await o.page.locator('[data-testid^="bp-cell-"]').first().waitFor({ timeout: 15000 });
  const cell = o.page.getByTestId(`bp-cell-${target}-pm`);
  for (let i = 0; i < 2 && !(await cell.count()); i++) await o.page.getByTestId('bp-later').click();
  await cell.click();
  await o.page.getByTestId('move-ok').click();
  // « Beaucoup de route ce jour-là »: the office books it anyway
  await o.page.getByTestId('move-sheet').waitFor({ state: 'detached', timeout: 15000 }).catch(async () => { await o.page.locator('[role=dialog] button.btn-primary, [role=dialog] [data-testid$="-ok"]').last().click(); });
  assert.equal(await until(() => h.sql(`select day::text || '|' || block from public.jobs where id = '${X}'`), (v) => v === `${target}|pm`, 15000), `${target}|pm`, 'moved on the server');
  // texts are not connected here: the message to Lina (« votre rendez-vous a changé ») is given to send by hand
  await o.page.getByTestId('text-outcome').waitFor({ timeout: 15000 });
  assert.match(await o.page.getByTestId('text-outcome-message').innerText(), /Lina/);
  await dismissSheets(o.page);
  // and the office takes Omar's cash at the counter
  await o.page.goto(h.APP + `#/job/${Y}`);
  await o.page.getByTestId('invoice-pay').click({ timeout: 15000 });
  await o.page.getByTestId('pay-sheet').waitFor();
  await o.page.getByTestId('pay-cash').click();
  await o.page.getByTestId('pay-confirm').click();
  assert.equal(await until(() => h.sql(`select status from public.invoices where job_id = '${Y}' and status <> 'void'`), (v) => v === 'paid', 15000), 'paid');
  // Saleh's screen follows, without a reload (no realtime on the test server: the app asks every 45 s)
  const t0 = Date.now();
  await s.page.waitForFunction((n) => { const x = document.querySelector('[data-testid="job-moment"]')?.innerText || ''; return !/Today|Aujourd/.test(x) && (n ? new RegExp(`\\b${n}\\b`).test(x) : /Demain|Tomorrow/.test(x)); }, dayNum, { timeout: 70000 });
  console.log(`# Saleh’s screen followed the move after ${Math.round((Date.now() - t0) / 1000)} s`);
  await h.shot(s.page, 'maj-5-moved');
  await s.page.goto(h.APP + `#/job/${Y}`);
  await s.page.getByTestId('stamp-paid').waitFor({ timeout: 15000 });

  // both press « Je pars » on Zoé's appointment at the same moment
  await s.page.goto(h.APP + `#/job/${Z}`);
  await o.page.goto(h.APP + `#/job/${Z}`);
  await s.page.getByTestId('step-leave').waitFor({ timeout: 15000 });
  await o.page.getByTestId('step-leave').waitFor({ timeout: 15000 });
  const mark = m.signal.log.length;
  await Promise.all([s.page.getByTestId('step-leave').click(), o.page.getByTestId('step-leave').click()]);
  assert.equal(await until(() => h.sql(`select status from public.jobs where id = '${Z}'`), (v) => v === 'en_route', 15000), 'en_route');
  const ofZ = () => m.signal.since(mark).filter((e) => e.rpc === 'job_step' && e.args?.p_job === Z);
  const steps = await until(ofZ, (l) => l.length === 2 && l.every((e) => e.status !== 0), 15000);
  console.log(`# « Je pars » sent: ${steps.map((e) => e.status).join(', ')}`);
  assert.equal(steps.length, 2, 'both phones sent their « Je pars »');
  assert.equal(steps.filter((e) => e.status === 200).length, 1, 'the server took one');
  // the one that came second is told in words, on its screen
  const told = await until2(async () => {
    for (const [who_, p] of [['Saleh', s.page], ['the office', o.page]]) { const t = await p.getByTestId('toast-bad').allInnerTexts(); if (t.length) return `${who_}: ${t.join(' | ')}`; }
    return '';
  }, (v) => !!v, 10000);
  console.log(`# the second phone read: ${told}`);
  assert.match(told, /déjà partie|plus possible|no longer possible|already/i, 'the second phone says why, in words');
  for (const p of [s.page, o.page]) await p.getByTestId('step-arrive').waitFor({ timeout: 15000 });
  assert.equal(Number(h.sql(`select count(*) from public.trips where job_id = '${Z}'`)) <= 1, true, 'one trip at most');
  await h.shot(o.page, 'maj-5-second');
  noErrors(s.page); noErrors(o.page);
  await s.ctx.close(); await o.ctx.close();
});
