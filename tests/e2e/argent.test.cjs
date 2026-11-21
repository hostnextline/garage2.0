// Money, end to end, on the local copy of the server (the production build, real sign-in, the real database rules, the
// functions on Deno, the fake Stripe of tests/stack/mocks.mjs with its signed notices). Each step follows people through
// the screens — the mechanic's phone at the door, the customer's phone, the office's computer, the treasurer — and checks
// what the screen says AND what the database holds (invoices, payments, activity, the Coffre, expenses, the
// reconciliation). The file runs by itself on a fresh database; the database is saved before and put back after.
//   on a Mac: bash tests/stack/mac/e2e.sh argent ["part of a step's name"]   on Linux: node --test tests/e2e/argent.test.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness.cjs');
const {
  PW, STRIPE_KEY, run, openW, noErrors, dismissSheets, draw, until, jwtOf, callAs, rpcAs,
  int, today, atDoor, invoiceRow, paymentsOf, jobStatus, fr, typed, tapTwice, answerAsk, jobPhone, makeAndFinish, amountField, receivedField,
  mockLog, clearMock, mockGet, payOnStripe, freeReconBrake, randomUUID
} = require('./argent.helpers.cjs');

// (the steps are made here, not in the helpers' file, so the report names this file)
const step = (name, fn) => test(name, run(name, fn));
/** a step that asserts the RIGHT behaviour but cannot pass yet: `why` starts with « BUG <id> » or « WAITS <request> » */
step.skip = (name, why, fn) => test(name, { skip: why }, run(name, fn));

const who = {};
let originalCounts;

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  const person = async (key, name, short, roles, truck = null) => {
    const email = `${key}-${n}@test.local`;
    who[key] = { email, id: await h.makePerson({ email, password: PW, name, short, roles, truck }) };
  };
  await person('owner', 'Hassan Jeha', 'Hassan', ['owner']);
  await person('saleh', 'Saleh Ismail', 'Saleh', ['mechanic'], 'Camion Complet');
  await person('nadia', 'Nadia Bureau', 'Nadia', ['office']);
  await person('louis', 'Louis Comptes', 'Louis', ['treasurer']);
  // card payment switched on, as the owner does it in Réglages → Branchements (a test copy of the server takes a test key)
  h.sql(`insert into public.secrets (key, value) values ('stripe_test_ok', 'on') on conflict (key) do update set value = 'on'`);
  const sk = await callAs(await jwtOf(who.owner.email), 'team', { action: 'secrets-set', stripe_key: STRIPE_KEY });
  assert.equal(sk.ok, true, 'Stripe is connected: ' + JSON.stringify(sk));
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

