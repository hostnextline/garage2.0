// « Refonte », the server functions of the field (ring, conversation, enroute, team, hermes, vin, backup, recon): one test
// per bug fixed, on the local copy (real accounts, real sign-in, fake GoHighLevel, Stripe, GitHub). Same helpers as
// functions.test.mjs. Everything made here is removed at the end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from '../stack/node_modules/pg/lib/index.js';

const K = JSON.parse(readFileSync(new URL('../stack/keys.json', import.meta.url)));
const API = 'http://127.0.0.1:54331', MOCK = 'http://127.0.0.1:8021', BASE = 'http://127.0.0.1:4173/';
const db = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 3 });
const made = { users: [], customers: [], trucks: [] };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

async function adminUser(email, password) {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: K.service, authorization: `Bearer ${K.service}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }) });
  const d = await r.json();
  assert.ok(d.id, 'user created: ' + JSON.stringify(d));
  made.users.push(d.id);
  return d.id;
}
async function signIn(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return r.json();
}
async function fn(name, body, jwt) {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt || K.anon}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
}
async function rpc(name, args, jwt) {
  const r = await fetch(`${API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message), d);
  return d;
}
const mockLog = async () => (await fetch(`${MOCK}/log`)).json();
const clearLog = () => fetch(`${MOCK}/log/clear`, { method: 'POST' });
const tokenOf = (link) => /[#&](?:t|suivi|invite)=([\w-]+)/.exec(link)[1];
/** a member of the team with an account, signed in */
async function member(name, roles, extra = {}) {
  const email = extra.email || `${name.toLowerCase().replace(/\W/g, '')}-${randomUUID().slice(0, 6)}@test.local`;
  const id = await adminUser(email, 'motdepasse-9');
  await q(`insert into public.staff (id, full_name, short_name, roles, email, phone, rights) values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, name, name.split(' ')[0], roles, 'staffEmail' in extra ? extra.staffEmail : email, extra.phone || null, JSON.stringify(extra.rights || {})]);
  return { id, email, jwt: (await signIn(email, 'motdepasse-9')).access_token };
}
/** GoHighLevel posting at the garage's address (a call, or a text with « &t=sms ») */
async function ring(key, body, t = '') {
  const r = await fetch(`${API}/functions/v1/ring?k=${key}${t}`, { method: 'POST', headers: { apikey: K.anon, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
}
/** a device that asked for the alert while the app is closed (keys as a browser gives them) */
async function device(staffId, path) {
  const dev = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b64u = (b) => Buffer.from(b).toString('base64url');
  await q(`insert into public.push_subs (staff_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`,
    [staffId, `${MOCK}/push/${path}`, b64u(await crypto.subtle.exportKey('raw', dev.publicKey)), b64u(crypto.getRandomValues(new Uint8Array(16)))]);
}

let owner, ownerJwt;
before(async () => {
  const o = await member('Hassan Jeha', '{owner}');
  owner = o.id; ownerJwt = o.jwt;
  assert.ok(ownerJwt);
  await q(`update public.settings set company = company || '{"name":"Mécanique Mobile H.I.S","phone":"438 901-6606"}'::jsonb where id = 1`);
});
after(async () => {
  await q(`delete from public.trips where staff_id = any($1) or created_by = any($1)`, [made.users]);
  await q(`delete from public.messages where staff_id = any($1) or created_by = any($1) or customer_id = any($2)`, [made.users, made.customers]);
  await q(`delete from public.jobs where customer_id = any($1)`, [made.customers]);
  await q(`delete from public.customers where id = any($1)`, [made.customers]);
  await q(`delete from public.trucks where id = any($1)`, [made.trucks]);
  await q(`delete from public.shifts where staff_id = any($1)`, [made.users]);
  await q(`delete from public.positions where id = any($1)`, [made.users]);
  await q(`delete from public.position_log where staff_id = any($1)`, [made.users]);
  await q(`delete from public.secrets`); await q(`delete from public.invitations`); await q(`delete from public.push_subs`);
  await q(`delete from public.incoming_calls`); await q(`delete from public.incoming_texts`);
  await q(`delete from public.staff where id = any($1)`, [made.users]);
  await q(`delete from auth.users where id = any($1)`, [made.users]);
  await q(`update public.settings set company = '{}'::jsonb where id = 1`);
  await q(`delete from public.op_log`); await q(`delete from public.activity`); await q(`delete from public.rate_limits`);
  await db.end();
});

test('supabase/config.toml names every server function, each with the platform’s token check off', () => {
  const toml = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  const folders = readdirSync(new URL('../../supabase/functions/', import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort();
  const named = [...toml.matchAll(/^\[functions\.([\w-]+)\]\s*\n\s*verify_jwt\s*=\s*(\w+)\s*$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(named.map((n) => n[0]).sort(), folders, 'one [functions.<name>] block per folder of supabase/functions, and none for a folder that is gone');
  assert.ok(named.every((n) => n[1] === 'false'), 'verify_jwt = false for all: each handler checks its caller itself');
  for (const must of ['book', 'conversation', 'hermes', 'ring', 'recon']) assert.ok(folders.includes(must) && named.some((n) => n[0] === must), must);
});

test('« Appel entrant » while the app is closed: a call is also sent as a notification to the devices of the owners who take the calls', async () => {
  const other = await member('Ibrahim Proprio', '{owner}');
  try {
    const a = await fn('ring', { action: 'link' }, ownerJwt);
    const key = new URL(a.url).searchParams.get('k');
    await device(owner, 'appel-1');
    await device(other.id, 'appel-autre');
    // nobody takes the calls: the call is noted, no device is told (the texts' switch is not the calls' switch)
    await q(`update public.staff set prefs = prefs || '{"texts": true}' where id = $1`, [owner]);
    await clearLog();
    assert.equal((await ring(key, { full_name: 'Nadia Roy', phone: '+14385560101' })).ok, true);
    assert.equal((await mockLog()).filter((x) => x.svc === 'push').length, 0);
    // « Recevoir les appels dans mon compte »: his device is told, never the other owner's
    await q(`update public.staff set prefs = prefs || '{"calls": true}' where id = $1`, [owner]);
    assert.equal((await ring(key, { full_name: 'Nadia Roy', phone: '+14385560102' })).ok, true);
    const pushes = (await mockLog()).filter((x) => x.svc === 'push');
    assert.deepEqual(pushes.map((x) => x.path), ['/appel-1']);
    assert.ok(pushes.every((x) => /^vapid t=/.test(x.auth) && x.encoding === 'aes128gcm' && x.bytes > 100), JSON.stringify(pushes));
    assert.deepEqual((await q(`select phone from public.incoming_calls order by phone`)).map((r) => r.phone), ['+14385560101', '+14385560102'], 'both calls are noted');
    // « Essayer »: the pretend call says how many devices were told
    await clearLog();
    const t = await fn('ring', { action: 'test' }, ownerJwt);
    assert.deepEqual([t.ok, t.alerted], [true, 1], JSON.stringify(t));
    assert.equal((await mockLog()).filter((x) => x.svc === 'push').length, 1);
    // a text still goes to those who take the texts
    await clearLog();
    assert.equal((await ring(key, { phone: '+14385560103', message: { body: 'Allo' } }, '&t=sms')).ok, true);
    assert.deepEqual((await mockLog()).filter((x) => x.svc === 'push').map((x) => x.path), ['/appel-1']);
  } finally {
    await q(`update public.staff set prefs = prefs - 'calls' - 'texts' where id = any($1)`, [[owner, other.id]]);
    await q(`delete from public.push_subs`); await q(`delete from public.incoming_calls`); await q(`delete from public.incoming_texts`);
    await q(`delete from public.secrets where key like 'vapid%' or key = 'call_hook'`);
    await q(`delete from public.rate_limits where key like 'ring%'`);
  }
});

test('GoHighLevel delivers the same call or text twice: noted once, announced once; two different texts or pictures stay two', async () => {
  try {
    const a = await fn('ring', { action: 'link' }, ownerJwt);
    const key = new URL(a.url).searchParams.get('k');
    await q(`update public.staff set prefs = prefs || '{"texts": true, "calls": true}' where id = $1`, [owner]);
    await device(owner, 'double-1');
    await clearLog();
    // the same text again (a retry): the second is the first one again
    const one = await ring(key, { full_name: 'Nadia Roy', phone: '+14385560111', message: { body: 'Demain 9 h ?' } }, '&t=sms');
    const two = await ring(key, { full_name: 'Nadia Roy', phone: '+14385560111', message: { body: 'Demain 9 h ?' } }, '&t=sms');
    assert.deepEqual([one.ok, one.again, two.ok, two.again], [true, undefined, true, true], JSON.stringify([one, two]));
    // two automations firing at the same instant
    const both = await Promise.all([1, 2].map(() => ring(key, { phone: '+14385560112', message: { body: 'Oui' } }, '&t=sms')));
    assert.deepEqual(both.map((x) => x.ok), [true, true]);
    assert.equal(both.filter((x) => x.again).length, 1, JSON.stringify(both));
    // other words from the same number, and two pictures with no words (their addresses differ): each one counts
    assert.equal((await ring(key, { phone: '+14385560111', message: { body: 'Finalement 10 h' } }, '&t=sms')).again, undefined);
    assert.equal((await ring(key, { phone: '+14385560113', message: { body: '', attachments: ['https://storage.test/media/a.jpg'] } }, '&t=sms')).again, undefined);
    assert.equal((await ring(key, { phone: '+14385560113', message: { body: '', attachments: ['https://storage.test/media/b.jpg'] } }, '&t=sms')).again, undefined);
    assert.equal((await ring(key, { phone: '+14385560113', message: { body: '', attachments: ['https://storage.test/media/b.jpg'] } }, '&t=sms')).again, true);
    const texts = await q(`select phone, body from public.incoming_texts order by phone, body`);
    assert.deepEqual(texts.map((r) => [r.phone, r.body]), [['+14385560111', 'Demain 9 h ?'], ['+14385560111', 'Finalement 10 h'], ['+14385560112', 'Oui'], ['+14385560113', ''], ['+14385560113', '']]);
    assert.equal((await mockLog()).filter((x) => x.svc === 'push').length, 5, 'one notification per text really received');
    // a call: the same number twice in a row is one call; another number is another call
    await clearLog();
    assert.equal((await ring(key, { phone: '+14385560114', full_name: 'Paul Roy' })).again, undefined);
    assert.equal((await ring(key, { phone: '+14385560114', full_name: 'Paul Roy' })).again, true);
    assert.equal((await ring(key, { phone: '+14385560115' })).again, undefined);
    assert.deepEqual((await q(`select phone from public.incoming_calls order by phone`)).map((r) => r.phone), ['+14385560114', '+14385560115']);
    assert.equal((await mockLog()).filter((x) => x.svc === 'push').length, 2);
    // « Essayer » twice in a row shows the banner twice (it is not GoHighLevel's address)
    await fn('ring', { action: 'test' }, ownerJwt); await fn('ring', { action: 'test' }, ownerJwt);
    assert.equal((await q(`select count(*)::int n from public.incoming_calls where name = 'Client TEST'`))[0].n, 2);
    // a wrong key is refused before anything else, whatever the body
    const bad = await fetch(`${API}/functions/v1/ring?k=${'x'.repeat(32)}&t=sms`, { method: 'POST', headers: { apikey: K.anon, 'content-type': 'application/json' }, body: '{not json' });
    assert.deepEqual([bad.status, (await bad.json()).code], [403, 'bad_key']);
  } finally {
    await q(`update public.staff set prefs = prefs - 'calls' - 'texts' where id = $1`, [owner]);
    await q(`delete from public.push_subs`); await q(`delete from public.incoming_calls`); await q(`delete from public.incoming_texts`);
    await q(`delete from public.secrets where key like 'vapid%' or key = 'call_hook'`);
    await q(`delete from public.rate_limits where key like 'ring%'`);
  }
});

test('the garage’s notification keys are made once: two devices asking at the same instant get the same public key', async () => {
  try {
    await q(`delete from public.secrets where key like 'vapid%'`);
    const keys = await Promise.all([1, 2, 3, 4].map(() => fn('ring', { action: 'push-key' }, ownerJwt)));
    assert.ok(keys.every((k) => k.ok && /^[\w-]{80,}$/.test(k.key)), JSON.stringify(keys));
    const kept = (await q(`select value from public.secrets where key = 'vapid_public'`))[0].value;
    assert.deepEqual(keys.map((k) => k.key), [kept, kept, kept, kept], 'every device holds the key the server signs with');
  } finally {
    await q(`delete from public.secrets where key like 'vapid%'`);
  }
});

/* ---------- the backup function: the heartbeat, the accounts, the repository's numbers ---------- */
const ticket = async (o = {}) => (await (await fetch(`${MOCK}/github/token?${new URLSearchParams(o)}`)).json()).value;
async function oidc(name, body, t) {
  const r = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: K.anon, ...(t ? { 'x-github-oidc': t } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
}

test('the nightly backup says « done »: one row in ops_backup_runs (GitHub ticket only, whole numbers only, said twice = once); the table is backed up and closed to the app', async () => {
  try {
    const good = await ticket();
    const night = { action: 'done', tables: 34, rows: 18412, commit: 'A1B2C3D4E5F60718293A4B5C6D7E8F9001122334' };
    // refused: no ticket, another repository
    assert.equal((await oidc('backup', night)).status, 401);
    assert.equal((await oidc('backup', night, await ticket({ repository: 'quelquun/autre' }))).status, 403);
    // refused: what is not a whole number, a commit that is not one
    for (const wrong of [{ tables: -1 }, { tables: 3.5 }, { rows: 'beaucoup' }, { rows: null }, { commit: 'pas un commit' }, { commit: { $ne: 1 } }]) {
      const r = await oidc('backup', { ...night, ...wrong }, good);
      assert.deepEqual([r.status, r.code], [400, 'bad_run'], JSON.stringify(wrong));
    }
    assert.equal((await q(`select count(*)::int n from public.ops_backup_runs`))[0].n, 0, 'nothing written by a refused call');
    // the night is recorded
    const d = await oidc('backup', night, good);
    assert.equal(d.ok, true, JSON.stringify(d));
    const rows = await q(`select id, tables, rows::text, commit, ok, at > now() - interval '1 minute' as fresh from public.ops_backup_runs`);
    assert.deepEqual(rows, [{ id: d.id, tables: 34, rows: '18412', commit: night.commit.toLowerCase(), ok: true, fresh: true }]);
    // said again (the job tries again when the answer is lost): the same row
    const again = await oidc('backup', night, good);
    assert.deepEqual([again.ok, again.id, again.again], [true, d.id, true], JSON.stringify(again));
    assert.equal((await q(`select count(*)::int n from public.ops_backup_runs`))[0].n, 1);
    // a night that failed is recorded as such
    assert.equal((await oidc('backup', { action: 'done', tables: 12, rows: 300, commit: null, ok: false }, good)).ok, true);
    assert.deepEqual((await q(`select tables, ok, commit from public.ops_backup_runs where not ok`)), [{ tables: 12, ok: false, commit: null }]);
    // the table is part of the backup; the app itself cannot read or write it, not even the owner
    const list = await oidc('backup', { action: 'tables' }, good);
    assert.equal(list.tables.find((t) => t.name === 'ops_backup_runs')?.count, 2, JSON.stringify(list).slice(0, 300));
    assert.equal((await oidc('backup', { action: 'rows', table: 'ops_backup_runs', from: 0 }, good)).rows.length, 2);
    const direct = await fetch(`${API}/rest/v1/ops_backup_runs?select=id`, { headers: { apikey: K.anon, authorization: `Bearer ${ownerJwt}` } });
    assert.ok(direct.status === 401 || direct.status === 403, 'no direct access: ' + direct.status);
    const write = await fetch(`${API}/rest/v1/ops_backup_runs`, { method: 'POST', headers: { apikey: K.anon, authorization: `Bearer ${ownerJwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ tables: 1, rows: 1 }) });
    assert.ok(write.status === 401 || write.status === 403, 'no direct write: ' + write.status);
  } finally {
    await q(`delete from public.ops_backup_runs`);
  }
});

