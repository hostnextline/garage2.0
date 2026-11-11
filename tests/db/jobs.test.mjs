// A job from start to finish, invoices, payments, and who sees what. Each test is rolled back at the end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());
const DAY = [[480, 1200]];
const here = [45.515, -73.64];

/** a garage with an owner, a mechanic and his truck, a customer, a job booked for a coming day */
async function garage(h, opts = {}) {
  const owner = await h.person('Hassan Jeha', ['owner']);
  const mech = await h.person('Saleh Mécano', ['mechanic'], { rights: opts.mechRights });
  const day = opts.today ? await h.val(`select public.local_today()::text`) : await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const truck = await h.truck('Camion de Saleh', mech, { [dow]: DAY });
  const customer = await h.customer('Jean', ...here, { last: 'Tremblay', phone: '5145551234' });
  const oil = await h.val(`insert into public.inventory_items (name, qty, unit) values ('Huile 5W-30', 20, 'L') returning id`);
  const filter = await h.val(`insert into public.inventory_items (name, qty) values ('Filtre PH7317', 5) returning id`);
  const svc = await h.val(`insert into public.services (name_fr, price_cents, duration_min) values ('Vidange d’huile + changement de filtre', 7999, 30) returning id`);
  await h.c.query(`insert into public.service_parts (service_id, item_id, qty) values ($1, $2, 4.5), ($1, $3, 1)`, [svc, oil, filter]);
  return { owner, mech, day, truck, customer, oil, filter, svc };
}
/** a job on the mechanic's truck, already en route → on site (as if the day had come) */
async function jobOnSite(h, g) {
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Vidange d’huile + changement de filtre', service_id: g.svc, unit_cents: 7999, duration_min: 30 }] });
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'leave', p_data: {} });
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'arrive', p_data: {} });
  return r.job_id;
}

test('a job from « Je pars » to « Terminé »: waiver, invoice with its number, payment, parts taken off the inventory', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [jobId]), 'on_site');
  // the waiver
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'waiver', p_data: { signer: 'Jean Tremblay', version: '1' } });
  assert.ok(await h.val(`select waiver_signed_at from public.jobs where id = $1`, [jobId]));
  // the invoice from the work
  const inv1 = await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true });
  const invoice = inv1.rows.invoices[0];
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.subtotal_cents, 7999);
  assert.equal(invoice.tps_cents, 400);    // 399,95 → 4,00
  assert.equal(invoice.tvq_cents, 798);    // 797,90 → 7,98
  assert.equal(invoice.total_cents, 9197);
  // a discount line added on the draft: totals recomputed by the server
  await h.c.query(`update public.invoices set lines = lines || '[{"description":"Rabais fidélité","qty":1,"unit_cents":1000,"kind":"discount"}]'::jsonb where id = $1`, [invoice.id]);
  const d = await h.one(`select subtotal_cents, total_cents from public.invoices where id = $1`, [invoice.id]);
  assert.equal(d.subtotal_cents, 6999);
  // leaving before payment is refused
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: {} })))?.hint, 'pay_first');
  // finish the invoice: number 1
  const f = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: invoice.id });
  assert.equal(f.number, 1);
  // an issued invoice is locked
  assert.ok(await h.fails(() => h.c.query(`update public.invoices set notes = 'x' where id = $1`, [invoice.id])));
  // partial, then full payment
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [invoice.id]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: invoice.id, p_amount_cents: 5000, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  assert.equal(await h.val(`select status from public.invoices where id = $1`, [invoice.id]), 'issued');
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: invoice.id, p_amount_cents: total - 5000, p_method: 'debit', p_reference: null, p_job: null, p_session: null });
  assert.equal(await h.val(`select status from public.invoices where id = $1`, [invoice.id]), 'paid');
  // now the job can finish; the parts the mechanic confirmed leave the inventory (Part 24 quater): 5 L of oil, no filter
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: { parts: [{ item_id: g.oil, qty: 5 }, { item_id: g.filter, qty: 0 }, { item_id: 'pas-un-id', qty: 3 }] } });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [jobId]), 'done');
  await h.as(null); await h.c.query('reset role');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.oil])), 15);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.filter])), 5, 'the filter was not used');
  assert.equal(await h.val(`select count(*)::int from public.inventory_moves where job_id = $1`, [jobId]), 1);
  // once: the list sent again (a retry) takes nothing more
  await h.c.query(`select public.use_parts($1, $2)`, [jobId, JSON.stringify([{ item_id: g.oil, qty: 5 }])]);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.oil])), 15);
}));

