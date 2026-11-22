// Part 27 — « Refonte », the money rules: invoices, payments, the Coffre, stock purchases.
// Each test runs inside a transaction that is rolled back, except the « two connections » tests: what two real
// connections share must be committed, so they make their own garage and delete it at the end (the database is left
// as it was, the invoice counter included).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());
const DAY = [[480, 1200]];
const here = [45.515, -73.64];
const money = (c) => (c / 100).toFixed(2).replace('.', ',');   // 4197 → « 41,97 » (the server's words)

/** a garage with an owner, a mechanic and his truck, a customer, stock, a service that uses parts */
async function garage(h) {
  const owner = await h.person('Hassan Jeha', ['owner']);
  const mech = await h.person('Saleh Mécano', ['mechanic']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const truck = await h.truck('Camion de Saleh', mech, { [dow]: DAY });
  const customer = await h.customer('Jean', ...here, { last: 'Tremblay', phone: '5145551234' });
  const oil = await h.val(`insert into public.inventory_items (name, qty, unit) values ('Huile 5W-30', 20, 'L') returning id`);
  const filter = await h.val(`insert into public.inventory_items (name, qty) values ('Filtre PH7317', 5) returning id`);
  const svc = await h.val(`insert into public.services (name_fr, price_cents, duration_min) values ('Vidange d’huile + changement de filtre', 7999, 30) returning id`);
  await h.c.query(`insert into public.service_parts (service_id, item_id, qty) values ($1, $2, 4.5), ($1, $3, 1)`, [svc, oil, filter]);
  return { owner, mech, day, truck, customer, oil, filter, svc };
}
/** the statements that follow run as the database itself (to look, or to set a scene) */
async function asDb(h) { await h.as(null); await h.c.query('reset role'); }
/** a job on the mechanic's truck, booked then en route → on site (the normal way) */
async function jobOnSite(h, g) {
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Vidange d’huile + changement de filtre', service_id: g.svc, unit_cents: 7999, duration_min: 30 }] });
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'leave', p_data: {} });
  await h.rpc('job_step', { p_op: uuid(), p_job: r.job_id, p_action: 'arrive', p_data: {} });
  return r.job_id;
}
/** one more job on site on the same truck, set directly (no « Je pars » rule in the way): lines [description, cents, status] */
async function siteJob(h, g, lines = [['Vidange', 7999]]) {
  await asDb(h);
  await h.c.query(`select set_config('garage.rpc', 'on', true)`);
  const id = await h.val(`insert into public.jobs (customer_id, day, block, truck_id, status, duration_min, started_at, arrived_at)
    values ($1, $2, 'am', $3, 'on_site', 60, now(), now()) returning id`, [g.customer, g.day, g.truck]);
  let k = 0;
  for (const [d, c, st] of lines) {
    await h.c.query(`insert into public.job_items (job_id, description, unit_cents, status, kind, sort) values ($1, $2, $3, $4, 'service', $5)`, [id, d, c, st || 'planned', k++]);
  }
  await h.c.query(`select set_config('garage.rpc', '', true)`);
  return id;
}
/** its invoice made and finished by the owner: { inv, total, number } */
async function finished(h, g, job) {
  await h.as(g.owner);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: job, p_refresh: true })).rows.invoices.find((v) => v.status === 'draft').id;
  const f = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  await asDb(h);
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [inv]);
  return { inv, total, number: Number(f.number) };
}
const pay = (h, inv, cents, method = 'cash', more = {}) => h.rpc('payment_add', { p_op: more.op ?? uuid(), p_invoice: inv, p_amount_cents: cents, p_method: method,
  p_reference: more.ref ?? null, p_job: more.job ?? null, p_session: more.session ?? null });
const card = (h, inv, cents, session, job = null) => pay(h, inv, cents, 'card_online', { ref: 'pi_' + session, job, session });
const hint = async (h, fn) => (await h.fails(fn))?.hint;
const inv1 = async (h, id) => { await asDb(h); return h.one(`select status, number, paid_cents, total_cents, deleted_at, void_reason, issued_at from public.invoices where id = $1`, [id]); };

/* ───────────────────────── exactly once ───────────────────────── */

