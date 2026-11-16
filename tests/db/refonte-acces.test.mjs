// Part 26 « Refonte », rights and privacy (20261116000300_refonte_acces.sql): each test is a door the scan found open.
// Run: node --test tests/db/refonte-acces.test.mjs. Each test is rolled back, except the « two at the same instant » ones,
// which need two real connections: they commit what they make and remove it at the end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());
const DAY = [[480, 1200]];
const here = [45.515, -73.64];

/** the owner, a mechanic who drives a truck working a coming day, a customer */
async function garage(h, opts = {}) {
  const owner = await h.person('Hassan Jeha', ['owner']);
  const mech = await h.person('Saleh Mécano', ['mechanic'], { rights: opts.mechRights ?? {} });
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  const truck = await h.truck('Camion de Saleh', mech, { [dow]: DAY });
  const customer = await h.customer('Jean', ...here, { last: 'Tremblay', phone: '5145551234' });
  return { owner, mech, day, dow, truck, customer };
}
async function bookOn(h, g, extra = {}) {
  await h.as(g.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: g.customer, day: g.day, block: 'am', duration_min: 60, ...extra }, p_items: [] });
  return r.job_id;
}
const code = (e) => e?.hint ?? e?.code ?? (e ? e.message : null);

// =====================================================================================================================
// 1. Direct writes
// =====================================================================================================================

