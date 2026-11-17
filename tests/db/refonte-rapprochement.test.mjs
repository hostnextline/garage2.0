// Part 28 — « Rapprochement quotidien »: the nightly check of the books. Each test is rolled back at the end.
// The rule that matters most: a healthy garage gives NO bad finding (a reconciliation that cries wolf is switched off).
// Then, for each check: break the invariant on purpose, see exactly its finding, repair, see it close by itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());
const DAY = [[480, 1200]];
const here = [45.515, -73.64];

/** the server itself (no person): what pg_cron and the server functions are */
async function server(h) { await h.as(null); await h.c.query('reset role'); }
/** recon_run as the server; the day defaults to today (the fixtures are made today) */
async function run(h, day = null) {
  await server(h);
  return day ? h.val(`select public.recon_run($1::date, 'test')`, [day]) : h.val(`select public.recon_run(public.local_today(), 'test')`);
}
/** the differences not closed */
async function open(h) {
  await server(h);
  return h.q(`select id, key, check_id, severity, entity_table, entity_id, state, message_fr, message_en, first_day::text, last_day::text, note
              from public.ops_recon_findings where state <> 'closed' order by key`);
}
/** a change made under the rules (triggers off): how a bug, a hand edit or a lost update would leave the books */
async function raw(h, sql, params = []) {
  await server(h);
  await h.c.query('set local session_replication_role = replica');
  try { await h.c.query(sql, params); } finally { await h.c.query('set local session_replication_role = origin'); }
}
/** run, and return the findings that were not open before */
async function sees(h, before) {
  await run(h);
  const was = new Set(before.map((f) => f.key));
  return (await open(h)).filter((f) => !was.has(f.key));
}
const ids = (rows) => rows.map((f) => f.check_id).sort();
const show = (rows) => rows.map((f) => `${f.check_id} ${f.severity}: ${f.message_fr}`).join('\n');
async function stateOf(h, key) { await server(h); return h.val(`select state from public.ops_recon_findings where key = $1`, [key]); }

/**
 * A real day of the garage, made with the app's own operations: an owner, a mechanic and his truck, two customers,
 * stock. Job A: booked, on site, invoiced, paid cash + debit, finished (its parts leave the stock). Job B: on site, put in
 * the Coffre (family), finished. Job C: booked for a coming day. Stock bought by the Trésorerie and by the Coffre. An
 * expense typed in the Trésorerie.
 */
async function garage(h) {
  const owner = await h.person('Hassan Jeha', ['owner']);
  const mech = await h.person('Saleh Mécano', ['mechanic']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const truck = await h.truck('Camion de Saleh', mech, { [dow]: DAY });
  const customer = await h.customer('Jean', ...here, { last: 'Tremblay', phone: '5145551234' });
  const family = await h.customer('Mona', 45.52, -73.6, { last: 'Jeha', phone: '5145559876' });
  const car = await h.val(`insert into public.vehicles (customer_id, year, make, model) values ($1, 2015, 'Honda', 'Civic') returning id`, [customer]);
  const oil = await h.val(`insert into public.inventory_items (name, qty, unit) values ('Huile 5W-30', 0, 'L') returning id`);
  const filter = await h.val(`insert into public.inventory_items (name, qty) values ('Filtre PH7317', 0) returning id`);
  const coil = await h.val(`insert into public.inventory_items (name, qty, unit, pool) values ('Huile Coffre', 0, 'L', 'coffre') returning id`);
  const svc = await h.val(`insert into public.services (name_fr, price_cents, duration_min) values ('Vidange d’huile + changement de filtre', 7999, 30) returning id`);
  await h.c.query(`insert into public.service_parts (service_id, item_id, qty) values ($1, $2, 4.5), ($1, $3, 1)`, [svc, oil, filter]);
  const work = [{ description: 'Vidange d’huile + changement de filtre', service_id: svc, unit_cents: 7999, duration_min: 30 }];
  await h.as(owner);
  // stock comes in the way the app does it: a move (paid by the Trésorerie: an expense « Pièces »)
  const buy = await h.rpc('inventory_buy', { p_op: uuid(), p_item: oil, p_qty: 20, p_total_cents: 11498, p_from: 'treasury', p_vendor: 'Lordco', p_note: null });
  await h.rpc('inventory_buy', { p_op: uuid(), p_item: filter, p_qty: 5, p_total_cents: 0, p_from: 'none', p_vendor: null, p_note: null });
  const book = async (cust, extra = {}) => (await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: cust, day, block: 'am', duration_min: 60, ...extra }, p_items: work })).job_id;
  const jobA = await book(customer, { vehicle_id: car });
  const jobB = await book(family);
  const jobC = await book(customer);
  // job A: on site, invoice, paid, finished
  await h.as(mech);
  for (const a of ['leave', 'arrive']) await h.rpc('job_step', { p_op: uuid(), p_job: jobA, p_action: a, p_data: {} });
  const invoice = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobA, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: invoice });
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [invoice]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: invoice, p_amount_cents: 5000, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: invoice, p_amount_cents: total - 5000, p_method: 'debit', p_reference: null, p_job: null, p_session: null });
  await h.rpc('job_step', { p_op: uuid(), p_job: jobA, p_action: 'finish', p_data: { parts: [{ item_id: oil, qty: 4.5 }, { item_id: filter, qty: 1 }] } });
  // job B: the family, paid by the Coffre (30 $ received), finished
  await h.as(owner);
  for (const a of ['leave', 'arrive']) await h.rpc('job_step', { p_op: uuid(), p_job: jobB, p_action: a, p_data: {} });
  const coffre = (await h.one(`select public.coffre_add($1, $2::uuid[], 3000) as r`, [uuid(), [jobB]])).r.id;
  await h.rpc('job_step', { p_op: uuid(), p_job: jobB, p_action: 'finish', p_data: { parts: [] } });
  // Coffre stock bought with the Coffre's money; an expense typed by hand (gas)
  await h.rpc('inventory_buy', { p_op: uuid(), p_item: coil, p_qty: 4, p_total_cents: 2000, p_from: 'coffre', p_vendor: null, p_note: null });
  await server(h);
  const gas = await h.val(`insert into public.expenses (day, vendor, category, subtotal_cents, tps_cents, tvq_cents, total_cents, method, created_by)
    values (public.local_today(), 'Shell', 'Essence', 4349, 217, 434, 5000, 'credit', $1) returning id`, [owner]);
  return { owner, mech, day, truck, customer, family, car, oil, filter, coil, svc, work, jobA, jobB, jobC, invoice, total, coffre, buy, gas, book };
}

// ───────────────────────────── no false alarm ─────────────────────────────

test('recon: a database freshly built says « tout balance »; running a day again replaces its run', () => tx(async (h) => {
  const r = await run(h);
  assert.equal(r.status, 'ok');
  assert.deepEqual(await open(h), []);
  const again = await run(h);
  assert.notEqual(again.run_id, r.run_id);
  assert.equal(await h.val(`select count(*)::int from public.ops_recon_runs where day = public.local_today()`), 1, 'one run per day');
  assert.deepEqual(Object.keys(r).sort(), ['counts', 'day', 'run_id', 'status']);
}));