test('the backup knows who has an account (id and e-mail, never a password): what a restore into a new project needs', async () => {
  assert.equal((await oidc('backup', { action: 'accounts' })).status, 401);
  const a = await oidc('backup', { action: 'accounts' }, await ticket());
  assert.equal(a.ok, true, JSON.stringify(a).slice(0, 300));
  const mine = a.accounts.find((x) => x.id === owner);
  assert.ok(mine && /@test\.local$/.test(mine.email), 'the owner’s account, with the same id as his staff row');
  assert.ok(a.accounts.every((x) => Object.keys(x).sort().join() === 'banned_until,created_at,email,id'), 'only these four fields');
  assert.ok(!/password|encrypted|token/i.test(JSON.stringify(a)), 'nothing secret');
  // a person removed from the team is said to be banned (the restore must not let him back in)
  const gone = await member('Parti Mécano', '{mechanic}');
  assert.equal((await fn('team', { action: 'remove', staff_id: gone.id }, ownerJwt)).ok, true);
  const b = await oidc('backup', { action: 'accounts' }, await ticket());
  assert.ok(b.accounts.find((x) => x.id === gone.id).banned_until, 'banned');
  assert.equal(b.accounts.find((x) => x.id === owner).banned_until, null);
});

test('the backup repository is known by its numbers, not only by its name: a repository that took the name is refused', async () => {
  const pin = 'backup_repo:hostnextline/garage2.0-sauvegardes';
  try {
    // a ticket without numbers (the tests' pretend GitHub) pins nothing
    assert.equal((await oidc('backup', { action: 'tables' }, await ticket())).ok, true);
    assert.equal((await q(`select count(*)::int n from public.secrets where key = $1`, [pin]))[0].n, 0);
    // the numbers of the real repository are known: the right name with other numbers (or none) is refused, for every action
    await q(`insert into public.secrets (key, value) values ($1, '987654321:123456')`, [pin]);
    for (const [name, body] of [['backup', { action: 'tables' }], ['backup', { action: 'rows', table: 'customers' }], ['backup', { action: 'done', tables: 1, rows: 1 }], ['recon', { action: 'run' }]]) {
      const r = await oidc(name, body, await ticket());
      assert.deepEqual([r.status, r.code], [403, 'not_allowed'], name + ' ' + JSON.stringify(body) + ' → ' + JSON.stringify(r));
      assert.match(r.error, /plus le même dépôt/);
    }
    assert.equal((await q(`select count(*)::int n from public.ops_backup_runs`))[0].n, 0);
    // the owner accepts a new repository by removing the row
    await q(`delete from public.secrets where key = $1`, [pin]);
    assert.equal((await oidc('backup', { action: 'tables' }, await ticket())).ok, true);
  } finally {
    await q(`delete from public.secrets where key = $1`, [pin]);
    await q(`delete from public.ops_backup_runs`);
  }
});