test('x-security-02: « Horaires » alone no longer takes, renames or switches off a truck; « Réglages » and the owner still do', () => tx(async (h) => {
  const g = await garage(h, { mechRights: { hours: true } });
  const other = await h.truck('Camion Complet', null, { [g.dow]: DAY });
  const office = await h.person('Julie Bureau', ['office'], { rights: { settings: true } });
  await h.as(g.mech);
  // what he could do before: make himself the driver of the other truck, switch it off, add one
  assert.equal((await h.q(`update public.trucks set driver_id = $1 where id = $2 returning id`, [g.mech, other])).length, 0, 'not the driver of another truck');
  assert.equal((await h.q(`update public.trucks set active = false where id = $1 returning id`, [other])).length, 0, 'not switched off');
  assert.equal((await h.q(`update public.trucks set name = 'X' where id = $1 returning id`, [g.truck])).length, 0, 'not even his own truck renamed');
  assert.equal(code(await h.fails(() => h.q(`insert into public.trucks (name, active) values ('Mon camion', true)`))), '42501', 'no new truck');
  // what « Horaires » is for still works: the hours of a truck
  assert.equal((await h.q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[540,1020]]')
    on conflict (truck_id, dow) do update set ranges = excluded.ranges returning truck_id`, [other, (g.dow + 1) % 7])).length, 1);
  // « Réglages » and the owner manage the trucks, as the app shows « Les camions »
  await h.as(office);
  assert.equal((await h.q(`update public.trucks set driver_id = $1 where id = $2 returning id`, [g.mech, other])).length, 1);
  await h.as(g.owner);
  assert.equal((await h.q(`update public.trucks set name = 'Voiture' where id = $1 returning id`, [other])).length, 1);
  assert.equal((await h.q(`insert into public.trucks (name, active) values ('Nouveau', true) returning id`)).length, 1);
}));

test('audit A2 (x-security-09): a job is not deleted, nor its length changed, by a direct write; its notes still are', () => tx(async (h) => {
  const g = await garage(h);
  const job = await bookOn(h, g);
  await h.as(g.owner);
  assert.equal(code(await h.fails(() => h.q(`update public.jobs set deleted_at = now() where id = $1`, [job]))), '42501');
  assert.equal(code(await h.fails(() => h.q(`update public.jobs set duration_min = 600 where id = $1`, [job]))), '42501');
  assert.equal((await h.q(`update public.jobs set notes = 'Code de porte 1234' where id = $1 returning id`, [job])).length, 1);
  // the length goes through set_job_duration
  const r = await h.rpc('set_job_duration', { p_op: uuid(), p_job: job, p_duration: 90 });
  assert.equal(r.ok, true);
  assert.equal(await h.val(`select duration_min from public.jobs where id = $1`, [job]), 90);
}));

test('sql-foundation-04: a person without « Clients » creates a customer and gets it back (insert … returning)', () => tx(async (h) => {
  const mech = await h.person('Adam Mécano', ['mechanic'], { rights: { clients: false } });
  await h.as(mech);
  const id = uuid();
  const rows = await h.q(`insert into public.customers (id, first_name, phone, created_by) values ($1, 'Nouveau', '5145550199', $2) returning id, first_name`, [id, mech]);
  assert.deepEqual(rows, [{ id, first_name: 'Nouveau' }]);
  // somebody else's customer stays hidden from him
  await h.as(null);
  const other = await h.customer('Caché', ...here);
  await h.as(mech);
  assert.equal((await h.q(`select id from public.customers where id = $1`, [other])).length, 0);
}));

test('x-security-22: a customer with a coming appointment or a finished invoice not paid is not deleted through the API', () => tx(async (h) => {
  const g = await garage(h);
  const job = await bookOn(h, g);
  await h.as(g.owner);
  assert.equal(code(await h.fails(() => h.q(`update public.customers set deleted_at = now() where id = $1`, [g.customer]))), 'customer_busy');
  // the appointment cancelled: an invoice finished and not paid still holds the file
  await h.as(null);
  await h.q(`update public.jobs set status = 'cancelled' where id = $1`, [job]);
  await h.q(`insert into public.invoices (job_id, customer_id, number, status, lines, paid_cents)
    values ($1, $2, 990001, 'issued', '[{"description":"Vidange","qty":1,"unit_cents":5000}]', 1000)`, [job, g.customer]);
  assert.ok(await h.val(`select total_cents > paid_cents from public.invoices where job_id = $1`, [job]));
  await h.as(g.owner);
  assert.equal(code(await h.fails(() => h.q(`update public.customers set deleted_at = now() where id = $1`, [g.customer]))), 'customer_owes');
  // paid: the file goes
  await h.as(null);
  await h.q(`update public.invoices set paid_cents = total_cents, status = 'paid' where job_id = $1`, [job]);
  await h.as(g.owner);
  assert.equal((await h.q(`update public.customers set deleted_at = now() where id = $1 returning id`, [g.customer])).length, 1);
  // a file with nothing coming goes at once
  await h.as(null);
  const plain = await h.customer('Libre', ...here);
  await h.as(g.owner);
  assert.equal((await h.q(`update public.customers set deleted_at = now() where id = $1 returning id`, [plain])).length, 1);
}));

test('x-security-01, sql-foundation-08: no SVG stored; a signature or a receipt is written once, never replaced', () => tx(async (h) => {
  const g = await garage(h);
  const job = await bookOn(h, g);
  await h.as(g.owner);
  assert.equal(code(await h.fails(() => h.q(`insert into public.attachments (kind, mime, data) values ('receipt', 'image/svg+xml', '<svg onload="alert(1)"/>')`))), '23514');
  const id = await h.val(`insert into public.attachments (kind, mime, data, bytes, job_id) values ('signature', 'image/png', 'iVBORw0KGgo=', 8, $1) returning id`, [job]);
  assert.ok(id);
  assert.equal(code(await h.fails(() => h.q(`update public.attachments set data = 'AAAA' where id = $1`, [id]))), '42501');
  assert.equal(code(await h.fails(() => h.q(`update public.attachments set mime = 'image/jpeg', kind = 'receipt' where id = $1`, [id]))), '42501');
  // the app's own path (insert … on conflict do nothing, the outbox's upsert) still works
  assert.equal((await h.q(`insert into public.attachments (id, kind, mime, data, job_id) values ($1, 'signature', 'image/png', 'iVBORw0KGgo=', $2) on conflict (id) do nothing returning id`, [id, job])).length, 0);
}));

test('sql-misc-02: the alert address of a device follows the owner who switches it on last (no raw database error)', () => tx(async (h) => {
  const a = await h.person('Hassan', ['owner']);
  const b = await h.person('Ibrahim', ['owner', 'treasurer']);
  const endpoint = 'https://push.example/' + uuid();
  await h.as(a);
  await h.q(`insert into public.push_subs (staff_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [a, endpoint]);
  await h.as(b);
  // what the app does: delete its own row for that address (none), then insert
  await h.q(`delete from public.push_subs where endpoint = $1`, [endpoint]);
  assert.equal((await h.q(`insert into public.push_subs (staff_id, endpoint, p256dh, auth) values ($1, $2, 'k2', 'a2') returning id`, [b, endpoint])).length, 1);
  await h.as(null);
  assert.deepEqual(await h.q(`select staff_id from public.push_subs where endpoint = $1`, [endpoint]), [{ staff_id: b }]);
  // a mechanic still cannot register one
  const m = await h.person('Saleh', ['mechanic']);
  await h.as(m);
  assert.equal(code(await h.fails(() => h.q(`insert into public.push_subs (staff_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [m, endpoint + 'x']))), '42501');
}));

test('sql-misc-04: a settings save never reopens « Réserver en ligne »; only web_switch does, and only for the owner', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const office = await h.person('Julie', ['office'], { rights: { settings: true } });
  await h.as(null);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": false, "max_km": 60}'::jsonb) where id = 1`);
  const before = await h.val(`select booking from public.settings where id = 1`);
  await h.as(office);
  // a phone whose copy is older than the day the page was closed saves « booking » whole
  await h.q(`update public.settings set booking = jsonb_set(booking, '{web,on}', 'true') || '{"speed_kmh": 41}'::jsonb where id = 1`);
  let b = await h.val(`select booking from public.settings where id = 1`);
  assert.equal(b.web.on, false, 'still closed');
  assert.equal(b.web.max_km, 60);
  assert.equal(b.speed_kmh, 41, 'the rest of the save is kept');
  // a copy with no « web » at all
  await h.q(`update public.settings set booking = booking - 'web' where id = 1`);
  b = await h.val(`select booking from public.settings where id = 1`);
  assert.equal(b.web?.on, false);
  // a write with the server key (an Edge Function, a script through the API) does not reopen it either
  await h.as(null);
  await h.q(`set local role service_role`);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{web}', '{"on": true, "max_km": 50}'::jsonb) where id = 1`);
  await h.q(`reset role`);
  b = await h.val(`select booking from public.settings where id = 1`);
  assert.equal(b.web.on, false, 'still closed after a server-key write');
  assert.equal(b.web.max_km, 50, 'the other numbers of « web » are saved');
  await h.as(office);
  // the switch
  assert.equal(code(await h.fails(() => h.rpc('web_switch', { p_op: uuid(), p_on: true }))), 'not_allowed');
  await h.as(owner);
  const op = uuid();
  const r = await h.rpc('web_switch', { p_op: op, p_on: true });
  assert.equal(r.ok, true); assert.equal(r.on, true);
  assert.equal((await h.val(`select booking from public.settings where id = 1`)).web.on, true);
  assert.equal((await h.rpc('web_switch', { p_op: op, p_on: true })).on, true, 'sent again: the same answer');
  assert.equal((await h.rpc('web_switch', { p_op: uuid(), p_on: false })).on, false);
  void before;
}));

test('x-security-03: a phone number corrected closes the links of the open appointments texted to the old one', () => tx(async (h) => {
  const g = await garage(h);
  const job = await bookOn(h, g);
  await h.as(null);
  const done = await h.val(`insert into public.jobs (customer_id, day, block, status, source) values ($1, $2, 'am', 'done', 'phone') returning id`, [g.customer, g.day]);
  const q = await h.val(`insert into public.quotes (customer_id, status) values ($1, 'sent') returning id`, [g.customer]);
  await h.q(`update public.jobs set confirm_sent_at = now() where id = $1`, [job]);
  const link = async (job_id, quote_id) => h.val(`insert into public.public_links (token_hash, job_id, quote_id, expires_at) values ($1, $2, $3, now() + interval '90 days') returning id`,
    [randomUUID(), job_id, quote_id]);
  const lJob = await link(job, null), lDone = await link(done, null), lQuote = await link(null, q);
  const revoked = async (id) => (await h.val(`select revoked_at from public.public_links where id = $1`, [id])) !== null;
  // the coming appointment was signed through the link (one tap: estimate + authorization); another one at the door
  await h.q(`update public.jobs set estimate_signed_at = now(), estimate_signer = 'Un inconnu', estimate_cents = 9999,
    waiver_signed_at = now(), waiver_signer = 'Un inconnu', waiver_version = '1', waiver_via = 'online' where id = $1`, [job]);
  const door = await h.val(`insert into public.jobs (customer_id, day, block, status, source) values ($1, $2, 'pm', 'booked', 'phone') returning id`, [g.customer, g.day]);
  await h.q(`update public.jobs set waiver_signed_at = now(), waiver_signer = 'Jean Tremblay', waiver_version = '1' where id = $1`, [door]);
  assert.equal(await h.val(`select waiver_via from public.jobs where id = $1`, [door]), 'phone');
  await h.as(g.owner);
  // the same digits written another way: nothing closes
  await h.q(`update public.customers set phone = '(514) 555-1234' where id = $1`, [g.customer]);
  await h.as(null);
  assert.equal(await revoked(lJob), false);
  await h.as(g.owner);
  // another number
  await h.q(`update public.customers set phone = '514 555-9876' where id = $1`, [g.customer]);
  await h.as(null);
  assert.equal(await revoked(lJob), true, 'the coming appointment’s link');
  assert.equal(await revoked(lQuote), true, 'the open estimate’s link');
  assert.equal(await revoked(lDone), false, 'a finished job keeps its link (the invoice, the card payment)');
  assert.equal(await h.val(`select confirm_sent_at from public.jobs where id = $1`, [job]), null, 'the booking text may go again');
  assert.equal(await h.val(`select count(*)::int from public.activity where entity_id = $1 and action = 'phone_changed'`, [g.customer]), 1);
  // what was signed through the old number's link no longer counts: signed again at the door; the door's signature stays
  const s = await h.one(`select estimate_signed_at, estimate_signer, estimate_cents, waiver_signed_at, waiver_signer, waiver_via from public.jobs where id = $1`, [job]);
  assert.deepEqual(s, { estimate_signed_at: null, estimate_signer: null, estimate_cents: null, waiver_signed_at: null, waiver_signer: null, waiver_via: null });
  const d = await h.one(`select waiver_signed_at, waiver_signer, waiver_via from public.jobs where id = $1`, [door]);
  assert.ok(d.waiver_signed_at); assert.equal(d.waiver_signer, 'Jean Tremblay'); assert.equal(d.waiver_via, 'phone');
  const act = await h.val(`select data from public.activity where entity_id = $1 and action = 'phone_changed'`, [g.customer]);
  assert.deepEqual(act.signature_removed, [job], 'the office sees which appointment lost its signature');
}));

// =====================================================================================================================
// 2. Rights
// =====================================================================================================================

test('x-rights-19: a blocked mechanic whose session still lives no longer reads his truck’s jobs nor changes its hours', () => tx(async (h) => {
  const g = await garage(h);
  const job = await bookOn(h, g);
  await h.as(g.mech);
  assert.equal((await h.q(`select id from public.jobs where id = $1`, [job])).length, 1);
  assert.equal(await h.val(`select public.truck_hours_editable($1)`, [g.truck]), true);
  await h.as(null);
  await h.q(`update public.staff set active = false where id = $1`, [g.mech]);
  await h.as(g.mech);
  assert.equal((await h.q(`select id from public.jobs where id = $1`, [job])).length, 0);
  assert.equal(await h.val(`select public.truck_hours_editable($1)`, [g.truck]), false);
  assert.equal((await h.q(`select id from public.customers where id = $1`, [g.customer])).length, 0);
}));

test('x-security-30: a right that is not yes / no in the rights never stops the person’s app', () => tx(async (h) => {
  const m = await h.person('Saleh', ['mechanic'], { rights: { book: 'peut-être', map: 'yes' } });
  await h.as(null);
  await h.q(`update public.settings set role_rights = jsonb_build_object('mechanic', jsonb_build_object('inventory', 'n/a', 'hours', 'true')) where id = 1`);
  await h.as(m);
  const a = await h.val(`select public.my_access()`);
  assert.equal(a.rights.book, false, 'not a yes: no');
  assert.equal(a.rights.map, true);
  assert.equal(a.rights.inventory, true, 'a value that is not one: the role’s default');
  assert.equal(a.rights.hours, true);
  assert.equal((await h.q(`select id from public.trucks`)).length >= 0, true, 'the row rules still answer');
}));

test('member_update: only known roles, yes / no rights kept, an empty list of roles refused in words', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const m = await h.person('Saleh', ['mechanic']);
  await h.as(owner);
  assert.equal(code(await h.fails(() => h.rpc('member_update', { p_op: uuid(), p_staff: m, p_patch: { roles: ['boss'] } }))), 'bad_role');
  assert.equal(code(await h.fails(() => h.rpc('member_update', { p_op: uuid(), p_staff: m, p_patch: { roles: [] } }))), 'no_role');
  const r = await h.rpc('member_update', { p_op: uuid(), p_staff: m, p_patch: { rights: { book: true, map: 'oui', nope: true, hours: null } } });
  assert.deepEqual(r.rows.staff[0].rights, { book: true });
  assert.deepEqual(r.rows.staff[0].roles, ['mechanic'], 'no roles sent: kept');
}));

test('x-security-25, x-security-37: removing someone cancels their unused links; the last owner is never removed', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const m = await h.person('Saleh', ['mechanic']);
  const email = await h.val(`select email from public.staff where id = $1`, [m]);
  await h.as(null);
  await h.q(`insert into public.invitations (email, full_name, roles, token_hash, kind, user_id, expires_at) values ($1, 'Saleh', '{mechanic}', $2, 'reset', $3, now() + interval '7 days')`, [email, randomUUID(), m]);
  assert.equal(await h.val(`select public.remove_member($1)`, [m]), true);
  assert.equal(await h.val(`select count(*)::int from public.invitations where user_id = $1 and used_at is null`, [m]), 0);
  assert.equal(code(await h.fails(() => h.q(`select public.remove_member($1)`, [owner]))), 'last_owner');
  assert.equal(await h.val(`select active from public.staff where id = $1`, [owner]), true);
}));