test('recon: a real day (paid job, Coffre job, coming job, stock bought both ways, an expense) has no bad and no warn finding, and the sheet adds up', () => tx(async (h) => {
  const g = await garage(h);
  const r = await run(h);
  const f = await open(h);
  assert.deepEqual(f.filter((x) => x.severity !== 'info'), [], show(f));
  assert.equal(r.status, 'ok', show(f));
  // the day's sheet
  const s = await h.val(`select sheet from public.ops_recon_runs where id = $1`, [r.run_id]);
  assert.deepEqual(Object.keys(s).sort(), ['coffre_in_cents', 'coffre_out_cents', 'expenses', 'invoiced_cents', 'received', 'refunded_cents', 'to_receive_cents']);
  assert.equal(s.invoiced_cents, g.total);
  assert.deepEqual(s.received.map((x) => [x.method, x.by, x.by_name, x.cents]), [['cash', g.mech, 'Saleh', 5000], ['debit', g.mech, 'Saleh', g.total - 5000]]);
  assert.equal(s.refunded_cents, 0);
  assert.deepEqual(s.expenses, [{ category: 'Essence', cents: 5000 }, { category: 'Pièces', cents: 11498 }]);
  assert.deepEqual([s.coffre_in_cents, s.coffre_out_cents, s.to_receive_cents], [3000, 2000, 0]);
}));

test('recon: a family job put in the Coffre at 0 $ and Coffre stock bought (the Coffre goes under zero) is no false alarm; « vu », it stays « vu » at the next purchase', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  const jobD = await g.book(g.family);
  for (const a of ['leave', 'arrive']) await h.rpc('job_step', { p_op: uuid(), p_job: jobD, p_action: a, p_data: {} });
  await h.one(`select public.coffre_add($1, $2::uuid[], 0) as r`, [uuid(), [jobD]]);     // « 0 $ si rien »
  await h.rpc('job_step', { p_op: uuid(), p_job: jobD, p_action: 'finish', p_data: { parts: [] } });
  await h.rpc('inventory_buy', { p_op: uuid(), p_item: g.coil, p_qty: 10, p_total_cents: 5000, p_from: 'coffre', p_vendor: null, p_note: null });
  const r = await run(h);
  const f = await open(h);
  assert.deepEqual(f.filter((x) => x.severity !== 'info'), [], show(f));
  assert.equal(r.status, 'ok', show(f));
  const bal = f.find((x) => x.check_id === 'M8.balance');
  assert.ok(bal, show(f));
  assert.match(bal.message_fr, /^Le Coffre est à -40,00 \$/);
  await h.as(g.owner);
  await h.rpc('recon_ack', { p_finding: bal.id, p_note: null });
  await h.as(g.owner);
  await h.rpc('inventory_buy', { p_op: uuid(), p_item: g.coil, p_qty: 2, p_total_cents: 1000, p_from: 'coffre', p_vendor: null, p_note: null });
  await run(h);
  const again = (await open(h)).find((x) => x.check_id === 'M8.balance');
  assert.deepEqual([again.id, again.state], [bal.id, 'acked'], 'the amount moved, the « vu » stays (info)');
  assert.match(again.message_fr, /^Le Coffre est à -50,00 \$/);
}));

// ───────────────────────────── money ─────────────────────────────

test('recon M1: an invoice whose amounts do not add up (bad), whose taxes are not the rates (warn); repaired, it closes', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await raw(h, `update public.invoices set total_cents = total_cents + 100 where id = $1`, [g.invoice]);
  const n = await sees(h, base);
  assert.deepEqual(ids(n), ['M1.sum', 'M2.status'], show(n));   // the total moved, the « payée » status no longer follows
  assert.ok(n.some((x) => x.check_id === 'M1.sum' && x.severity === 'bad' && x.entity_id === g.invoice), show(n));
  assert.match(n.find((x) => x.check_id === 'M1.sum').message_fr, /^Les montants de la facture F-\d{4} ne s’additionnent pas/);
  await raw(h, `update public.invoices set total_cents = total_cents - 100 where id = $1`, [g.invoice]);
  await run(h);
  for (const x of n) assert.equal(await stateOf(h, x.key), 'closed');
  // taxes moved together with the total: only the rate is wrong
  await raw(h, `update public.invoices set tps_cents = tps_cents + 1, total_cents = total_cents + 1, paid_cents = paid_cents + 1 where id = $1`, [g.invoice]);
  await raw(h, `update public.payments set amount_cents = amount_cents + 1 where invoice_id = $1 and method = 'cash'`, [g.invoice]);
  const t = await sees(h, base);
  assert.deepEqual(ids(t), ['M1.tax'], show(t));
  assert.equal(t[0].severity, 'warn');
}));

test('recon M2: « payé » not the payments, a wrong status, overpaid, a draft holding money, a cancelled invoice holding money', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  // paid_cents lost an update
  await raw(h, `update public.invoices set paid_cents = paid_cents - 2000 where id = $1`, [g.invoice]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M2.paid'], show(n));
  assert.match(n[0].message_fr, /dit payé [\d,]+ \$, mais ses paiements font [\d,]+ \$ : ouvre la facture et vérifie les paiements\.$/);
  assert.equal(n[0].severity, 'bad');
  await raw(h, `update public.invoices set paid_cents = paid_cents + 2000 where id = $1`, [g.invoice]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // the status does not follow
  await raw(h, `update public.invoices set status = 'issued' where id = $1`, [g.invoice]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M2.status'], show(n));
  await raw(h, `update public.invoices set status = 'paid' where id = $1`, [g.invoice]);
  // paid twice: 10 $ too much
  await raw(h, `insert into public.payments (invoice_id, job_id, amount_cents, method, created_by) values ($1, $2, 1000, 'interac', $3)`, [g.invoice, g.jobA, g.mech]);
  await raw(h, `update public.invoices set paid_cents = paid_cents + 1000 where id = $1`, [g.invoice]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M2.over'], show(n));
  assert.equal(n[0].severity, 'warn');
  assert.match(n[0].message_fr, /^Le client a payé 10,00 \$ de trop/);
  await raw(h, `delete from public.payments where invoice_id = $1 and method = 'interac'`, [g.invoice]);
  await raw(h, `update public.invoices set paid_cents = paid_cents - 1000 where id = $1`, [g.invoice]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a draft holding a payment (job C gets a draft with a payment attached to it)
  await h.as(g.owner);
  const draft = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: g.jobC, p_refresh: true })).rows.invoices[0].id;
  await raw(h, `insert into public.payments (invoice_id, job_id, amount_cents, method) values ($1, $2, 500, 'cash')`, [draft, g.jobC]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M2.draft'], show(n));
  await raw(h, `delete from public.payments where invoice_id = $1`, [draft]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a cancelled invoice still holding the money
  await raw(h, `update public.invoices set status = 'void', voided_at = now() where id = $1`, [g.invoice]);
  n = await sees(h, base);
  assert.ok(n.some((x) => x.check_id === 'M2.void' && x.entity_id === g.invoice), show(n));
  assert.ok(n.some((x) => x.check_id === 'M5.unbilled' && x.entity_id === g.jobA), 'the job lost its invoice too');
  await raw(h, `update public.invoices set status = 'paid', voided_at = null where id = $1`, [g.invoice]);
  await run(h);
  for (const x of n) assert.equal(await stateOf(h, x.key), 'closed');
}));

test('recon M3: invoice numbers — a hole, a numbered invoice deleted, the counter behind', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  const no = Number(await h.val(`select number from public.invoices where id = $1`, [g.invoice]));
  // the counter fell behind the last number
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M3.counter'], show(n));
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 1]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a hole: the counter jumped two numbers
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 2]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M3.gap'], show(n));
  assert.match(n[0].message_fr, new RegExp(`^Le numéro de facture F-${String(no + 1).padStart(4, '0')} manque`));
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 1]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a numbered draft thrown away (job C: finished, reopened, deleted)
  await h.as(g.owner);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: g.jobC, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv });
  await raw(h, `update public.invoices set deleted_at = now() where id = $1`, [inv]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M3.deleted'], show(n));
  await raw(h, `update public.invoices set deleted_at = null where id = $1`, [inv]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
}));