/* ---------- the daily reconciliation (function « recon ») ----------
   Its SQL half (recon_run, recon_add, recon_summary, recon_ack) is written by the reconciliation engineer the same night.
   While this database does not have it, the test puts stand-ins that follow the agreed contract, and removes them at the
   end; once both halves are merged, the same test runs against the real ones (it only asserts what the contract says). */
const RECON_STUB = `
  create schema recon_stub;
  create table recon_stub.runs (id uuid primary key default gen_random_uuid(), day date, source text);
  create table recon_stub.findings (id uuid primary key default gen_random_uuid(), run uuid, chk text, severity text, entity_table text, entity_id uuid, fr text, en text, data jsonb, note text, acked boolean default false);
  create function public.recon_run(p_day date, p_source text) returns jsonb language plpgsql security definer set search_path = public as $f$
    declare v uuid; begin insert into recon_stub.runs (day, source) values (p_day, p_source) returning id into v;
    return jsonb_build_object('run_id', v, 'day', p_day, 'status', 'ok', 'counts', jsonb_build_object('bad', 0, 'warn', 0, 'info', 0)); end $f$;
  create function public.recon_add(p_run uuid, p_check text, p_severity text, p_entity_table text, p_entity_id uuid, p_message_fr text, p_message_en text, p_data jsonb) returns uuid language plpgsql security definer set search_path = public as $f$
    declare v uuid; begin insert into recon_stub.findings (run, chk, severity, entity_table, entity_id, fr, en, data) values (p_run, p_check, p_severity, p_entity_table, p_entity_id, p_message_fr, p_message_en, p_data) returning id into v; return v; end $f$;
  create function public.recon_summary(p_days int) returns jsonb language sql security definer set search_path = public as $f$
    select jsonb_build_object('days', p_days, 'runs', (select count(*) from recon_stub.runs), 'open', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from recon_stub.findings f where not f.acked)) $f$;
  create function public.recon_ack(p_finding uuid, p_note text) returns jsonb language plpgsql security definer set search_path = public as $f$
    begin update recon_stub.findings set acked = true, note = p_note where id = p_finding; if not found then perform public.fail('not_found', 'Cet écart n’existe plus.'); end if; return jsonb_build_object('ok', true); end $f$;
  revoke all on function public.recon_run(date, text), public.recon_add(uuid, text, text, text, uuid, text, text, jsonb), public.recon_summary(int), public.recon_ack(uuid, text) from public, anon, authenticated;
  grant execute on function public.recon_run(date, text), public.recon_add(uuid, text, text, text, uuid, text, text, jsonb), public.recon_summary(int), public.recon_ack(uuid, text) to service_role;
  notify pgrst, 'reload schema';`;