test('rights_table for the team only; access_of with the person’s short name, colour and real routes; my_access says the server’s time', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const m = await h.person('Adam Mécano', ['mechanic'], { short_name: 'Adam' });
  const t1 = await h.truck('Voiture', null), t2 = await h.truck('Camion', null);
  await h.as(null);
  await h.q(`update public.staff set color = '#ff0000' where id = $1`, [m]);
  await h.q(`update public.settings set booking = booking || '{"shared_routes": true}'::jsonb where id = 1`);
  await h.as(owner);
  const a = await h.val(`select public.access_of($1)`, [m]);
  assert.equal(a.short_name, 'Adam'); assert.equal(a.color, '#ff0000');
  assert.ok(a.trucks.includes(t1) && a.trucks.includes(t2), '« Routes partagées »: every vehicle');
  // a value that is not yes / no there never stops the preview
  await h.as(null);
  await h.q(`update public.settings set booking = booking || '{"shared_routes": "peut-être"}'::jsonb where id = 1`);
  await h.as(owner);
  assert.deepEqual((await h.val(`select public.access_of($1)`, [m])).trucks, [], 'not yes: only the truck the person drives (none)');
  await h.as(null);
  await h.q(`update public.settings set booking = booking || '{"shared_routes": true}'::jsonb where id = 1`);
  await h.as(owner);
  const me = await h.val(`select public.my_access()`);
  assert.ok(Math.abs(new Date(me.now).getTime() - Date.now()) < 120000);
  // a blocked person (session still alive) gets no table of rights
  await h.as(null);
  await h.q(`update public.staff set active = false where id = $1`, [m]);
  await h.as(m);
  assert.equal(await h.val(`select public.rights_table()`), null);
  await h.as(owner);
  assert.ok((await h.val(`select public.rights_table()`)).rights.includes('agenda'));
}));