test('every money operation claims its op before any work (op_begin), and saves its answer', () => tx(async (h) => {
  for (const name of ['payment_add', 'payment_remove', 'invoice_finish', 'invoice_reopen', 'invoice_void', 'invoice_for_job', 'coffre_add', 'coffre_remove',
    'inventory_buy', 'inventory_delete', 'extra_answer', 'job_item_price']) {
    const body = await h.val(`select string_agg(pg_get_functiondef(p.oid), '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [name]);
    assert.match(body, new RegExp(`\\nbegin\\s+v_done := public\\.op_begin\\(p_op, '${name}'\\);\\s+if v_done is not null then return v_done; end if;`), `${name}: op_begin is its first statement`);
    assert.doesNotMatch(body, /op_done\(/, `${name}: no more op_done`);
    assert.match(body, new RegExp(`public\\.op_save\\(p_op, '${name}'`), `${name}: its answer is saved`);
    // after the claim, every way out saves its answer or raises (a refusal returned as plain jsonb would make the
    // retry answer « ok »): each « return » is the claim's stored answer or op_save UNDER ITS OWN NAME (an answer saved
    // under another name is never found by the retry, which does the work again), and no handler swallows a refusal
    const way = new RegExp(`\\breturn (v_done;|public\\.op_save\\(p_op, '${name}')`);
    assert.doesNotMatch(`  return public.op_save(p_op, '${name}_x', jsonb_build_object('ok', true));`, way, `${name}: another op's name is caught`);
    assert.doesNotMatch(`  return public.op_save(p_op, 'other', jsonb_build_object('ok', true));`, way, `${name}: another op's name is caught`);
    for (const line of body.split('\n').map((l) => l.replace(/--.*$/, ''))) {
      if (/\breturn\b/.test(line)) assert.match(line, way, `${name}: ${line.trim()}`);
    }
    assert.doesNotMatch(body, /\bexception\s+when\b/i, `${name}: no handler that could swallow a refusal`);
  }
  // the new building blocks are the server's own
  const g = await garage(h);
  await h.as(g.mech);
  for (const [fn, args] of [['job_unbilled', { p_job: uuid() }], ['cents_text', { p_cents: 100 }]]) {
    assert.equal((await h.fails(() => h.rpc(fn, args)))?.code, '42501', `${fn} is refused`);
  }
}));

/** two real connections: a garage committed for them, deleted at the end (counter put back) */
async function shared(fn) {
  const c = await pool.connect();
  const made = { users: [], customers: [], jobs: [], items: [] };
  const opened = [];
  const start = (await c.query(`select clock_timestamp() as t`)).rows[0].t;
  const counter = (await c.query(`select next_value from public.counters where name = 'invoice'`)).rows[0]?.next_value ?? null;
  const s = {
    c,
    async person(name, roles) {
      const id = randomUUID();
      await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [id, `${id.slice(0, 8)}@test.local`]);
      await c.query(`insert into public.staff (id, full_name, short_name, roles, rights, email) values ($1, $2, $3, $4, '{}', $5)`, [id, name, name.split(' ')[0], roles, `${id.slice(0, 8)}@test.local`]);
      made.users.push(id);
      return id;
    },
    async job(status, invoice) {
      const cust = randomUUID();
      await c.query(`insert into public.customers (id, first_name, last_name, phone, lat, lng, address) values ($1, 'Conc', 'Test', '5145550000', $2, $3, '1 rue Test')`, [cust, ...here]);
      made.customers.push(cust);
      const id = (await c.query(`insert into public.jobs (customer_id, day, block, status, duration_min) values ($1, public.local_today() + 30, 'am', $2, 60) returning id`, [cust, status])).rows[0].id;
      made.jobs.push(id);
      await c.query(`insert into public.job_items (job_id, description, unit_cents, status, kind) values ($1, 'Freins', 20000, 'planned', 'service')`, [id]);
      let inv = null;
      if (invoice) {
        inv = (await c.query(`insert into public.invoices (job_id, customer_id, status, lines) values ($1, $2, $3, public.job_lines($1)) returning id`, [id, cust, invoice])).rows[0].id;
      }
      return { id, inv };
    },
    async item(name) {
      const id = (await c.query(`insert into public.inventory_items (name, qty) values ($1, 0) returning id`, [name])).rows[0].id;
      made.items.push(id);
      return id;
    },
    /** a connection in its own transaction, as this person (null = the server) */
    async open(who) {
      const k = await pool.connect();
      opened.push(k);
      await k.query('begin');
      if (who) {
        await k.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: who, role: 'authenticated' }), who]);
        await k.query('set local role authenticated');
      }
      return k;
    },
    async pid(k) { return (await k.query('select pg_backend_pid() as p')).rows[0].p; },
    /** what a connection waits for now ('Lock' while it waits on another one's row) */
    async waits(pid) { return (await c.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid])).rows[0]?.wait_event_type ?? null; },
    async val(sql, params = []) { const r = (await c.query(sql, params)).rows[0]; return r ? Object.values(r)[0] : undefined; }
  };
  try {
    await c.query(`select set_config('garage.rpc', 'on', false)`);
    return await fn(s);
  } finally {
    for (const k of opened) { await k.query('rollback').catch(() => {}); k.release(); }
    await c.query(`select set_config('garage.rpc', '', false)`);
    await c.query(`delete from public.payments where job_id = any($1) or invoice_id in (select id from public.invoices where job_id = any($1))`, [made.jobs]);
    await c.query(`delete from public.invoices where job_id = any($1)`, [made.jobs]);
    await c.query(`delete from public.job_items where job_id = any($1)`, [made.jobs]);
    await c.query(`delete from public.jobs where id = any($1)`, [made.jobs]);
    await c.query(`delete from public.customers where id = any($1)`, [made.customers]);
    await c.query(`delete from public.expenses where created_by = any($1)`, [made.users]);
    await c.query(`delete from public.inventory_items where id = any($1)`, [made.items]);
    await c.query(`delete from public.op_log where at >= $1`, [start]);
    await c.query(`delete from public.activity where at >= $1`, [start]);
    await c.query(`delete from auth.users where id = any($1)`, [made.users]);
    if (counter !== null) await c.query(`update public.counters set next_value = $1 where name = 'invoice'`, [counter]);
    c.release();
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** does the promise end within ms? ('done' | 'failed' | 'waiting') */
const within = (p, ms) => Promise.race([p.then(() => 'done', () => 'failed'), sleep(ms).then(() => 'waiting')]);

test('two connections: the same payment arriving twice at the same instant is written once (sql-money-02, x-sync-01, core-data-06)', () => shared(async (s) => {
  const owner = await s.person('Hassan Conc', ['owner']);
  const { inv } = await s.job('on_site', 'issued');   // 200,00 $ + taxes
  const op = randomUUID();
  const sql = `select public.payment_add(p_op => $1, p_invoice => $2, p_amount_cents => 5000, p_method => 'cash') as r`;
  // two tabs of the office computer send the waiting « Encaisser » together: the same op
  const k1 = await s.open(owner), k2 = await s.open(owner);
  const pid2 = await s.pid(k2);
  const r1 = (await k1.query(sql, [op, inv])).rows[0].r;
  const p2 = k2.query(sql, [op, inv]);
  assert.equal(await within(p2, 400), 'waiting', 'the second one waits for the first');
  assert.equal(await s.waits(pid2), 'Lock', 'on the first one’s claim');
  await k1.query('commit');
  const r2 = (await p2).rows[0].r;
  await k2.query('commit');
  assert.deepEqual(r2, r1, 'the second one gets the answer of the first');
  assert.equal(await s.val(`select count(*)::int from public.payments where invoice_id = $1 and deleted_at is null`, [inv]), 1, 'one payment');
  assert.equal(await s.val(`select paid_cents from public.invoices where id = $1`, [inv]), 5000);
}));

test('two connections: the same stock purchase arriving twice at the same instant is written once (sql-money-02)', () => shared(async (s) => {
  const owner = await s.person('Hassan Conc', ['owner']);
  const item = await s.item('Filtre conc');
  const op = randomUUID();
  const sql = `select public.inventory_buy(p_op => $1, p_item => $2, p_qty => 2, p_total_cents => 2300, p_from => 'treasury') as r`;
  const k1 = await s.open(owner), k2 = await s.open(owner);
  const r1 = (await k1.query(sql, [op, item])).rows[0].r;
  const p2 = k2.query(sql, [op, item]);
  assert.equal(await within(p2, 400), 'waiting', 'the second one waits for the first');
  await k1.query('commit');
  const r2 = (await p2).rows[0].r;
  await k2.query('commit');
  assert.deepEqual([r2.move_id, r2.expense_id], [r1.move_id, r1.expense_id], 'the same answer');
  assert.equal(Number(await s.val(`select qty from public.inventory_items where id = $1`, [item])), 2, 'two filters, not four');
  assert.equal(await s.val(`select count(*)::int from public.inventory_moves where item_id = $1`, [item]), 1, 'one move');
  assert.equal(await s.val(`select count(*)::int from public.expenses where created_by = $1`, [owner]), 1, 'one expense');
}));

test('two connections: two people record the whole balance at the same instant (two op ids): one payment, the other is told nothing is left (x-money-01, invoices-quotes-01, argent-04)', () => shared(async (s) => {
  const owner = await s.person('Hassan Conc', ['owner']);
  const office = await s.person('Bureau Conc', ['owner']);
  const { id: job, inv } = await s.job('on_site', 'issued');
  const total = await s.val(`select total_cents from public.invoices where id = $1`, [inv]);
  // the mechanic's waiting « Encaisser » and the office's, each with its own op id, reach the server together
  const sql = `select public.payment_add(p_op => $1, p_invoice => $2, p_amount_cents => $3, p_method => 'cash', p_job => $4) as r`;
  const k1 = await s.open(owner), k2 = await s.open(office);
  const pid2 = await s.pid(k2);
  await k1.query(sql, [randomUUID(), inv, total, job]);
  const p2 = k2.query(sql, [randomUUID(), inv, total, job]);
  assert.equal(await within(p2, 400), 'waiting', 'the second one waits for the first');
  assert.equal(await s.waits(pid2), 'Lock', 'on the job, locked first by every money operation');
  await k1.query('commit');
  const e = await p2.then(() => null, (x) => x);
  await k2.query('rollback');
  assert.equal(e?.hint, 'too_much', 'the second one sees the first payment');
  assert.equal(await s.val(`select count(*)::int from public.payments where invoice_id = $1 and deleted_at is null`, [inv]), 1, 'one payment');
  assert.deepEqual(Object.values((await s.c.query(`select status, paid_cents from public.invoices where id = $1`, [inv])).rows[0]), ['paid', total]);
}));

test('two connections: a card payment ahead that lands while the invoice is being finished goes on it (sql-money-17)', () => shared(async (s) => {
  const owner = await s.person('Hassan Conc', ['owner']);
  const { id: job, inv } = await s.job('on_site', 'draft');
  const session = 'cs_conc_' + randomUUID();
  const k1 = await s.open(owner), k2 = await s.open(null);
  await k1.query(`select public.invoice_finish(p_op => $1, p_invoice => $2)`, [randomUUID(), inv]);
  // the customer's card payment (the server, by the job: the page was opened on the draft) arrives now
  const p2 = k2.query(`select public.payment_add(p_op => $1, p_invoice => null, p_amount_cents => 5000, p_method => 'card_online', p_reference => 'pi_conc', p_job => $2, p_session => $3) as r`, [randomUUID(), job, session]);
  assert.equal(await within(p2, 400), 'waiting', 'it waits for the finish (the job is locked first, by both)');
  await k1.query('commit');
  await p2;
  await k2.query('commit');
  assert.equal(await s.val(`select invoice_id from public.payments where stripe_session = $1`, [session]), inv, 'on the finished invoice, not beside it');
  assert.equal(await s.val(`select paid_cents from public.invoices where id = $1`, [inv]), 5000);
}));

test('two connections: a payment removed while another is added: the invoice counts both, never a stale sum (sql-money-25)', () => shared(async (s) => {
  const owner = await s.person('Hassan Conc', ['owner']);
  const { id: job, inv } = await s.job('on_site', 'issued');
  const p3000 = (await s.c.query(`insert into public.payments (invoice_id, job_id, amount_cents, method) values ($1, $2, 3000, 'cash') returning id`, [inv, job])).rows[0].id;
  await s.c.query(`update public.invoices set paid_cents = 3000 where id = $1`, [inv]);
  const k1 = await s.open(owner), k2 = await s.open(owner);
  await k1.query(`select public.payment_add(p_op => $1, p_invoice => $2, p_amount_cents => 5000, p_method => 'debit')`, [randomUUID(), inv]);
  const p2 = k2.query(`select public.payment_remove(p_op => $1, p_payment => $2)`, [randomUUID(), p3000]);
  assert.equal(await within(p2, 400), 'waiting');
  await k1.query('commit');
  await p2;
  await k2.query('commit');
  assert.equal(await s.val(`select paid_cents from public.invoices where id = $1`, [inv]), 5000, 'the 30 $ removed, the 50 $ added');
}));

test('two connections: two requests making the same draft make one, without a raw error (sql-money-34)', () => shared(async (s) => {
  const owner = await s.person('Hassan Conc', ['owner']);
  const { id: job } = await s.job('on_site', null);
  const sql = `select public.invoice_for_job(p_op => $1, p_job => $2, p_refresh => true) as r`;
  const k1 = await s.open(owner), k2 = await s.open(owner);
  await k1.query(sql, [randomUUID(), job]);
  const p2 = k2.query(sql, [randomUUID(), job]);
  assert.equal(await within(p2, 400), 'waiting');
  await k1.query('commit');
  const r2 = (await p2).rows[0].r;
  await k2.query('commit');
  assert.equal(r2.ok, true, 'the second one finds the draft');
  assert.equal(await s.val(`select count(*)::int from public.invoices where job_id = $1 and deleted_at is null`, [job]), 1);
}));

/* ───────────────────────── card payments are never refused ───────────────────────── */

test('a card payment Stripe confirmed is never lost: invoice cancelled, deleted, gone or sent to the Coffre while the card page was open (sql-money-01, edge-functions-01, x-money-02)', () => tx(async (h) => {
  const g = await garage(h);
  // 1. cancelled while the customer's card page was open
  const j1 = await siteJob(h, g);
  const f1 = await finished(h, g, j1);
  await h.c.query(`insert into public.public_links (token_hash, job_id, expires_at, last_session, last_session_url, last_session_amount, last_session_expires)
    values ('h-' || gen_random_uuid(), $1, now() + interval '30 days', 'cs_open', 'https://stripe.test/cs_open', $2, now() + interval '1 hour')`, [j1, f1.total]);
  await h.as(g.owner);
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: f1.inv, p_reason: 'Erreur de prix' });
  await asDb(h);
  assert.equal(await h.val(`select last_session from public.public_links where job_id = $1`, [j1]), null, 'the open card page is not offered again');
  // the customer pays on the page still open; the server brings it as today (the invoice, no job)
  const a = await card(h, f1.inv, f1.total, 'cs_void');
  assert.deepEqual([a.ok, a.unmatched], [true, 'void']);
  const p = await h.one(`select invoice_id, job_id, amount_cents from public.payments where stripe_session = 'cs_void'`);
  assert.deepEqual([p.invoice_id, p.job_id, p.amount_cents], [null, j1, f1.total], 'it waits on the job');
  const note = await h.one(`select entity, entity_id, data from public.activity where action = 'payment_unmatched' and data->>'session' = 'cs_void'`);
  assert.deepEqual([note.entity, note.entity_id, note.data.why, note.data.invoice, note.data.amount], ['job', j1, 'void', f1.inv, f1.total], 'the owner sees it in the job’s history');
  // Stripe sends it again (or the customer's page checks it): once, and no error
  assert.equal((await card(h, f1.inv, f1.total, 'cs_void')).already, true);
  assert.equal(await h.val(`select count(*)::int from public.payments where stripe_session = 'cs_void'`), 1);
  // a person still gets « annulée » on the cancelled invoice
  await h.as(g.owner);
  assert.equal(await hint(h, () => pay(h, f1.inv, 100)), 'void');
  // the job's new invoice, finished: the money waiting comes on it
  const f1b = await finished(h, g, j1);
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f1b.inv])), ['paid', f1.total]);
  // 2. the job's new invoice already finished when an older page is paid: it lands there, said
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  await h.as(g.owner);
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: f2.inv, p_reason: 'Refaite' });
  const f2b = await finished(h, g, j2);
  const b = await card(h, f2.inv, 3000, 'cs_old');
  assert.equal(b.unmatched, 'void');
  assert.equal(await h.val(`select invoice_id from public.payments where stripe_session = 'cs_old'`), f2b.inv);
  assert.equal(await h.val(`select data->>'now_on' from public.activity where action = 'payment_unmatched' and data->>'session' = 'cs_old'`), f2b.inv);
  // 3. a draft that was deleted, an invoice that is not there at all, nothing known: kept all the same
  const j3 = await siteJob(h, g);
  await h.as(g.owner);
  const d3 = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j3, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: d3, p_reason: 'Brouillon' });
  await asDb(h);
  assert.equal((await card(h, d3, 1000, 'cs_del')).unmatched, 'deleted');
  assert.equal(await h.val(`select job_id from public.payments where stripe_session = 'cs_del'`), j3);
  assert.equal((await card(h, uuid(), 1000, 'cs_missing', j3)).unmatched, 'missing');
  assert.equal(await h.val(`select job_id from public.payments where stripe_session = 'cs_missing'`), j3);
  assert.equal((await card(h, null, 1000, 'cs_nothing', null)).unmatched, 'no_job');
  assert.equal(await h.val(`select count(*)::int from public.payments where stripe_session = 'cs_nothing'`), 1, 'the money is written even with nothing to hold it');
  // 4. the job sent to the Coffre while the page was open
  const j4 = await siteJob(h, g);
  const f4 = await finished(h, g, j4);
  await h.as(g.owner);
  await h.rpc('coffre_add', { p_op: uuid(), p_jobs: `{${j4}}`, p_amount: 0, p_note: null, p_day: null });
  await asDb(h);
  assert.equal((await card(h, f4.inv, f4.total, 'cs_coffre')).unmatched, 'coffre');
  assert.equal(await h.val(`select job_id from public.payments where stripe_session = 'cs_coffre'`), j4);
}));