const RECON_UNSTUB = `drop function if exists public.recon_run(date, text), public.recon_add(uuid, text, text, text, uuid, text, text, jsonb), public.recon_summary(int), public.recon_ack(uuid, text);
  drop schema if exists recon_stub cascade; notify pgrst, 'reload schema';`;

test('« Rapprochement quotidien » (recon): run by the backup job or by the owner / the Trésorerie; Stripe skipped and said so when not connected; the last good backup must be younger than 26 hours; last and ack', async (t) => {
  const real = (await q(`select to_regprocedure('public.recon_run(date,text)') is not null as there`))[0].there;
  const stub = !real;
  if (stub) {
    t.diagnostic('the reconciliation’s SQL is not in this database yet: stand-ins that follow the contract are used');
    await db.query(RECON_STUB);
  }
  const meca = await member('Adam Mécano', '{mechanic}');
  const tres = await member('Tina Trésor', '{treasurer}');
  const day = (await q(`select (public.local_today() - 1)::text d, (public.local_today() + 1)::text demain`))[0];
  const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
  try {
    // the server's API learns the new functions (a moment after the stand-ins are made)
    for (let i = 0; i < 50; i++) { const r = await fn('recon', { action: 'last' }, ownerJwt); if (r.code !== 'not_ready') break; await new Promise((ok) => setTimeout(ok, 200)); }
    await q(`delete from public.secrets where key like 'stripe%'`);
    await q(`delete from public.ops_backup_runs`);
    // who may: not a visitor, not a mechanic; the owner and the Trésorerie; an unknown action or a bad day is refused
    assert.equal((await fn('recon', { action: 'run' })).status, 401);
    assert.deepEqual([(await fn('recon', { action: 'run' }, meca.jwt)).code, (await fn('recon', { action: 'last' }, meca.jwt)).code, (await fn('recon', { action: 'ack', finding: randomUUID() }, meca.jwt)).code], ['not_allowed', 'not_allowed', 'not_allowed']);
    assert.equal((await fn('recon', { action: 'efface-tout' }, ownerJwt)).code, 'action');
    assert.equal((await fn('recon', { action: 'run', day: 'hier' }, ownerJwt)).code, 'bad_day');
    assert.equal((await fn('recon', { action: 'run', day: '2026-02-31' }, ownerJwt)).code, 'bad_day');
    assert.equal((await fn('recon', { action: 'run', day: day.demain }, ownerJwt)).code, 'bad_day');
    assert.equal((await fn('recon', { action: 'ack', finding: 'pas-un-numero' }, ownerJwt)).code, 'not_found');
    // the owner: yesterday by default; Stripe is not connected (skipped, and said so); no backup ever said « done »: bad
    const r1 = await fn('recon', { action: 'run' }, ownerJwt);
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.ok(isUuid(r1.run.run_id) && 'status' in r1.run && 'counts' in r1.run, JSON.stringify(r1.run));
    assert.equal(String(r1.run.day).slice(0, 10), day.d, 'yesterday, in Montréal');
    assert.deepEqual([r1.outside.stripe.status, r1.outside.backup.status], ['off', 'none']);
    assert.match(r1.outside.stripe.note, /Stripe n’est pas branché/);
    assert.deepEqual(r1.added.map((a) => [a.check, a.severity, a.entity_table]), [['backup_late', 'bad', 'ops_backup_runs']]);
    assert.ok(isUuid(r1.added[0].id), 'the finding has its id');
    assert.deepEqual([r1.bad, r1.status], [true, 'bad'], 'no backup = the nightly job must end red');
    // the backup job says « done »: the next run finds it (the job itself runs it, with its GitHub ticket)
    assert.equal((await oidc('backup', { action: 'done', tables: 34, rows: 5000, commit: 'abcdef1' }, await ticket())).ok, true);
    const r2 = await oidc('recon', { action: 'run' }, await ticket());
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.deepEqual([r2.outside.backup.status, r2.outside.backup.commit, r2.added.filter((a) => a.check === 'backup_late').length], ['ok', 'abcdef1', 0]);
    if (stub) assert.deepEqual([r2.bad, r2.status], [false, 'ok']);
    // the job runs it and nothing else; a ticket of another repository is refused
    assert.deepEqual([(await oidc('recon', { action: 'last' }, await ticket())).code, (await oidc('recon', { action: 'ack', finding: r1.added[0].id }, await ticket())).code], ['not_allowed', 'not_allowed']);
    assert.equal((await oidc('recon', { action: 'run' }, await ticket({ repository: 'quelquun/autre' }))).status, 403);
    // 25 hours old: still fine; 27 hours: late, said with the hours; a failed night does not count as a backup
    await q(`update public.ops_backup_runs set at = now() - interval '25 hours'`);
    assert.equal((await fn('recon', { action: 'run', day: day.d }, tres.jwt)).outside.backup.status, 'ok', 'the Trésorerie may run it too');
    await q(`update public.ops_backup_runs set at = now() - interval '27 hours'`);
    await q(`insert into public.ops_backup_runs (tables, rows, ok) values (3, 10, false)`);
    const r3 = await fn('recon', { action: 'run' }, ownerJwt);
    assert.equal(r3.outside.backup.status, 'late', JSON.stringify(r3.outside));
    const late = r3.added.find((a) => a.check === 'backup_late');
    assert.deepEqual([late.severity, r3.bad], ['bad', true]);
    assert.match(late.message_fr, /27 heures/); assert.match(late.message_en, /27 hours/);
    // last: the summary of the database; ack: a finding noted as seen
    const last = await fn('recon', { action: 'last', days: 3 }, ownerJwt);
    assert.equal(last.ok, true, JSON.stringify(last).slice(0, 300));
    assert.ok(last.summary && typeof last.summary === 'object');
    const ack = await fn('recon', { action: 'ack', finding: late.id, note: 'Vu, la sauvegarde est relancée.' }, ownerJwt);
    assert.equal(ack.ok, true, JSON.stringify(ack));
    if (stub) {
      assert.deepEqual((await q(`select source, count(*)::int n from recon_stub.runs group by source order by source`)), [{ source: 'app', n: 3 }, { source: 'backup', n: 1 }]);
      assert.deepEqual((await q(`select acked, note from recon_stub.findings where id = $1`, [late.id])), [{ acked: true, note: 'Vu, la sauvegarde est relancée.' }]);
      assert.equal(last.summary.days, 3);
      assert.equal((await fn('recon', { action: 'ack', finding: randomUUID() }, ownerJwt)).code, 'not_found', 'the database’s own refusal comes out with its code');
    }
    // Stripe connected. The tests' pretend Stripe may not list its checkout pages yet: then the check says it could not be
    // done (a finding to look at, never a crash); when it does list them, money taken without its payment row is « bad ».
    await q(`insert into public.secrets (key, value) values ('stripe_key', 'sk_test_abcdefghijklmnop') on conflict (key) do update set value = excluded.value`);
    await q(`update public.ops_backup_runs set at = now() where ok`);
    const sk = { authorization: 'Bearer sk_test_abcdefghijklmnop', 'content-type': 'application/x-www-form-urlencoded' };
    const lists = (await fetch(`${MOCK}/stripe/v1/checkout/sessions?limit=1`, { headers: sk })).ok;
    if (!lists) {
      t.diagnostic('the pretend Stripe does not list checkout sessions: only the handled failure is checked (see the request to add it to tests/stack/mocks.mjs)');
      const r4 = await fn('recon', { action: 'run' }, ownerJwt);
      assert.equal(r4.ok, true, JSON.stringify(r4));
      assert.equal(r4.outside.stripe.status, 'error');
      assert.deepEqual(r4.added.map((a) => [a.check, a.severity]), [['stripe_unreachable', 'warn']]);
      assert.equal(r4.bad, r4.run.status === 'bad', 'a check that could not be done is not « bad » by itself');
    } else {
      const cust = randomUUID(); made.customers.push(cust);
      await q(`insert into public.customers (id, first_name, phone) values ($1, 'Carte', '438 556-0190')`, [cust]);
      const job = randomUUID();
      await q(`insert into public.jobs (id, customer_id, day, block, status, duration_min) values ($1, $2, public.local_today(), 'am', 'booked', 60)`, [job, cust]);
      const open = async (cents, md) => (await (await fetch(`${MOCK}/stripe/v1/checkout/sessions`, { method: 'POST', headers: sk,
        body: new URLSearchParams({ 'line_items[0][price_data][unit_amount]': String(cents), ...Object.fromEntries(Object.entries(md).map(([k, v]) => [`metadata[${k}]`, v])) }) })).json()).id;
      const paidNoRow = await open(11498, { job_id: job }), paidWrong = await open(5000, { job_id: job }), paidRight = await open(2500, { job_id: job });
      const notPaid = await open(9900, { job_id: job }), notOurs = await open(4200, {});
      for (const id of [paidNoRow, paidWrong, paidRight, notOurs]) await fetch(`${MOCK}/pay/${id}`);   // paid at Stripe (the notice is refused: no webhook secret here)
      await q(`delete from public.payments where job_id = $1`, [job]);
      await q(`insert into public.payments (job_id, amount_cents, method, stripe_session) values ($1, 4000, 'card_online', $2), ($1, 2500, 'card_online', $3)`, [job, paidWrong, paidRight]);
      const r4 = await fn('recon', { action: 'run' }, ownerJwt);
      assert.equal(r4.ok, true, JSON.stringify(r4));
      assert.deepEqual([r4.outside.stripe.status, r4.outside.stripe.missing, r4.outside.stripe.wrong], ['ok', 1, 1], JSON.stringify(r4.outside.stripe));
      assert.deepEqual(r4.added.map((a) => [a.check, a.severity, a.entity_table, a.entity_id]).sort(), [['stripe_amount', 'bad', 'jobs', job], ['stripe_paid_not_recorded', 'bad', 'jobs', job]]);
      assert.match(r4.added.find((a) => a.check === 'stripe_paid_not_recorded').message_fr, /114,98 \$/);
      assert.match(r4.added.find((a) => a.check === 'stripe_amount').message_fr, /50,00 \$.+40,00 \$/);
      assert.equal(r4.bad, true);
      void notPaid;
      // the payment is written (and the other corrected): nothing left to say
      await q(`insert into public.payments (job_id, amount_cents, method, stripe_session) values ($1, 11498, 'card_online', $2)`, [job, paidNoRow]);
      await q(`update public.payments set amount_cents = 5000 where stripe_session = $1`, [paidWrong]);
      const r5 = await fn('recon', { action: 'run' }, ownerJwt);
      assert.deepEqual([r5.outside.stripe.status, r5.outside.stripe.missing, r5.outside.stripe.wrong, r5.added.length], ['ok', 0, 0, 0], JSON.stringify(r5));
      await q(`delete from public.payments where job_id = $1`, [job]);
    }
  } finally {
    await q(`delete from public.ops_backup_runs`);
    await q(`delete from public.secrets where key like 'stripe%'`);
    await q(`delete from public.rate_limits where key = 'recon:run'`);
    if (stub) await db.query(RECON_UNSTUB);
  }
});