// =====================================================================================================================
// 3. The day
// =====================================================================================================================

test('sql-foundation-26: the position no longer keeps a job that is finished', () => tx(async (h) => {
  const g = await garage(h);
  const job = await bookOn(h, g);
  await h.as(g.mech);
  await h.rpc('shift_start', {});
  await h.rpc('job_step', { p_op: uuid(), p_job: job, p_action: 'leave', p_data: {} });
  await h.q(`select public.report_position(45.51, -73.64, 10, null, null, $1)`, [job]);
  assert.equal(await h.val(`select job_id from public.positions where id = $1`, [g.mech]), job);
  await h.q(`select public.report_position(45.512, -73.641)`);
  assert.equal(await h.val(`select job_id from public.positions where id = $1`, [g.mech]), job, 'still under way: kept');
  await h.as(null);
  await h.q(`update public.jobs set status = 'done' where id = $1`, [job]);
  await h.as(g.mech);
  await h.q(`select public.report_position(45.52, -73.65)`);
  assert.equal(await h.val(`select job_id from public.positions where id = $1`, [g.mech]), null);
}));

test('sql-misc-11, audit A4: housekeeping empties what was promised short-lived and the old change log, never a named proof', () => tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const m = await h.person('Saleh', ['mechanic']);
  await h.as(null);
  const old = `now() - interval '25 months'`;
  await h.q(`insert into public.incoming_calls (phone, at) values ('5145550001', now() - interval '2 days'), ('5145550002', now())`);
  await h.q(`insert into public.incoming_texts (phone, body, at) values ('5145550001', 'vieux', now() - interval '8 days'), ('5145550002', 'neuf', now())`);
  await h.q(`insert into public.rate_limits (key, bucket, n, at) values ('test:old', 1, 1, now() - interval '3 days'), ('test:new', 2, 1, now())`);
  await h.q(`insert into public.push_subs (staff_id, endpoint, p256dh, auth) values ($1, 'https://p/owner', 'k', 'a'), ($2, 'https://p/mech', 'k', 'a')`, [owner, m]);
  const e = uuid();
  await h.q(`insert into public.activity (at, entity, entity_id, action) values
    (${old}, 'job', $1, 'update'), (${old}, 'job', $1, 'insert'), (${old}, 'job', $1, 'signed_online'), (${old}, 'job', $1, 'price_changed'),
    (now() - interval '100 days', 'web', null, 'web_robot'), (now() - interval '23 months', 'job', $1, 'update')`, [e]);
  await h.q(`select public.housekeeping()`);
  assert.deepEqual((await h.q(`select phone from public.incoming_calls where phone in ('5145550001','5145550002')`)).map((r) => r.phone), ['5145550002']);
  assert.deepEqual((await h.q(`select body from public.incoming_texts where phone in ('5145550001','5145550002')`)).map((r) => r.body), ['neuf']);
  assert.deepEqual((await h.q(`select key from public.rate_limits where key like 'test:%'`)).map((r) => r.key), ['test:new']);
  assert.deepEqual((await h.q(`select endpoint from public.push_subs where endpoint like 'https://p/%'`)).map((r) => r.endpoint), ['https://p/owner']);
  const left = (await h.q(`select action from public.activity where entity_id = $1 order by action, at`, [e])).map((r) => r.action);
  assert.deepEqual(left, ['price_changed', 'signed_online', 'update'], 'the proofs stay, and the change log of less than 24 months');
  assert.equal(await h.val(`select count(*)::int from public.activity where action = 'web_robot' and at < now() - interval '90 days'`), 0);
}));