test('recon M3: holes are said as runs of numbers — a counter jumped far is ONE finding; many holes are the 50 newest and one « and more »', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  const no = Number(await h.val(`select number from public.invoices where id = $1`, [g.invoice]));
  const pad = (n) => `F-${String(n).padStart(4, '0')}`;
  // the counter set 50000 numbers ahead (a bad restore): one finding, not 50000
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 50001]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M3.gap'], show(n));
  assert.equal(n[0].message_fr, `Les numéros de facture ${pad(no + 1)} à ${pad(no + 50000)} manquent (50000 numéros) : aucune facture ne les a. Vérifie si des factures ont été effacées ou si le compteur a sauté, et note-le pour le comptable.`);
  assert.match(n[0].message_en, /^Invoice numbers F-\d+ to F-\d+ are missing \(50000 numbers\)/);
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 1]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // 60 holes one number wide (every other number used, by cancelled invoices): the 50 newest, then one finding for the 10 older
  await raw(h, `insert into public.invoices (customer_id, number, status, voided_at, lines) select $1, $2::bigint + 2 * k, 'void', now(), '[]' from generate_series(1, 60) k`, [g.customer, no]);
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 121]);
  n = await sees(h, base);
  assert.equal(n.filter((x) => x.check_id === 'M3.gap').length, 50, show(n));
  assert.deepEqual([...new Set(ids(n))], ['M3.gap', 'M3.gapmore'], show(n));
  const more = n.find((x) => x.check_id === 'M3.gapmore');
  assert.match(more.message_fr, new RegExp(`^Il manque aussi 10 autres séries de numéros de facture, plus anciennes \\(10 numéros, jusqu’à ${pad(no + 19)}\\)`));
  assert.ok(n.some((x) => x.message_fr.startsWith(`Le numéro de facture ${pad(no + 119)} manque`)), 'the newest hole is said one by one');
  await raw(h, `delete from public.invoices where number > $1 and status = 'void'`, [no]);
  await raw(h, `update public.counters set next_value = $1 where name = 'invoice'`, [no + 1]);
  await run(h);
  for (const x of n) assert.equal(await stateOf(h, x.key), 'closed');
}));