/* ---------- « Je pars »: whose trip, two at once, the way back sent twice ---------- */
async function enrouteSetup(driverId) {
  const dow = (await q(`select extract(dow from public.local_today())::int d`))[0].d;
  const truck = randomUUID(); made.trucks.push(truck);
  await q(`insert into public.trucks (id, name, active, driver_id) values ($1, 'Voiture test', true, $2)`, [truck, driverId]);
  await q(`insert into public.truck_week (truck_id, dow, ranges) values ($1, $2, '[[0,1440]]')`, [truck, dow]);
  const cust = randomUUID(); made.customers.push(cust);
  await q(`insert into public.customers (id, first_name, phone, lat, lng) values ($1, 'Lina', '438 556-0170', 45.53, -73.61)`, [cust]);
  return { truck, cust };
}
async function enrouteJob(cust, truck, createdBy, status = 'en_route') {
  const job = randomUUID();
  await q(`insert into public.jobs (id, customer_id, day, block, truck_id, status, duration_min, created_by) values ($1, $2, public.local_today(), 'am', $3, $4, 60, $5)`, [job, cust, truck, status, createdBy]);
  return job;
}

test('« Je pars »: the trip, the name in the text and the map are those of the person who leaves, not of the truck’s named driver; the office pressing for the driver uses HIS position; the job’s rows come back', async () => {
  const adam = await member('Adam Partant', '{mechanic}');
  const bilal = await member('Bilal Chauffeur', '{mechanic}');
  const { truck, cust } = await enrouteSetup(bilal.id);
  // Adam takes Bilal's vehicle today (shared routes, or the job is his): he taps « Je pars »
  const job = await enrouteJob(cust, truck, adam.id);
  await rpc('shift_start', {}, adam.jwt);   // his day started: his phone sends its position
  await clearLog();
  const r = await fn('enroute', { action: 'start', job_id: job, base: BASE, pos: { lat: 45.50, lng: -73.66 } }, adam.jwt);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.message, /Adam/, 'the text names the one who leaves');
  assert.doesNotMatch(r.message, /Bilal/);
  assert.equal((await q(`select staff_id from public.trips where job_id = $1 and status = 'active'`, [job]))[0].staff_id, adam.id);
  const t = await rpc('public_track', { p_token: tokenOf(r.link) }, K.anon);
  assert.equal(t.mechanic, 'Adam', 'the customer follows Adam');
  assert.ok(t.pos && Math.abs(t.pos.lat - 45.50) < 1e-6, 'and Adam’s phone: ' + JSON.stringify(t.pos));
  // the job's rows as they are now (they used to be always empty: job_payload is kept for the server)
  assert.ok(r.rows && Array.isArray(r.rows.jobs) && r.rows.jobs[0]?.id === job && r.rows.trips.length === 1, 'rows: ' + JSON.stringify(r.rows).slice(0, 200));
  // the owner, at the office, presses for Bilal's job: Bilal leaves; the arrival time is worked out from where BILAL is,
  // never from the office's phone, and the office's position is not taken as the truck's
  const job2 = await enrouteJob(cust, truck, owner);
  await q(`insert into public.positions (id, lat, lng, at) values ($1, 45.52, -73.60, now()) on conflict (id) do update set lat = 45.52, lng = -73.60, at = now(), deleted_at = null`, [bilal.id]);
  await clearLog();
  const o = await fn('enroute', { action: 'start', job_id: job2, base: BASE, pos: { lat: 45.40, lng: -73.90 } }, ownerJwt);
  assert.equal(o.ok, true, JSON.stringify(o));
  assert.match(o.message, /Bilal/);
  assert.equal((await q(`select staff_id from public.trips where job_id = $1 and status = 'active'`, [job2]))[0].staff_id, bilal.id);
  const osrm = (await mockLog()).filter((x) => x.svc === 'osrm');
  assert.deepEqual(osrm.map((x) => x.pts[0]), [[-73.60, 45.52]], 'the route starts where Bilal is');
  assert.equal((await q(`select count(*)::int n from public.positions where id = $1`, [owner]))[0].n, 0, 'the office is not on the map');
  // naming who leaves: the owner may name Adam; a mechanic may not leave in somebody else's name
  const job3 = await enrouteJob(cust, truck, adam.id);
  assert.deepEqual([(await fn('enroute', { action: 'start', job_id: job3, base: BASE, driver_id: bilal.id }, adam.jwt)).code], ['not_allowed']);
  const named = await fn('enroute', { action: 'start', job_id: job3, base: BASE, driver_id: adam.id }, ownerJwt);
  assert.equal(named.ok, true, JSON.stringify(named));
  assert.equal((await q(`select staff_id from public.trips where job_id = $1 and status = 'active'`, [job3]))[0].staff_id, adam.id);
  assert.equal((await fn('enroute', { action: 'start', job_id: job3, base: BASE, driver_id: randomUUID() }, ownerJwt)).code, 'not_found');
});