// =====================================================================================================================
// 4. « Réserver en ligne » (audit A3, sql-misc-01/05/06/13)
// =====================================================================================================================

async function webGarage(h) {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h);
  const dow = await h.val(`select extract(dow from $1::date)::int`, [day]);
  await h.truck('Camion web', null, { [dow]: DAY });
  await h.as(null);
  await h.q(`update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": true}'::jsonb) where id = 1`);
  const svc = await h.val(`insert into public.services (name_fr, price_cents, duration_min, active) values ('Vidange TEST', 7999, 45, true) returning id`);
  const home = await h.one(`select lat, lng from public.home_point()`);
  const at = [home.lat + 0.01, home.lng + 0.01];
  const form = (extra = {}) => ({ first_name: 'Sophie', last_name: 'Tremblay', phone: '514 555-4321', lang: 'fr', address: '10 rue du Test', lat: at[0], lng: at[1],
    services: [svc], day, block: 'pm', ...extra });
  const web = (x) => h.val(`select public.web_book($1::jsonb)`, [JSON.stringify(x)]);
  return { owner, day, svc, at, form, web };
}

test('audit A3: the same phone AND the same name is the same customer, whose file is never written; another name is a new file', () => tx(async (h) => {
  const w = await webGarage(h);
  // a known customer, with a car and no e-mail
  const known = await h.customer('Sophie', ...w.at, { last: 'Tremblay', phone: '5145554321' });
  const car = await h.val(`insert into public.vehicles (customer_id, year, make, model) values ($1, 2019, 'Honda', 'Civic') returning id`, [known]);
  // the same person (accents and capitals aside), her car
  const a = await w.web(w.form({ first_name: 'sophie', vehicle: { year: '2019', make: 'honda', model: 'civic' }, email: 'sophie@example.com' }));
  assert.equal(a.ok, true); assert.equal(a.customer_id, known); assert.equal(a.new_customer, false); assert.equal(a.shared_phone, false);
  const ja = await h.one(`select vehicle_id, web_contact, notes from public.jobs where id = $1`, [a.job_id]);
  assert.equal(ja.vehicle_id, car);
  assert.equal(ja.web_contact.match, 'same'); assert.equal(ja.web_contact.email, 'sophie@example.com');
  assert.match(ja.notes, /Courriel donné : sophie@example\.com/);
  const c = await h.one(`select email, first_name from public.customers where id = $1`, [known]);
  assert.equal(c.email, null, 'the file is not written'); assert.equal(c.first_name, 'Sophie');
  // the same phone, a car the file does not have: no car added, the car said on the job
  const b = await w.web(w.form({ address: '20 rue Autre', vehicle: { year: '2015', make: 'Toyota', model: 'RAV4' } }));
  assert.equal(b.customer_id, known);
  const jb = await h.one(`select vehicle_id, web_contact, notes from public.jobs where id = $1`, [b.job_id]);
  assert.equal(jb.vehicle_id, null);
  assert.equal(await h.val(`select count(*)::int from public.vehicles where customer_id = $1`, [known]), 1);
  assert.deepEqual(jb.web_contact.vehicle, { year: 2015, make: 'Toyota', model: 'RAV4' });
  assert.match(jb.notes, /Auto annoncée : 2015 Toyota RAV4/);
}));

