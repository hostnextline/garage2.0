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
  // now the job can finish; the parts leave the inventory once
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: {} });
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [jobId]), 'done');
  await h.as(null); await h.c.query('reset role');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.oil])), 15.5);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.filter])), 4);
  assert.equal(await h.val(`select count(*)::int from public.inventory_moves where job_id = $1`, [jobId]), 2);
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
  assert.match(m.fr.booking, /signer votre estimation\{payer\}/);
  assert.match(m.en.booking, /sign your estimate\{payer\}/);
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

  // the owner, or the mechanic of the job's truck (Part 22); not the treasurer
  await h.as(g.mech);
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([j1])]), true, 'the mechanic of the truck may');
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([])]), false);
  await h.as(treasurer);
  assert.equal(await h.val(`select public.coffre_may_add($1::uuid[])`, [pgArr([j1])]), false);
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