test('recon M4: a payment on nothing, a card without its session, a payment left on the job, a payment taken twice', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  // on nothing
  const lost = await h.val(`insert into public.payments (amount_cents, method) values (700, 'cash') returning id`);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M4.orphan'], show(n));
  await h.c.query(`delete from public.payments where id = $1`, [lost]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // « carte en ligne » without its Stripe session
  await raw(h, `update public.payments set method = 'card_online' where invoice_id = $1 and method = 'debit'`, [g.invoice]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M4.card'], show(n));
  await raw(h, `update public.payments set method = 'debit' where invoice_id = $1 and method = 'card_online'`, [g.invoice]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // the cash payment slipped back onto the job (the race of a card landing while the invoice is finished)
  await raw(h, `update public.payments set invoice_id = null where invoice_id = $1 and method = 'cash'`, [g.invoice]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M2.paid', 'M4.waiting'], show(n));
  await raw(h, `update public.payments set invoice_id = $1 where job_id = $2 and invoice_id is null`, [g.invoice, g.jobA]);
  await run(h);
  for (const x of n) assert.equal(await stateOf(h, x.key), 'closed');
  // the same 20 $ cash twice within a minute on job C's invoice (« Encaisser » tapped twice)
  await h.as(g.owner);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: g.jobC, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  for (let i = 0; i < 2; i++) await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: 2000, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M4.double'], show(n));
  await raw(h, `update public.payments set deleted_at = now() where id = $1`, [n[0].entity_id]);
  await raw(h, `update public.invoices set paid_cents = 2000 where id = $1`, [inv]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a payment waiting on a job that is closed without a finished invoice (a cancelled job keeping a prepayment)
  await h.as(g.owner);
  const d = await g.book(g.customer);
  await raw(h, `insert into public.payments (job_id, amount_cents, method, stripe_session) values ($1, 1500, 'card_online', 'cs_test_1')`, [d]);
  await raw(h, `update public.jobs set status = 'cancelled', cancelled_at = now() where id = $1`, [d]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M4.closed'], show(n));
  assert.equal(n[0].severity, 'warn');
}));

test('recon M5: a finished job whose invoice is a draft (warn), with no invoice (bad), unpaid without « payer plus tard » (warn)', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await h.as(g.owner);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: g.jobC, p_refresh: true })).rows.invoices[0].id;
  await raw(h, `update public.jobs set status = 'done', finished_at = now(), arrived_at = now(), started_at = now() where id = $1`, [g.jobC]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M5.draft'], show(n));
  assert.equal(n[0].severity, 'warn');
  await raw(h, `update public.invoices set deleted_at = now() where id = $1`, [inv]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M5.unbilled'], show(n));
  assert.equal(n[0].severity, 'bad');
  assert.match(n[0].message_fr, /est terminée, mais elle n’a pas de facture : fais sa facture et encaisse-la/);
  await raw(h, `update public.invoices set deleted_at = null where id = $1`, [inv]);
  await h.as(g.owner);
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M5.unpaid'], show(n));
  const key = n[0].key;
  await h.as(g.owner);
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [inv]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: total, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  await run(h);
  assert.equal(await stateOf(h, key), 'closed');
  assert.deepEqual(ids(await sees(h, base)), []);
}));

test('recon M7: an expense that does not add up; stock « payé par la Trésorerie » without its expense', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await h.c.query(`update public.expenses set total_cents = 5100 where id = $1`, [g.gas]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M7.sum'], show(n));
  assert.match(n[0].message_fr, /^La dépense Shell du \d{4}-\d\d-\d\d ne s’additionne pas/);
  await h.c.query(`update public.expenses set total_cents = 5000 where id = $1`, [g.gas]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // the purchase's expense deleted in the Trésorerie: the stock stayed
  await h.c.query(`update public.expenses set deleted_at = now() where id = $1`, [g.buy.expense_id]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M7.stockgone'], show(n));
  // the expense gone for good
  await h.c.query(`delete from public.expenses where id = $1`, [g.buy.expense_id]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M7.stock'], show(n));
  assert.equal(n[0].severity, 'bad');
}));

test('recon M8: the Coffre — a link broken, a Coffre job with money, more spent than received, a purchase without its stock', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await raw(h, `update public.jobs set coffre_id = null where id = $1`, [g.jobB]);
  let n = await sees(h, base);
  assert.ok(ids(n).includes('M8.link'), show(n));
  assert.ok(n.every((x) => ['M8.link', 'M5.unbilled'].includes(x.check_id)), show(n));
  await raw(h, `update public.jobs set coffre_id = $1 where id = $2`, [g.coffre, g.jobB]);
  await run(h);
  for (const x of n) assert.equal(await stateOf(h, x.key), 'closed');
  // a payment on a Coffre job
  await raw(h, `insert into public.payments (job_id, amount_cents, method) values ($1, 1000, 'cash')`, [g.jobB]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M8.money'], show(n));
  await raw(h, `delete from public.payments where job_id = $1`, [g.jobB]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // more spent than received (30 $ in, 20 $ + 15 $ out): said, as info only (the app allows it: 0 $ family jobs)
  await h.c.query(`insert into public.coffre (kind, amount_cents, received_on, item_name) values ('purchase', 1500, public.local_today(), 'Lave-glace')`);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M8.balance'], show(n));
  assert.match(n[0].message_fr, /^Le Coffre est à -5,00 \$/);
  assert.equal(n[0].severity, 'info');
  assert.equal((await run(h)).status, 'ok', 'a Coffre under zero never colours the day');
  await h.c.query(`update public.coffre set deleted_at = now() where item_name = 'Lave-glace'`);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a Coffre purchase whose stock entry was removed
  await h.c.query(`update public.inventory_moves set deleted_at = now() where item_id = $1 and reason = 'restock'`, [g.coil]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['M8.stock'], show(n));
}));

test('recon M9: an estimate « converted » without its job', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  const q = await h.val(`insert into public.quotes (customer_id, status) values ($1, 'converted') returning id`, [g.customer]);
  const n = await sees(h, base);
  assert.deepEqual(ids(n), ['M9.quote'], show(n));
  await h.c.query(`update public.quotes set job_id = $1 where id = $2`, [g.jobC, q]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
}));

// ───────────────────────────── data ─────────────────────────────

test('recon D1: a past job still open, a status without its time, two trips under way for one person', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await raw(h, `update public.jobs set day = public.local_today() - 3 where id = $1`, [g.jobC]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['D1.past'], show(n));
  assert.match(n[0].message_fr, /est encore « réservée » : termine-la, annule-la ou déplace-la\.$/);
  await raw(h, `update public.jobs set status = 'cancelled' where id = $1`, [g.jobC]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D1.stamp'], show(n));
  await raw(h, `update public.jobs set cancelled_at = now() where id = $1`, [g.jobC]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // two trips under way for Saleh
  await h.c.query(`insert into public.trips (job_id, staff_id, status, kind) values ($1, $3, 'active', 'job'), ($2, $3, 'active', 'job')`, [g.jobC, g.jobA, g.mech]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D1.trips'], show(n));
  await h.c.query(`update public.trips set status = 'arrived' where job_id = $1`, [g.jobA]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
}));

test('recon D2: the coming days — two stops with one number, a promised window missed, a day mixing modes, machine work on the car, « À placer »', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  const jobE = await g.book(g.customer);
  const base = (await run(h), await open(h));
  const [c, e] = await h.q(`select id, stop_order, eta_min from public.jobs where id = any($1) order by stop_order`, [[g.jobC, jobE]]);
  assert.ok(c.stop_order != null && e.stop_order != null);
  // two stops with the same number
  await raw(h, `update public.jobs set stop_order = $1 where id = $2`, [c.stop_order, e.id]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['D2.order'], show(n));
  await raw(h, `update public.jobs set stop_order = $1 where id = $2`, [e.stop_order, e.id]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // a window promised that the plan arrives after
  await raw(h, `update public.jobs set win_start = $1, win_end = $2 where id = $3`, [Math.max(0, c.eta_min - 120), Math.max(1, c.eta_min - 60), c.id]);
  n = await sees(h, base);
  assert.deepEqual(ids(n).filter((x) => x !== 'D2.mix'), ['D2.window'], show(n));
  await raw(h, `update public.jobs set win_start = null, win_end = null where id = $1`, [c.id]);
  // a day mixing « journée » and blocks
  await raw(h, `update public.jobs set block = 'day' where id = $1`, [c.id]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D2.mix'], show(n));
  await raw(h, `update public.jobs set block = 'am' where id = $1`, [c.id]);
  // machine work on the vehicle without the machine
  await raw(h, `update public.trucks set tire_machine = false where id = $1`, [g.truck]);
  await raw(h, `update public.jobs set needs_machine = true where id = $1`, [c.id]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D2.machine'], show(n));
  await raw(h, `update public.jobs set needs_machine = false where id = $1`, [c.id]);
  // « À placer »: info only, never colours the day
  await raw(h, `update public.jobs set truck_id = null, stop_order = null where id = $1`, [c.id]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D2.unplaced'], show(n));
  assert.equal(n[0].severity, 'info');
  assert.equal((await run(h)).status, 'ok');
}));

test('recon D3 and D4: the car or the invoice of another customer (warn); doubles of phone and VIN (info)', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await raw(h, `update public.jobs set vehicle_id = $1 where id = $2`, [g.car, g.jobC]);
  await raw(h, `update public.vehicles set customer_id = $1 where id = $2`, [g.family, g.car]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['D3.car'], show(n));
  await raw(h, `update public.vehicles set customer_id = $1 where id = $2`, [g.customer, g.car]);
  await raw(h, `update public.invoices set customer_id = $1 where id = $2`, [g.family, g.invoice]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D3.invoice'], show(n));
  await raw(h, `update public.invoices set customer_id = $1 where id = $2`, [g.customer, g.invoice]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  const twin = await h.customer('Jean', ...here, { last: 'T.', phone: '(514) 555-1234' });
  await h.c.query(`insert into public.vehicles (customer_id, vin) values ($1, '2HGFB2F50FH512345'), ($2, '2HGFB2F50FH512345')`, [g.customer, twin]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['D4.phone', 'D4.vin'], show(n));
  assert.ok(n.every((x) => x.severity === 'info'));
  assert.equal((await run(h)).status, 'ok', 'info never colours the day');
}));

// ───────────────────────────── stock ─────────────────────────────

test('recon S1: the stock against its moves — the first run takes the baseline, a CHANGE is said, put back it closes', () => tx(async (h) => {
  const g = await garage(h);
  // a difference that was already there before the first run: noted, not said
  await raw(h, `update public.inventory_items set qty = qty + 2 where id = $1`, [g.filter]);
  const first = await run(h);
  assert.ok('S1' in first.counts.checks_ms, 'the first run (the baseline) says its time too');
  const base = await open(h);
  assert.deepEqual(base.filter((x) => x.check_id.startsWith('S1')), []);
  assert.equal(Number(await h.val(`select value from public.ops_recon_baseline where check_id = 'S1' and entity_id = $1`, [g.filter])), 2);
  // a quantity changed without a move
  await raw(h, `update public.inventory_items set qty = qty - 1 where id = $1`, [g.oil]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['S1.drift'], show(n));
  assert.equal(n[0].entity_id, g.oil);
  assert.match(n[0].message_fr, /^Le stock de « Huile 5W-30 » dit 14\.5 L, mais ses entrées et sorties donnent 15\.5/);
  await raw(h, `update public.inventory_items set qty = qty + 1 where id = $1`, [g.oil]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // the old difference changing is said too
  await raw(h, `update public.inventory_items set qty = qty + 1 where id = $1`, [g.filter]);
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['S1.drift'], show(n));
}));

test('recon S2: stock under zero; a job that sold a stock item and took nothing out', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await h.as(g.owner);
  await h.rpc('inventory_buy', { p_op: uuid(), p_item: g.filter, p_qty: 0.5, p_total_cents: 0, p_from: 'none', p_vendor: null, p_note: null });
  await server(h);
  await h.c.query(`insert into public.inventory_moves (item_id, delta, reason) values ($1, -10, 'adjust')`, [g.filter]);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['S2.negative'], show(n));
  await h.c.query(`insert into public.inventory_moves (item_id, delta, reason) values ($1, 10, 'adjust')`, [g.filter]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
  // job C sells a filter from the stock; « Pièces utilisées » sent with nothing
  await h.c.query(`insert into public.job_items (job_id, kind, item_id, description, qty, unit_cents) values ($1, 'part', $2, 'Filtre PH7317', 1, 1500)`, [g.jobC, g.filter]);
  await h.as(g.mech);
  for (const a of ['leave', 'arrive']) await h.rpc('job_step', { p_op: uuid(), p_job: g.jobC, p_action: a, p_data: {} });
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: g.jobC, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [inv]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: total, p_method: 'credit', p_reference: null, p_job: null, p_session: null });
  await h.rpc('job_step', { p_op: uuid(), p_job: g.jobC, p_action: 'finish', p_data: { parts: [] } });
  n = await sees(h, base);
  assert.deepEqual(ids(n), ['S2.unused'], show(n));
  assert.match(n[0].message_fr, /a vendu Filtre PH7317 du stock, mais rien n’est sorti du stock/);
  await server(h);
  await h.c.query(`insert into public.inventory_moves (item_id, delta, reason, job_id) values ($1, -1, 'used', $2)`, [g.filter, g.jobC]);
  await run(h);
  assert.equal(await stateOf(h, n[0].key), 'closed');
}));

// ───────────────────────────── the run itself ─────────────────────────────

test('recon: a check that throws is a finding of its own and the others still run; fixed, it closes', () => tx(async (h) => {
  const g = await garage(h);
  const base = (await run(h), await open(h));
  await h.c.query(`update public.expenses set total_cents = 5100 where id = $1`, [g.gas]);
  await h.c.query(`select set_config('garage.recon_fail', 'M3', true)`);
  let n = await sees(h, base);
  assert.deepEqual(ids(n), ['M3.error', 'M7.sum'], show(n));
  assert.match(n.find((x) => x.check_id === 'M3.error').message_fr, /^La vérification M3 n’a pas pu se faire/);
  await h.c.query(`select set_config('garage.recon_fail', '', true)`);
  await run(h);
  assert.equal(await stateOf(h, 'M3.error:'), 'closed');
}));

test('recon: a check that throws leaves its differences as they were — « vu » stays « vu »; checked again and repaired, it closes', () => tx(async (h) => {
  const g = await garage(h);
  await raw(h, `update public.invoices set paid_cents = paid_cents - 2000 where id = $1`, [g.invoice]);
  await run(h);
  const [f] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  await h.as(g.owner);
  await h.rpc('recon_ack', { p_finding: f.id, p_note: 'Vu avec le client' });
  // M2 throws tonight: its difference was NOT checked, so it is not « repaired »
  await server(h);
  await h.c.query(`select set_config('garage.recon_fail', 'M2', true)`);
  const r = await run(h);
  const during = await h.one(`select state, acked_by, note from public.ops_recon_findings where id = $1`, [f.id]);
  assert.deepEqual([during.state, during.acked_by, during.note], ['acked', g.owner, 'Vu avec le client']);
  assert.equal(await stateOf(h, 'M2.error:'), 'open');
  assert.deepEqual([r.counts.errors, r.counts.closed], [1, 0]);
  // M2 works again, the difference is still there: still the same « vu »
  await h.c.query(`select set_config('garage.recon_fail', '', true)`);
  await run(h);
  const after2 = await h.one(`select state, acked_by from public.ops_recon_findings where id = $1`, [f.id]);
  assert.deepEqual([after2.state, after2.acked_by], ['acked', g.owner]);
  assert.equal(await stateOf(h, 'M2.error:'), 'closed');
  // repaired: closed
  await raw(h, `update public.invoices set paid_cents = paid_cents + 2000 where id = $1`, [g.invoice]);
  await run(h);
  assert.equal(await stateOf(h, f.key), 'closed');
}));

test('recon: running an old day again never dates a difference back (the checks read the books as they are now)', () => tx(async (h) => {
  const g = await garage(h);
  const today = await h.val(`select public.local_today()::text`);
  const old = await h.val(`select (public.local_today() - 20)::text`);
  await run(h);
  // a difference made today, first seen by a run of a day 20 days back: dated today
  await raw(h, `update public.invoices set paid_cents = paid_cents - 2000 where id = $1`, [g.invoice]);
  await run(h, old);
  let [f] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f.first_day, f.last_day], [today, today]);
  // already open: an old day run again keeps its first day
  await run(h);
  await run(h, old);
  [f] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f.first_day, f.last_day], [today, today]);
}));