test('sql-misc-01/05: a phone number alone never puts a job on somebody’s file: another name is a new file, flagged', () => tx(async (h) => {
  const w = await webGarage(h);
  const known = await h.customer('Jean', ...w.at, { last: 'Gagnon', phone: '5145554321' });
  const r = await w.web(w.form({ first_name: 'Marie', last_name: 'Roy', vehicle: { make: 'Mazda', model: '3' } }));
  assert.equal(r.ok, true);
  assert.notEqual(r.customer_id, known); assert.equal(r.new_customer, true); assert.equal(r.shared_phone, true);
  const c = await h.one(`select first_name, last_name, notes from public.customers where id = $1`, [r.customer_id]);
  assert.deepEqual([c.first_name, c.last_name], ['Marie', 'Roy']);
  assert.match(c.notes, /Même numéro de téléphone/);
  const j = await h.one(`select web_contact, vehicle_id from public.jobs where id = $1`, [r.job_id]);
  assert.equal(j.web_contact.match, 'shared');
  assert.ok(j.vehicle_id, 'a car is made on the new file');
  assert.equal(await h.val(`select count(*)::int from public.vehicles where customer_id = $1`, [known]), 0, 'nothing on the other file');
  assert.equal(await h.val(`select count(*)::int from public.jobs where customer_id = $1`, [known]), 0);
}));