test('Part 24 quinquies: stock bought, paid by the Trésorerie (an expense with taxes) or by the Coffre (its balance goes down)', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  // the Trésorerie: 5 filters for 57,49 $ taxes included → an expense « Pièces », taxes split, the cost per filter
  const a = await h.rpc('inventory_buy', { p_op: uuid(), p_item: g.filter, p_qty: 5, p_total_cents: 5749, p_from: 'treasury', p_vendor: 'Lordco', p_note: 'Facture 1234' });
  assert.equal(a.ok, true);
  await h.as(null); await h.c.query('reset role');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.filter])), 10);
  const e = await h.one(`select vendor, category, description, subtotal_cents, tps_cents, tvq_cents, total_cents from public.expenses where id = $1`, [a.expense_id]);
  assert.deepEqual([e.vendor, e.category, e.description, e.total_cents], ['Lordco', 'Pièces', '5 × Filtre PH7317', 5749]);
  assert.equal(e.subtotal_cents + e.tps_cents + e.tvq_cents, 5749, 'subtotal + taxes = what was paid');
  assert.deepEqual([e.subtotal_cents, e.tps_cents], [5000, 250]);
  assert.equal(await h.val(`select cost_cents from public.inventory_items where id = $1`, [g.filter]), 1150);
  // the Coffre's own stock (Part 24 septies): family gave 100 $; 4,5 L of oil for the Coffre bought with it for 40 $ → 60 $ left
  await h.c.query(`insert into public.coffre (kind, amount_cents, received_on) values ('received', 10000, public.local_today())`);
  const coil = await h.val(`insert into public.inventory_items (name, qty, unit, pool) values ('Huile Coffre', 0, 'L', 'coffre') returning id`);
  await h.as(g.owner);
  const b = await h.rpc('inventory_buy', { p_op: uuid(), p_item: coil, p_qty: 4.5, p_total_cents: 4000, p_from: 'coffre', p_vendor: null, p_note: null });
  assert.ok(b.coffre_id && !b.expense_id, 'no expense for Coffre money');
  const rep = await h.rpc('coffre_report', { p_from: null, p_to: null });
  assert.deepEqual([rep.amount_cents, rep.spent_cents, rep.balance_cents], [10000, 4000, 6000]);
  const row = rep.rows.find((x) => x.kind === 'purchase');
  assert.deepEqual([row.customer, row.work, row.amount_cents], ['Huile Coffre', '4.5 × Huile Coffre', 4000]);
  await h.as(null); await h.c.query('reset role');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [coil])), 4.5);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.oil])), 20, 'the garage\'s oil did not move');
  assert.equal(await h.val(`select count(*)::int from public.expenses where description like '%Huile Coffre%'`), 0, 'never in the Trésorerie');
  // the same purchase sent twice (a retry): once; the Coffre's stock is worth what it cost
  const op = uuid();
  await h.as(g.owner);
  await h.rpc('inventory_buy', { p_op: op, p_item: coil, p_qty: 1, p_total_cents: 900, p_from: 'coffre', p_vendor: null, p_note: null });
  await h.rpc('inventory_buy', { p_op: op, p_item: coil, p_qty: 1, p_total_cents: 900, p_from: 'coffre', p_vendor: null, p_note: null });
  const rep2 = await h.rpc('coffre_report', { p_from: null, p_to: null });
  assert.deepEqual([rep2.balance_cents, rep2.stock_cents], [5100, 4950], '5,5 L at 9,00 $');
  // each stock its own money: a garage item is not paid by the Coffre, a Coffre item not by the Trésorerie
  assert.equal((await h.fails(() => h.rpc('inventory_buy', { p_op: uuid(), p_item: g.oil, p_qty: 1, p_total_cents: 900, p_from: 'coffre', p_vendor: null, p_note: null })))?.hint, 'bad_from');
  assert.equal((await h.fails(() => h.rpc('inventory_buy', { p_op: uuid(), p_item: coil, p_qty: 1, p_total_cents: 900, p_from: 'treasury', p_vendor: null, p_note: null })))?.hint, 'bad_from');
  // an item stays in its stock
  assert.equal((await h.fails(() => h.c.query(`update public.inventory_items set pool = 'garage' where id = $1`, [coil])))?.hint, 'pool_fixed');
  // refusals: no price, a bad side
  assert.equal((await h.fails(() => h.rpc('inventory_buy', { p_op: uuid(), p_item: g.oil, p_qty: 1, p_total_cents: null, p_from: 'treasury', p_vendor: null, p_note: null })))?.hint, 'bad_amount');
  assert.equal((await h.fails(() => h.rpc('inventory_buy', { p_op: uuid(), p_item: g.oil, p_qty: 1, p_total_cents: 100, p_from: 'poche', p_vendor: null, p_note: null })))?.hint, 'bad_from');
  await h.as(null); await h.c.query('reset role');
  const acc = await h.person('Comptable', ['treasurer'], { rights: { treasury: true, inventory: false } });
  await h.as(acc);
  assert.equal((await h.fails(() => h.rpc('inventory_buy', { p_op: uuid(), p_item: coil, p_qty: 1, p_total_cents: 100, p_from: 'coffre', p_vendor: null, p_note: null })))?.hint, 'not_allowed');
}));

test('Part 24 sexies: « Changer le prix »: any account that sees the appointment, noted; never on a finished invoice or a closed job', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Vidange', service_id: g.svc, unit_cents: 7999, duration_min: 30 }, { description: 'Rabais', kind: 'discount', unit_cents: 1000 }] });
  const [oil, rebate] = await h.q(`select id, kind from public.job_items where job_id = $1 order by kind desc`, [r.job_id]).then((x) => [x.find((i) => i.kind !== 'discount').id, x.find((i) => i.kind === 'discount').id]);
  // the mechanic of the truck (no « invoices » right): the wrong price fixed
  await h.as(g.mech);
  const a = await h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: 6999 });
  assert.equal(a.ok, true);
  await h.rpc('job_item_price', { p_op: uuid(), p_item: rebate, p_unit_cents: 500 });
  await h.as(null); await h.c.query('reset role');
  assert.deepEqual((await h.q(`select unit_cents from public.job_items where id = any($1) order by kind desc`, [[oil, rebate]])).map((x) => x.unit_cents), [6999, -500], 'a discount stays a discount');
  const note = await h.one(`select actor, data from public.activity where action = 'price_changed' and data->>'item' = $1`, [oil]);
  assert.deepEqual([note.actor, note.data.from, note.data.to], [g.mech, 7999, 6999]);
  // someone who does not see the appointment, a bad price
  const other = await h.person('Autre Mécano', ['mechanic']);
  await h.as(other);
  assert.equal((await h.fails(() => h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: 100 })))?.hint, 'not_found');
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: -5 })))?.hint, 'bad_amount');
  // a finished invoice: refused (cancel it first)
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: r.job_id, p_refresh: true })).rows.invoices[0];
  assert.equal((await h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: 7500 })).ok, true, 'a draft follows the work');
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv.id });
  assert.equal((await h.fails(() => h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: 7000 })))?.hint, 'invoice_done');
}));