test('« Je pars » pressed on two phones at the same instant: one trip, one text, both answers ok (no « server problem »)', async () => {
  const adam = await member('Adam Double', '{mechanic}');
  const { truck, cust } = await enrouteSetup(adam.id);
  await q(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  try {
    for (let round = 0; round < 3; round++) {
      const job = await enrouteJob(cust, truck, adam.id);
      await clearLog();
      const both = await Promise.all([1, 2].map(() => fn('enroute', { action: 'start', job_id: job, base: BASE, pos: { lat: 45.50, lng: -73.66 } }, adam.jwt)));
      assert.deepEqual(both.map((x) => [x.status, x.ok]), [[200, true], [200, true]], JSON.stringify(both));
      assert.deepEqual(both.map((x) => x.sms).sort(), ['already', 'sent'], JSON.stringify(both.map((x) => x.sms)));
      assert.equal((await q(`select count(*)::int n from public.trips where job_id = $1`, [job]))[0].n, 1);
      assert.equal((await mockLog()).filter((x) => x.svc === 'ghl' && x.path === '/conversations/messages').length, 1, 'one text');
    }
  } finally {
    await q(`delete from public.secrets where key like 'ghl%'`);
  }
});

test('« Je pars vers la Centrale » sent twice with the same operation id (a lost answer, then a second tap): one trip, one text, the first link keeps working; after a failed text the same id tries again', async () => {
  const adam = await member('Adam Retour', '{mechanic}');
  const [{ booking: before }] = await q(`select booking from public.settings where id = 1`);
  await q(`update public.settings set booking = booking || jsonb_build_object('return_phone', '514 771-4243',
    'home', jsonb_build_object('label', 'Centrale', 'address', '1401 rue Legendre O, Montréal', 'lat', 45.5312898, 'lng', -73.6544639)) where id = 1`);
  await q(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  const texts = async () => (await mockLog()).filter((x) => x.svc === 'ghl' && x.path === '/conversations/messages').length;
  try {
    const op = randomUUID();
    await clearLog();
    const one = await fn('enroute', { action: 'return', base: BASE, pos: { lat: 45.50, lng: -73.66 }, op }, adam.jwt);
    assert.deepEqual([one.ok, one.sms], [true, 'sent'], JSON.stringify(one));
    const two = await fn('enroute', { action: 'return', base: BASE, pos: { lat: 45.50, lng: -73.66 }, op }, adam.jwt);
    assert.deepEqual([two.ok, two.sms, two.again, two.rows.trips.length], [true, 'already', true, 1], JSON.stringify(two));
    assert.equal(await texts(), 1, 'one text');
    assert.equal((await rpc('public_track', { p_token: tokenOf(one.link) }, K.anon)).status, 'active', 'the link of the first text still works');
    assert.equal((await q(`select count(*)::int n from public.trips where staff_id = $1 and kind = 'return'`, [adam.id]))[0].n, 1);
    assert.deepEqual(await q(`select status, kind from public.messages where id = $1`, [op]), [{ status: 'sent', kind: 'return_trip' }]);
    // at the same instant, a new id: one of them makes the trip
    const op2 = randomUUID();
    await clearLog();
    const par = await Promise.all([1, 2].map(() => fn('enroute', { action: 'return', base: BASE, pos: { lat: 45.51, lng: -73.65 }, op: op2 }, adam.jwt)));
    assert.deepEqual(par.map((x) => x.sms).sort(), ['already', 'sent'], JSON.stringify(par));
    assert.equal(await texts(), 1);
    // without an id (yesterday's app): as before, each tap is a new trip back
    const plain = await fn('enroute', { action: 'return', base: BASE, pos: { lat: 45.51, lng: -73.65 } }, adam.jwt);
    assert.deepEqual([plain.ok, plain.sms], [true, 'sent']);
    // the text fails (GoHighLevel refuses): the same id again sends it
    await fetch(`${MOCK}/control?ghl=fail`);
    const op3 = randomUUID();
    const bad = await fn('enroute', { action: 'return', base: BASE, pos: { lat: 45.51, lng: -73.65 }, op: op3 }, adam.jwt);
    assert.equal(bad.sms, 'error', JSON.stringify(bad));
    await fetch(`${MOCK}/control?ghl=ok`);
    const retry = await fn('enroute', { action: 'return', base: BASE, pos: { lat: 45.51, lng: -73.65 }, op: op3 }, adam.jwt);
    assert.deepEqual([retry.ok, retry.sms], [true, 'sent'], JSON.stringify(retry));
    assert.deepEqual(await q(`select status from public.messages where id = $1`, [op3]), [{ status: 'sent' }]);
    // an id that is not one, or used by another person
    assert.equal((await fn('enroute', { action: 'return', base: BASE, op: 'abc' }, adam.jwt)).code, 'bad_op');
    assert.equal((await fn('enroute', { action: 'return', base: BASE, op }, ownerJwt)).code, 'op_reused');
  } finally {
    await fetch(`${MOCK}/control?ghl=ok`);
    await q(`update public.settings set booking = $1 where id = 1`, [before]);
    await q(`delete from public.secrets where key like 'ghl%'`);
  }
});

/* ---------- the conversation: a text sent twice with the same operation id; the pretend number ---------- */
test('conversation « send » with an operation id: the same text tapped twice (or at the same instant) leaves once; after a failure it goes on the next try; the « Essayer » number is never texted', async () => {
  const cust = randomUUID(); made.customers.push(cust);
  await q(`insert into public.customers (id, first_name, phone) values ($1, 'Rima', '438 556-0180')`, [cust]);
  await q(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  const texts = async () => (await mockLog()).filter((x) => x.svc === 'ghl' && x.path === '/conversations/messages').length;
  try {
    await clearLog();
    const op = randomUUID();
    const one = await fn('conversation', { action: 'send', customer_id: cust, message: 'On arrive vers 10 h.', op }, ownerJwt);
    assert.deepEqual([one.ok, one.status], [true, 'sent'], JSON.stringify(one));
    const two = await fn('conversation', { action: 'send', customer_id: cust, message: 'On arrive vers 10 h.', op }, ownerJwt);
    assert.deepEqual([two.ok, two.status, two.again], [true, 'sent', true], JSON.stringify(two));
    assert.equal(await texts(), 1, 'the customer gets it once');
    assert.deepEqual(await q(`select status, body, customer_id from public.messages where id = $1`, [op]), [{ status: 'sent', body: 'On arrive vers 10 h.', customer_id: cust }]);
    // at the same instant
    await clearLog();
    const op2 = randomUUID();
    const par = await Promise.all([1, 2].map(() => fn('conversation', { action: 'send', customer_id: cust, message: 'Merci !', op: op2 }, ownerJwt)));
    assert.equal(await texts(), 1, JSON.stringify(par));
    assert.equal(par.filter((x) => x.again).length, 1);
    assert.equal((await q(`select count(*)::int n from public.messages where body = 'Merci !'`))[0].n, 1);
    // GoHighLevel refuses: the same id again sends it (still one row)
    await fetch(`${MOCK}/control?ghl=fail`);
    const op3 = randomUUID();
    assert.equal((await fn('conversation', { action: 'send', customer_id: cust, message: 'Encore là ?', op: op3 }, ownerJwt)).status, 'error');
    await fetch(`${MOCK}/control?ghl=ok`);
    assert.equal((await fn('conversation', { action: 'send', customer_id: cust, message: 'Encore là ?', op: op3 }, ownerJwt)).status, 'sent');
    assert.deepEqual(await q(`select status from public.messages where body = 'Encore là ?'`), [{ status: 'sent' }]);
    // without an id: as before (each tap sends)
    await clearLog();
    assert.equal((await fn('conversation', { action: 'send', customer_id: cust, message: 'Sans numéro' }, ownerJwt)).status, 'sent');
    assert.equal(await texts(), 1);
    // the pretend number of « Essayer » (Client TEST): nobody is behind it
    await clearLog();
    const test = await fn('conversation', { action: 'send', phone: '+15145550100', message: 'Bonjour' }, ownerJwt);
    assert.deepEqual([test.status, test.code], [400, 'test_number']);
    assert.equal(await texts(), 0);
  } finally {
    await fetch(`${MOCK}/control?ghl=ok`);
    await q(`delete from public.secrets where key like 'ghl%'`);
  }
});

/* ---------- the team: links of a removed person, « Mot de passe oublié », what the owner types ---------- */
test('a new-password link stops working once the person is removed (it used to lift his ban); removing someone cancels his links', async () => {
  const gone = await member('Sami Parti', '{mechanic}');
  const link = await fn('team', { action: 'reset-link', staff_id: gone.id, send: 'none', base: BASE }, ownerJwt);
  assert.equal(link.ok, true, JSON.stringify(link));
  // removed by another way than « Retirer » (the database rule alone): the old link is refused, the ban stays
  await q(`update public.staff set active = false, deleted_at = now() where id = $1`, [gone.id]);
  await q(`update auth.users set banned_until = now() + interval '100 years' where id = $1`, [gone.id]);
  const r = await fn('team', { action: 'invite-accept', token: tokenOf(link.link), password: 'nouveau-mot-9' });
  assert.deepEqual([r.ok, r.code], [false, 'used'], JSON.stringify(r));
  assert.ok((await q(`select banned_until from auth.users where id = $1`, [gone.id]))[0].banned_until, 'still banned');
  assert.equal((await signIn(gone.email, 'nouveau-mot-9')).access_token, undefined, 'cannot sign in');
  // « Retirer »: the links he holds are cancelled at once
  const gone2 = await member('Rami Parti', '{mechanic}');
  const link2 = await fn('team', { action: 'reset-link', staff_id: gone2.id, send: 'none', base: BASE }, ownerJwt);
  assert.equal((await fn('team', { action: 'remove', staff_id: gone2.id }, ownerJwt)).ok, true);
  assert.equal((await fn('team', { action: 'invite-info', token: tokenOf(link2.link) })).code, 'used');
  // a person still on the team: his link works as before
  const here = await member('Nora Ici', '{office}');
  const link3 = await fn('team', { action: 'reset-link', staff_id: here.id, send: 'none', base: BASE }, ownerJwt);
  assert.equal((await fn('team', { action: 'invite-accept', token: tokenOf(link3.link), password: 'nouveau-mot-9' })).ok, true);
  assert.ok((await signIn(here.email, 'nouveau-mot-9')).access_token);
});

test('« Mot de passe oublié »: finds the account whatever the capital letters; never cancels the link the owner just made; the owner’s link for a person with no e-mail is a clear refusal', async () => {
  const mixed = await member('Lea Majuscule', '{office}', { staffEmail: null });
  const typed = `Lea.Maj-${randomUUID().slice(0, 4)}@Test.Local`;
  await q(`update public.staff set email = $1 where id = $2`, [typed, mixed.id]);
  // the owner has a link without e-mail: refused with a word, not « server problem »
  const none = await fn('team', { action: 'reset-link', staff_id: mixed.id, send: 'none', base: BASE }, ownerJwt);
  assert.equal(none.ok, true, 'her file has an e-mail: ' + JSON.stringify(none));
  const noMail = await member('Sans Courriel', '{mechanic}', { staffEmail: null });
  const r0 = await fn('team', { action: 'reset-link', staff_id: noMail.id, send: 'none', base: BASE }, ownerJwt);
  assert.deepEqual([r0.status, r0.code], [400, 'no_email'], JSON.stringify(r0));
  // somebody types her address in « Mot de passe oublié » (in lower case): a link is made for her...
  const before = (await q(`select count(*)::int n from public.invitations where kind = 'reset' and lower(email) = lower($1)`, [typed]))[0].n;
  assert.equal((await fn('team', { action: 'forgot', email: typed.toLowerCase(), base: BASE })).ok, true);
  assert.equal((await q(`select count(*)::int n from public.invitations where kind = 'reset' and lower(email) = lower($1)`, [typed]))[0].n, before + 1, 'found despite the capitals');
  // ...and the owner's link still works
  assert.equal((await fn('team', { action: 'invite-info', token: tokenOf(none.link) })).ok, true, 'the owner’s link is not cancelled');
  assert.equal((await fn('team', { action: 'invite-accept', token: tokenOf(none.link), password: 'mot-de-lea-9' })).ok, true);
});

test('what the owner types in Équipe and Branchements: rights only as on / off, names escaped in the e-mail, the GoHighLevel keys never half saved', async () => {
  const inv = await fn('team', { action: 'invite', email: `zoe-${randomUUID().slice(0, 6)}@test.local`, full_name: '<b>Zoé</b> Test', roles: ['office'],
    rights: { book: true, agenda: 'oui', invoices: false, 'drop table': true }, send: 'none', base: BASE }, ownerJwt);
  assert.equal(inv.ok, true, JSON.stringify(inv));
  assert.deepEqual((await q(`select rights from public.invitations where id = $1`, [inv.id]))[0].rights, { book: true, invoices: false });
  assert.doesNotMatch(inv.message.html, /<b>/, 'the name is text in the e-mail, not HTML');
  assert.match(inv.message.html, /&lt;b&gt;Zoé&lt;\/b&gt;/);
  assert.match(inv.message.text, /<b>Zoé<\/b>/, 'the plain text keeps what was typed');
  // a good GoHighLevel key with a wrong account number: nothing is saved
  await q(`delete from public.secrets where key like 'ghl%'`);
  const half = await fn('team', { action: 'secrets-set', ghl_token: 'pit-abcdef1234567890', ghl_location: 'x' }, ownerJwt);
  assert.equal(half.code, 'ghl_location');
  assert.equal((await q(`select count(*)::int n from public.secrets where key like 'ghl%'`))[0].n, 0, 'the key is not saved alone');
  assert.equal((await fn('team', { action: 'secrets-set', ghl_token: 'pit-abcdef1234567890', ghl_location: 'LOC12345678' }, ownerJwt)).ok, true);
  assert.equal((await q(`select count(*)::int n from public.secrets where key like 'ghl%'`))[0].n, 2);
  await q(`delete from public.secrets where key like 'ghl%'`);
});

/* ---------- Hermes' pairing ---------- */
test('Hermes’ pairing: posts from anybody while no pairing is waiting do not block the real one; ten wrong codes burn the waiting code', async () => {
  const fp = async (c) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))).toString('hex');
  const key = 'k'.repeat(40);
  try {
    await q(`delete from public.rate_limits where key = 'hermes:pair'`);
    await q(`delete from public.secrets where key like 'hermes%'`);
    for (let i = 0; i < 12; i++) assert.equal((await fn('hermes', { action: 'pair', code: 'n-' + i, url: MOCK + '/hermes', key })).code, 'no_pair');
    await q(`insert into public.secrets (key, value) values ('hermes_pair', $1)`, [`${await fp('le-bon-code')}|${new Date(Date.now() + 600000).toISOString()}`]);
    for (let i = 0; i < 3; i++) assert.equal((await fn('hermes', { action: 'pair', code: 'faux-' + i, url: MOCK + '/hermes', key })).code, 'bad_pair');
    const ok = await fn('hermes', { action: 'pair', code: 'le-bon-code', url: MOCK + '/hermes', key });
    assert.equal(ok.ok, true, 'the real pairing goes through: ' + JSON.stringify(ok));
    assert.equal((await q(`select value from public.secrets where key = 'hermes_key'`))[0].value, key);
    // guessing: the 10th wrong code in the hour cancels the waiting one
    await q(`delete from public.rate_limits where key = 'hermes:pair'`);
    await q(`insert into public.secrets (key, value) values ('hermes_pair', $1) on conflict (key) do update set value = excluded.value`, [`${await fp('autre-code')}|${new Date(Date.now() + 600000).toISOString()}`]);
    const codes = [];
    for (let i = 0; i < 10; i++) codes.push((await fn('hermes', { action: 'pair', code: 'devine-' + i, url: MOCK + '/hermes', key })).code);
    assert.deepEqual(codes, [...Array(9).fill('bad_pair'), 'busy']);
    assert.equal((await fn('hermes', { action: 'pair', code: 'autre-code', url: MOCK + '/hermes', key })).code, 'no_pair', 'burned');
  } finally {
    await q(`delete from public.rate_limits where key = 'hermes:pair'`);
    await q(`delete from public.secrets where key like 'hermes%'`);
  }
});
