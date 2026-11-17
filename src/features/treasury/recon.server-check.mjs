// « Rapprochement d'hier » against a REAL server (the local test stack): the calls of ReconPanel.tsx (recon_summary 14,
// recon_now, recon_ack) as a treasurer, and the answer has every field normalizeRecon (src/domain/recon/recon.ts) reads.
// After « Vérifier maintenant » the newest run is TODAY (Montréal): the panel's title follows it (runWhen). Not a unit
// test (vitest does not run it):  SRC=<copy> bash <lane>/api-tests.sh src/features/treasury/recon.server-check.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const GW = process.env.GARAGE_DB_PORT === '54452' ? 54431 : 54331;
const API = `http://127.0.0.1:${GW}`;
const K = JSON.parse(readFileSync(`${process.cwd()}/tests/stack/keys.json`, 'utf8'));
const svc = createClient(API, K.service, { auth: { persistSession: false, autoRefreshToken: false } });
const made = [];
async function member(name, rights) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: 'motdepasse-9', email_confirm: true });
  assert.ifError(error);
  made.push(data.user.id);
  assert.ifError((await svc.from('staff').insert({ id: data.user.id, full_name: name, short_name: name, roles: ['mechanic'], email, rights })).error);
  const c = createClient(API, K.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ifError((await c.auth.signInWithPassword({ email, password: 'motdepasse-9' })).error);
  return c;
}
/** today in Montréal, as lib/dates today() gives it */
const montrealToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

let tre, meca;
before(async () => { tre = await member('Louis', { treasury: true }); meca = await member('Saleh', {}); });
after(async () => {
  await svc.from('staff').delete().in('id', made);
  for (const id of made) await svc.auth.admin.deleteUser(id);
});

test('recon: the treasurer’s summary has every field the panel reads; « Vérifier maintenant » answers today so far', async () => {
  const s = await tre.rpc('recon_summary', { p_days: 14 });
  assert.ifError(s.error);
  for (const k of ['ok', 'can_ack', 'last_run', 'runs', 'findings']) assert.ok(k in s.data, `recon_summary has ${k}`);
  assert.equal(s.data.can_ack, true);
  const now = await tre.rpc('recon_now', {});
  assert.ifError(now.error);
  const last = now.data.last_run;
  if (last) {
    // braked (another run less than a minute ago) it answers the summary as it is; else the newest run is today's
    for (const k of ['day', 'status', 'finished_at', 'counts', 'sheet']) assert.ok(k in last, `last_run has ${k}`);
    assert.match(String(last.day), /^\d{4}-\d{2}-\d{2}/);
    assert.ok(['ok', 'warn', 'bad'].includes(last.status));
    const sh = last.sheet;
    for (const k of ['invoiced_cents', 'received', 'refunded_cents', 'expenses', 'coffre_in_cents', 'coffre_out_cents', 'to_receive_cents']) assert.ok(k in sh, `sheet has ${k}`);
    console.log('after recon_now: last_run.day', last.day, 'Montréal today', montrealToday(), 'runs', now.data.runs.map((r) => r.day).join(','));
    assert.ok(String(last.day).slice(0, 10) <= montrealToday());
    // last_run is the newest run: after the button, today's (so the panel's title must say « aujourd'hui »)
    assert.equal(String(last.day).slice(0, 10), String(now.data.runs[0].day).slice(0, 10));
    if (now.data.runs.length >= 2) assert.equal(String(last.day).slice(0, 10), montrealToday());
  }
  for (const f of now.data.findings) for (const k of ['id', 'check_id', 'severity', 'entity_table', 'entity_id', 'message_fr', 'message_en', 'first_day', 'last_day', 'state', 'note']) assert.ok(k in f, `finding has ${k}`);
  const open = now.data.findings.find((f) => f.state === 'open');
  if (open) {
    const ack = await tre.rpc('recon_ack', { p_finding: open.id, p_note: null });
    assert.ifError(ack.error);
    assert.equal(ack.data.findings.find((f) => f.id === open.id).state, 'acked');
  }
});

test('recon: someone without « Trésorerie » is refused (the panel is not shown to them)', async () => {
  const s = await meca.rpc('recon_summary', { p_days: 14 });
  assert.ok(s.error);
  console.log('no right', JSON.stringify({ code: s.error.code, hint: s.error.hint }));
});