test('recon_ack and recon_add take the run lock first (the same order as recon_run: « vu » during a run waits, never deadlocks)', async () => {
  /** can another connection take the run lock right now? */
  const free = async () => {
    const b = await pool.connect();
    try {
      await b.query('begin');
      return (await b.query(`select pg_try_advisory_xact_lock(hashtext('garage.recon_run')) as ok`)).rows[0].ok;
    } finally { await b.query('rollback').catch(() => {}); b.release(); }
  };
  // « vu »: a run and a finding made by hand (no recon_run in this transaction, so the lock comes from recon_ack alone)
  await tx(async (h) => {
    const owner = await h.person('Hassan Jeha', ['owner']);
    await server(h);
    await h.c.query(`insert into public.ops_recon_runs (day, source, finished_at) values (public.local_today() - 40, 'test', now())`);
    const id = await h.val(`insert into public.ops_recon_findings (key, check_id, severity, message_fr, message_en, first_day, last_day)
      values ('M2.paid:lock-test', 'M2.paid', 'bad', 'x', 'x', public.local_today() - 40, public.local_today() - 40) returning id`);
    assert.equal(await free(), true, 'nobody holds it before');
    await h.as(owner);
    await h.rpc('recon_ack', { p_finding: id, p_note: null });
    assert.equal(await free(), false, 'recon_ack holds the run lock until it commits');
  });
  // recon_add: the run it adds to cannot be replaced under it
  await tx(async (h) => {
    await server(h);
    const run2 = await h.val(`insert into public.ops_recon_runs (day, source, finished_at) values (public.local_today() - 40, 'test', now()) returning id`);
    assert.equal(await free(), true);
    await h.c.query(`select public.recon_add($1, 'backup_late', 'warn', null, null, 'x', 'x', '{}'::jsonb)`, [run2]);
    assert.equal(await free(), false, 'recon_add holds the run lock until it commits');
  });
});

test('recon: one row per difference — seen again it keeps its row (last_day moves), « vu » stays, new words open it again, gone it closes, back it opens', () => tx(async (h) => {
  const g = await garage(h);
  await raw(h, `update public.invoices set paid_cents = paid_cents - 2000 where id = $1`, [g.invoice]);
  const today = await h.val(`select public.local_today()::text`);
  const yday = await h.val(`select (public.local_today() - 1)::text`);
  await run(h, yday);
  const [f1] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f1.first_day, f1.last_day, f1.state], [yday, yday, 'open']);
  const r = await run(h, today);
  assert.equal(r.status, 'bad');
  const [f2] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f2.id, f2.first_day, f2.last_day], [f1.id, yday, today], 'the same row, last_day moved');
  // « vu » by the owner: stays « vu » while the difference stays the same, and no longer colours the day
  await h.as(g.owner);
  await h.rpc('recon_ack', { p_finding: f1.id, p_note: 'Le client a un crédit, vu avec lui.' });
  assert.equal((await run(h)).status, 'ok');
  let [f3] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f3.id, f3.state, f3.note], [f1.id, 'acked', 'Le client a un crédit, vu avec lui.']);
  // the difference changed (other words): open again
  await raw(h, `update public.invoices set paid_cents = paid_cents - 100 where id = $1`, [g.invoice]);
  assert.equal((await run(h)).status, 'bad');
  [f3] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f3.id, f3.state], [f1.id, 'open']);
  // repaired: closed by itself
  await raw(h, `update public.invoices set paid_cents = paid_cents + 2100 where id = $1`, [g.invoice]);
  const ok = await run(h);
  assert.deepEqual([ok.status, ok.counts.closed], ['ok', 1]);
  assert.equal(await stateOf(h, f1.key), 'closed');
  // back again: the same row opens again, its first day is the new one
  await raw(h, `update public.invoices set paid_cents = paid_cents - 1 where id = $1`, [g.invoice]);
  await run(h);
  const [f4] = (await open(h)).filter((x) => x.check_id === 'M2.paid');
  assert.deepEqual([f4.id, f4.state, f4.first_day], [f1.id, 'open', today]);
}));

