// Money, end to end, on the local copy of the server (the production build, real sign-in, the real database rules, the
// functions on Deno, the fake Stripe of tests/stack/mocks.mjs with its signed notices). Each step follows people through
// the screens — the mechanic's phone at the door, the customer's phone, the office's computer, the treasurer — and checks
// what the screen says AND what the database holds (invoices, payments, activity, the Coffre, expenses, the
// reconciliation). The file runs by itself on a fresh database; the database is saved before and put back after.
//   bash <lane>/e2e-file.sh tests/e2e/argent.test.cjs ["part of a step's name"]
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness.cjs');
const {
  PW, STRIPE_KEY, step, openW, noErrors, dismissSheets, draw, until, jwtOf, callAs, rpcAs,
  int, today, atDoor, invoiceRow, paymentsOf, jobStatus, fr, typed, tapTwice, jobPhone, makeAndFinish, amountField, receivedField,
  mockLog, clearMock, mockGet, payOnStripe, freeReconBrake, randomUUID
} = require('./argent.helpers.cjs');

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
      await m.page.getByText(new RegExp(`Paiement en partie : il restera ${fr(left - cents).source} à payer`)).waitFor();
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
step('Trop payé: a zero too many is refused in words before anything is sent; two phones on Sophie’s invoice: Saleh, without signal, takes it all in cash while the office records her Interac deposit; back in signal the server refuses Saleh’s payment in words, nothing recorded twice', async () => {
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

  // the office has the same invoice open on its computer
  const o = await jobPhone(who.nadia.email, a.job, 'desktop');
  await o.page.getByTestId('invoice-pay').waitFor({ timeout: 15000 });
  // Saleh's phone loses the signal; Sophie hands him the whole amount in cash: kept on the phone
  await m.ctx.setOffline(true);
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  await m.page.getByTestId('pay-cash').click();
  assert.equal(await amountField(m.page).inputValue(), '344,93');
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
  // the signal comes back: Saleh's 344,93 $ goes, and the server refuses it, in words he can act on
  await m.ctx.setOffline(false);
  await m.page.locator('[data-testid="sync-chip"].has-failed').waitFor({ timeout: 30000 });
  await m.page.getByTestId('sync-chip').click();
  await m.page.getByTestId('sync-sheet').waitFor();
  await m.page.getByTestId('sync-sheet').getByText(/Il reste 244,93\s\$ à payer sur cette facture : le montant écrit est trop haut\./).waitFor({ timeout: 15000 });
  await h.shot(m.page, 'argent-3-refused');
  assert.deepEqual(paymentsOf(a.job), [['interac', 10000, true, who.nadia.id]], 'only the office’s payment: nothing counted twice');
  const mid = invoiceRow(a.job);
  assert.deepEqual([mid.status, mid.paid, mid.total], ['issued', 10000, 34493]);
  await dismissSheets(m.page);
  // Saleh gives back the cash he took too much and takes what is left by debit: the sheet offers 244,93 $
  await m.page.getByTestId('step-pay').filter({ hasText: /244,93\s\$ à payer/ }).waitFor({ timeout: 60000 });
  await m.page.getByTestId('step-pay').click();
  await m.page.getByTestId('pay-sheet').waitFor();
  assert.match(await m.page.getByTestId('pay-balance').innerText(), fr(24493));
  await m.page.getByTestId('pay-debit').click();
  await m.page.getByTestId('pay-confirm').click();
  await m.page.getByTestId('pay-sheet').waitFor({ state: 'detached', timeout: 15000 });
  assert.deepEqual(await until(() => paymentsOf(a.job), (v) => v.length === 2, 15000), [['interac', 10000, true, who.nadia.id], ['debit', 24493, true, who.saleh.id]]);
  const done = invoiceRow(a.job);
  assert.deepEqual([done.status, done.paid], ['paid', 34493]);
  await m.page.getByTestId('step-finish').click({ timeout: 15000 });
  assert.equal(await until(() => jobStatus(a.job), (v) => v === 'done', 15000), 'done');
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
  await m.page.getByTestId('pay-cash').getByText(/Comptant : arrondi aux 5 ¢, soit 103,45\s\$\./).waitFor();
  // the bills he is handed: one tap
  await m.page.getByTestId('pay-cash').locator('button.pay-bill', { hasText: /^120\s\$$/ }).click();
  assert.equal(await receivedField(m.page).inputValue(), '120,00');
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