test('Part 24 nonies: « Changer de client »: the appointment goes to the right customer (car, address); the wrong one loses the link and the signature', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(null); await h.c.query('reset role');
  const right = await h.customer('Marie', 45.52, -73.62, { last: 'Bon', phone: '5145559876', address: '22 rue Juste' });
  const marieCar = await h.val(`insert into public.vehicles (customer_id, year, make, model) values ($1, 2018, 'Honda', 'Civic') returning id`, [right]);
  const wrongCar = await h.val(`insert into public.vehicles (customer_id, year, make, model) values ($1, 2012, 'Ford', 'Focus') returning id`, [g.customer]);
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, vehicle_id: wrongCar, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Vidange', service_id: g.svc, unit_cents: 7999, duration_min: 30 }] });
  await h.as(null); await h.c.query('reset role');
  // the wrong customer had the confirmation link and had signed online
  const link = await h.val(`insert into public.public_links (token_hash, job_id, expires_at) values ('h-' || gen_random_uuid(), $1, now() + interval '30 days') returning id`, [r.job_id]);
  await h.c.query(`update public.jobs set estimate_signed_at = now(), estimate_signer = 'Jean Tremblay', waiver_signed_at = now(), waiver_signer = 'Jean Tremblay', confirm_sent_at = now() where id = $1`, [r.job_id]);
  // a mechanic of another truck: refused; the one of this truck may
  const other = await h.person('Autre Mécano', ['mechanic']);
  await h.as(other);
  assert.equal((await h.fails(() => h.rpc('job_customer', { p_op: uuid(), p_job: r.job_id, p_customer: right, p_vehicle: null })))?.hint, 'not_found');
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('job_customer', { p_op: uuid(), p_job: r.job_id, p_customer: g.customer, p_vehicle: null })))?.hint, 'same');
  assert.equal((await h.fails(() => h.rpc('job_customer', { p_op: uuid(), p_job: r.job_id, p_customer: right, p_vehicle: wrongCar })))?.hint, 'bad_vehicle', 'the car must be hers');
  // Marie's only car is taken by itself; her address and position; the draft invoice follows
  const out = await h.rpc('job_customer', { p_op: uuid(), p_job: r.job_id, p_customer: right, p_vehicle: null });
  assert.equal(out.ok, true); assert.equal(out.vehicle_id, marieCar);
  await h.as(null); await h.c.query('reset role');
  const j = await h.one(`select customer_id, vehicle_id, address, lat, confirm_sent_at, waiver_signed_at, waiver_via, estimate_signed_at, estimate_signer, status from public.jobs where id = $1`, [r.job_id]);
  assert.deepEqual([j.customer_id, j.vehicle_id, j.address, j.lat, j.status], [right, marieCar, '22 rue Juste', 45.52, 'booked']);
  assert.deepEqual([j.confirm_sent_at, j.waiver_signed_at, j.waiver_via, j.estimate_signed_at, j.estimate_signer], [null, null, null, null, null], 'Jean’s signature is gone; the text can go to Marie');
  assert.ok(await h.val(`select revoked_at from public.public_links where id = $1`, [link]), 'Jean’s link no longer works');
  assert.equal(await h.val(`select count(*)::int from public.job_items where job_id = $1`, [r.job_id]), 1, 'the services stay');
  const note = await h.one(`select actor, data from public.activity where action = 'customer_changed' and entity_id = $1`, [r.job_id]);
  assert.deepEqual([note.actor, note.data.from, note.data.to, note.data.links_closed, note.data.signature_removed], [g.owner, g.customer, right, 1, true]);
  // once the truck has left: refused (cancel and book again)
  await h.c.query(`update public.jobs set status = 'en_route' where id = $1`, [r.job_id]);
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('job_customer', { p_op: uuid(), p_job: r.job_id, p_customer: g.customer, p_vehicle: null })))?.hint, 'started');
}));

test('Part 24 decies: « Modifier la facture »: the draft follows the work, a finished invoice reopens with its number, payments wait and come back', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  // what the test looks at, read as the database (the person's role comes back after)
  const peek = async (sql, params = []) => {
    const was = await h.val('select current_user');
    await h.c.query('reset role');
    try { return await h.val(sql, params); } finally { if (was === 'authenticated') await h.c.query('set local role authenticated'); }
  };
  const lines = async (inv) => (await peek(`select lines from public.invoices where id = $1`, [inv])).map((l) => [l.description, Number(l.unit_cents)]);
  // the mechanic on site: a second part of the job, then the invoice
  await h.as(g.mech);
  const oil = await h.val(`select id from public.job_items where job_id = $1`, [jobId]);
  const brakes = await h.val(`insert into public.job_items (job_id, description, unit_cents, status, kind, sort) values ($1, 'Plaquettes avant', 15000, 'planned', 'service', 99999) returning id`, [jobId]);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0].id;
  assert.deepEqual(await lines(inv), [['Vidange d’huile + changement de filtre', 7999], ['Plaquettes avant', 15000]]);
  // a part of the job taken off: it leaves the draft by itself
  await h.c.query(`update public.job_items set status = 'removed' where id = $1`, [brakes]);
  assert.deepEqual(await lines(inv), [['Vidange d’huile + changement de filtre', 7999]]);
  // a new price on the work goes on the draft; a price written on the invoice by hand stays when the work is only marked done
  await h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: 6999 });
  assert.deepEqual(await lines(inv), [['Vidange d’huile + changement de filtre', 6999]]);
  await h.c.query(`update public.invoices set lines = jsonb_set(lines, '{0,unit_cents}', '6500') where id = $1`, [inv]);
  await h.c.query(`update public.job_items set status = 'done' where id = $1`, [oil]);
  assert.deepEqual(await lines(inv), [['Vidange d’huile + changement de filtre', 6500]]);
  // finished, 20 $ received
  const n = (await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv })).number;
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: 2000, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  // the work billed on a finished invoice does not change by itself: « Modifier la facture » first
  assert.equal((await h.fails(() => h.c.query(`update public.job_items set status = 'removed' where id = $1`, [oil])))?.hint, 'invoice_done');
  assert.equal((await h.fails(() => h.rpc('job_item_price', { p_op: uuid(), p_item: oil, p_unit_cents: 5000 })))?.hint, 'invoice_done');
  await h.c.query(`update public.job_items set status = 'planned' where id = $1`, [oil]);  // done ⇄ planned bills the same: allowed
  // a mechanic of another truck may not; the job's mechanic may
  await h.as(null);
  const other = await h.person('Autre Mécano', ['mechanic']);
  await h.as(other);
  assert.equal((await h.fails(() => h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv })))?.hint, 'not_allowed');
  await h.as(g.mech);
  const counter = await peek(`select next_value from public.counters where name = 'invoice'`);
  const r = await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv });
  assert.deepEqual([r.ok, r.number], [true, n]);
  const open = await h.one(`select status, number, paid_cents from public.invoices where id = $1`, [inv]);
  assert.deepEqual([open.status, Number(open.number), open.paid_cents], ['draft', n, 0]);
  assert.equal(await peek(`select count(*)::int from public.payments where job_id = $1 and invoice_id is null`, [jobId]), 1, 'the 20 $ wait on the job');
  // the brakes come back, then go again; under what was paid: refused
  await h.c.query(`update public.job_items set status = 'planned' where id = $1`, [brakes]);
  await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true });
  assert.equal((await lines(inv)).length, 2);
  await h.c.query(`update public.job_items set deleted_at = now() where id = $1`, [brakes]);
  assert.deepEqual(await lines(inv), [['Vidange d’huile + changement de filtre', 6999]]);
  await h.c.query(`update public.invoices set lines = jsonb_set(lines, '{0,unit_cents}', '1000') where id = $1`, [inv]);
  const low = await h.fails(() => h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv }));
  assert.equal(low?.hint, 'below_paid'); assert.match(low.message, /20,00 \$/);
  await h.c.query(`update public.invoices set lines = jsonb_set(lines, '{0,unit_cents}', '6999') where id = $1`, [inv]);
  // finished again: the same number, no number used, the 20 $ back on it
  const again = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  assert.deepEqual([again.number, again.again], [n, true]);
  assert.equal(await peek(`select next_value from public.counters where name = 'invoice'`), counter, 'no invoice number spent');
  const back = await h.one(`select status, paid_cents from public.invoices where id = $1`, [inv]);
  assert.deepEqual([back.status, back.paid_cents], ['issued', 2000]);
  // reopened while the customer pays by card: the money is in, it waits on the job and comes back when finished
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv });
  await h.as(null); await h.c.query('reset role');
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: 1000, p_method: 'card_online', p_reference: 'pi_1', p_job: null, p_session: 'cs_1' });
  assert.equal(await h.val(`select invoice_id from public.payments where stripe_session = 'cs_1'`), null);
  // a cash payment on a draft: still « finish it first »
  await h.as(g.mech);
  assert.equal((await h.fails(() => h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: 500, p_method: 'cash', p_reference: null, p_job: null, p_session: null })))?.hint, 'invoice_first');
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  assert.equal(await peek(`select paid_cents from public.invoices where id = $1`, [inv]), 3000);
  // the job over: no more; paid: no more
  await h.as(null); await h.c.query('reset role');
  await h.c.query(`update public.jobs set status = 'done' where id = $1`, [jobId]);
  await h.as(g.mech);
  assert.equal((await h.fails(() => h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv })))?.hint, 'closed');
  await h.as(null); await h.c.query('reset role');
  await h.c.query(`update public.jobs set status = 'on_site' where id = $1`, [jobId]);
  await h.as(g.mech);
  const left = await peek(`select total_cents - paid_cents from public.invoices where id = $1`, [inv]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: left, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  assert.equal((await h.fails(() => h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv })))?.hint, 'paid');
  await h.as(null); await h.c.query('reset role');
  const note = await h.one(`select actor, data from public.activity where action = 'invoice_reopened' and entity_id = $1 limit 1`, [jobId]);
  assert.deepEqual([note.actor, Number(note.data.number), note.data.paid, note.data.payments], [g.mech, n, 2000, 1]);
}));