/* ───────────────────────── never more than what is due ───────────────────────── */

test('a person never records more than what is left to pay: the same payment tapped twice is refused, not counted twice (invoices-quotes-01, jobs-a-02, x-money-01)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  const f = await finished(h, g, j);
  await h.as(g.mech);
  const first = uuid();
  await pay(h, f.inv, f.total, 'cash', { op: first });
  // the second tap (the first was waiting on the phone): another op id
  const e = await h.fails(() => pay(h, f.inv, f.total));
  assert.equal(e?.hint, 'too_much'); assert.match(e.message, /déjà payée au complet/);
  // the first one sent again (a retry): its answer, no error
  assert.equal((await pay(h, f.inv, f.total, 'cash', { op: first })).ok, true);
  await asDb(h);
  assert.deepEqual([await h.val(`select count(*)::int from public.payments where invoice_id = $1`, [f.inv]), await h.val(`select paid_cents from public.invoices where id = $1`, [f.inv])], [1, f.total]);
  // partly paid: what is left is said, and exactly that passes
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  await h.as(g.mech);
  await pay(h, f2.inv, 5000);
  const e2 = await h.fails(() => pay(h, f2.inv, f2.total));
  assert.equal(e2?.hint, 'too_much'); assert.match(e2.message, new RegExp(`${money(f2.total - 5000)} \\$`));
  await pay(h, f2.inv, f2.total - 5000);
  // a card payment the customer made on top (the server): never refused, but said
  await h.as(null);
  const c = await card(h, f2.inv, 2000, 'cs_over');
  assert.equal(c.over_cents, 2000);
  assert.equal(await h.val(`select (data->>'over')::int from public.activity where action = 'overpaid' and data->>'invoice' = $1`, [f2.inv]), 2000);
  // what only the server writes, and what only the office does
  await h.as(g.mech);
  assert.equal(await hint(h, () => pay(h, f2.inv, 100, 'card_online')), 'method', 'not « carte en ligne » by hand');
  assert.equal(await hint(h, () => pay(h, f2.inv, -100)), 'not_allowed', 'money given back: the office');
}));