test('audit A3 (the retry path): « the same booking sent again » needs the same name too; the same phone and address alone never link another person’s appointment', () => tx(async (h) => {
  const w = await webGarage(h);
  const t1 = randomUUID(), t2 = randomUUID(), t3 = randomUUID();
  const a = await w.web(w.form({ token_hash: t1 }));
  assert.equal(a.ok, true); assert.equal(a.again, false);
  // the page retried (same person): the job already made, the new link on it
  const again = await w.web(w.form({ first_name: 'SOPHIE', token_hash: t2 }));
  assert.equal(again.again, true); assert.equal(again.job_id, a.job_id);
  assert.equal(await h.val(`select job_id from public.public_links where token_hash = $1`, [t2]), a.job_id);
  // somebody else on the same phone and address, the same moment and work, within the 10 minutes
  const other = await w.web(w.form({ first_name: 'Marc', last_name: 'Roy', token_hash: t3 }));
  assert.equal(other.again, false, 'not « sent again »');
  assert.notEqual(other.job_id, a.job_id);
  assert.notEqual(other.customer_id, a.customer_id);
  assert.equal(other.shared_phone, true);
  assert.equal(await h.val(`select job_id from public.public_links where token_hash = $1`, [t3]), other.job_id, 'his link opens his own appointment');
}));

test('sql-misc-13: a day, a position or a year that is not one is refused in words, never a raw error', () => tx(async (h) => {
  const w = await webGarage(h);
  assert.equal(code(await h.fails(() => w.web(w.form({ day: '2026-02-30' })))), 'bad_block');
  assert.equal(code(await h.fails(() => w.web(w.form({ day: 'demain' })))), 'bad_block');
  assert.equal(code(await h.fails(() => w.web(w.form({ lat: 'abc' })))), 'far');
  assert.equal(code(await h.fails(() => w.web(w.form({ services: 'pas une liste' })))), 'no_service');
  const r = await w.web(w.form({ vehicle: { year: '99999999999', make: 'Ford', model: 'F-150' } }));
  assert.equal(r.ok, true, 'a year that is not one is simply left out');
}));

// =====================================================================================================================
// Two at the same instant (two real connections)
// =====================================================================================================================