test('Part 24 undecies: « Historique du véhicule »: every visit of a VIN, whoever owned the car; never the other owner’s name', () => tx(async (h) => {
  const g = await garage(h);
  const VIN = '1HGCM82633A004352';
  await h.as(null); await h.c.query('reset role');
  // Jean had the car (and booked it twice: one done, one cancelled); Marie bought it and entered the same VIN
  const marie = await h.customer('Marie', 45.52, -73.62, { last: 'Nouvelle', phone: '5145559876' });
  const jeanCar = await h.val(`insert into public.vehicles (customer_id, year, make, model, vin) values ($1, 2003, 'Honda', 'Accord', $2) returning id`, [g.customer, VIN]);
  const marieCar = await h.val(`insert into public.vehicles (customer_id, year, make, model, vin) values ($1, 2003, 'Honda', 'Accord', $2) returning id`, [marie, VIN]);
  await h.as(g.owner);
  const book = async (customer, car, what) => (await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: customer, vehicle_id: car, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: what, unit_cents: 12000, duration_min: 30 }] })).job_id;
  const done = await book(g.customer, jeanCar, 'Freins avant');
  const cancelled = await book(g.customer, jeanCar, 'Pneus d’hiver');
  const coming = await book(marie, marieCar, 'Vidange');
  const family = await book(g.customer, jeanCar, 'Batterie');
  await h.as(null); await h.c.query('reset role');
  await h.c.query(`update public.jobs set status = 'done', day = day - 30 where id = $1`, [done]);
  await h.c.query(`update public.jobs set status = 'cancelled' where id = $1`, [cancelled]);
  const coffre = await h.val(`insert into public.coffre (kind, amount_cents, received_on) values ('received', 5000, public.local_today()) returning id`);
  await h.c.query(`update public.jobs set coffre_id = $2 where id = $1`, [family, coffre]);
  // the owner, from Marie's file: Jean's visit is « another owner », hers is here; the cancelled one is not a visit
  await h.as(g.owner);
  const r = await h.rpc('vin_history', { p_vin: ' 1hgcm82633a004352 ', p_customer: marie });
  assert.equal(r.vin, VIN, 'spaces and small letters do not matter');
  const byJob = Object.fromEntries(r.visits.map((x) => [x.job_id, x]));
  assert.ok(!byJob[cancelled], 'a cancelled appointment is not a visit');
  assert.deepEqual([byJob[done].here, byJob[done].work, byJob[done].status], [false, ['Freins avant'], 'done']);
  assert.deepEqual([byJob[coming].here, byJob[coming].work], [true, ['Vidange']]);
  assert.equal(r.visits[0].job_id, coming, 'the newest first');
  assert.ok(byJob[family], 'the owner sees a visit paid by the Coffre');
  // a mechanic of another truck: the visits (what was done on the car), not the jobs themselves; never Jean's name or phone
  await h.as(null);
  const other = await h.person('Autre Mécano', ['mechanic']);
  await h.as(other);
  const m = await h.rpc('vin_history', { p_vin: VIN, p_customer: null });
  assert.ok(m.visits.length >= 2);
  assert.ok(m.visits.every((x) => x.open === false), 'he may not open jobs that are not his');
  assert.ok(!m.visits.some((x) => x.job_id === family), 'the Coffre stays the owner’s');
  assert.doesNotMatch(JSON.stringify(m), /Jean|Tremblay|5145551234|Marie|Nouvelle|12000/, 'no name, phone or price');
  // a VIN that is not 17 characters: nothing; someone not of the team: refused
  assert.deepEqual((await h.rpc('vin_history', { p_vin: '1HGCM826', p_customer: null })).visits, []);
  await h.as(null);
  assert.equal((await h.fails(() => h.rpc('vin_history', { p_vin: VIN, p_customer: null })))?.hint, 'not_allowed');
}));

test('Part 24 quater: without a confirmed list (an older app) the planned parts leave as before; an item deleted for good leaves no trace', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'waiver', p_data: { signer: 'Jean', version: '1' } });
  const invoice = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0];
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: invoice.id });
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [invoice.id]);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: invoice.id, p_amount_cents: total, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: {} });
  await h.as(null); await h.c.query('reset role');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.oil])), 15.5, '4.5 L planned for the service');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.filter])), 4);
  // delete for good: the inventory right (or the owner); not the accountant, who has no say on the shelf
  const accountant = await h.person('Comptable', ['treasurer'], { rights: { treasury: true, inventory: false } });
  await h.as(accountant);
  assert.equal((await h.fails(() => h.rpc('inventory_delete', { p_op: uuid(), p_item: g.filter })))?.hint, 'not_allowed');
  await h.as(g.owner);
  const r = await h.rpc('inventory_delete', { p_op: uuid(), p_item: g.filter });
  assert.deepEqual([r.ok, r.name], [true, 'Filtre PH7317']);
  assert.equal((await h.fails(() => h.rpc('inventory_delete', { p_op: uuid(), p_item: g.filter })))?.hint, 'not_found');
  await h.as(null); await h.c.query('reset role');
  assert.equal(await h.val(`select count(*)::int from public.inventory_items where id = $1`, [g.filter]), 0, 'gone');
  assert.equal(await h.val(`select count(*)::int from public.inventory_moves where item_id = $1`, [g.filter]), 0, 'its moves too');
  assert.equal(await h.val(`select count(*)::int from public.service_parts where item_id = $1`, [g.filter]), 0, 'and its links to services');
  assert.equal(await h.val(`select count(*)::int from public.job_items where item_id = $1`, [g.filter]), 0);
  assert.equal(await h.val(`select count(*)::int from public.inventory_moves where item_id = $1`, [g.oil]), 1, 'the other item keeps its history');
}));