test('a cash payment queued before « Modifier la facture » waits on the job and comes back on the invoice; a second tap is still refused (invoices-quotes-10)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  const f = await finished(h, g, j);
  // the mechanic records the cash without signal (queued); before it leaves the phone, the office reopens the invoice
  const queued = uuid();
  await h.as(g.owner);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f.inv });
  // the phone syncs: the cash is written, waiting on the job (before: « invoice_first », the cash in no book)
  await h.as(g.mech);
  const r = await pay(h, f.inv, 5000, 'cash', { op: queued });
  assert.equal(r.ok, true);
  await asDb(h);
  const p = await h.one(`select invoice_id, job_id, amount_cents, method from public.payments where job_id = $1 and deleted_at is null`, [j]);
  assert.deepEqual([p.invoice_id, p.job_id, p.amount_cents, p.method], [null, j, 5000, 'cash']);
  // the same op sent again (a retry): its answer, still one payment
  await h.as(g.mech);
  assert.equal((await pay(h, f.inv, 5000, 'cash', { op: queued })).ok, true);
  // never more than the draft's total less what already waits: the whole total again is refused, the rest passes
  const e = await h.fails(() => pay(h, f.inv, f.total));
  assert.equal(e?.hint, 'too_much'); assert.match(e.message, new RegExp(`${money(f.total - 5000)} \\$`));
  await pay(h, f.inv, f.total - 5000, 'debit');
  assert.equal(await hint(h, () => pay(h, f.inv, 100)), 'too_much', 'all of it waits: nothing more');
  await asDb(h);
  assert.equal(await h.val(`select count(*)::int from public.payments where job_id = $1 and invoice_id is null and deleted_at is null`, [j]), 2);
  assert.equal((await inv1(h, f.inv)).status, 'draft');
  // finished again: the same number, the money back on it, paid
  await h.as(g.owner);
  const again = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: f.inv });
  assert.deepEqual([Number(again.number), again.again], [f.number, true]);
  const v = await inv1(h, f.inv);
  assert.deepEqual([v.status, v.paid_cents], ['paid', f.total]);
  await asDb(h);
  assert.equal(await h.val(`select count(*)::int from public.payments where invoice_id = $1 and deleted_at is null`, [f.inv]), 2);
  // a draft that never had a number: still « finish it first »
  const j2 = await siteJob(h, g);
  await h.as(g.owner);
  const d2 = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j2, p_refresh: true })).rows.invoices.find((x) => x.status === 'draft').id;
  await h.as(g.mech);
  assert.equal(await hint(h, () => pay(h, d2, 1000)), 'invoice_first');
}));

/* ───────────────────────── money given back ───────────────────────── */

test('a card refund reaches the books where its payment is and the invoice follows; money given back by hand too, never more than was paid (sql-money-03, x-money-04)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  const f = await finished(h, g, j);
  await h.as(null);
  await card(h, f.inv, f.total, 'cs_A', j);
  const orig = await h.val(`select id from public.payments where stripe_session = 'cs_A'`);
  // the contract with the Stripe function: an op from the refund id, the invoice of the payment, minus the cents,
  // the refund id, the job, « <checkout session>#<refund id> »
  const r1 = await h.rpc('payment_add', { p_op: uuid(), p_invoice: f.inv, p_amount_cents: -3000, p_method: 'card_online', p_reference: 're_1', p_job: j, p_session: 'cs_A#re_1' });
  assert.equal(r1.ok, true);
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f.inv])), ['issued', f.total - 3000], 'no longer fully paid: no longer « payée »');
  assert.equal(await h.val(`select data->>'of' from public.activity where action = 'payment_refund' and data->>'session' = 'cs_A#re_1'`), orig);
  // the same refund again: once
  assert.equal((await h.rpc('payment_add', { p_op: uuid(), p_invoice: f.inv, p_amount_cents: -3000, p_method: 'card_online', p_reference: 're_1', p_job: j, p_session: 'cs_A#re_1' })).already, true);
  // the rest given back: nothing paid any more, and the invoice can be cancelled (what was paid adds up to zero)
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: f.inv, p_amount_cents: -(f.total - 3000), p_method: 'card_online', p_reference: 're_2', p_job: j, p_session: 'cs_A#re_2' });
  assert.equal(await h.val(`select paid_cents from public.invoices where id = $1`, [f.inv]), 0);
  await h.as(g.owner);
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: f.inv, p_reason: 'Client remboursé' });
  const v = await inv1(h, f.inv);
  assert.equal(v.status, 'void');
  assert.equal(await h.val(`select count(*)::int from public.payments where invoice_id = $1`, [f.inv]), 0, 'a cancelled invoice holds no payment');
  assert.equal(await h.val(`select coalesce(sum(amount_cents), 0)::int from public.payments where job_id = $1`, [j]), 0, 'the three wait on the job and add up to zero');
  // a card refund while « Modifier la facture » is open: it waits on the job with its payment, and comes back with it
  const j3 = await siteJob(h, g);
  const f3 = await finished(h, g, j3);
  await h.as(null);
  await card(h, f3.inv, f3.total, 'cs_B', j3);
  await h.as(g.owner);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f3.inv });
  await h.as(null);
  await h.rpc('payment_add', { p_op: uuid(), p_invoice: f3.inv, p_amount_cents: -2000, p_method: 'card_online', p_reference: 're_3', p_job: j3, p_session: 'cs_B#re_3' });
  assert.deepEqual(Object.values(await h.one(`select invoice_id, job_id from public.payments where stripe_session = 'cs_B#re_3'`)), [null, j3]);
  await h.as(g.owner);
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: f3.inv });
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f3.inv])), ['issued', f3.total - 2000]);
  // a person never writes a card refund
  assert.equal(await hint(h, () => pay(h, f3.inv, -100, 'card_online')), 'method');
  // money given back by hand (the office): the invoice follows; never more than was paid; a payment and its money back leave together
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  await h.as(g.owner);
  await pay(h, f2.inv, f2.total);
  await pay(h, f2.inv, -1000);
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f2.inv])), ['issued', f2.total - 1000]);
  const e = await h.fails(() => pay(h, f2.inv, -f2.total));
  assert.equal(e?.hint, 'refund_too_much'); assert.match(e.message, new RegExp(`${money(f2.total - 1000)} \\$`));
  const cash = await h.val(`select id from public.payments where invoice_id = $1 and amount_cents > 0`, [f2.inv]);
  assert.equal(await hint(h, () => h.rpc('payment_remove', { p_op: uuid(), p_payment: cash })), 'refund_first');
  const back = await h.val(`select id from public.payments where invoice_id = $1 and amount_cents < 0`, [f2.inv]);
  await h.rpc('payment_remove', { p_op: uuid(), p_payment: back });
  await h.rpc('payment_remove', { p_op: uuid(), p_payment: cash });
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f2.inv])), ['issued', 0]);
}));

test('a refund that failed, taken back (« #echec »), goes where its refund is: the money of one card payment is never split (integration, x-branches-02)', () => tx(async (h) => {
  const g = await garage(h);
  const refund = (inv, cents, session, job) => h.rpc('payment_add', { p_op: uuid(), p_invoice: inv, p_amount_cents: cents, p_method: 'card_online',
    p_reference: session.split('#')[1], p_job: job, p_session: session });
  // 1. the usual case: the payment on its finished invoice; the refund, then its failure, on that invoice; the invoice follows
  const j1 = await siteJob(h, g);
  const f1 = await finished(h, g, j1);
  await h.as(null);
  await card(h, f1.inv, f1.total, 'cs_E1', j1);
  await refund(f1.inv, -3000, 'cs_E1#re_e1', j1);
  assert.equal((await inv1(h, f1.inv)).status, 'issued');
  await h.as(null);
  await refund(f1.inv, 3000, 'cs_E1#re_e1#echec', j1);
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f1.inv])), ['paid', f1.total], 'paid again');
  // 2. a payment left waiting on the job while the job has a finished invoice (an older version did that; the nightly
  // reconciliation lists it, M4.waiting): its refund waits with it, and so does the failure of that refund — before,
  // the failure went on the invoice, which had never received that money
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  await h.c.query(`select set_config('garage.rpc', 'on', true)`);
  await h.c.query(`insert into public.payments (invoice_id, job_id, amount_cents, method, reference, stripe_session) values (null, $1, 5000, 'card_online', 'pi_w', 'cs_W')`, [j2]);
  await h.c.query(`select set_config('garage.rpc', '', true)`);
  await h.as(null);
  await refund(null, -2000, 'cs_W#re_w', j2);
  await h.as(null);
  await refund(null, 2000, 'cs_W#re_w#echec', j2);
  await asDb(h);
  const rows = (await h.c.query(`select stripe_session, invoice_id, job_id, amount_cents from public.payments where stripe_session like 'cs_W%' order by created_at, stripe_session`)).rows;
  assert.deepEqual(rows.map((r) => [r.stripe_session, r.invoice_id, r.job_id]), [['cs_W', null, j2], ['cs_W#re_w', null, j2], ['cs_W#re_w#echec', null, j2]], 'the three stay together, on the job');
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [f2.inv])), ['issued', 0], 'the invoice never got that money');
  // 3. a failure whose refund is not in the books (written by hand, or lost): it goes where the payment is
  await h.as(null);
  await refund(f1.inv, 1000, 'cs_E1#re_lost#echec', j1);
  assert.equal(await h.val(`select invoice_id from public.payments where stripe_session = 'cs_E1#re_lost#echec'`), f1.inv);
}));

