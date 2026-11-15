// « Notes d'appels » (Part 26): who reads the notes of the calls, who writes them, and whose call it is. Rolled back at the end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool } from './helpers.mjs';

after(() => pool.end());

test('Part 26: « Notes d’appels »: only the server writes, only an owner reads; a call belongs to the customer who has that number, now or later', () => tx(async (h) => {
  const owner = await h.person('Hassan Jeha', ['owner']);
  const mech = await h.person('Saleh Mécano', ['mechanic']);
  const office = await h.person('Rima Bureau', ['office'], { rights: { clients: true, money: true, settings: true } });
  const karim = await h.customer('Karim', 45.5, -73.6, { phone: '(438) 557-0101' });
  const gone = await h.customer('Ancien', 45.5, -73.6, { phone: '438 557-0202' });
  await h.q(`update public.customers set deleted_at = now() where id = $1`, [gone]);
  // the server notes three calls: a known number, the number of a deleted file, a stranger
  await h.q(`insert into public.call_notes (message_id, phone, dir, at, duration_sec) values ('m1', '+14385570101', 'in', now(), 95), ('m2', '+14385570202', 'in', now(), 40), ('m3', '+14385570303', 'out', now(), 61)`);
  const rows = await h.q(`select message_id, customer_id, phone_digits, status, tries, created_at, updated_at from public.call_notes order by message_id`);
  assert.deepEqual(rows.map((r) => [r.customer_id, r.phone_digits, r.status, r.tries]), [[karim, '4385570101', 'new', 0], [null, '4385570202', 'new', 0], [null, '4385570303', 'new', 0]]);
  assert.ok(rows[0].created_at && rows[0].updated_at);
  // the same call is never noted twice; a status that does not exist is refused
  assert.equal((await h.fails(() => h.q(`insert into public.call_notes (message_id) values ('m1')`)))?.code, '23505');
  assert.equal((await h.fails(() => h.q(`update public.call_notes set status = 'peut-etre' where message_id = 'm1'`)))?.code, '23514');
  assert.equal((await h.fails(() => h.q(`update public.call_notes set dir = 'up' where message_id = 'm1'`)))?.code, '23514');
  // the stranger's file is made after the call (by anyone on the team): the note becomes theirs
  await h.as(office);
  const nadia = await h.val(`insert into public.customers (first_name, phone) values ('Nadia', '438-557-0303') returning id`);
  await h.as(null);
  assert.equal(await h.val(`select customer_id from public.call_notes where message_id = 'm3'`), nadia);
  // a number corrected on a file: the calls of that number follow; a note that has its customer never changes hands
  const late = await h.customer('Tard', 45.5, -73.6, { phone: '438 557-0999' });
  await h.q(`update public.customers set phone = '438 557-0202' where id = $1`, [late]);
  assert.equal(await h.val(`select customer_id from public.call_notes where message_id = 'm2'`), late);
  await h.customer('Homonyme', 45.5, -73.6, { phone: '438 557-0101' });
  assert.equal(await h.val(`select customer_id from public.call_notes where message_id = 'm1'`), karim);
  // « call_notes_link » (the server asks it at each look): rows still without a file
  await h.q(`update public.call_notes set customer_id = null where message_id = 'm3'`);
  assert.equal(await h.val(`select public.call_notes_link()`), 1);
  assert.equal(await h.val(`select customer_id from public.call_notes where message_id = 'm3'`), nadia);
  // a file deleted for good: the note stays, without a customer
  await h.q(`delete from public.customers where id = $1`, [late]);
  assert.deepEqual(await h.one(`select customer_id, phone from public.call_notes where message_id = 'm2'`), { customer_id: null, phone: '+14385570202' });
  // who reads: an owner. Nobody of the team writes, not even the owner
  await h.as(owner);
  assert.equal(await h.val(`select count(*)::int from public.call_notes`), 3);
  for (const sql of [`insert into public.call_notes (message_id) values ('m9')`, `update public.call_notes set summary = 'autre'`, `delete from public.call_notes`, `select public.call_notes_link()`]) {
    assert.equal((await h.fails(() => h.q(sql)))?.code, '42501', sql);
  }
  for (const who of [mech, office]) {
    await h.as(who);
    assert.equal(await h.val(`select count(*)::int from public.call_notes`), 0);
    assert.equal((await h.fails(() => h.q(`update public.call_notes set summary = 'autre'`)))?.code, '42501');
  }
  await h.as(null);
  assert.equal(await h.val(`select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_notes'`), 1);
}));