/* ---------- (1) the card online ---------- */
step('Carte en ligne: Saleh finishes Amélie’s invoice and texts her the card link; she pays on her phone (Stripe’s notice comes twice: one payment); her page says paid; Saleh’s phone shows PAYÉ and « Terminer la job » by itself', async () => {
  const a = atDoor({ first: 'Amélie', last: 'Roy', phone: '514 555-0161', items: [{ description: 'Freins avant', unit_cents: 20000 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  const inv = await makeAndFinish(m.page, a.job);
  assert.deepEqual([inv.subtotal, inv.tps, inv.tvq, inv.total, inv.paid], [20000, 1000, 1995, 22995, 0], 'the invoice with the Québec taxes');
  // « Encaisser »: she would rather pay on her phone; texts are not connected, so Saleh sends the text from his own phone
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  assert.match(await m.page.getByTestId('pay-balance').innerText(), fr(22995));
  await m.page.getByTestId('pay-link').click();
  await m.page.getByTestId('send-sheet').waitFor({ timeout: 15000 });
  const text = await m.page.getByTestId('send-message').innerText();
  assert.match(text, /229,95\s\$/, 'the text says the amount');
  const link = (text.match(/https?:\/\/\S+client\.html#\S+/) || [])[0];
  assert.ok(link, 'the text carries the customer’s page: ' + text);
  await dismissSheets(m.page);
  await h.shot(m.page, 'argent-1-mechanic-sent');

  // Amélie's phone: the text's link, the invoice, « Payer 229,95 $ par carte », Stripe's page, back to the garage's page
  const c = await openW({ kind: 'phone' });
  const paid = [];
  await payOnStripe(c.page, paid);
  await clearMock();
  await c.page.goto(link);
  await c.page.getByTestId('client-invoice').waitFor({ timeout: 15000 });
  assert.match(await c.page.getByTestId('client-pay-button').innerText(), /Payer 229,95\s\$ par carte/);
  await c.page.getByTestId('client-pay-button').click();
  await c.page.getByTestId('client-paid-note').waitFor({ timeout: 30000 });
  assert.match(await c.page.getByTestId('client-paid-note').innerText(), /Votre paiement est reçu/);
  await c.page.getByTestId('client-stamp').waitFor();
  await c.page.getByText('Facture payée. Merci').waitFor();
  assert.equal(await c.page.getByTestId('client-pay-button').count(), 0, 'nothing more to pay on her page');
  await h.shot(c.page, 'argent-1-customer-paid');
  // what Stripe was asked and sent: one card page for the invoice, its notice twice and the same notice once more
  assert.equal(paid.length, 1, 'one card page');
  const sid = paid[0].session;
  assert.deepEqual([paid[0].amount, paid[0].metadata.job_id, paid[0].metadata.invoice_id], [22995, a.job, inv.id]);
  assert.equal(paid[0].hook, 200, paid[0].result);
  const hooks = (await mockLog()).filter((x) => x.svc === 'stripe-webhook');
  assert.equal(hooks.length, 3, 'three notices reached the garage');
  assert.ok(hooks.every((x) => x.status === 200), 'each one answered 2xx (Stripe never sends it again): ' + JSON.stringify(hooks.map((x) => x.status)));
  assert.equal(new Set(hooks.map((x) => x.event)).size, 2, 'two different notices, one of them twice');
  assert.equal(int(`select count(*) from public.stripe_events where id in (${[...new Set(hooks.map((x) => `'${x.event}'`))].join(',')})`), 2, 'both notices noted as handled');
  // the books: ONE card payment, on the invoice, by nobody (Stripe), and the invoice paid exactly
  assert.equal(int(`select count(*) from public.payments where stripe_session = '${sid}'`), 1, 'one payment row for the card page');
  assert.deepEqual(paymentsOf(a.job), [['card_online', 22995, true, '']]);
  const after1 = invoiceRow(a.job);
  assert.deepEqual([after1.status, after1.paid, after1.total, after1.number], ['paid', 22995, 22995, inv.number]);
  assert.equal(int(`select count(*) from public.activity where entity_id = '${a.job}' and action in ('payment_unmatched', 'payment_parked', 'payment_moved')`), 0, 'nothing for the office to sort out');

  // Saleh's phone, still on the job, never reloaded: PAYÉ, and the red button is « Terminer la job »
  await m.page.getByTestId('stamp-paid').waitFor({ timeout: 60000 });
  await m.page.getByTestId('step-finish').waitFor({ timeout: 10000 });
  assert.match(await m.page.getByTestId('step-finish').innerText(), /Terminer la job[\s\S]*La facture est payée/);
  assert.equal(await m.page.getByTestId('step-pay').count(), 0, 'no « Encaisser » any more');
  assert.match(await m.page.getByTestId('payments').innerText(), /Carte en ligne[\s\S]*229,95\s\$/);
  await h.shot(m.page, 'argent-1-mechanic-paid');
  await m.page.getByTestId('step-finish').click();
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  noErrors(m.page); noErrors(c.page);
  await m.ctx.close(); await c.ctx.close();
});

/* ---------- (2) part payments at the door ---------- */
step('En plusieurs fois: Marc pays 100 $ cash, 150 $ by debit, the rest by credit at the door; the sheet and the red button offer what is left each time', async () => {
  const a = atDoor({ first: 'Marc', last: 'Gagnon', phone: '514 555-0162', items: [{ description: 'Pneus d’hiver posés', unit_cents: 40000 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  const inv = await makeAndFinish(m.page, a.job);
  assert.equal(inv.total, 45990);
  const pay = async (method, cents, left, n) => {
    assert.match(await m.page.getByTestId('step-pay').innerText(), new RegExp(`Encaisser[\\s\\S]*${fr(left).source} à payer`), 'the red button says what is left');
    await m.page.getByTestId('step-pay').click();
    await m.page.getByTestId('pay-sheet').waitFor();
    // what is left is offered, ready to take
    assert.match(await m.page.getByTestId('pay-balance').innerText(), fr(left));
    assert.equal(await amountField(m.page).inputValue(), typed(left));
    await m.page.getByTestId(`pay-${method}`).click();
    if (cents !== left) {
      await amountField(m.page).fill(typed(cents));
      await m.page.getByText(new RegExp(`Paiement en partie\\s:\\sil restera ${fr(left - cents).source} à payer`)).waitFor();
    }
    assert.match(await m.page.getByTestId('pay-confirm').innerText(), new RegExp(`Encaisser ${fr(cents).source}`));
    await m.page.getByTestId('pay-confirm').click();
    await m.page.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal((await until(() => paymentsOf(a.job), (v) => v.length === n, 15000)).length, n, `payment ${n} reached the server`);
  };
  await pay('cash', 10000, 45990, 1);
  // the second time, the sheet says what was paid already
  await pay('debit', 15000, 35990, 2);
  await pay('credit', 20990, 20990, 3);
  await m.page.getByTestId('stamp-paid').waitFor({ timeout: 15000 });
  await m.page.getByTestId('step-finish').waitFor();
  assert.deepEqual(paymentsOf(a.job), [['cash', 10000, true, who.saleh.id], ['debit', 15000, true, who.saleh.id], ['credit', 20990, true, who.saleh.id]]);
  const done = invoiceRow(a.job);
  assert.deepEqual([done.status, done.paid, done.total], ['paid', 45990, 45990]);
  assert.match(await m.page.getByTestId('payments').innerText(), /Comptant[\s\S]*100,00\s\$[\s\S]*Débit[\s\S]*150,00\s\$[\s\S]*Crédit[\s\S]*209,90\s\$/);
  await h.shot(m.page, 'argent-2-three-payments');
  await m.page.getByTestId('step-finish').click();
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  noErrors(m.page);
  await m.ctx.close();
});

/* ---------- (3) an over-payment ---------- */
/** Two phones on one invoice: the office has it open on its computer; Saleh's phone loses the signal and he takes the
    whole invoice in cash (kept on the phone); the office records the 100 $ the customer had sent by Interac; the signal
    comes back, Saleh's payment goes and the server refuses it. Ends with « Synchronisation » open on the refusal.
    Returns the office's page. */
async function refusedAtTheDoor(a, m) {
  // the office has the same invoice open on its computer
  const o = await jobPhone(who.nadia.email, a.job, 'desktop');
  await o.page.getByTestId('invoice-pay').waitFor({ timeout: 15000 });
  // Saleh's phone loses the signal; Sophie hands him the whole amount in cash: kept on the phone
  await m.ctx.setOffline(true);
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  await m.page.getByTestId('pay-cash').click();
  assert.equal(await amountField(m.page).inputValue(), typed(invoiceRow(a.job).total));
  await m.page.getByTestId('pay-confirm').click();
  await m.page.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
  await m.page.getByTestId('sync-chip').waitFor();
  assert.deepEqual(paymentsOf(a.job), [], 'nothing reached the server without signal');
  // meanwhile the office records the 100 $ she had sent by Interac this morning
  await o.page.getByTestId('invoice-pay').click();
  await o.page.getByTestId('pay-sheet').waitFor();
  await o.page.getByTestId('pay-interac').click();
  await amountField(o.page).fill('100,00');
  await o.page.getByTestId('pay-ref').fill('INT-4471');
  await o.page.getByTestId('pay-confirm').click();
  await o.page.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 1, 15000), [['interac', 10000, true, who.nadia.id]]);
  // the signal comes back: Saleh's payment goes, and the server refuses it, in words he can act on
  await m.ctx.setOffline(false);
  await m.page.locator('[data-testid="sync-chip"].has-failed').waitFor({ timeout: 30000 });
  await m.page.getByTestId('sync-chip').click();
  await m.page.getByTestId('sync-sheet').waitFor();
  await m.page.getByTestId('sync-sheet').getByText(new RegExp(`Il reste ${fr(invoiceRow(a.job).total - 10000).source} à payer sur cette facture\\s:\\sle montant écrit est trop haut\\.`)).waitFor({ timeout: 15000 });
  return o;
}

step('Trop payé: a zero too many is refused in words before anything is sent; two phones on Sophie’s invoice: Saleh, without signal, takes it all in cash while the office records her Interac deposit; back in signal the server refuses Saleh’s payment in words, nothing recorded twice; he keeps only what is left', async () => {
  const a = atDoor({ first: 'Sophie', last: 'Martin', phone: '514 555-0163', items: [{ description: 'Alternateur', unit_cents: 30000 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  const inv = await makeAndFinish(m.page, a.job);
  assert.equal(inv.total, 34493);
  // a zero too many: the sheet says it, in words, and nothing can be sent
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  await m.page.getByTestId('pay-cash').click();
  await amountField(m.page).fill('3449,30');
  await amountField(m.page).blur();
  await m.page.getByTestId('pay-sheet').getByText(/C’est plus que le reste à payer \(344,93\s\$\)\./).waitFor();
  assert.equal(await m.page.getByTestId('pay-confirm').isDisabled(), true, 'no « Encaisser » with that amount');
  await h.shot(m.page, 'argent-3-too-much-typed');
  assert.deepEqual(paymentsOf(a.job), [], 'nothing recorded');
  await dismissSheets(m.page);

  const o = await refusedAtTheDoor(a, m);
  await h.shot(m.page, 'argent-3-refused');
  assert.deepEqual(paymentsOf(a.job), [['interac', 10000, true, who.nadia.id]], 'only the office’s payment: nothing counted twice');
  const mid = invoiceRow(a.job);
  assert.deepEqual([mid.status, mid.paid, mid.total], ['issued', 10000, 34493]);
  await dismissSheets(m.page);
  // Saleh gives Sophie back the 100 $ she had already sent and keeps the rest in cash: the sheet offers 244,93 $
  await m.page.getByTestId('step-pay').filter({ hasText: /244,93\s\$ à payer/ }).waitFor({ timeout: 60000 });
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  assert.match(await m.page.getByTestId('pay-balance').innerText(), fr(24493));
  await m.page.getByTestId('pay-cash').click();
  await m.page.getByTestId('pay-confirm').click();
  await m.page.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 2, 15000), [['interac', 10000, true, who.nadia.id], ['cash', 24493, true, who.saleh.id]]);
  const done = invoiceRow(a.job);
  assert.deepEqual([done.status, done.paid], ['paid', 34493]);
  await m.page.getByTestId('step-finish').click({ timeout: 15000 });
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  noErrors(m.page); noErrors(o.page);
  await m.ctx.close(); await o.ctx.close();
});

// argent-refusal-cut (S30): on a phone, « Synchronisation » used to cut the reason of a refused change to one line with
// « … » (src/app/sync.tsx, the RowItem `sub`): Saleh read « Il reste 244,93 $ à p… » and never the end of the sentence that
// says what to do. The reason is now a paragraph that wraps (`sync-why`).
step('Refusé, lisible: on a phone, the reason a payment was refused is read in full in « Synchronisation »', async () => {
  const a = atDoor({ first: 'Nathalie', last: 'Roy', phone: '514 555-0169', items: [{ description: 'Démarreur', unit_cents: 30000 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  await makeAndFinish(m.page, a.job);
  const o = await refusedAtTheDoor(a, m);
  const reason = m.page.getByTestId('sync-sheet').getByText(/le montant écrit est trop haut\./);
  const box = await reason.evaluate((el) => ({ cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, text: el.textContent }));
  await h.shot(m.page, 'argent-3b-reason');
  assert.equal(box.cut, false, `the whole reason is on the screen: « ${box.text} »`);
  // the rest in cash, the job ends (the books of the day stay whole)
  await dismissSheets(m.page);
  const jwt = await jwtOf(who.saleh.email);
  const inv = invoiceRow(a.job);
  await rpcAs(jwt, 'payment_add', { p_op: randomUUID(), p_invoice: inv.id, p_amount_cents: inv.total - inv.paid, p_method: 'cash', p_reference: null, p_job: a.job, p_session: null });
  await rpcAs(jwt, 'job_step', { p_op: randomUUID(), p_job: a.job, p_action: 'finish', p_data: {} });
  noErrors(m.page); noErrors(o.page);
  await m.ctx.close(); await o.ctx.close();
});

/* ---------- (4) cash with change ---------- */
step('Comptant avec monnaie: Paul hands a 120 $ bill for 103,47 $: rounded to 5 ¢, the app says to give back 16,55 $ and records 103,47 $ only', async () => {
  const a = atDoor({ first: 'Paul', last: 'Côté', phone: '514 555-0164', items: [{ description: 'Vidange d’huile synthétique', unit_cents: 8999 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  const inv = await makeAndFinish(m.page, a.job);
  assert.deepEqual([inv.tps, inv.tvq, inv.total], [450, 898, 10347]);
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  await m.page.getByTestId('pay-cash').click();
  await m.page.getByTestId('pay-cash').getByText(/Comptant\s:\sarrondi aux 5 ¢, soit 103,45\s\$\./).waitFor();
  // the bills he is handed: one tap
  await m.page.getByTestId('pay-cash').locator('button.pay-bill', { hasText: /^120\s\$$/ }).click();
  assert.equal(await until(() => receivedField(m.page).inputValue(), (v) => v === '120,00', 5000), '120,00', 'the bill tapped is the amount received');
  assert.match(await m.page.getByTestId('pay-change').innerText(), /Rendre[\s\S]*16,55\s\$/);
  assert.match(await m.page.getByTestId('pay-confirm').innerText(), /Encaisser 103,47\s\$/, 'only what is due is recorded');
  await h.shot(m.page, 'argent-4-change');
  await m.page.getByTestId('pay-confirm').click();
  await m.page.getByText(/Paiement enregistré\. Rends 16,55\s\$\./).waitFor({ timeout: 15000 });
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 1, 15000), [['cash', 10347, true, who.saleh.id]]);
  const done = invoiceRow(a.job);
  assert.deepEqual([done.status, done.paid], ['paid', 10347], 'paid in full, not a cent more');
  await m.page.getByTestId('step-finish').click({ timeout: 15000 });
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  noErrors(m.page);
  await m.ctx.close();
});

/* the day's sheet of the reconciliation panel (« Facturé », « Reçu : … », …), as [words, amount text] */
const sheetLines = async (page) => page.getByTestId('recon-sheet').locator('div').evaluateAll((els) => els.map((d) => [d.querySelector('dt')?.textContent.trim(), d.querySelector('dd')?.textContent.trim()]));
/** the treasurer's Trésorerie for today, « Vérifier maintenant », and « Tout balance » with the day's sheet */
async function checkNow(page) {
  freeReconBrake();
  const before = h.sql(`select coalesce(max(finished_at)::text, '') from public.ops_recon_runs`);
  // the panel's own answer, then the summary it asks again: the next look at the panel (its sheet, a toast, the server's
  // answer to another tap) never takes what was on screen before this check (a race seen on 2026-11-20: the sheet of an
  // older check read, the toast of this check taken for the next one's)
  const answered = page.waitForResponse((r) => /\/rpc\/recon_now/.test(r.url()), { timeout: 30000 });
  await page.getByTestId('recon-check').click();
  const reread = page.waitForResponse((r) => /\/rpc\/recon_summary/.test(r.url()), { timeout: 30000 });
  await (await answered).finished();
  await (await reread).finished();
  await until(() => h.sql(`select coalesce(max(finished_at)::text, '') from public.ops_recon_runs`), (v) => v !== before, 30000);
  // the panel drawn from that summary (a moment after the answer)
  await page.waitForTimeout(300);
}
const owingNow = () => int(`select coalesce(sum(greatest(total_cents - paid_cents, 0)), 0) from public.invoices where deleted_at is null and status = 'issued'`);

/* ---------- (5) pay later ---------- */
step('Payer plus tard: Luc will pay at the end of the month; Saleh may not let him go, the office does from its computer with the reason; the job is done, the invoice stays to receive (« Reste à recevoir » in Trésorerie); later the office records his cheque', async () => {
  const a = atDoor({ first: 'Luc', last: 'Bélanger', phone: '514 555-0165', items: [{ description: 'Batterie', unit_cents: 18000 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  const inv = await makeAndFinish(m.page, a.job);
  assert.equal(inv.total, 20696);
  assert.equal(await m.page.getByTestId('job-pay-later').count(), 0, 'a mechanic does not let a customer leave without paying');
  // the office, on its computer, on the same job: « Le client paiera plus tard », and why
  const o = await jobPhone(who.nadia.email, a.job, 'desktop');
  await o.page.getByTestId('job-pay-later').click({ timeout: 15000 });
  await answerAsk(o.page, 'Laisser partir sans paiement', 'Paie à la fin du mois, client depuis 2019');
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  assert.equal(h.sql(`select pay_later || '|' || coalesce(pay_later_reason, '') from public.jobs where id = '${a.job}'`), 'true|Paie à la fin du mois, client depuis 2019');
  const later = invoiceRow(a.job);
  assert.deepEqual([later.status, later.paid, later.total], ['issued', 0, 20696], 'the invoice stays to receive');
  assert.deepEqual(paymentsOf(a.job), []);
  await o.page.getByTestId('job-done').getByText(/Le client paiera plus tard\s:\sPaie à la fin du mois/).waitFor({ timeout: 15000 });
  // Saleh's phone follows by itself: done, Luc pays later
  await m.page.getByTestId('job-done').getByText(/Le client paiera plus tard/).waitFor({ timeout: 60000 });
  await h.shot(m.page, 'argent-5-mechanic-later');
  // the treasurer: the day balances, and what is still to receive is said in Trésorerie
  const t = await openW({ kind: 'desktop' });
  await h.signIn(t.page, who.louis.email, PW);
  const day = today();
  await t.page.goto(h.APP + `#/treasury?p=custom&from=${day}&to=${day}`);
  await t.page.getByTestId('treasury-recon').waitFor({ timeout: 15000 });
  await checkNow(t.page);
  await t.page.getByTestId('recon-ok').waitFor({ timeout: 15000 });
  const owing = owingNow();
  assert.ok(owing >= 20696, 'Luc’s invoice is to receive');
  assert.deepEqual((await sheetLines(t.page)).find(([k]) => k === 'Reste à recevoir'), ['Reste à recevoir', (await t.page.evaluate((c) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(c / 100), owing))]);
  await t.page.getByTestId('treasury-recon').scrollIntoViewIfNeeded(); await h.shot(t.page, 'argent-5-to-receive');
  // later: Luc's cheque comes in; the office finds his invoice among those to receive and records it
  await o.page.goto(h.APP + '#/invoices');
  await o.page.getByTestId('owing-total').waitFor({ timeout: 15000 });
  assert.match(await o.page.getByTestId('owing-total').innerText(), fr(owing));
  await o.page.getByTestId('invoice-row').filter({ hasText: 'Bélanger' }).locator('a').click();
  await o.page.getByTestId('invoice-pay').click({ timeout: 15000 });
  await o.page.getByTestId('pay-sheet').waitFor();
  assert.match(await o.page.getByTestId('pay-balance').innerText(), fr(20696));
  await o.page.getByTestId('pay-cheque').click();
  await o.page.getByTestId('pay-ref').fill('112');
  await o.page.getByTestId('pay-confirm').click();
  await o.page.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 1, 15000), [['cheque', 20696, true, who.nadia.id]]);
  assert.equal(h.sql(`select reference from public.payments where invoice_id = '${inv.id}'`), '112');
  const paidLater = invoiceRow(a.job);
  assert.deepEqual([paidLater.status, paidLater.paid], ['paid', 20696]);
  // Trésorerie again: nothing more to receive from Luc
  await checkNow(t.page);
  const left = owingNow();
  assert.equal(left, owing - 20696);
  await t.page.getByTestId('recon-sheet').getByText(fr(left)).first().waitFor({ timeout: 15000 });
  noErrors(m.page); noErrors(o.page); noErrors(t.page);
  await m.ctx.close(); await o.ctx.close(); await t.ctx.close();
});

/* ---------- (6) a refund made in Stripe ---------- */
step('Remboursement Stripe: Chantal pays ahead from the arrival text; the wipers are not done, the invoice is lower than what she paid: « Trop-perçu »; the garage gives the difference back in Stripe (its notice twice): one negative card payment, the invoice paid exactly, the day’s numbers follow', async () => {
  const a = atDoor({ first: 'Chantal', last: 'Dubé', phone: '514 555-0166', at: 'en_route',
    items: [{ description: 'Freins arrière', unit_cents: 20000 }, { description: 'Essuie-glaces', unit_cents: 3000 }] });
  h.sql(`update public.jobs set waiver_signed_at = now(), waiver_signer = 'Chantal Dubé', waiver_version = '1', waiver_via = 'online' where id = '${a.job}'`);
  const m = await jobPhone(who.saleh.email, a.job);
  // « Je suis arrivé »: the invoice of the work goes to Chantal to pay during the work (Saleh sends the text himself)
  await m.page.getByTestId('step-arrive').click({ timeout: 15000 });
  await m.page.getByTestId('text-outcome').waitFor({ timeout: 15000 });
  const text = await m.page.getByTestId('text-outcome-message').innerText();
  assert.match(text, /264,44\s\$/);
  const link = (text.match(/https?:\/\/\S+client\.html#\S+/) || [])[0];
  assert.ok(link, 'the text carries her page: ' + text);
  await dismissSheets(m.page);
  assert.equal(invoiceRow(a.job)?.status, 'draft', 'the invoice being made');
  // her phone: « Payer maintenant 264,44 $ » while the work goes on
  const c = await openW({ kind: 'phone' });
  const paid = [];
  await payOnStripe(c.page, paid);
  await c.page.goto(link);
  await c.page.getByTestId('client-pay-button').waitFor({ timeout: 15000 });
  assert.match(await c.page.getByTestId('client-pay-button').innerText(), /Payer maintenant 264,44\s\$/);
  await c.page.getByTestId('client-pay-button').click();
  await c.page.getByTestId('client-paid-note').waitFor({ timeout: 30000 });
  assert.equal(paid.length, 1);
  const sid = paid[0].session;
  assert.deepEqual(paymentsOf(a.job), [['card_online', 26444, false, '']], 'paid ahead: it waits on the job until the invoice is finished');
  // the wipers were not needed after all: Saleh takes them off the invoice (they become « Pas fait »), then finishes it
  await m.page.getByTestId('line-desc').nth(1).waitFor({ timeout: 15000 });
  assert.equal(await m.page.getByTestId('line-desc').nth(1).inputValue(), 'Essuie-glaces');
  await m.page.getByTestId('line-remove').nth(1).click();
  assert.equal(await until(() => h.sql(`select status from public.job_items where id = '${a.items[1]}'`), (v) => v === 'removed', 15000), 'removed');
  await m.page.getByTestId('invoice-finish').click();
  const over = await until(() => invoiceRow(a.job), (v) => v && v.status !== 'draft', 15000);
  assert.deepEqual([over.status, over.total, over.paid], ['paid', 22995, 26444], 'paid more than the invoice');
  assert.equal(h.sql(`select (data->>'over')::int from public.activity where action = 'overpaid' and entity_id = '${a.job}'`), '3449', 'the trop-perçu is noted');
  await m.page.getByTestId('invoice-over').waitFor({ timeout: 15000 });
  assert.match(await m.page.getByTestId('invoice-over').innerText(), /Trop-perçu\s:\s34,49\s\$ à remettre au client/);
  await h.shot(m.page, 'argent-6-over');
  await m.page.getByTestId('step-finish').click({ timeout: 15000 });
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  // the office gives the 34,49 $ back from Stripe's own screens; Stripe's notice « charge.refunded » comes twice
  await clearMock();
  const r = await mockGet(`/refund/${sid}?amount=3449&twice=1`);
  assert.equal(r.hook, 200, r.result);
  const hooks = (await mockLog()).filter((x) => x.svc === 'stripe-webhook');
  assert.deepEqual(hooks.map((x) => [x.type, x.status]), [['charge.refunded', 200], ['charge.refunded', 200]]);
  assert.deepEqual(paymentsOf(a.job), [['card_online', 26444, true, ''], ['card_online', -3449, true, '']], 'the refund once, as a negative card payment on the invoice');
  assert.equal(h.sql(`select stripe_session || '|' || reference from public.payments where amount_cents < 0 and invoice_id = '${over.id}'`), `${sid}#${r.refund}|${r.refund}`);
  assert.equal(int(`select count(*) from public.activity where action = 'payment_refund' and entity_id = '${a.job}'`), 1, 'noted once');
  const after6 = invoiceRow(a.job);
  assert.deepEqual([after6.status, after6.paid, after6.total], ['paid', 22995, 22995], 'paid exactly, nothing more to give back');
  // the office's computer: the refund in the payments, no « Trop-perçu » any more
  const o = await jobPhone(who.nadia.email, a.job, 'desktop');
  await o.page.getByTestId('payments').waitFor({ timeout: 15000 });
  assert.match(await o.page.getByTestId('payments').innerText(), /Carte en ligne[\s\S]*264,44\s\$[\s\S]*Remboursement \(Carte en ligne\)[\s\S]*[-−]\s?34,49\s\$/);
  assert.equal(await o.page.getByTestId('invoice-over').count(), 0);
  await o.page.getByTestId('stamp-paid').waitFor();
  await h.shot(o.page, 'argent-6-refunded');
  // the treasurer's numbers of the day follow: card money net of the refund
  const t = await openW({ kind: 'desktop' });
  await h.signIn(t.page, who.louis.email, PW);
  const day = today();
  await t.page.goto(h.APP + `#/treasury?p=custom&from=${day}&to=${day}`);
  await t.page.getByTestId('treasury-collected').waitFor({ timeout: 15000 });
  const card = int(`select coalesce(sum(amount_cents), 0) from public.payments where deleted_at is null and method = 'card_online' and (paid_at at time zone 'America/Toronto')::date = public.local_today()`);
  const bar = t.page.getByTestId('treasury-collected').locator('.dash-hbar', { hasText: 'Carte en ligne' });
  assert.match(await bar.locator('.dash-hbar-value').innerText(), fr(card));
  noErrors(m.page); noErrors(c.page); noErrors(o.page); noErrors(t.page);
  await m.ctx.close(); await c.ctx.close(); await o.ctx.close(); await t.ctx.close();
});

/* ---------- (7) work added after the invoice is paid ---------- */
/** Éric's appointment: the invoice finished and paid in cash, then the wipers he asked for at the door, accepted (the
    state step 7 leaves; made here with the server's own operations when step 7 did not run) */
let eric = null;
async function ericPaidWithWipers() {
  if (eric) return eric;
  const a = atDoor({ first: 'Éric', last: 'Lavoie', phone: '514 555-0167', items: [{ description: 'Courroie', unit_cents: 15000 }] });
  const jwt = await jwtOf(who.saleh.email);
  const d = await rpcAs(jwt, 'invoice_for_job', { p_op: randomUUID(), p_job: a.job, p_refresh: true });
  const invId = d.rows.invoices[0].id;
  await rpcAs(jwt, 'invoice_finish', { p_op: randomUUID(), p_invoice: invId });
  await rpcAs(jwt, 'payment_add', { p_op: randomUUID(), p_invoice: invId, p_amount_cents: 17246, p_method: 'cash', p_reference: null, p_job: a.job, p_session: null });
  const wipers = h.sql(`insert into public.job_items (job_id, description, unit_cents, qty, kind, status, taxable, sort, answered_at, answered_via)
    values ('${a.job}', 'Essuie-glaces', 3000, 1, 'labour', 'approved', true, 1, now(), 'signature') returning id`);
  eric = { ...a, wipers };
  return eric;
}
step('Travail ajouté après la facture payée: Éric paid; at the door he asks for wipers and signs for them: they are on no invoice, so the red button says to put them on it (never « Terminer la job »), and the server refuses to finish, naming the work', async () => {
  const a = atDoor({ first: 'Éric', last: 'Lavoie', phone: '514 555-0167', items: [{ description: 'Courroie', unit_cents: 15000 }] });
  const m = await jobPhone(who.saleh.email, a.job);
  const inv = await makeAndFinish(m.page, a.job);
  assert.equal(inv.total, 17246);
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  await m.page.getByTestId('pay-cash').click();
  await m.page.getByTestId('pay-confirm').click();
  await m.page.getByTestId('step-finish').waitFor({ timeout: 15000 });
  // the red button moves on as soon as the payment is taken on the phone (it counts the payment still leaving): wait for the row
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 1, 15000), [['cash', 17246, true, who.saleh.id]]);
  // « Proposer un travail »: the wipers, 30 $; Éric signs on the phone
  await m.page.getByTestId('work-propose').click();
  await m.page.getByTestId('propose-sheet').waitFor();
  await m.page.getByTestId('propose-what').fill('Essuie-glaces');
  await m.page.getByTestId('propose-sheet').locator('input.input-money').fill('30,00');
  await m.page.getByTestId('propose-ok').click();
  await m.page.getByTestId('answer-sheet').waitFor({ timeout: 15000 });
  await draw(m.page, 'answer-pad');
  await m.page.getByTestId('answer-yes').click();
  await m.page.getByTestId('answer-sheet').waitFor({ state: 'detached', timeout: 15000 });
  const wipers = await until(() => h.sql(`select id from public.job_items where job_id = '${a.job}' and description = 'Essuie-glaces' and status = 'approved'`), Boolean, 15000);
  assert.ok(wipers, 'the wipers are accepted');
  // the red button: put the wipers on the invoice; « Terminer la job » is not offered
  await m.page.getByTestId('step-unbilled').waitFor({ timeout: 15000 });
  assert.match(await m.page.getByTestId('step-unbilled').innerText(), /Mettre le travail sur la facture[\s\S]*Essuie-glaces/);
  assert.equal(await m.page.getByTestId('step-finish').count(), 0, 'no « Terminer la job » while work is on no invoice');
  assert.match(await m.page.getByTestId('work-unbilled').innerText(), /Essuie-glaces/);
  await h.shot(m.page, 'argent-7-unbilled');
  // the server refuses « Terminer » the same way (whatever phone asks), in words that name the work
  let refused = null;
  try { await rpcAs(await jwtOf(who.saleh.email), 'job_step', { p_op: randomUUID(), p_job: a.job, p_action: 'finish', p_data: {} }); }
  catch (e) { refused = e; }
  assert.ok(refused, 'refused');
  assert.equal(refused.hint, 'unbilled', JSON.stringify(refused));
  assert.match(refused.message, /Un travail n’est pas sur la facture \(Essuie-glaces\)/);
  assert.equal(jobStatus(a.job), 'on_site');
  const still = invoiceRow(a.job);
  assert.deepEqual([still.status, still.paid, still.total, still.number], ['paid', 17246, 17246, inv.number], 'the paid invoice is not changed by itself');
  eric = { ...a, wipers };
  noErrors(m.page);
  await m.ctx.close();
});

// R42: « Modifier la facture » on a PAID invoice (src/shared/invoices/Reopen.tsx, mayReopen): the invoice panel and the
// « not on the invoice » banner offer it for a paid invoice while the job is booked, en route or on site (the server's
// invoice_reopen takes a paid one since Part 27).
step('Travail ajouté après la facture payée, suite: Saleh opens the PAID invoice again (« Modifier la facture »), the wipers go on it, he takes the difference and finishes; the invoice keeps its number', async () => {
  const a = await ericPaidWithWipers();
  const counter = h.sql(`select next_value from public.counters where name = 'invoice'`);
  const before7 = invoiceRow(a.job);
  assert.deepEqual([before7.status, before7.paid], ['paid', 17246]);
  const m = await jobPhone(who.saleh.email, a.job);
  // the red button leads to the invoice; « Modifier la facture » (a confirm button: two taps)
  await m.page.getByTestId('step-unbilled').click({ timeout: 15000 });
  await tapTwice(m.page.getByTestId('invoice-reopen').first());
  assert.equal((await until(() => invoiceRow(a.job), (v) => v.status === 'draft', 15000)).number, before7.number, 'back to a draft, same number');
  assert.deepEqual(paymentsOf(a.job), [['cash', 17246, false, who.saleh.id]], 'what Éric paid waits on the job meanwhile');
  await m.page.getByTestId('draft-reopened').waitFor({ timeout: 15000 });
  // the wipers come onto the draft by themselves
  await m.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="line-desc"]')].some((i) => i.value === 'Essuie-glaces'), null, { timeout: 15000 });
  await m.page.getByTestId('invoice-finish').click();
  const again = await until(() => invoiceRow(a.job), (v) => v.status !== 'draft', 15000);
  assert.deepEqual([again.status, again.number, again.total, again.paid], ['issued', before7.number, 20696, 17246], 'the same number, the new total, what was paid counted');
  assert.equal(h.sql(`select next_value from public.counters where name = 'invoice'`), counter, 'no number spent');
  assert.equal(h.sql(`select data->>'was' from public.activity where action = 'invoice_reopened' and entity_id = '${a.job}'`), 'paid');
  // the difference: 34,50 $, in cash
  assert.match(await m.page.getByTestId('step-pay').innerText(), /34,50\s\$ à payer/);
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  assert.match(await m.page.getByTestId('pay-balance').innerText(), fr(3450));
  await m.page.getByTestId('pay-cash').click();
  await m.page.getByTestId('pay-confirm').click();
  await m.page.getByTestId('step-finish').waitFor({ timeout: 15000 });
  // the red button moves on as soon as the payment is taken on the phone (it counts the payment still leaving): wait for the row
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 2, 15000), [['cash', 17246, true, who.saleh.id], ['cash', 3450, true, who.saleh.id]]);
  const done = await until(() => invoiceRow(a.job), (v) => v.paid === 20696, 15000);
  assert.deepEqual([done.status, done.paid, done.total, done.number], ['paid', 20696, 20696, before7.number]);
  await m.page.getByTestId('step-finish').click();
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  noErrors(m.page);
  await m.ctx.close();
});

/* ---------- (8) the Coffre ---------- */
step('Coffre: the owner puts his aunt Mona’s oil change in the Coffre (40 $ given, no invoice, no taxes); Saleh finishes without collecting; the Coffre screen of the day and its totals', async () => {
  const a = atDoor({ first: 'Mona', last: 'Haddad', phone: '514 555-0168', items: [{ description: 'Vidange d’huile', unit_cents: 8000 }] });
  const o = await jobPhone(who.owner.email, a.job, 'desktop');
  await o.page.getByTestId('job-menu').click();
  await o.page.getByTestId('menu-coffre').click();
  await o.page.getByTestId('coffre-sheet').waitFor();
  assert.equal(await o.page.getByTestId(`coffre-job-${a.job}`).isChecked(), true, 'this job is checked');
  await o.page.getByTestId('coffre-sheet').locator('input.input-money').fill('40,00');
  await o.page.getByTestId('coffre-save').click();
  await o.page.getByTestId('coffre-sheet').waitFor({ state: 'detached', timeout: 15000 });
  const box = await until(() => h.sql(`select id || '|' || kind || '|' || amount_cents || '|' || value_cents from public.coffre where '${a.job}' = any(job_ids) and deleted_at is null`), Boolean, 15000);
  const [coffreId, kind, amount, value] = box.split('|');
  assert.deepEqual([kind, Number(amount), Number(value)], ['received', 4000, 8000], '40 $ given for 80 $ of work, no taxes');
  assert.equal(h.sql(`select coffre_id from public.jobs where id = '${a.job}'`), coffreId);
  assert.equal(int(`select count(*) from public.invoices where job_id = '${a.job}' and deleted_at is null and status <> 'void'`), 0, 'no invoice');
  assert.deepEqual(paymentsOf(a.job), [], 'no payment');
  await o.page.getByTestId('job-coffre').waitFor({ timeout: 15000 });
  // Saleh's phone: nothing to collect, « Terminer la job »
  const m = await jobPhone(who.saleh.email, a.job);
  await m.page.getByTestId('step-finish').click({ timeout: 15000 });
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
  // the Coffre screen of the day: the entry and the totals, as the Coffre's rows say
  const day = today();
  await o.page.goto(h.APP + `#/coffre?p=custom&from=${day}&to=${day}`);
  await o.page.getByTestId('coffre-totals').waitFor({ timeout: 15000 });
  await o.page.getByTestId(`coffre-row-${coffreId}`).waitFor();
  assert.match(await o.page.getByTestId(`coffre-row-${coffreId}`).innerText(), /Mona Haddad[\s\S]*40,00\s\$/);
  const given = int(`select coalesce(sum(amount_cents), 0) from public.coffre where deleted_at is null and kind = 'received' and received_on = public.local_today()`);
  const spent = int(`select coalesce(sum(amount_cents), 0) from public.coffre where deleted_at is null and kind = 'purchase' and received_on = public.local_today()`);
  const balance = int(`select coalesce(sum(case when kind = 'purchase' then -amount_cents else amount_cents end), 0) from public.coffre where deleted_at is null`);
  assert.match(await o.page.getByTestId('coffre-amount').innerText(), fr(given));
  assert.match(await o.page.getByTestId('coffre-spent').innerText(), fr(spent));
  assert.match(await o.page.getByTestId('coffre-balance').innerText(), fr(balance));
  await h.shot(o.page, 'argent-8-coffre');
  noErrors(o.page); noErrors(m.page);
  await o.ctx.close(); await m.ctx.close();
});

/* ---------- (9) an expense with its receipt photo ---------- */
step('Dépense avec le reçu: Louis takes the photo of a Canadian Tire receipt (the reader cannot load: he types the total); the expense and its photo reach the server; the list shows it', async () => {
  const t = await openW({ kind: 'phone' });
  // the receipt reader comes from a CDN: not reachable here, the person types the amounts (the app says so)
  await t.ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
  // the photo: a receipt printed on a page, photographed
  const shoot = await t.ctx.newPage();
  await shoot.setContent(`<div style="font:16px monospace;padding:24px;width:320px;background:#fff">CANADIAN TIRE #0412<br>2026-11-16<br><br>Huile 5W30 x2 ...... 59,98<br>Filtre ............ 15,02<br><br>SOUS-TOTAL ........ 75,00<br>TPS ................ 3,75<br>TVQ ................ 7,48<br>TOTAL ............. 86,23</div>`);
  const photo = await shoot.screenshot({ type: 'png' });
  await shoot.close();
  await h.signIn(t.page, who.louis.email, PW);
  await t.page.goto(h.APP + '#/treasury?add=1');
  await t.page.getByTestId('expense-sheet').waitFor({ timeout: 15000 });
  await t.page.getByTestId('receipt-file').setInputFiles({ name: 'recu-canadian-tire.png', mimeType: 'image/png', buffer: photo });
  await t.page.getByTestId('receipt-thumb').waitFor({ timeout: 15000 });
  await t.page.getByTestId('receipt-message').getByText(/Écris les montants/).waitFor({ timeout: 30000 });
  await t.page.locator('[data-testid="expense-sheet"] input.input-money').first().fill('86,23');
  await t.page.getByTestId('expense-vendor').fill('Canadian Tire');
  const category = await t.page.locator('[data-testid="expense-sheet"] select').first().evaluate((s) => [...s.options].find((o) => o.value && !o.disabled)?.value);
  await t.page.locator('[data-testid="expense-sheet"] select').first().selectOption(category);
  await t.page.getByTestId('expense-method').getByRole('button', { name: 'Débit' }).click();
  await t.page.getByTestId('expense-sum').waitFor();
  await h.shot(t.page, 'argent-9-expense');
  await t.page.getByTestId('expense-save').click();
  await t.page.getByTestId('expense-sheet').waitFor({ state: 'detached', timeout: 30000 });
  const row = await until(() => h.sql(`select id || '|' || subtotal_cents || '|' || tps_cents || '|' || tvq_cents || '|' || total_cents || '|' || category || '|' || coalesce(method, '') || '|' || coalesce(receipt_id::text, '') || '|' || day
    from public.expenses where vendor = 'Canadian Tire' and deleted_at is null`), (v) => v && v.split('|')[7], 15000);
  const [, sub, tps, tvq, total, cat, method, receipt, day] = row.split('|');
  assert.equal(Number(total), 8623);
  assert.equal(Number(sub) + Number(tps) + Number(tvq), 8623, 'before taxes + TPS + TVQ = the total');
  assert.deepEqual([cat, method, day], [category, 'debit', today()]);
  assert.ok(receipt, 'the receipt photo is attached');
  assert.equal(h.sql(`select kind || '|' || mime || '|' || (bytes > 1000) from public.attachments where id = '${receipt}'`), 'receipt|image/jpeg|true', 'the photo itself is on the server');
  await t.page.getByTestId('expense-row').filter({ hasText: 'Canadian Tire' }).waitFor({ timeout: 15000 });
  assert.match(await t.page.getByTestId('expense-row').filter({ hasText: 'Canadian Tire' }).innerText(), /86,23\s\$/);
  noErrors(t.page);
  await t.ctx.close();
});

/* ---------- (10) the day's books and the reconciliation ---------- */
step('Les livres de la journée: Trésorerie for today — revenue, money in by method and by person, refunds, expenses, the Coffre — each equal to the rows; « Vérifier maintenant »: « Tout balance »; a payment taken out behind the app’s back is found in words at the next check, and « Vu » notes it', async () => {
  const t = await openW({ kind: 'desktop' });
  await h.signIn(t.page, who.louis.email, PW);
  const day = today();
  const money = (c) => t.page.evaluate((x) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(x / 100), c);
  await t.page.goto(h.APP + `#/treasury?p=custom&from=${day}&to=${day}`);
  await t.page.getByTestId('treasury-report').waitFor({ timeout: 15000 });
  // the report of the day (the server's treasury_report) against the rows
  const inv = `from public.invoices where deleted_at is null and status in ('issued', 'paid') and (issued_at at time zone 'America/Toronto')::date = public.local_today()`;
  const exp = `from public.expenses where deleted_at is null and day = public.local_today()`;
  const revenue = int(`select coalesce(sum(subtotal_cents), 0) ${inv}`), nInv = int(`select count(*) ${inv}`);
  const spent = int(`select coalesce(sum(subtotal_cents), 0) ${exp}`), nExp = int(`select count(*) ${exp}`);
  assert.ok(nInv > 0 && nExp > 0, 'the day has invoices and expenses (the steps before)');
  await t.page.getByTestId('treasury-profit').waitFor({ timeout: 15000 });
  const lines = await t.page.getByTestId('treasury-report').locator('.tre-lines > div').evaluateAll((els) => els.map((d) => [d.querySelector('dt').textContent.replace(/\s+/g, ' ').trim(), d.querySelector('dd').textContent.trim()]));
  assert.deepEqual(lines[0], [`Revenus ${nInv} factures`, await money(revenue)], 'the revenue of the day (before taxes)');
  assert.deepEqual(lines[1], [`Dépenses ${nExp} ${nExp > 1 ? 'dépenses' : 'dépense'}`, `−${await money(spent)}`], 'the expenses of the day (before taxes)');
  assert.equal((await t.page.getByTestId('treasury-profit').innerText()).replace(/\s+/g, ''), (await money(revenue - spent)).replace(/\s+/g, ''), 'the profit of the day');
  // money in by method (the refund counts against the card)
  const byMethod = h.sql(`select coalesce(string_agg(method || ':' || s, ',' order by method), '') from (select method, sum(amount_cents) s from public.payments
    where deleted_at is null and (paid_at at time zone 'America/Toronto')::date = public.local_today() group by method) x`).split(',').filter(Boolean).map((x) => x.split(':'));
  const word = { cash: 'Comptant', debit: 'Débit', credit: 'Carte de crédit', interac: 'Virement Interac', card_online: 'Carte en ligne', cheque: 'Chèque', other: 'Autre' };
  for (const [method, cents] of byMethod) {
    const bar = t.page.getByTestId('treasury-collected').locator('.dash-hbar').filter({ has: t.page.locator('.dash-hbar-label', { hasText: new RegExp(`^${word[method]}$`) }) });
    assert.equal(await bar.locator('.dash-hbar-value').innerText(), await money(Number(cents)), `collected by ${method}`);
  }
  assert.equal(await t.page.getByTestId('treasury-collected').locator('.dash-hbar').count(), byMethod.length);

  // « Vérifier maintenant »: the day balances, and its sheet says the same as the rows
  await checkNow(t.page);
  await t.page.getByTestId('recon-ok').waitFor({ timeout: 15000 });
  assert.match(await t.page.getByTestId('recon-ok').innerText(), /Tout balance/);
  const sheet = await sheetLines(t.page);
  const pay = `from public.payments where deleted_at is null and (paid_at at time zone 'America/Toronto')::date = public.local_today()`;
  const expect = [['Facturé', int(`select coalesce(sum(total_cents), 0) ${inv}`)]];
  const recv = h.sql(`select coalesce(string_agg(p.method || ':' || coalesce(s.short_name, s.full_name, '') || ':' || p.s, ',' order by p.method, p.s desc), '')
    from (select method, created_by, sum(amount_cents) s ${pay} and amount_cents > 0 group by 1, 2) p left join public.staff s on s.id = p.created_by`).split(',').filter(Boolean);
  for (const x of recv) {
    const [method, name, cents] = x.split(':');
    expect.push([`Reçu : ${word[method]}${name ? `, ${name}` : ''}`, Number(cents)]);
  }
  const refunded = int(`select coalesce(-sum(amount_cents), 0) ${pay} and amount_cents < 0`);
  assert.ok(refunded > 0, 'the refund of the day');
  expect.push(['Remboursé', refunded]);
  for (const x of h.sql(`select coalesce(string_agg(category || ':' || s, ',' order by category), '') from (select category, sum(total_cents) s ${exp} group by 1) e`).split(',').filter(Boolean)) {
    const [category, cents] = x.split(':');
    expect.push([`Dépenses : ${category}`, Number(cents)]);
  }
  const coffreIn = int(`select coalesce(sum(amount_cents), 0) from public.coffre where deleted_at is null and kind = 'received' and received_on = public.local_today()`);
  if (coffreIn) expect.push(['Entré au Coffre', coffreIn]);
  expect.push(['Reste à recevoir', owingNow()]);
  const shown = sheet.map(([k, v]) => [k.replace(/\s+/g, ' '), v]);
  const wanted = [];
  for (const [k, c] of expect) wanted.push([k, await money(c)]);
  assert.deepEqual(shown, wanted, 'the day’s sheet is the sum of the rows');
  await t.page.getByTestId('treasury-recon').scrollIntoViewIfNeeded(); await h.shot(t.page, 'argent-10-balanced');

  // behind the app's back: a cash payment of the day is taken out of the books (its invoice still says paid)
  const victim = h.sql(`select p.id || '|' || p.invoice_id || '|' || p.amount_cents from public.payments p join public.invoices v on v.id = p.invoice_id
    where p.deleted_at is null and p.method = 'cash' and v.status = 'paid' and (p.paid_at at time zone 'America/Toronto')::date = public.local_today()
    and not exists (select 1 from public.payments o where o.invoice_id = p.invoice_id and o.id <> p.id and o.deleted_at is null) order by p.paid_at limit 1`);
  assert.ok(victim, 'a cash payment of the day, alone on its paid invoice');
  const [payId, invId, cents] = victim.split('|');
  h.sql(`update public.payments set deleted_at = now() where id = '${payId}'`);
  try {
    await checkNow(t.page);
    const number = h.sql(`select number from public.invoices where id = '${invId}'`);
    const finding = t.page.getByTestId('recon-finding').filter({ hasText: /dit payé/ });
    await finding.waitFor({ timeout: 15000 });
    const words = await finding.innerText();
    assert.match(words, new RegExp(`La facture F-0*${number} dit payé ${fr(Number(cents)).source}, mais ses paiements font 0,00\\s\\$\\s:\\souvre la facture et vérifie les paiements\\.`), words);
    assert.equal(await t.page.getByTestId('recon-ok').count(), 0, 'no « Tout balance » any more');
    const row = () => h.sql(`select state || '|' || coalesce(acked_by::text, '') from public.ops_recon_findings where check_id = 'M2.paid' and entity_id = '${invId}'`);
    assert.equal(row(), 'open|');
    await t.page.getByTestId('treasury-recon').scrollIntoViewIfNeeded(); await h.shot(t.page, 'argent-10-finding');
    // « Vu »
    await finding.getByTestId('recon-ack').click();
    assert.equal(await until(row, (v) => v.startsWith('acked'), 15000), `acked|${who.louis.id}`);
    await t.page.getByText('Noté comme vu').waitFor({ timeout: 15000 });
    assert.equal(await until(() => t.page.getByTestId('recon-finding').filter({ hasText: /dit payé/ }).getByTestId('recon-ack').count(), (n) => n === 0, 15000), 0, 'no « Vu » to tap any more');
    assert.equal(int(`select count(*) from public.activity where action = 'recon_ack' and actor = '${who.louis.id}'`), 1);
  } finally {
    h.sql(`update public.payments set deleted_at = null where id = '${payId}'`);
  }
  noErrors(t.page);
  await t.ctx.close();
});

// argent-recon-seen (S32): once every difference was « Vu », the panel used to say « Tout balance — Aucune différence pour
// cette journée » and hide the differences seen (src/features/treasury/ReconPanel.tsx), although the books still miss the
// payment. A seen difference stays listed with « Vu », and the panel never says there is none meanwhile.
step('« Vu » keeps the difference in sight: a payment missing from the books, seen, stays listed with « Vu »; the panel never says « Aucune différence » meanwhile', async () => {
  const t = await openW({ kind: 'desktop' });
  await h.signIn(t.page, who.louis.email, PW);
  const day = today();
  await t.page.goto(h.APP + `#/treasury?p=custom&from=${day}&to=${day}`);
  await t.page.getByTestId('treasury-recon').waitFor({ timeout: 15000 });
  // the books as they are first (a difference of a step before, seen and repaired since, closes)
  await checkNow(t.page);
  const victim = h.sql(`select p.id || '|' || p.invoice_id from public.payments p join public.invoices v on v.id = p.invoice_id where p.deleted_at is null and p.method = 'cash' and v.status = 'paid'
    and not exists (select 1 from public.payments o where o.invoice_id = p.invoice_id and o.id <> p.id and o.deleted_at is null) order by p.paid_at limit 1`);
  assert.ok(victim, 'a cash payment alone on its paid invoice');
  const [payId, invId] = victim.split('|');
  h.sql(`update public.payments set deleted_at = now() where id = '${payId}'`);
  try {
    await checkNow(t.page);
    const finding = t.page.getByTestId('recon-finding').filter({ hasText: /dit payé/ });
    await finding.getByTestId('recon-ack').click({ timeout: 15000 });
    await until(() => h.sql(`select state from public.ops_recon_findings where check_id = 'M2.paid' and entity_id = '${invId}'`), (v) => v === 'acked', 15000);
    await t.page.getByText('Noté comme vu').waitFor({ timeout: 15000 });
    await t.page.getByTestId('treasury-recon').scrollIntoViewIfNeeded(); await h.shot(t.page, 'argent-10b-seen');
    // the difference seen is still there to read, marked « Vu »; nothing says the books have no difference
    await finding.getByText('Vu', { exact: true }).waitFor({ timeout: 5000 });
    assert.doesNotMatch(await t.page.getByTestId('treasury-recon').innerText(), /Aucune différence/);
  } finally {
    h.sql(`update public.payments set deleted_at = null where id = '${payId}'`);
  }
  noErrors(t.page);
  await t.ctx.close();
});

// argent-recon-brake (S31): « Vérifier maintenant » runs at most once a minute for the whole garage (recon_now: rate_hit
// 'recon_now', 60 s window). Braked, the server used to answer the old summary silently and the panel said « Vérification
// faite » over the old « Tout balance ». Now recon_now answers `braked` and `next_at` (000400) and the panel says it could
// not check yet (ReconPanel.tsx checkNow), never « Vérification faite » over the old result.
step('« Vérifier maintenant » twice within the minute: the second check finds what changed, or says it could not check yet — never « Vérification faite » over the old result', async () => {
  const t = await openW({ kind: 'desktop' });
  await h.signIn(t.page, who.louis.email, PW);
  const day = today();
  await t.page.goto(h.APP + `#/treasury?p=custom&from=${day}&to=${day}`);
  await t.page.getByTestId('treasury-recon').waitFor({ timeout: 15000 });
  // a check made a moment ago by somebody (this minute's brake is taken)
  await checkNow(t.page);
  // behind the app's back: a cash payment of the day is taken out of the books
  const victim = h.sql(`select p.id from public.payments p join public.invoices v on v.id = p.invoice_id where p.deleted_at is null and p.method = 'cash' and v.status = 'paid'
    and not exists (select 1 from public.payments o where o.invoice_id = p.invoice_id and o.id <> p.id and o.deleted_at is null) order by p.paid_at limit 1`);
  assert.ok(victim, 'a cash payment alone on its paid invoice');
  h.sql(`insert into public.rate_limits (key, bucket, n) values ('recon_now', floor(extract(epoch from now()) / 60), 1) on conflict (key, bucket) do update set n = 1`);
  h.sql(`update public.payments set deleted_at = now() where id = '${victim}'`);
  try {
    // the panel asks the summary again once the check answered
    // the first check's toast is closed first: the words read are this check's own
    const toasts = t.page.locator('[data-testid^="toast-"]');
    while (await toasts.count()) await toasts.first().locator('.toast-x').click();
    const reread = t.page.waitForResponse((r) => /\/rpc\/recon_summary/.test(r.url()), { timeout: 30000 });
    // what the server answered (braked or not), said if the step fails
    const answered = t.page.waitForResponse((r) => /\/rpc\/recon_now/.test(r.url()), { timeout: 30000 })
      .then((r) => r.json()).then((j) => JSON.stringify({ braked: j?.braked, next_at: j?.next_at, last_run: j?.last_run?.finished_at, open: (j?.findings || []).filter((f) => f.state === 'open').map((f) => f.check_id) }), (e) => `no answer: ${e}`);
    await t.page.getByTestId('recon-check').click();
    const said = await toasts.last().innerText({ timeout: 30000 });
    await (await reread).finished();
    const found = await t.page.getByTestId('recon-finding').filter({ hasText: /dit payé/ }).waitFor({ timeout: 5000 }).then(() => 1, () => 0);
    await t.page.getByTestId('treasury-recon').scrollIntoViewIfNeeded(); await h.shot(t.page, 'argent-11-braked');
    // either it checked and found the payment, or it says it could not check yet (« Vérifié il y a moins d’une minute : réessaie à … »)
    assert.ok(found > 0 || (/réessaie à/.test(said) && !/Vérification faite/.test(said)), `the second check found nothing and said « ${said} »; recon_now answered ${await answered}`);
  } finally {
    h.sql(`update public.payments set deleted_at = null where id = '${victim}'`);
  }
  noErrors(t.page);
  await t.ctx.close();
});