/** a committed person (removed by the returned cleanup) */
async function committedPerson(name, roles) {
  const c = await pool.connect();
  const id = randomUUID();
  try {
    await c.query(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`, [id, `${id.slice(0, 8)}@test.local`]);
    await c.query(`insert into public.staff (id, full_name, short_name, roles, email) values ($1, $2, $2, $3, $4)`, [id, name, roles, `${id.slice(0, 8)}@test.local`]);
  } finally { c.release(); }
  return id;
}
async function cleanup(ids, ops = []) {
  const c = await pool.connect();
  try {
    await c.query(`delete from public.op_log where op = any($1::uuid[])`, [ops]);
    await c.query(`delete from public.shifts where staff_id = any($1::uuid[])`, [ids]);
    await c.query(`delete from public.activity where actor = any($1::uuid[]) or entity_id = any($1::uuid[])`, [ids]);
    await c.query(`delete from public.staff where id = any($1::uuid[])`, [ids]);
    await c.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
  } finally { c.release(); }
}
async function begin(c, who) {
  await c.query('begin');
  if (who) {
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: who, role: 'authenticated' }), who]);
    await c.query('set local role authenticated');
  }
}
/** true while `promise` has not settled after `ms` */
const stillWaiting = (promise, ms = 300) => Promise.race([promise.then(() => false, () => false), new Promise((r) => setTimeout(() => r(true), ms))]);

test('sql-foundation-29: two taps on « Commencer ma journée » at the same instant open one day, no database error', async () => {
  const m = await committedPerson('Saleh Test', ['mechanic']);
  const c1 = await pool.connect(), c2 = await pool.connect();
  try {
    await begin(c1, m); await begin(c2, m);
    await c1.query(`select public.shift_start()`);
    const second = c2.query(`select public.shift_start() r`);
    assert.equal(await stillWaiting(second), true, 'the second tap waits for the first');
    await c1.query('commit');
    const r = await second;                                     // before: duplicate key value violates « shifts_one_open »
    assert.equal(r.rows[0].r.rows.shifts.length, 1);
    await c2.query('commit');
    const c = await pool.connect();
    try { assert.equal((await c.query(`select count(*)::int n from public.shifts where staff_id = $1 and ended_at is null`, [m])).rows[0].n, 1); } finally { c.release(); }
  } finally {
    await c1.query('rollback').catch(() => {}); await c2.query('rollback').catch(() => {});
    c1.release(); c2.release();
    await cleanup([m]);
  }
});

test('x-security-37: two owners who remove each other at the same instant leave one owner', async () => {
  const a = await committedPerson('Owner A', ['owner']), b = await committedPerson('Owner B', ['owner']);
  const c1 = await pool.connect(), c2 = await pool.connect();
  try {
    await begin(c1, null); await begin(c2, null);               // the function « team » calls it with the server's key
    assert.equal((await c1.query(`select public.remove_member($1) r`, [b])).rows[0].r, true);
    const second = c2.query(`select public.remove_member($1) r`, [a]);
    assert.equal(await stillWaiting(second), true, 'the second waits for the first');
    await c1.query('commit');
    const e = await second.then(() => null, (x) => x);
    assert.equal(e?.hint, 'last_owner');
    await c2.query('rollback');
    const c = await pool.connect();
    try {
      const left = (await c.query(`select id from public.staff where id = any($1::uuid[]) and active and deleted_at is null`, [[a, b]])).rows.map((r) => r.id);
      assert.deepEqual(left, [a]);
    } finally { c.release(); }
  } finally {
    await c1.query('rollback').catch(() => {}); await c2.query('rollback').catch(() => {});
    c1.release(); c2.release();
    await cleanup([a, b]);
  }
});

test('rule 5: member_update sent twice at the same instant runs once (the second gets the first’s answer)', async () => {
  const owner = await committedPerson('Owner C', ['owner']), m = await committedPerson('Mécano C', ['mechanic']);
  const op = randomUUID();
  const c1 = await pool.connect(), c2 = await pool.connect();
  try {
    await begin(c1, owner); await begin(c2, owner);
    const args = [op, m, JSON.stringify({ short_name: 'Momo' })];
    const r1 = (await c1.query(`select public.member_update($1, $2, $3::jsonb) r`, args)).rows[0].r;
    const second = c2.query(`select public.member_update($1, $2, $3::jsonb) r`, args);
    assert.equal(await stillWaiting(second), true);
    await c1.query('commit');
    const r2 = (await second).rows[0].r;                        // before: duplicate key value violates « op_log_pkey »
    assert.deepEqual(r2, r1);
    await c2.query('commit');
  } finally {
    await c1.query('rollback').catch(() => {}); await c2.query('rollback').catch(() => {});
    c1.release(); c2.release();
    await cleanup([owner, m], [op]);
  }
});