test('paid ahead more than the final invoice: finished « payée » and the excess said; given back, the books balance (sql-money-05, x-branches-01)', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  const brakes = await h.val(`insert into public.job_items (job_id, description, unit_cents, status, kind, sort) values ($1, 'Plaquettes avant', 15000, 'planned', 'service', 9) returning id`, [jobId]);
  const draft = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0];
  // the customer pays the draft's total ahead by card (« Payer » of the arrival text)
  await h.as(null);
  await card(h, null, draft.total_cents, 'cs_pre', jobId);
  // then the brakes are not done
  await h.as(g.mech);
  await h.c.query(`update public.job_items set status = 'removed' where id = $1`, [brakes]);
  const f = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: draft.id });
  const v = await inv1(h, draft.id);
  assert.equal(v.status, 'paid');
  assert.equal(f.over_cents, draft.total_cents - v.total_cents, 'what must go back to the customer is in the answer');
  assert.equal(await h.val(`select (data->>'over')::int from public.activity where action = 'overpaid' and data->>'invoice' = $1`, [draft.id]), f.over_cents);
  // the office gives it back by hand: still paid, nothing too much
  await h.as(g.owner);
  await pay(h, draft.id, -f.over_cents, 'interac');
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents from public.invoices where id = $1`, [draft.id])), ['paid', v.total_cents]);
  assert.equal(await hint(h, () => pay(h, draft.id, -(v.total_cents + 1))), 'refund_too_much');
}));

/** a job on site whose invoice (oil change + brakes) the customer paid in full in cash, then reopened by the mechanic
 *  (« Modifier la facture ») and the brakes taken off (« Pas fait »): { job, inv, brakes, paid, number, issued } */
async function paidThenLineOff(h, g, job) {
  const brakes = await h.val(`insert into public.job_items (job_id, description, unit_cents, status, kind, sort) values ($1, 'Plaquettes avant', 15000, 'planned', 'service', 9) returning id`, [job]);
  await h.as(g.mech);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: job, p_refresh: true })).rows.invoices.find((v) => v.status === 'draft').id;
  const number = Number((await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv })).number);
  const first = await inv1(h, inv);
  await h.as(g.mech);
  await pay(h, inv, first.total_cents);
  assert.equal((await inv1(h, inv)).status, 'paid');
  await h.as(g.mech);
  assert.equal((await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv })).ok, true);
  await h.c.query(`update public.job_items set status = 'removed' where id = $1`, [brakes]);
  return { job, inv, brakes, paid: first.total_cents, number, issued: first.issued_at };
}

test('a paid invoice reopened on site, a line taken off, finished again: « payée », what goes back is said, same number and date; the job finishes, the next « Je pars » goes, the office gives the difference back (owner’s decision 2026-11-20, S123, O-28)', () => tx(async (h) => {
  const g = await garage(h);
  const job = await jobOnSite(h, g);
  await h.as(g.owner);
  const next = (await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'pm', duration_min: 60 },
    p_items: [{ description: 'Pneus d’hiver', unit_cents: 8000, duration_min: 45 }] })).job_id;
  const s = await paidThenLineOff(h, g, job);
  // « Terminer la facture » again, by the mechanic: no longer refused « below_paid »
  await h.as(g.mech);
  const op = uuid();
  const f = await h.rpc('invoice_finish', { p_op: op, p_invoice: s.inv });
  const v = await inv1(h, s.inv);
  assert.deepEqual((await h.val(`select lines from public.invoices where id = $1`, [s.inv])).map((l) => l.description), ['Vidange d’huile + changement de filtre'], 'the brakes are off the invoice');
  assert.ok(v.total_cents < s.paid);
  assert.deepEqual([f.ok, Number(f.number), f.again, f.over_cents], [true, s.number, true, s.paid - v.total_cents], 'its number, « again », and what goes back');
  assert.deepEqual([v.status, Number(v.number), v.paid_cents], ['paid', s.number, s.paid], 'paid, with all the money on it');
  assert.equal(v.issued_at.getTime(), s.issued.getTime(), 'the day it was first issued');
  assert.equal(await h.val(`select count(*)::int from public.payments where job_id = $1 and invoice_id is null and deleted_at is null`, [job]), 0, 'nothing left waiting on the job');
  const said = async () => { await asDb(h); return h.q(`select actor, entity, entity_id, data from public.activity where action = 'overpaid' and data->>'invoice' = $1`, [s.inv]); };
  const notes = await said();
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].actor, notes[0].entity, notes[0].entity_id], [g.mech, 'job', job]);
  assert.deepEqual(notes[0].data, { invoice: s.inv, number: s.number, total: v.total_cents, paid: s.paid, over: s.paid - v.total_cents });
  // the same finish sent again (a phone's retry): the same answer, nothing written twice
  await h.as(g.mech);
  assert.deepEqual(await h.rpc('invoice_finish', { p_op: op, p_invoice: s.inv }), f);
  assert.equal((await said()).length, 1);
  // the mechanic does not give money back himself (the office does, O-29): refused, the invoice as it was
  await h.as(g.mech);
  assert.equal(await hint(h, () => pay(h, s.inv, -f.over_cents)), 'not_allowed');
  // nothing blocks him: the next « Je pars » (this job reads « payée »), then « Terminé » (no work left off the invoice)
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: next, p_action: 'leave', p_data: {} });
  await h.rpc('job_step', { p_op: uuid(), p_job: job, p_action: 'finish', p_data: {} });
  await asDb(h);
  assert.deepEqual((await h.q(`select id, status from public.jobs where id in ($1, $2)`, [job, next])).map((r) => [r.id, r.status]).sort(),
    [[job, 'done'], [next, 'en_route']].sort());
  // the office gives the difference back: the books balance, the invoice stays paid; never more than what was paid
  await h.as(g.owner);
  const back = await pay(h, s.inv, -f.over_cents, 'interac');
  assert.equal(back.over_cents, undefined);
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents, total_cents from public.invoices where id = $1`, [s.inv])), ['paid', v.total_cents, v.total_cents]);
  await h.as(g.owner);
  const refused = await h.fails(() => pay(h, s.inv, -(v.total_cents + 1)));
  assert.equal(refused?.hint, 'refund_too_much'); assert.match(refused.message, new RegExp(`${money(v.total_cents)} \\$`));
}));

test('an invoice paid MORE than its total opens again too: the money waits on the job, nothing more is taken, finished again it follows the work (owner’s decision 2026-11-20)', () => tx(async (h) => {
  const g = await garage(h);
  const job = await siteJob(h, g, [['Vidange', 7999]]);
  const s = await paidThenLineOff(h, g, job);
  await h.as(g.mech);
  const over = (await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: s.inv })).over_cents;
  assert.ok(over > 0);
  // « Modifier la facture » again on the overpaid invoice: allowed, what was paid (more than the total) waits on the job
  await h.as(g.mech);
  const r = await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: s.inv });
  assert.deepEqual([r.ok, Number(r.number)], [true, s.number]);
  await asDb(h);
  assert.equal(await h.val(`select coalesce(sum(amount_cents), 0)::int from public.payments where job_id = $1 and invoice_id is null and deleted_at is null`, [job]), s.paid);
  // a cash payment on it now (a tap, or sent from the phone's queue): nothing is left to take, it is said — not a second
  // payment the customer would need back
  await h.as(g.mech);
  const e = await h.fails(() => pay(h, s.inv, 1000));
  assert.equal(e?.hint, 'too_much'); assert.match(e.message, /déjà payée au complet/);
  // the brakes done after all: back on the draft; finished, paid exactly, nothing to give back
  await h.as(g.mech);
  await h.c.query(`update public.job_items set status = 'planned' where id = $1`, [s.brakes]);
  const f = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: s.inv });
  assert.deepEqual([Number(f.number), f.again, f.over_cents], [s.number, true, 0]);
  assert.deepEqual(Object.values(await h.one(`select status, paid_cents, total_cents from public.invoices where id = $1`, [s.inv])), ['paid', s.paid, s.paid]);
  await h.as(g.mech);
  await h.rpc('job_step', { p_op: uuid(), p_job: job, p_action: 'finish', p_data: {} });
  await asDb(h);
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [job]), 'done');
}));