test('recon_add: a check made outside (Stripe, the backup) counts in the run; not added again for a day, it closes', () => tx(async (h) => {
  await h.person('Hassan Jeha', ['owner']);
  const yday = await h.val(`select (public.local_today() - 1)::text`);
  const r = await run(h, yday);
  const id = await h.val(`select public.recon_add($1, 'B1.backup', 'bad', null, null, 'La dernière sauvegarde a plus de 26 heures : regarde le travail de sauvegarde sur GitHub.',
    'The last backup is more than 26 hours old: look at the backup job on GitHub.', '{"hours": 30}'::jsonb)`, [r.run_id]);
  assert.ok(id);
  assert.equal(await h.val(`select status from public.ops_recon_runs where id = $1`, [r.run_id]), 'bad');
  // added again the next night: the same row
  const r2 = await run(h);
  assert.equal(r2.status, 'bad', 'still open until the outside check says otherwise');
  assert.equal(await h.val(`select public.recon_add($1, 'B1.backup', 'bad', null, null, 'La dernière sauvegarde a plus de 26 heures : regarde le travail de sauvegarde sur GitHub.', 'x', '{}'::jsonb)`, [r2.run_id]), id);
  // two days later without it: closed
  await run(h, await h.val(`select (public.local_today() + 2)::text`));
  assert.equal(await h.val(`select state from public.ops_recon_findings where id = $1`, [id]), 'closed');
  // refusals
  assert.equal((await h.fails(() => h.c.query(`select public.recon_add($1, 'B1', 'grave', null, null, 'x', 'x', '{}')`, [r.run_id])))?.hint, 'bad_finding');
  assert.equal((await h.fails(() => h.c.query(`select public.recon_add($1, 'B1', 'bad', null, null, 'x', 'x', '{}')`, [uuid()])))?.hint, 'not_found');
}));

test('recon_add: card money Stripe took and the books do not have never closes by age; it closes once the books have that page, once « vu » and no longer added, or once kept aside for the office', () => tx(async (h) => {
  const g = await garage(h);
  const day = (k) => h.val(`select (public.local_today() + $1::int)::text`, [k]);
  const fr = 'Stripe a encaissé 120,00 $ par carte, mais aucun paiement n’est inscrit dans l’app pour cette carte.';
  const add = async (runId, session, check = 'stripe_paid_not_recorded', recorded = null) => {
    await server(h);
    const data = { sig: session, session, amount_cents: 12000, payment_intent: `pi_${session}`, job_id: g.jobC, invoice_id: null, payment_id: null, recorded_cents: recorded };
    return h.val(`select public.recon_add($1, $2, 'bad', 'jobs', $3, $4, 'Stripe took $120.00 by card, but no payment is recorded in the app for it.', $5::jsonb)`,
      [runId, check, g.jobC, fr, JSON.stringify(data)]);
  };
  const state = async (id) => { await server(h); return h.val(`select state from public.ops_recon_findings where id = $1`, [id]); };
  // nights 1 to 3: Stripe's list of the last 72 hours still has the page, the notice was lost
  let id;
  for (const k of [0, 1, 2]) id = await add((await run(h, await day(k))).run_id, 'cs_test_lost');
  // nights 4 to 7: Stripe's list no longer has it, nobody adds it again; the money is still missing from the books
  for (const k of [3, 4, 5, 6]) {
    const r = await run(h, await day(k));
    assert.equal(await state(id), 'open', `night ${k + 1}`);
    assert.equal(r.status, 'bad', `night ${k + 1}`);
  }
  // the books get that card page (the notice tried again, the customer's page): closed at the next run
  await server(h);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: null, p_amount_cents: 12000, p_method: 'card_online', p_reference: 'pi_cs_test_lost', p_job: g.jobC, p_session: 'cs_test_lost' });
  const r8 = await run(h, await day(7));
  assert.equal(await state(id), 'closed');
  assert.equal(r8.status, 'ok');
  // Stripe's amount is not the one written: stays open past 3 nights; written right, it closes
  await raw(h, `update public.payments set amount_cents = 11000 where stripe_session = 'cs_test_lost'`);
  const wrong = await add((await run(h, await day(8))).run_id, 'cs_test_lost', 'stripe_amount', 11000);
  for (const k of [9, 10, 11]) await run(h, await day(k));
  assert.equal(await state(wrong), 'open', 'a wrong amount does not close by age');
  await raw(h, `update public.payments set amount_cents = 12000 where stripe_session = 'cs_test_lost'`);
  await run(h, await day(12));
  assert.equal(await state(wrong), 'closed');
  // entered by hand by the office (no card page in the books): « vu », then no longer added for a day: closed
  const hand = await add((await run(h, await day(13))).run_id, 'cs_test_hand');
  await h.as(g.owner);
  await h.rpc('recon_ack', { p_finding: hand, p_note: 'Entré à la main, comptant.' });
  await run(h, await day(14));
  assert.equal(await state(hand), 'acked');
  await run(h, await day(15));
  assert.equal(await state(hand), 'closed');
  // kept aside for the office (« payment_parked »): the Stripe finding may close by age, M6.parked says it from then on
  const kept = await add((await run(h, await day(16))).run_id, 'cs_test_kept');
  await server(h);
  await h.c.query(`insert into public.activity (entity, entity_id, action, data) values ('job', $1, 'payment_parked', $2::jsonb)`,
    [g.jobC, JSON.stringify({ kind: 'payment', session: 'cs_test_kept', reference: 'pi_kept', amount_cents: 12000, invoice: null, job: g.jobC, reason: 'refused' })]);
  await run(h, await day(17));
  await run(h, await day(18));
  assert.equal(await state(kept), 'closed');
  assert.deepEqual((await open(h)).filter((f) => f.check_id.startsWith('M6.')).map((f) => [f.check_id, f.severity]), [['M6.parked', 'bad']]);
}));