test('invoice numbers follow each other, never twice; a cancelled one keeps its number and the job gets a new one', () => tx(async (h) => {
  const g = await garage(h);
  const j1 = await jobOnSite(h, g);
  const i1 = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j1, p_refresh: true })).rows.invoices[0].id;
  const n1 = (await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: i1 })).number;
  const op = uuid();
  const again = await h.rpc('invoice_finish', { p_op: op, p_invoice: i1 });
  assert.equal(again.already, true, 'finishing twice keeps the same number');
  await h.as(g.owner);
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: i1, p_reason: 'Erreur de prix' });
  assert.equal(await h.val(`select status from public.invoices where id = $1`, [i1]), 'void');
  const i2 = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j1, p_refresh: true })).rows.invoices.find((v) => v.status === 'draft').id;
  const n2 = (await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: i2 })).number;
  assert.equal(n2, n1 + 1);
}));

test('the mechanic cannot leave while the job before is not paid; the office may let a customer pay later', () => tx(async (h) => {
  const g = await garage(h);
  const j1 = await jobOnSite(h, g);
  await h.as(g.owner);
  const c2 = await h.customer('Marie', 45.52, -73.63);
  const r2 = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c2, day: g.day, block: 'am', duration_min: 30 }, p_items: [] });
  await h.as(g.mech);
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: r2.job_id, p_action: 'leave', p_data: {} })))?.hint, 'unpaid_here');
  // the mechanic cannot let him go unpaid; the owner can, once the invoice is finished
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j1, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: j1, p_action: 'finish', p_data: { pay_later: true } })))?.hint, 'pay_first');
  await h.as(g.owner);
  await h.rpc('job_step', { p_op: uuid(), p_job: j1, p_action: 'finish', p_data: { pay_later: true, reason: 'Client commercial, paie au mois' } });
  assert.equal(await h.val(`select pay_later from public.jobs where id = $1`, [j1]), true);
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: r2.job_id, p_action: 'leave', p_data: {} });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [r2.job_id]), 'en_route');
}));

test('cancel and « Client absent »: amount lost, the block frees up, back on the agenda', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Pneus', unit_cents: 7999, qty: 1 }, { description: 'Vidange', unit_cents: 7999 }] });
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'no_show', p_data: { reason: 'Personne à la maison' } });
  const j = await h.one(`select status, lost_cents, truck_id from public.jobs where id = $1`, [r.job_id]);
  assert.equal(j.status, 'no_show');
  assert.equal(j.lost_cents, 15998);
  assert.equal(await h.val(`select no_shows from public.customers where id = $1`, [g.customer]), 1);
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'reopen', p_data: {} });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [r.job_id]), 'booked');
  assert.equal(await h.val(`select no_shows from public.customers where id = $1`, [g.customer]), 0);
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'cancel', p_data: { lost_cents: 5000, reason: 'Le client a annulé' } });
  assert.equal(await h.val(`select lost_cents from public.jobs where id = $1`, [r.job_id]), 5000);
}));