test('the nightly reconciliation treats a reopened invoice finished under what was paid as a first finish paid ahead: one « À regarder » each (M2.over), never « Important », the same one night after night, gone once given back (owner’s decision 2026-11-20)', () => tx(async (h) => {
  const g = await garage(h);
  // a first finish under what was paid ahead (by card), and a reopened one under what was paid (cash): both finished
  const ahead = await siteJob(h, g, [['Vidange', 7999], ['Plaquettes avant', 15000]]);
  await h.as(g.mech);
  const draft = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: ahead, p_refresh: true })).rows.invoices[0];
  await h.as(null);
  await card(h, null, draft.total_cents, 'cs_ahead', ahead);
  await asDb(h);
  await h.c.query(`update public.job_items set status = 'removed' where job_id = $1 and description = 'Plaquettes avant'`, [ahead]);
  await h.as(g.mech);
  const f1 = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: draft.id });
  const reopened = await siteJob(h, g, [['Vidange', 7999]]);
  const s = await paidThenLineOff(h, g, reopened);
  await h.as(g.mech);
  const f2 = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: s.inv });
  const over = f1.over_cents;
  assert.ok(over > 0);
  assert.equal(f2.over_cents, over, 'the same money to give back on both');
  for (const j of [ahead, reopened]) { await h.as(g.mech); await h.rpc('job_step', { p_op: uuid(), p_job: j, p_action: 'finish', p_data: {} }); }
  // what a night's checks find about each one (its invoice, its job, its payments, its number)
  await asDb(h);
  const about = async (inv, job) => {
    await asDb(h);
    const mine = new Set([inv, job, ...(await h.q(`select id from public.payments where invoice_id = $1 or job_id = $2`, [inv, job])).map((p) => p.id)]);
    const no = String(await h.val(`select number from public.invoices where id = $1`, [inv]));
    const all = (await h.val(`select public.recon_collect(public.local_today())`)).findings;
    return all.filter((x) => mine.has(x.e) || mine.has(x.d?.invoice_id) || mine.has(x.d?.job_id) || String(x.d?.number) === no)
      .map((x) => `${x.c} ${x.s}`).sort();
  };
  assert.deepEqual(await about(draft.id, ahead), ['M2.over warn'], 'a first finish paid ahead');
  assert.deepEqual(await about(s.inv, reopened), ['M2.over warn'], 'a reopened one: the same');
  // two nights in a row (a garage already reconciled before: these are new, not « déjà là »): one difference per
  // invoice, the same row, never « Important » (bad)
  await asDb(h);
  await h.c.query(`insert into public.ops_recon_baseline (check_id, entity_id, value, set_on)
    values ('first', '00000000-0000-0000-0000-000000000000', 0, public.local_today() - 30) on conflict do nothing`);
  const rows = async () => { await asDb(h); return h.q(`select entity_id, check_id, severity, state, first_day::text from public.ops_recon_findings where entity_id in ($1, $2) order by check_id, entity_id`, [draft.id, s.inv]); };
  await h.val(`select public.recon_run(public.local_today() - 1, 'test')`);
  const night1 = await rows();
  await h.val(`select public.recon_run(public.local_today(), 'test')`);
  assert.deepEqual(await rows(), night1, 'the second night finds the same, nothing new');
  assert.deepEqual(night1.map((r) => [r.entity_id, r.check_id, r.severity]).sort(), [[draft.id, 'M2.over', 'warn'], [s.inv, 'M2.over', 'warn']].sort());
  // the office gives the difference back on both: nothing more to say
  for (const inv of [draft.id, s.inv]) { await h.as(g.owner); await pay(h, inv, -over, 'interac'); }
  assert.deepEqual(await about(draft.id, ahead), []);
  assert.deepEqual(await about(s.inv, reopened), []);
  await h.val(`select public.recon_run(public.local_today(), 'test')`);
  assert.deepEqual((await rows()).map((r) => r.state), ['closed', 'closed']);
}));

/* ───────────────────────── work and the invoice ───────────────────────── */

test('work added or accepted after the invoice is finished is billed: the job does not finish without it, and a paid invoice opens again (sql-money-04, jobs-a-01, jobs-b-02)', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0].id;
  const n = Number((await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv })).number);
  await asDb(h);
  const total = await h.val(`select total_cents from public.invoices where id = $1`, [inv]);
  await h.as(g.mech);
  await pay(h, inv, total);
  // then the customer accepts more work, and the mechanic adds a line
  const extra = uuid();
  await h.c.query(`insert into public.job_items (id, job_id, description, unit_cents, status, kind) values ($1, $2, 'Plaquettes avant', 12999, 'proposed', 'service')`, [extra, jobId]);
  await h.rpc('extra_answer', { p_op: uuid(), p_item: extra, p_accept: true, p_via: 'verbal' });
  await h.c.query(`insert into public.job_items (job_id, description, unit_cents, status, kind) values ($1, 'Essuie-glaces', 2999, 'planned', 'service')`, [jobId]);
  assert.equal((await inv1(h, inv)).total_cents, total, 'a finished invoice never changes by itself');
  // « Terminer la job »: refused, the work is named
  await h.as(g.mech);
  const e = await h.fails(() => h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: {} }));
  assert.equal(e?.hint, 'unbilled'); assert.match(e.message, /Plaquettes avant/); assert.match(e.message, /Essuie-glaces/);
  // « Modifier la facture » on the PAID invoice (the appointment is still open): what was paid waits on the job
  const r = await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: inv });
  assert.deepEqual([r.ok, Number(r.number)], [true, n]);
  assert.deepEqual(r.added.map((x) => x.description).sort(), ['Essuie-glaces', 'Plaquettes avant'], 'the answer says what came on the draft');
  assert.equal((await inv1(h, inv)).status, 'draft');
  // the work the finished invoice missed is on the draft already (argent-01): no tap on « Ajouter à la facture » needed
  const onDraft = (await h.val(`select lines from public.invoices where id = $1`, [inv])).map((x) => x.description);
  assert.equal(onDraft[0], 'Vidange d’huile + changement de filtre', 'the lines already billed stay first, as they were');
  assert.deepEqual(onDraft.slice(1).sort(), ['Essuie-glaces', 'Plaquettes avant']);
  await h.as(g.mech);
  const again = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  assert.deepEqual([Number(again.number), again.again, again.unbilled], [n, true, []]);
  const v = await inv1(h, inv);
  assert.deepEqual([v.status, v.paid_cents], ['issued', total], 'the same number, the first payment counted, the rest to pay');
  await h.as(g.mech);
  await pay(h, inv, v.total_cents - total);
  await h.rpc('job_step', { p_op: uuid(), p_job: jobId, p_action: 'finish', p_data: {} });
  assert.equal((await h.one(`select status from public.jobs where id = $1`, [jobId])).status, 'done');
  // the other way out: the work marked « Pas fait »
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  await h.as(g.mech);
  await pay(h, f2.inv, f2.total);
  const tires = await h.val(`insert into public.job_items (job_id, description, unit_cents, status, kind) values ($1, 'Pneus', 40000, 'planned', 'service') returning id`, [j2]);
  assert.equal(await hint(h, () => h.rpc('job_step', { p_op: uuid(), p_job: j2, p_action: 'finish', p_data: {} })), 'unbilled');
  await h.c.query(`update public.job_items set status = 'removed' where id = $1`, [tires]);
  await h.rpc('job_step', { p_op: uuid(), p_job: j2, p_action: 'finish', p_data: {} });
  await asDb(h);
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [j2]), 'done');
}));

test('work that becomes billable goes on the draft by itself; finishing the invoice says what is left out (invoices-quotes-05, x-money-03)', () => tx(async (h) => {
  const g = await garage(h);
  const jobId = await jobOnSite(h, g);
  const inv = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: jobId, p_refresh: true })).rows.invoices[0].id;
  const lines = async () => { await asDb(h); const l = (await h.val(`select lines from public.invoices where id = $1`, [inv])).map((x) => x.description); await h.as(g.mech); return l; };
  // a new line of work: on the draft
  const brakes = await h.val(`insert into public.job_items (job_id, description, unit_cents, status, kind, sort) values ($1, 'Plaquettes avant', 15000, 'planned', 'service', 5) returning id`, [jobId]);
  assert.deepEqual(await lines(), ['Vidange d’huile + changement de filtre', 'Plaquettes avant']);
  // extras proposed: not yet; accepted: on it; declined: never
  const yes = uuid(), no = uuid();
  await h.c.query(`insert into public.job_items (id, job_id, description, unit_cents, status, kind) values ($1, $3, 'Essuie-glaces', 2999, 'proposed', 'service'), ($2, $3, 'Antigel', 1500, 'proposed', 'service')`, [yes, no, jobId]);
  assert.equal((await lines()).length, 2);
  await h.rpc('extra_answer', { p_op: uuid(), p_item: yes, p_accept: true, p_via: 'verbal' });
  await h.rpc('extra_answer', { p_op: uuid(), p_item: no, p_accept: false, p_via: 'verbal' });
  assert.deepEqual(await lines(), ['Vidange d’huile + changement de filtre', 'Plaquettes avant', 'Essuie-glaces']);
  await asDb(h);
  assert.equal(await h.val(`select subtotal_cents from public.invoices where id = $1`, [inv]), 7999 + 15000 + 2999, 'the totals follow');
  // a line taken off the invoice by hand stays off (only a change of state brings work), and finishing says so
  await h.as(g.mech);
  await h.c.query(`update public.invoices set lines = (select jsonb_agg(l) from jsonb_array_elements(lines) l where l->>'item_id' <> $2) where id = $1`, [inv, brakes]);
  await h.c.query(`update public.job_items set unit_cents = 16000 where id = $1`, [brakes]);
  assert.deepEqual(await lines(), ['Vidange d’huile + changement de filtre', 'Essuie-glaces']);
  const f = await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: inv });
  assert.deepEqual(f.unbilled.map((x) => [x.id, x.description]), [[brakes, 'Plaquettes avant']]);
}));