test('recon M6 (R34): a parked card payment is a finding for Trésorerie; a card refund without its payment, more given back than paid; card money on a cancelled, deleted or Coffre job', () => tx(async (h) => {
  const g = await garage(h);
  const acc = await h.person('Comptable', ['treasurer'], { rights: { treasury: true } });
  const card = (amount, session, job, invoice = null) => h.rpc('payment_add', { p_op: uuid(), p_invoice: invoice, p_amount_cents: amount, p_method: 'card_online',
    p_reference: `pi_${session}`, p_job: job, p_session: session });
  const jobNo = await h.val(`select number from public.jobs where id = $1`, [g.jobC]);
  // kept aside by the server (the shape _shared/payments.ts writes): a bad finding, and « Trésorerie » sees it
  await server(h);
  await h.c.query(`insert into public.activity (entity, entity_id, action, data) values ('job', $1, 'payment_parked', $2::jsonb)`,
    [g.jobC, JSON.stringify({ kind: 'payment', session: 'cs_park', reference: 'pi_park', amount_cents: 12000, invoice: null, job: g.jobC, reason: 'not_allowed' })]);
  let f = await sees(h, []);
  assert.deepEqual(f.map((x) => [x.check_id, x.severity]), [['M6.parked', 'bad']], show(f));
  assert.equal(f[0].message_fr, `Un paiement par carte de 120,00 $ a été mis de côté le ${await h.val(`select public.local_today()::text`)} sans être inscrit dans l’app : entre-le à la main sur la job ${jobNo} (référence Stripe pi_park).`);
  assert.match(f[0].message_en, /^A card payment of \$120\.00 was kept aside on .* enter it by hand on job \d+ \(Stripe reference pi_park\)\.$/);
  await h.as(acc);
  const t = await h.rpc('recon_summary', {});
  assert.deepEqual(t.findings.map((x) => x.check_id), ['M6.parked']);
  assert.equal(t.last_run.status, 'bad');
  // the office enters it by hand on the job, for the same amount: closed
  await h.as(g.owner);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: null, p_amount_cents: 12000, p_method: 'credit', p_reference: 'pi_park', p_job: g.jobC, p_session: null });
  assert.deepEqual((await sees(h, [])).map((x) => x.check_id), []);
  assert.equal(await stateOf(h, `M6.parked:${g.jobC}:cs_park`), 'closed');
  // a card refund whose card payment is not in the books; then the payment comes, smaller than the refund
  await server(h);
  await card(-3000, 'cs_gone#re_1', g.jobC);
  f = await sees(h, []);
  assert.deepEqual(f.map((x) => x.check_id), ['M6.refund'], show(f));
  await card(2000, 'cs_gone', g.jobC);
  f = await sees(h, []);
  assert.deepEqual(f.map((x) => [x.check_id, x.message_fr]), [['M6.refundmore',
    'Pour un paiement par carte de 20,00 $, l’app a inscrit 30,00 $ de remboursements : plus que ce que le client a payé. Vérifie les remboursements dans Stripe (page cs_gone).']]);
  await raw(h, `update public.payments set amount_cents = -2000 where stripe_session = 'cs_gone#re_1'`);
  assert.deepEqual((await sees(h, [])).map((x) => x.check_id), []);
  // card money landing on a cancelled job (payment_add keeps it on the job, note « job_closed »), then on a deleted one
  await h.as(g.owner);
  const jobD = await g.book(g.customer);
  await raw(h, `update public.jobs set status = 'cancelled', cancelled_at = now() where id = $1`, [jobD]);
  await server(h);
  await card(5000, 'cs_cancel', jobD);
  f = await sees(h, []);
  assert.deepEqual(f.map((x) => [x.check_id, x.severity]), [['M4.closed', 'warn']], show(f));
  assert.equal(await h.val(`select data->>'why' from public.ops_recon_findings where id = $1`, [f[0].id]), 'job_closed');
  await raw(h, `update public.jobs set status = 'booked', cancelled_at = null, deleted_at = now() where id = $1`, [jobD]);
  f = (await sees(h, [])).filter((x) => x.check_id === 'M4.closed');
  assert.match(f[0]?.message_fr || '', /qui est effacée, sans facture terminée/);
  // on the Coffre job: M8.money; given back in full (net zero): closed
  await server(h);
  await card(4000, 'cs_coffre', g.jobB);
  assert.ok((await sees(h, [])).some((x) => x.check_id === 'M8.money'));
  await card(-4000, 'cs_coffre#re_2', g.jobB);
  assert.equal((await open(h)).filter((x) => x.check_id === 'M8.money').length, 1);
  await run(h);
  assert.equal((await open(h)).filter((x) => x.check_id === 'M8.money' || x.check_id.startsWith('M6.')).length, 0, 'a payment and its refund add up to zero');
}));

// ───────────────────────────── who sees what ─────────────────────────────

test('recon_summary: the owner sees everything, « Trésorerie » the money and stock, others are refused; the app may not run it itself', () => tx(async (h) => {
  const g = await garage(h);
  const acc = await h.person('Comptable', ['treasurer'], { rights: { treasury: true } });
  await raw(h, `update public.jobs set day = public.local_today() - 3 where id = $1`, [g.jobC]);    // D1: data, warn
  await h.c.query(`update public.expenses set total_cents = 5100 where id = $1`, [g.gas]);            // M7: money, bad
  const r = await run(h);
  // the checks a server function adds: Stripe is money (« Trésorerie » sees it), the backup is the owner's
  for (const [check, sev] of [['stripe_amount', 'warn'], ['backup_late', 'warn']]) {
    await h.c.query(`select public.recon_add($1, $2, $3, null, null, $4, $4, '{}'::jsonb)`, [r.run_id, check, sev, `Test ${check}`]);
  }
  // the owner
  await h.as(g.owner);
  const o = await h.rpc('recon_summary', { p_days: 14 });
  assert.deepEqual(Object.keys(o).sort(), ['can_ack', 'findings', 'last_run', 'ok', 'runs']);
  assert.deepEqual(Object.keys(o.last_run).sort(), ['counts', 'day', 'finished_at', 'sheet', 'status']);
  assert.deepEqual(Object.keys(o.runs[0]).sort(), ['counts', 'day', 'finished_at', 'status']);
  assert.deepEqual(Object.keys(o.findings[0]).sort(), ['check_id', 'entity_id', 'entity_table', 'first_day', 'id', 'last_day', 'message_en', 'message_fr', 'note', 'severity', 'state']);
  assert.deepEqual(Object.keys(o.last_run.sheet).sort(), ['coffre_in_cents', 'coffre_out_cents', 'expenses', 'invoiced_cents', 'received', 'refunded_cents', 'to_receive_cents']);
  assert.equal(o.ok, true);
  assert.equal(o.can_ack, true);
  assert.deepEqual(o.findings.map((f) => f.check_id), ['M7.sum', 'D1.past', 'backup_late', 'stripe_amount'], 'bad first, then by check');
  assert.equal(o.last_run.status, 'bad');
  // « Trésorerie »: the money only
  await h.as(acc);
  const t = await h.rpc('recon_summary', { p_days: 14 });
  assert.deepEqual(t.findings.map((f) => f.check_id), ['M7.sum', 'stripe_amount']);
  assert.deepEqual([t.last_run.counts.bad, t.last_run.counts.warn], [1, 1]);
  // what the run noted, for her too: only what her list holds (the data differences are not counted for her)
  assert.deepEqual([t.last_run.counts.seen, t.last_run.counts.new, t.last_run.counts.closed, t.last_run.counts.errors], [1, 1, 0, 0]);
  assert.ok(o.last_run.counts.seen >= 2 && o.last_run.counts.new >= 2, JSON.stringify(o.last_run.counts));
  assert.equal(t.last_run.counts.limited, undefined);
  // « vu » by the treasurer on a data difference: not hers
  const d1 = o.findings.find((f) => f.check_id === 'D1.past').id;
  assert.equal((await h.fails(() => h.rpc('recon_ack', { p_finding: d1, p_note: null })))?.hint, 'not_found');
  let acked;
  for (const f of t.findings) acked = await h.rpc('recon_ack', { p_finding: f.id, p_note: 'Corrigé demain avec le reçu' });
  assert.deepEqual(acked.findings.map((f) => f.state), ['acked', 'acked']);
  assert.equal(acked.findings[0].note, 'Corrigé demain avec le reçu');
  assert.equal(acked.last_run.status, 'ok', 'for her, the day no longer has an open difference');
  await h.as(g.owner);
  assert.equal((await h.rpc('recon_summary', {})).last_run.status, 'warn', 'for the owner, the data and the backup are still open');
  // a mechanic is refused
  await h.as(g.mech);
  for (const [fn, args] of [['recon_summary', { p_days: 7 }], ['recon_now', {}], ['recon_ack', { p_finding: d1, p_note: null }]]) {
    assert.equal((await h.fails(() => h.rpc(fn, args)))?.hint, 'not_allowed', fn);
  }
  // the app may not call the server's functions, nor read the tables
  assert.ok(await h.fails(() => h.c.query(`select public.recon_run()`)));
  assert.ok(await h.fails(() => h.c.query(`select public.recon_add(null, 'x', 'bad', null, null, 'x', 'x', '{}')`)));
  assert.ok(await h.fails(() => h.c.query(`select * from public.ops_recon_findings`)));
  await server(h);
  for (const t2 of ['ops_recon_runs', 'ops_recon_findings', 'ops_recon_baseline']) {
    assert.equal(await h.val(`select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t2}`]), true);
    for (const role of ['anon', 'authenticated']) assert.equal(await h.val(`select has_table_privilege($1, $2, 'select')`, [role, `public.${t2}`]), false);
  }
  for (const fn of ['recon_run(date,text)', 'recon_add(uuid,text,text,text,uuid,text,text,jsonb)', 'recon_collect(date)', 'recon_tally(uuid)']) {
    assert.equal(await h.val(`select has_function_privilege('authenticated', $1, 'execute')`, [`public.${fn}`]), false, fn);
    assert.equal(await h.val(`select has_function_privilege('anon', $1, 'execute')`, [`public.${fn}`]), false, fn);
  }
  for (const fn of ['recon_summary(integer)', 'recon_ack(uuid,text)', 'recon_now()']) {
    assert.equal(await h.val(`select has_function_privilege('authenticated', $1, 'execute')`, [`public.${fn}`]), true, fn);
    assert.equal(await h.val(`select has_function_privilege('anon', $1, 'execute')`, [`public.${fn}`]), false, fn);
  }
}));