test('a cancel in a block that has already started leaves the other jobs on their truck (Part 24)', () => tx(async (h) => {
  const now = await h.val(`select public.now_min()`);
  const b = await h.one(`select key, start_min, end_min from public.blocks() where start_min <= $1 order by start_min desc limit 1`, [now]);
  if (!b) return;   // before the first block of the day (Montréal time): no block has started yet, nothing to check
  const g = await garage(h, { today: true });
  // the truck has (almost) no time left in this block: before Part 24 the re-plan after a cancel dropped it, and the
  // mechanic's other jobs of the block went to « À placer »
  await h.c.query(`update public.truck_week set ranges = $2 where truck_id = $1`, [g.truck, JSON.stringify([[b.start_min, Math.max(b.start_min + 5, Math.min(b.end_min, now + 10))]])]);
  await h.as(null);
  await h.c.query(`select set_config('garage.rpc', 'on', true)`);
  const ids = [uuid(), uuid()];
  for (const id of ids) {
    await h.c.query(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, lat, lng, stop_order) values ($1, $2, $3, $4, $5, 'booked', 30, 45.51, -73.63, $6)`,
      [id, g.customer, g.day, b.key, g.truck, ids.indexOf(id) + 1]);
  }
  assert.equal(await h.val(`select public.block_open($1, $2)`, [g.day, b.key]), false, 'the block has started');
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: ids[0], p_action: 'cancel', p_data: { reason: 'Le client a annulé' } });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [ids[0]]), 'cancelled');
  assert.equal(await h.val(`select truck_id from public.jobs where id = $1`, [ids[1]]), g.truck, 'the other job stays on the truck');
  // the same for a longer job in that block: the length changes, nothing moves
  await h.rpc('set_job_duration', { p_op: uuid(), p_job: ids[1], p_duration: 90 });
  const j = await h.one(`select truck_id, duration_min from public.jobs where id = $1`, [ids[1]]);
  assert.deepEqual([j.truck_id, j.duration_min], [g.truck, 90]);
  // a coming block is still re-planned as before (block_open is the server's own: asked as the server)
  await h.as(null);
  assert.equal(await h.val(`select public.block_open((public.local_today() + 1)::date, 'am')`), true);
}));

test('extra work: proposed, answered by the customer on the spot, billed only when accepted', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  const yes = uuid(), no = uuid();
  await h.c.query(`insert into public.job_items (id, job_id, description, unit_cents, status) values ($1, $3, 'Plaquettes avant', 12999, 'proposed'), ($2, $3, 'Essuie-glaces', 2999, 'proposed')`, [yes, no, jobId]);
  await h.rpc('extra_answer', { p_op: uuid(), p_item: yes, p_accept: true, p_via: 'verbal' });
  // a signature of another job can't be used; the customer's own signature stays with the answer
  const sigOther = uuid(), sig = uuid();
  await h.as(null);
  const other = await h.val(`insert into public.jobs (customer_id, day, block, status, duration_min) values ($1, public.local_today() + 30, 'am', 'booked', 30) returning id`, [g.customer]);
  await h.c.query(`insert into public.attachments (id, kind, mime, data, job_id) values ($1, 'signature', 'image/png', 'iVBOR', $2), ($3, 'signature', 'image/png', 'iVBOR', $4)`, [sigOther, other, sig, jobId]);
  await h.as(g.mech);
  assert.equal((await h.fails(() => h.rpc('extra_answer', { p_op: uuid(), p_item: no, p_accept: false, p_via: 'signature', p_attachment: sigOther })))?.hint, 'signature');
  await h.rpc('extra_answer', { p_op: uuid(), p_item: no, p_accept: false, p_via: 'signature', p_attachment: sig });
  assert.equal(await h.val(`select answer_attachment::text from public.job_items where id = $1`, [no]), sig);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0];
  assert.equal(inv.subtotal_cents, 7999 + 12999);
  assert.deepEqual(inv.lines.map((l) => l.description).sort(), ['Plaquettes avant', 'Vidange d’huile + changement de filtre']);
}));

test('a walk-in: work starting now on my truck', () => tx(async (h) => {
  const g = await garage(h, { today: true });
  await h.as(g.mech);
  const r = await h.rpc('walk_in', { p_op: uuid(), p_job: { customer_id: g.customer }, p_items: [{ description: 'Boost', unit_cents: 4000 }] });
  const j = await h.one(`select status, truck_id, day::text = public.local_today()::text as today, source from public.jobs where id = $1`, [r.job_id]);
  assert.deepEqual([j.status, j.truck_id, j.today, j.source], ['on_site', g.truck, true, 'walk_in']);
}));

test('who sees what: a mechanic his truck, the treasurer the money, nobody the secrets', () => tx(async (h) => {
  const g = await garage(h, { mechRights: { clients: false } });
  const other = await h.person('Adam', ['mechanic']);
  const tres = await h.person('Trésorier', ['treasurer']);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [g.day]);
  const t2 = await h.truck('Voiture', other, { [dow]: DAY });
  const c2 = await h.customer('Paul', 45.6, -73.6);
  await h.as(g.owner);
  const a = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', truck_id: g.truck }, p_items: [] });
  const b = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c2, day: g.day, block: 'am', truck_id: t2 }, p_items: [] });
  await h.c.query(`insert into public.expenses (vendor, total_cents) values ('NAPA', 5000)`);
  await h.c.query('reset role');
  await h.c.query(`insert into public.secrets (key, value) values ('ghl_token', 'pit-test')`);
  // the mechanic: his job, his customer only (clients right removed for him)
  await h.as(g.mech);
  const jobs = (await h.q(`select id from public.jobs`)).map((r) => r.id);
  assert.deepEqual(jobs, [a.job_id]);
  const cust = (await h.q(`select id from public.customers`)).map((r) => r.id);
  assert.deepEqual(cust, [g.customer]);
  assert.equal((await h.q(`select * from public.expenses`)).length, 0);
  assert.ok(await h.fails(() => h.q(`select * from public.secrets`)), 'secrets are not even readable');
  // the other mechanic cannot touch the first one's job
  await h.as(other);
  assert.equal((await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: a.job_id, p_action: 'leave', p_data: {} })))?.hint, 'not_allowed');
  // the treasurer: expenses yes, jobs no (no agenda right by default)
  await h.as(tres);
  assert.equal((await h.q(`select * from public.expenses`)).length, 1);
  assert.equal((await h.q(`select * from public.jobs`)).length, 0);
  void b;
}));

test('rights: what each person may do comes from the server', () => tx(async (h) => {
  const g = await garage(h);
  const office = await h.person('Bureau', ['office'], { rights: { money: false } });
  await h.as(office);
  const acc = await h.val(`select public.my_access()`);
  assert.equal(acc.rights.agenda, true, 'always with the office role');
  assert.equal(acc.rights.book, true, 'given by the role at the start');
  assert.equal(acc.rights.money, false, 'removed for this person');
  assert.equal(acc.rights.settings, false);
  assert.ok((await h.fails(() => h.rpc('set_role_rights', { p_op: uuid(), p_role: 'mechanic', p_right: 'book', p_on: true })))?.hint === 'not_allowed');
  await h.as(g.owner);
  await h.rpc('set_role_rights', { p_op: uuid(), p_role: 'mechanic', p_right: 'book', p_on: true });
  await h.as(g.mech);
  assert.equal((await h.val(`select public.my_access()`)).rights.book, true, 'the owner ticked « book » for mechanics');
  assert.deepEqual((await h.val(`select public.my_access()`)).trucks, [g.truck]);
  // the last owner stays an owner
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('member_update', { p_op: uuid(), p_staff: g.owner, p_patch: { roles: ['office'] } })))?.hint, 'last_owner');
  await h.rpc('member_update', { p_op: uuid(), p_staff: g.mech, p_patch: { active: false } });
  await h.c.query('reset role');
  assert.ok(await h.val(`select banned_until from auth.users where id = $1`, [g.mech]), 'a blocked person cannot sign in');
}));

test('positions only during the day; the map needs its right; the customer follows with the secret link only', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.mech);
  assert.equal((await h.val(`select public.report_position(45.5, -73.6)`)).reason, 'no_shift');
  await h.val(`select public.shift_start()`);
  assert.equal((await h.val(`select public.report_position(45.5, -73.6)`)).ok, true);
  const jobId = await jobOnSite(h, g);
  // a trip with a token (made by the en-route function in real life)
  const token = randomBytes(18).toString('base64url');
  await h.c.query('reset role');
  await h.c.query(`insert into public.trips (job_id, staff_id, token_hash, status, dest_lat, dest_lng, minutes, km) values ($1, $2, $3, 'active', 45.515, -73.64, 12, 4.2)`,
    [jobId, g.mech, createHash('sha256').update(token).digest('hex')]);
  await h.c.query(`update public.jobs set status = 'en_route' where id = $1`, [jobId]);
  await h.c.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
  await h.c.query('set local role anon');
  const t = await h.val(`select public.public_track($1)`, [token]);
  assert.equal(t.status, 'active');
  assert.equal(t.mechanic, 'Saleh');
  assert.equal(t.customer, 'Jean');
  assert.ok(t.pos && t.pos.lat === 45.5, 'his position while on the way');
  assert.equal((await h.val(`select public.public_track('wrong-token-1234567')`)).status, 'not_found');
  assert.ok(await h.fails(() => h.q(`select * from public.jobs`)), 'the public sees no table');
  await h.as(g.mech);
  await h.val(`select public.shift_end()`);
  await h.c.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
  await h.c.query('reset role'); await h.c.query('set local role anon');
  const t2 = await h.val(`select public.public_track($1)`, [token]);
  assert.equal(t2.status, 'cancelled', 'ending the day ends the tracking');
  assert.equal(t2.pos, null);
}));

test('Part 24 ter: the trip back to the start has no job; the public page says where to; ending the day = arrived', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.mech);
  await h.val(`select public.shift_start()`);
  const token = randomBytes(18).toString('base64url');
  await h.c.query('reset role');
  await h.c.query(`insert into public.trips (job_id, kind, dest_label, staff_id, token_hash, status, dest_lat, dest_lng, minutes, km) values (null, 'return', 'Centrale', $1, $2, 'active', 45.5312898, -73.6544639, 14, 6.1)`,
    [g.mech, createHash('sha256').update(token).digest('hex')]);
  // one trip back at a time per person
  const twice = await h.fails(() => h.c.query(`insert into public.trips (job_id, kind, dest_label, staff_id, status, dest_lat, dest_lng) values (null, 'return', 'Centrale', $1, 'active', 45.5, -73.6)`, [g.mech]));
  assert.match(String(twice?.message), /trips_one_return/);
  assert.ok(await h.fails(() => h.c.query(`insert into public.trips (job_id, kind, staff_id, status) values (null, 'elsewhere', $1, 'active')`, [g.mech])), 'kind is job or return');
  await h.c.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
  await h.c.query('set local role anon');
  const t = await h.val(`select public.public_track($1)`, [token]);
  assert.deepEqual([t.status, t.kind, t.dest_label, t.mechanic, t.customer, t.lang], ['active', 'return', 'Centrale', 'Saleh', '', 'fr']);
  assert.deepEqual(t.dest, { lat: 45.5312898, lng: -73.6544639 });
  await h.as(g.mech);
  await h.val(`select public.shift_end()`);
  await h.c.query('reset role');
  assert.equal(await h.val(`select status from public.trips where token_hash = $1`, [createHash('sha256').update(token).digest('hex')]), 'arrived', 'home: arrived, not cancelled');
  await h.c.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
  await h.c.query('set local role anon');
  assert.equal((await h.val(`select public.public_track($1)`, [token])).status, 'arrived');
}));

test('the dashboard and the treasury report add up', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: 9197, p_method: 'interac', p_reference: null, p_job: null, p_session: null });
  await h.as(g.owner);
  await h.c.query(`insert into public.expenses (vendor, category, subtotal_cents, tps_cents, tvq_cents, total_cents) values ('NAPA', 'Pièces', 2000, 100, 200, 2300)`);
  const today = await h.val(`select public.local_today()::text`);
  const dsh = await h.val(`select public.dashboard($1::date)`, [today]);
  assert.equal(dsh.revenue_cents, 7999);
  assert.equal(dsh.collected_cents, 9197);
  const rep = await h.val(`select public.treasury_report($1::date, $1::date)`, [today]);
  assert.equal(rep.profit, 7999 - 2000);
  assert.equal(rep.tps_to_remit, 400 - 100);
  assert.equal(rep.tvq_to_remit, 798 - 200);
  await h.as(g.mech);
  assert.equal((await h.fails(() => h.val(`select public.dashboard($1::date)`, [today])))?.hint, 'not_allowed', 'a mechanic does not see the numbers by default');
}));

test('the server’s own building blocks can’t be called from the app (ending someone’s day, reading any job, re-planning)', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.mech);
  for (const [fn, args] of [['close_day', { p_staff: g.owner }], ['job_payload', { p_job: uuid() }], ['block_rows', { p_day: g.day, p_block: 'am' }],
    ['replan_block', { p_day: g.day, p_block: 'am' }], ['use_parts', { p_job: uuid() }], ['housekeeping', {}], ['op_save', { p_op: uuid(), p_name: 'x', p_result: {} }]]) {
    const e = await h.fails(() => h.rpc(fn, args));
    assert.equal(e?.code, '42501', `${fn} is refused`);
  }
  // what the app uses still works
  assert.ok(await h.rpc('my_access', {}));
}));

test('the estimate signed online carries the authorization (nothing to sign at the door); a signature at the door says so', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Vidange d’huile + changement de filtre', service_id: g.svc, unit_cents: 7999, duration_min: 30 }] });
  // the customer's page (the server's own function) writes the online signature
  await h.as(null);
  const att = await h.val(`insert into public.attachments (kind, mime, data, job_id) values ('signature', 'image/png', 'iVBORw0KGgoAAAA', $1) returning id`, [r.job_id]);
  await h.c.query(`update public.jobs set estimate_signed_at = now(), estimate_signer = 'Jean Tremblay', estimate_attachment = $2, estimate_cents = 9197,
    waiver_signed_at = now(), waiver_signer = 'Jean Tremblay', waiver_version = '1', waiver_attachment = $2, waiver_via = 'online' where id = $1`, [r.job_id, att]);
  assert.equal(await h.val(`select waiver_via from public.jobs where id = $1`, [r.job_id]), 'online');
  // a person can't write these columns directly (only the server's operations)
  await h.as(g.owner);
  assert.ok(await h.fails(() => h.c.query(`update public.jobs set estimate_signer = 'x' where id = $1`, [r.job_id])));
  // at the door: the mechanic moves on without the waiver step (already signed online)
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'leave', p_data: {} });
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'arrive', p_data: {} });
  assert.ok(await h.val(`select waiver_signed_at is not null from public.jobs where id = $1`, [r.job_id]));
  // signing again on the phone (the customer prefers): the signature says « at the door »
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'waiver', p_data: { signer: 'Jean Tremblay', version: '1' } });
  assert.equal(await h.val(`select waiver_via from public.jobs where id = $1`, [r.job_id]), 'phone');
}));

test('the texts: the confirmation with the block and the estimate to sign, the new « mechanic arrived » text', () => tx(async (h) => {
  const m = await h.val(`select messages from public.settings where id = 1`);
  assert.match(m.fr.booking, /\{bloc\}/);
  // Part 24 sexies: the services line by line, the total before taxes « + tx », no « pay now »
  assert.match(m.fr.booking, /\{services\}\nTotal : \{soustotal\}\n/);
  assert.match(m.en.booking, /\{services\}\nTotal: \{soustotal\}\n/);
  assert.doesNotMatch(m.fr.booking, /\{payer\}/);
  assert.match(m.fr.arrived, /payer en ligne pendant les travaux/);
  assert.match(m.fr.arrived_no_pay, /\{total\}/);
  assert.equal(m.on.arrived, true);
}));

test('a card payment that arrives after the invoice was finished goes on that invoice (paid, not lost on the side)', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'waiver', p_data: { signer: 'Jean Tremblay', version: '1' } });
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0];
  // the customer opened « Payer » on the draft (paid ahead, on the job)…
  await h.as(null);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: null, p_amount_cents: 2000, p_method: 'card_online', p_reference: 'pi_1', p_job: jobId, p_session: 'cs_1' });
  // …the mechanic finished the invoice meanwhile: the payment ahead counts on it
  await h.as(g.mech);
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv.id });
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [inv.id]);
  assert.equal(await h.val(`select paid_cents from public.invoices where id = $1`, [inv.id]), 2000);
  // …and the card page the customer opened before the invoice was finished pays the rest: on the invoice too
  await h.as(null);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: null, p_amount_cents: total - 2000, p_method: 'card_online', p_reference: 'pi_2', p_job: jobId, p_session: 'cs_2' });
  assert.equal(await h.val(`select status from public.invoices where id = $1`, [inv.id]), 'paid');
  assert.equal(await h.val(`select count(*)::int from public.payments where job_id = $1 and invoice_id is null`, [jobId]), 0);
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: {} });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [jobId]), 'done');
}));

/* Part 20: « Coffre » (family and friends) */
const pgArr = (xs) => `{${xs.join(',')}}`;   // a Postgres list (uuid[]), not JSON
test('« Coffre »: family and friends jobs, no invoice, no taxes, out of the revenue, in their own report (Part 20)', () => tx(async (h) => {
  const g = await garage(h);
  const treasurer = await h.person('Comptable', ['treasurer'], { rights: { treasury: true } });
  const j1 = await jobOnSite(h, g);
  await h.rpc('job_step', { p_op: uuid(), p_job: j1, p_action: 'waiver', p_data: { signer: 'Jean', version: '1' } });
  const draft = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j1, p_refresh: true })).rows.invoices[0];
  // a second job of the same customer, booked, with a finished invoice (nothing paid)
  await h.as(g.owner);
  const j2 = (await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'pm', duration_min: 60 },
    p_items: [{ description: 'Pneus d’hiver', unit_cents: 12000, duration_min: 45 }] })).job_id;
  const i2 = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j2, p_refresh: true })).rows.invoices[0].id;
  const n2 = (await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: i2 })).number;

  // every member of the team (Part 24 bis; Part 22 kept it to the owner and the truck's mechanic): nobody from outside
  await h.as(g.mech);
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([j1])]), true, 'the mechanic may');
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([])]), false, 'no job, nothing to put');
  await h.as(treasurer);
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([j1])]), true, 'the treasurer may too');
  await h.as(uuid());   // a signed-in account that is not on the team (no staff row)
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([j1])]), false, 'an account that is not on the team may not');
  assert.equal((await h.fails(() => h.rpc('coffre_add', { p_op: uuid(), p_jobs: pgArr([j1]), p_amount: 5000, p_note: null, p_day: null })))?.hint, 'not_allowed');

  await h.as(g.owner);
  const r = await h.rpc('coffre_add', { p_op: uuid(), p_jobs: pgArr([j1, j2]), p_amount: 10000, p_note: 'Tante, cadeau', p_day: null });
  assert.equal(r.ok, true);
  // the draft is gone, the finished invoice is cancelled with its number kept
  assert.ok(await h.val(`select deleted_at from public.invoices where id = $1`, [draft.id]));
  const v2 = await h.one(`select status, number, void_reason from public.invoices where id = $1`, [i2]);
  assert.deepEqual({ ...v2, number: Number(v2.number) }, { status: 'void', number: Number(n2), void_reason: 'Coffre (famille et amis)' });
  // no new invoice for a job in the Coffre
  assert.equal((await h.fails(() => h.rpc('invoice_for_job', { p_op: uuid(), p_job: j1, p_refresh: true })))?.hint, 'coffre_job');
  // the job counts as settled: the mechanic finishes it without payment
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: j1, p_action: 'finish', p_data: {} });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [j1]), 'done');
  // twice: refused
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('coffre_add', { p_op: uuid(), p_jobs: pgArr([j1]), p_amount: 0, p_note: null, p_day: null })))?.hint, 'already');

  // nothing in the revenue or the taxes of the treasury
  const from = await h.val(`select (public.local_today() - 40)::text`), to = await h.val(`select (public.local_today() + 40)::text`);
  const tr = await h.rpc('treasury_report', { p_from: from, p_to: to });
  assert.equal(Number(tr.revenue.subtotal), 0, 'not in the revenue');
  assert.equal(Number(tr.revenue.tps) + Number(tr.revenue.tvq), 0, 'no taxes');
  // the report apart: the owner and the accountant; not the mechanic
  const rep = await h.rpc('coffre_report', { p_from: from, p_to: to });
  assert.equal(rep.count, 1);
  assert.equal(rep.amount_cents, 10000);
  assert.equal(rep.value_cents, 7999 + 12000, 'what the work was worth, before taxes');
  assert.deepEqual(rep.rows[0].job_numbers.map(Number).sort(), [await h.val(`select number from public.jobs where id = $1`, [j1]), await h.val(`select number from public.jobs where id = $1`, [j2])].map(Number).sort());
  assert.equal(rep.rows[0].note, 'Tante, cadeau');
  await h.as(treasurer);
  assert.equal((await h.rpc('coffre_report', { p_from: from, p_to: to })).count, 1);
  await h.as(g.mech);
  assert.equal((await h.fails(() => h.rpc('coffre_report', { p_from: from, p_to: to })))?.hint, 'not_allowed');
  // nobody reads the table directly
  assert.ok(await h.fails(() => h.q(`select * from public.coffre`)));

  // a mistake: out of the Coffre, the job can be invoiced again
  await h.as(g.owner);
  await h.rpc('coffre_remove', { p_op: uuid(), p_id: r.id });
  assert.equal(await h.val(`select coffre_id from public.jobs where id = $1`, [j2]), null);
  assert.equal((await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j2, p_refresh: true })).rows.invoices.some((v) => v.status === 'draft'), true);
  assert.equal((await h.rpc('coffre_report', { p_from: from, p_to: to })).count, 0);
}));

test('« Coffre »: a job already paid keeps its invoice (Part 20)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await jobOnSite(h, g);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: 2000, p_method: 'cash', p_reference: null, p_job: null, p_session: null });
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('coffre_add', { p_op: uuid(), p_jobs: pgArr([j]), p_amount: 0, p_note: null, p_day: null })))?.hint, 'has_payment');
}));