test('the customer’s « oui » to proposed work is noted only by who works the job AND sees it: a job « À placer » or booked by nobody is no longer anybody’s (S79, R96)', () => tx(async (h) => {
  const g = await garage(h);
  const adam = await h.person('Adam Mécano', ['mechanic']);
  const karim = await h.person('Karim Mécano', ['mechanic'], { rights: { book: true } });   // « Réserver », not « Agenda »
  const office = await h.person('Bureau', ['office']);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [g.day]);
  const adamsTruck = await h.truck('Voiture d’Adam', adam, { [dow]: DAY });
  /** a booked job written as the server writes it (nobody booked it), with one proposed extra: the extra's id */
  const extraOn = async (truck) => {
    await asDb(h);
    await h.c.query(`select set_config('garage.rpc', 'on', true)`);
    const job = await h.val(`insert into public.jobs (customer_id, day, block, truck_id, status, duration_min) values ($1, $2, 'am', $3, 'booked', 60) returning id`, [g.customer, g.day, truck]);
    const item = await h.val(`insert into public.job_items (job_id, description, unit_cents, status, kind) values ($1, 'Essuie-glaces', 2999, 'proposed', 'service') returning id`, [job]);
    await h.c.query(`select set_config('garage.rpc', '', true)`);
    return item;
  };
  const answer = async (who, item) => { await h.as(who); return hint(h, () => h.rpc('extra_answer', { p_op: uuid(), p_item: item, p_accept: true, p_via: 'verbal' })); };
  const status = async (item) => { await asDb(h); return h.val(`select status from public.job_items where id = $1`, [item]); };
  const loose = await extraOn(null), adams = await extraOn(adamsTruck), salehs = await extraOn(g.truck);
  // a mechanic without « Réserver »: the rule answered NULL for these two (no truck, no author), and « if not NULL » let him through
  assert.equal(await answer(g.mech, loose), 'not_allowed', 'a job « À placer » is not his');
  assert.equal(await answer(g.mech, adams), 'not_allowed', 'another truck’s job, booked by nobody, is not his');
  // « Réserver » without « Agenda » (R96, as « Je pars »): a job he does not see
  assert.equal(await answer(karim, adams), 'not_allowed', 'a job he does not see');
  assert.deepEqual([await status(loose), await status(adams)], ['proposed', 'proposed'], 'nothing written');
  // the ones who may, as before
  assert.equal(await answer(g.mech, salehs), undefined, 'his own truck’s job');
  assert.equal(await answer(g.owner, loose), undefined, 'the owner, a job « À placer »');
  assert.equal(await answer(office, adams), undefined, 'the office (« Agenda » and « Réserver »)');
  assert.deepEqual([await status(salehs), await status(loose), await status(adams)], ['approved', 'approved', 'approved']);
}));

test('« Refaire depuis le travail » on a draft: it speaks the language of the job’s customer now (invoices-quotes-26)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  await h.as(g.owner);
  const d = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j, p_refresh: true })).rows.invoices[0];
  assert.equal(d.lang, 'fr');
  // the customer's language is changed on the file (or « Changer de client » put an English-speaking one on the job)
  await asDb(h);
  await h.c.query(`update public.customers set lang = 'en' where id = $1`, [g.customer]);
  await h.as(g.owner);
  await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j, p_refresh: true });
  assert.equal(await h.val(`select lang from public.invoices where id = $1`, [d.id]), 'en');
  // « Faire la facture » that finds the draft already there (no refresh) changes nothing
  await asDb(h);
  await h.c.query(`update public.customers set lang = 'fr' where id = $1`, [g.customer]);
  await h.as(g.owner);
  await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j, p_refresh: false });
  assert.equal(await h.val(`select lang from public.invoices where id = $1`, [d.id]), 'en');
}));

test('an invoice that has a number is never deleted: cancelled, its number stays in the books; what was paid waits for the next one (sql-money-06, invoices-quotes-04)', () => tx(async (h) => {
  const g = await garage(h);
  // « Modifier la facture », then « Supprimer le brouillon »
  const j1 = await siteJob(h, g);
  const f1 = await finished(h, g, j1);
  await h.as(g.owner);
  await pay(h, f1.inv, 2000);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f1.inv });
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: f1.inv, p_reason: 'À refaire' });
  const v1 = await inv1(h, f1.inv);
  assert.deepEqual([v1.status, Number(v1.number), v1.deleted_at, v1.void_reason], ['void', f1.number, null, 'À refaire']);
  const f1b = await finished(h, g, j1);
  assert.equal((await inv1(h, f1b.inv)).paid_cents, 2000, 'the 20 $ paid come on the new invoice');
  // through the Coffre
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  await h.as(g.owner);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f2.inv });
  await h.rpc('coffre_add', { p_op: uuid(), p_jobs: `{${j2}}`, p_amount: 0, p_note: null, p_day: null });
  const v2 = await inv1(h, f2.inv);
  assert.deepEqual([v2.status, Number(v2.number), v2.deleted_at], ['void', f2.number, null]);
  // by hand: never, whoever does it
  const j3 = await siteJob(h, g);
  const f3 = await finished(h, g, j3);
  await h.as(g.mech);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f3.inv });
  assert.equal(await hint(h, () => h.c.query(`update public.invoices set deleted_at = now() where id = $1`, [f3.inv])), 'numbered');
  await asDb(h);
  assert.equal(await hint(h, () => h.c.query(`update public.invoices set deleted_at = now() where id = $1`, [f3.inv])), 'numbered');
  // a draft that never had a number still goes away
  const j4 = await siteJob(h, g);
  await h.as(g.owner);
  const d4 = (await h.rpc('invoice_for_job', { p_op: uuid(), p_job: j4, p_refresh: true })).rows.invoices[0].id;
  await h.rpc('invoice_void', { p_op: uuid(), p_invoice: d4, p_reason: 'Pas besoin' });
  assert.ok((await inv1(h, d4)).deleted_at);
}));

test('a finished invoice keeps its taxes whoever touches the row; finishing it again takes today’s (A1 of the audit, sql-money-08)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  const f = await finished(h, g, j);
  assert.equal(f.total, 9197);
  // the tax rate changes in Réglages, then the server re-sends the invoice (a direct update, not an operation)
  await h.c.query(`update public.settings set taxes = jsonb_set(taxes, '{tps}', '0.10') where id = 1`);
  await h.c.query(`update public.invoices set sent_at = now() where id = $1`, [f.inv]);
  const a = await h.one(`select tps_cents, total_cents from public.invoices where id = $1`, [f.inv]);
  assert.deepEqual([a.tps_cents, a.total_cents], [400, 9197], 'issued once, the taxes never move');
  // « Modifier la facture » keeps the lines and their totals; finished again, the invoice is made as of today
  await h.as(g.owner);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f.inv });
  assert.equal((await inv1(h, f.inv)).total_cents, 9197);
  await h.as(g.owner);
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: f.inv });
  assert.equal((await inv1(h, f.inv)).total_cents, 7999 + 800 + 798);
}));

test('the invoice number never falls behind the highest one given; a reopened invoice keeps its first date (sql-money-27, sql-money-30)', () => tx(async (h) => {
  const g = await garage(h);
  const j1 = await siteJob(h, g);
  const f1 = await finished(h, g, j1);
  // a partial restore put the counter back; the first invoice was issued 40 days ago
  await h.c.query(`update public.counters set next_value = 1 where name = 'invoice'`);
  await h.c.query(`update public.invoices set issued_at = issued_at - interval '40 days', due_on = due_on - 40 where id = $1`, [f1.inv]);
  const first = (await inv1(h, f1.inv)).issued_at;
  const j2 = await siteJob(h, g);
  const f2 = await finished(h, g, j2);
  assert.equal(f2.number, f1.number + 1, 'the next number, not one already given');
  await h.as(g.owner);
  await h.rpc('invoice_reopen', { p_op: uuid(), p_invoice: f1.inv });
  await h.rpc('invoice_finish', { p_op: uuid(), p_invoice: f1.inv });
  const v = await inv1(h, f1.inv);
  assert.deepEqual([Number(v.number), v.issued_at.toISOString()], [f1.number, first.toISOString()], 'same number, same date');
}));