test('recon_now: yesterday and today so far, at most once a minute, then the summary; before any run the summary says so', () => tx(async (h) => {
  const owner = await h.person('Hassan Jeha', ['owner']);
  await h.as(owner);
  const empty = await h.rpc('recon_summary', {});
  assert.deepEqual([empty.last_run, empty.runs, empty.findings], [null, [], []]);
  const s = await h.rpc('recon_now', {});
  assert.deepEqual(s.runs.map((r) => r.day), [await h.val(`select public.local_today()::text`), await h.val(`select (public.local_today() - 1)::text`)]);
  assert.equal(s.last_run.status, 'ok');
  const at = s.last_run.finished_at;
  const again = await h.rpc('recon_now', {});
  assert.equal(again.last_run.finished_at, at, 'braked: nothing ran again');
}));

test('recon: a few thousand rows are checked in well under a second', () => tx(async (h) => {
  const g = await garage(h);
  // 1500 finished jobs over 30 past days, each with its paid invoice and payment; 300 stock items with 4 moves each
  await raw(h, `insert into public.jobs (id, customer_id, day, block, status, started_at, arrived_at, finished_at, duration_min)
    select gen_random_uuid(), $1, public.local_today() - 1 - (n % 30), 'am', 'done', now(), now(), now(), 60 from generate_series(1, 1500) n`, [g.customer]);
  await raw(h, `update public.invoices set number = 1000 where id = $1`, [g.invoice]);
  await raw(h, `with j as (select id, row_number() over (order by id) as n from public.jobs where customer_id = $1 and status = 'done' and id <> all($2::uuid[]))
    insert into public.invoices (job_id, customer_id, number, status, issued_at, lines, subtotal_cents, taxable_cents, tps_cents, tvq_cents, total_cents, paid_cents)
    select j.id, $1, 1000 + j.n, 'paid', now() - make_interval(mins => j.n::int), '[{"description":"Vidange","qty":1,"unit_cents":10000,"total_cents":10000}]',
           10000, 10000, 500, 998, 11498, 11498 from j`, [g.customer, [g.jobA, g.jobB, g.jobC]]);
  await raw(h, `insert into public.payments (invoice_id, job_id, amount_cents, method, paid_at)
    select v.id, v.job_id, 11498, 'cash', v.issued_at from public.invoices v where v.number > 1000`);
  await raw(h, `update public.counters set next_value = 2501 where name = 'invoice'`);
  await raw(h, `insert into public.inventory_items (id, name, qty) select gen_random_uuid(), 'Pièce ' || n, 4 from generate_series(1, 300) n`);
  await raw(h, `insert into public.inventory_moves (item_id, delta, reason) select i.id, 1, 'restock' from public.inventory_items i, generate_series(1, 4) k where i.name like 'Pièce %'`);
  // 300 stock purchases paid by the Trésorerie (the move and its expense « Pièces » made at the same instant, as inventory_buy
  // does) among 1000 expenses; 100 Coffre purchases with their stock entry (M7 and M8 match moves and expenses: linear, not squared)
  await raw(h, `insert into public.inventory_items (id, name, qty) select gen_random_uuid(), 'Achat ' || n, 1 from generate_series(1, 300) n`);
  await raw(h, `insert into public.inventory_moves (item_id, delta, reason, note, created_at)
    select i.id, 1, 'restock', 'Lordco — Payé par la Trésorerie', now() - make_interval(mins => substr(i.name, 7)::int) from public.inventory_items i where i.name like 'Achat %'`);
  await raw(h, `insert into public.expenses (day, vendor, category, subtotal_cents, tps_cents, tvq_cents, total_cents, method, created_at)
    select public.local_today() - (n % 30), 'Lordco', 'Pièces', 4349, 217, 434, 5000, 'credit', now() - make_interval(mins => n) from generate_series(1, 300) n`);
  await raw(h, `insert into public.expenses (day, vendor, category, subtotal_cents, tps_cents, tvq_cents, total_cents, method)
    select public.local_today() - (n % 30), 'Shell', 'Essence', 4349, 217, 434, 5000, 'credit' from generate_series(1, 700) n`);
  await raw(h, `insert into public.inventory_items (id, name, qty, pool) select gen_random_uuid(), 'Coffre ' || n, 1, 'coffre' from generate_series(1, 100) n`);
  await raw(h, `insert into public.inventory_moves (item_id, delta, reason, created_at)
    select i.id, 1, 'restock', now() - make_interval(mins => substr(i.name, 8)::int) from public.inventory_items i where i.name like 'Coffre %'`);
  await raw(h, `insert into public.coffre (kind, amount_cents, received_on, item_id, item_name, qty, created_at)
    select 'purchase', 100, public.local_today(), i.id, i.name, 1, now() - make_interval(mins => substr(i.name, 8)::int) from public.inventory_items i where i.name like 'Coffre %'`);
  await run(h);   // the first run takes the baseline
  const t0 = Date.now();
  const r = await run(h);
  const ms = Date.now() - t0;
  const f = await open(h);
  console.log(`recon_run: ${ms} ms on ${await h.val(`select (select count(*) from public.jobs) + (select count(*) from public.invoices) + (select count(*) from public.payments) + (select count(*) from public.inventory_moves) + (select count(*) from public.inventory_items) + (select count(*) from public.expenses) + (select count(*) from public.coffre)`)} rows (server ${r.counts.ms} ms; by check: ${JSON.stringify(r.counts.checks_ms)})`);
  assert.deepEqual(f.filter((x) => x.severity !== 'info'), [], show(f));
  assert.ok(ms < 1000, `recon_run took ${ms} ms`);
  assert.equal(await h.val(`select count(*)::int from public.ops_recon_findings where state <> 'closed' and check_id like 'M7.%'`), 0, 'each purchase found its expense');
}));
