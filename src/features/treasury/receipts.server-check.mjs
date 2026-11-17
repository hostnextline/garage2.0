// Receipt photos against a REAL server (the local test stack: Postgres, GoTrue, PostgREST, the front door), with the
// very calls of receipts.ts: the insert with its own id and an abort signal, the retry of a try whose answer was lost
// (23505), the read back, the expense given its receipt_id afterwards (the app's update), a person without
// « Trésorerie » refused, and what the phone gets when there is no signal or the try is cut off. Not a unit test (vitest
// does not run it): run on the local stack, from a copy of the app, with
//   SRC=<copy> bash <lane>/api-tests.sh src/features/treasury/receipts.server-check.mjs
// The answers' shapes it prints are the ones pinned in receipts.test.ts (« the real server's answers »).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// the lane's front door: the harness gives the lane's database port (lane A 54352, lane B 54452)
const GW = process.env.GARAGE_DB_PORT === '54452' ? 54431 : 54331;
const API = `http://127.0.0.1:${GW}`;
const K = JSON.parse(readFileSync(`${process.cwd()}/tests/stack/keys.json`, 'utf8'));
const svc = createClient(API, K.service, { auth: { persistSession: false, autoRefreshToken: false } });
const made = { users: [], expenses: [], attachments: [] };

async function member(name, rights) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: 'motdepasse-9', email_confirm: true });
  assert.ifError(error);
  made.users.push(data.user.id);
  const ins = await svc.from('staff').insert({ id: data.user.id, full_name: name, short_name: name, roles: ['mechanic'], email, rights });
  assert.ifError(ins.error);
  const c = createClient(API, K.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await c.auth.signInWithPassword({ email, password: 'motdepasse-9' });
  assert.ifError(s.error);
  return c;
}
// a small real JPEG (1×1), as shrinkPhoto gives it: data:image/jpeg;base64,…
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
/** uploadPhoto of receipts.ts, word for word (the client given) */
async function uploadPhoto(sb, p, signal) {
  const data = p.dataUrl.split(',')[1] || '';
  const r = await sb.from('attachments')
    .insert({ id: p.id, kind: 'receipt', mime: 'image/jpeg', data, bytes: Math.round(data.length * 0.75), width: p.w, height: p.h })
    .abortSignal(signal);
  return r;
}
/** readAttachment of receipts.ts */
async function readAttachment(sb, id) {
  const { data, error } = await sb.from('attachments').select('mime, data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? `data:${data.mime};base64,${data.data}` : null;
}
const shape = (r) => ({ status: r.status, code: r.error?.code ?? null, name: r.error?.name ?? null, message: String(r.error?.message ?? '').slice(0, 80) });

let tre, meca;
before(async () => {
  tre = await member('Louis', { treasury: true });
  meca = await member('Saleh', {});
});
after(async () => {
  if (made.expenses.length) await svc.from('expenses').delete().in('id', made.expenses);
  if (made.attachments.length) await svc.from('attachments').delete().in('id', made.attachments);
  if (made.users.length) await svc.from('staff').delete().in('id', made.users);
  for (const id of made.users) await svc.auth.admin.deleteUser(id);
});

test('receipts: a treasurer’s photo lands with its own id; a retry of the same photo is « already there » (23505); it reads back', async () => {
  const p = { id: randomUUID(), dataUrl: `data:image/jpeg;base64,${JPEG}`, w: 1, h: 1 };
  made.attachments.push(p.id);
  const first = await uploadPhoto(tre, p, new AbortController().signal);
  console.log('first try', JSON.stringify(shape(first)));
  assert.equal(first.error, null);
  assert.equal(first.status, 201);
  const again = await uploadPhoto(tre, p, new AbortController().signal);
  console.log('same photo again', JSON.stringify(shape(again)));
  assert.equal(again.error?.code, '23505');
  assert.equal(await readAttachment(tre, p.id), p.dataUrl);
  // stored once
  const { count } = await svc.from('attachments').select('id', { count: 'exact', head: true }).eq('id', p.id);
  assert.equal(count, 1);
});

test('receipts: the expense saved first without its photo is given its receipt_id once the photo is there (the app’s update)', async () => {
  const id = randomUUID();
  made.expenses.push(id);
  const day = new Date().toISOString().slice(0, 10);
  const ins = await tre.from('expenses').upsert({ id, day, vendor: 'NAPA', category: 'Pièces', subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498 }, { onConflict: 'id', ignoreDuplicates: true }).select('*');
  assert.ifError(ins.error);
  const p = { id: randomUUID(), dataUrl: `data:image/jpeg;base64,${JPEG}`, w: 1, h: 1 };
  made.attachments.push(p.id);
  assert.equal((await uploadPhoto(tre, p, new AbortController().signal)).error, null);
  const up = await tre.from('expenses').update({ receipt_id: p.id }).eq('id', id).select('*');
  assert.ifError(up.error);
  assert.equal(up.data[0].receipt_id, p.id);
  // a receipt_id naming a photo that never reached the server is refused (why the expense goes first without it)
  const bad = await tre.from('expenses').update({ receipt_id: randomUUID() }).eq('id', id).select('*');
  console.log('receipt_id of a photo not there', JSON.stringify(shape(bad)));
  assert.equal(bad.error?.code, '23503');
});

test('receipts: someone without « Trésorerie » is refused (a refusal, not the network: the photo is kept, marked)', async () => {
  const p = { id: randomUUID(), dataUrl: `data:image/jpeg;base64,${JPEG}`, w: 1, h: 1 };
  made.attachments.push(p.id);
  const r = await uploadPhoto(meca, p, new AbortController().signal);
  console.log('no right', JSON.stringify(shape(r)));
  assert.equal(r.error?.code, '42501');
  assert.equal(r.status, 403);
});

test('receipts: a try cut off (abort) and no signal at all answer what the phone reads as « try later »', async () => {
  const p = { id: randomUUID(), dataUrl: `data:image/jpeg;base64,${JPEG}`, w: 1, h: 1 };
  made.attachments.push(p.id);
  const ctl = new AbortController();
  ctl.abort();
  let cut;
  try { cut = await uploadPhoto(tre, p, ctl.signal); } catch (e) { cut = { status: 'threw', error: e }; }
  console.log('cut off', JSON.stringify(shape(cut)));
  assert.ok(cut.error, 'an aborted try is an error');
  // no signal: nothing answers on that port
  const dead = createClient('http://127.0.0.1:9', K.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  let none;
  try { none = await uploadPhoto(dead, p, new AbortController().signal); } catch (e) { none = { status: 'threw', error: e }; }
  console.log('no signal', JSON.stringify(shape(none)));
  assert.ok(none.error, 'no signal is an error');
  // the photo never landed: it is not on the server
  assert.equal(await readAttachment(tre, p.id), null);
});