test('« Changer le prix » on a line priced below zero keeps it below zero (x-money-05)', () => tx(async (h) => {
  const g = await garage(h);
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60 },
    p_items: [{ description: 'Vidange', service_id: g.svc, unit_cents: 7999, duration_min: 30 }, { description: 'Rabais fidélité', unit_cents: -2000 }] });
  const rebate = await h.val(`select id from public.job_items where job_id = $1 and unit_cents < 0`, [r.job_id]);
  await h.as(g.mech);
  await h.rpc('job_item_price', { p_op: uuid(), p_item: rebate, p_unit_cents: 1500 });
  await asDb(h);
  assert.equal(await h.val(`select unit_cents from public.job_items where id = $1`, [rebate]), -1500);
  // the history says the price as it is kept, with its sign (argent-02)
  const seen = await h.one(`select data from public.activity where action = 'price_changed' and data->>'item' = $1`, [rebate]);
  assert.deepEqual([seen.data.from, seen.data.to], [-2000, -1500]);
}));

/* ───────────────────────── the Coffre and the stock ───────────────────────── */

test('« Retirer » a Coffre purchase takes its stock back out; each purchase knows its stock move (sql-money-09)', () => tx(async (h) => {
  const g = await garage(h);
  await h.c.query(`insert into public.coffre (kind, amount_cents, received_on) values ('received', 10000, public.local_today())`);
  const coil = await h.val(`insert into public.inventory_items (name, qty, unit, pool) values ('Huile Coffre', 0, 'L', 'coffre') returning id`);
  await h.as(g.owner);
  const b = await h.rpc('inventory_buy', { p_op: uuid(), p_item: coil, p_qty: 3, p_total_cents: 4500, p_from: 'coffre', p_vendor: null, p_note: null });
  const a = await h.rpc('inventory_buy', { p_op: uuid(), p_item: g.filter, p_qty: 5, p_total_cents: 5749, p_from: 'treasury', p_vendor: 'Lordco', p_note: null });
  await asDb(h);
  assert.equal(await h.val(`select move_id from public.coffre where id = $1`, [b.coffre_id]), b.move_id);
  assert.equal(await h.val(`select move_id from public.expenses where id = $1`, [a.expense_id]), a.move_id);
  await h.as(g.owner);
  assert.equal((await h.rpc('coffre_report', { p_from: null, p_to: null })).balance_cents, 5500);
  const out = await h.rpc('coffre_remove', { p_op: uuid(), p_id: b.coffre_id });
  assert.equal(Number(out.rows.inventory_items[0].qty), 0, 'the phone gets the item back as it is');
  assert.equal((await h.rpc('coffre_report', { p_from: null, p_to: null })).balance_cents, 10000);
  await asDb(h);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [coil])), 0, 'the stock it brought left with it');
  assert.ok(await h.val(`select deleted_at from public.inventory_moves where id = $1`, [b.move_id]));
  // a purchase made before Part 27 (its move unknown): a move the other way
  const old = await h.val(`insert into public.coffre (kind, amount_cents, value_cents, received_on, item_id, item_name, qty) values ('purchase', 1000, 0, public.local_today(), $1, 'Huile Coffre', 2) returning id`, [coil]);
  await h.c.query(`insert into public.inventory_moves (item_id, delta, reason) values ($1, 2, 'restock')`, [coil]);
  await h.as(g.owner);
  await h.rpc('coffre_remove', { p_op: uuid(), p_id: old });
  await asDb(h);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [coil])), 0);
  assert.equal(await h.val(`select delta::text from public.inventory_moves where item_id = $1 and reason = 'adjust'`, [coil]), '-2.00');
}));

test('the Coffre: only the jobs one sees; a payment and its money back no longer hold a job (sql-money-13, sql-money-03)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  const other = await h.person('Autre Mécano', ['mechanic']);
  await h.as(other);
  assert.equal(await hint(h, () => h.rpc('coffre_add', { p_op: uuid(), p_jobs: `{${j}}`, p_amount: 0, p_note: null, p_day: null })), 'not_allowed', 'a job id alone is not enough');
  // 20 $ received then given back: the job may go to the Coffre (its truck's mechanic sees it)
  const f = await finished(h, g, j);
  await h.as(g.owner);
  await pay(h, f.inv, 2000);
  await pay(h, f.inv, -2000);
  await h.as(g.mech);
  assert.equal((await h.rpc('coffre_add', { p_op: uuid(), p_jobs: `{${j}}`, p_amount: 0, p_note: null, p_day: null })).ok, true);
  const v = await inv1(h, f.inv);
  assert.equal(v.status, 'void');
  assert.equal(await h.val(`select count(*)::int from public.payments where invoice_id = $1`, [f.inv]), 0, 'the cancelled invoice holds no payment');
}));

test('« Terminer » with a quantity of parts that rounds to zero: left out, no raw error (sql-money-28)', () => tx(async (h) => {
  const g = await garage(h);
  const j = await siteJob(h, g);
  const f = await finished(h, g, j);
  await h.as(g.mech);
  await pay(h, f.inv, f.total);
  await h.rpc('job_step', { p_op: uuid(), p_job: j, p_action: 'finish', p_data: { parts: [{ item_id: g.oil, qty: 0.004 }, { item_id: g.filter, qty: 1 }] } });
  await asDb(h);
  assert.equal(await h.val(`select status from public.jobs where id = $1`, [j]), 'done');
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.oil])), 20);
  assert.equal(Number(await h.val(`select qty from public.inventory_items where id = $1`, [g.filter])), 4);
}));

/* ───────────────────────── the migration itself ───────────────────────── */

test('the money migration sends no DROP, DELETE or TRUNCATE to the live database, and applied again (twice) it leaves the same triggers (S120)', () => tx(async (h) => {
  const file = new URL('../../supabase/migrations/20261116000100_refonte_argent.sql', import.meta.url);
  const sql = readFileSync(file, 'utf8');
  // what the migration itself runs: the bodies of its functions ($$ … $$) are only stored, its comments are words
  const sent = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(sent, /\b(drop|truncate|delete)\b/i, 'no statement that removes something');
  assert.doesNotMatch(sent, /\bcreate\s+trigger\b/i, 'a trigger is made with « create or replace » (a plain create needs a drop first)');
  assert.equal(sent.match(/\bcreate\s+or\s+replace\s+trigger\b/gi)?.length, 3);
  // the triggers of the three tables, as the build left them; then the file again, twice in a row (inside this test's
  // transaction, rolled back): the same triggers, the same definitions, none more, none less, still on
  await asDb(h);
  const triggers = () => h.q(`select c.relname as table, t.tgname as name, t.tgenabled as on, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ('invoices', 'job_items', 'jobs') order by 1, 2`);
  const built = await triggers();
  const def = (name) => built.find((t) => t.name === name)?.def;
  assert.match(def('invoices_number_keep'), /BEFORE UPDATE OF deleted_at ON public\.invoices FOR EACH ROW WHEN \(\(\(new\.deleted_at IS NOT NULL\) AND \(old\.deleted_at IS NULL\) AND \(new\.number IS NOT NULL\)\)\) EXECUTE FUNCTION invoices_number_keep\(\)/);
  assert.match(def('job_items_invoice_follow'), /AFTER INSERT OR UPDATE ON public\.job_items FOR EACH ROW EXECUTE FUNCTION job_items_invoice_follow\(\)/);
  assert.match(def('jobs_unbilled_guard'), /BEFORE UPDATE OF status ON public\.jobs FOR EACH ROW WHEN \(\(\(new\.status = 'done'::text\) AND \(old\.status IS DISTINCT FROM 'done'::text\)\)\) EXECUTE FUNCTION jobs_unbilled_guard\(\)/);
  await h.c.query(sql);
  assert.deepEqual(await triggers(), built, 'applied a second time');
  await h.c.query(sql);
  assert.deepEqual(await triggers(), built, 'and a third');
  // and they still hold: a numbered invoice is not deleted
  const g = await garage(h);
  const f = await finished(h, g, await siteJob(h, g));
  await asDb(h);
  assert.equal((await h.fails(() => h.c.query(`update public.invoices set deleted_at = now() where id = $1`, [f.inv])))?.hint, 'numbered');
}));
