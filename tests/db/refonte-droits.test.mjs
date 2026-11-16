// Who may call what (Part 26, audit D1): the exact list of the database functions the app and the public key may run.
// Run: node --test tests/db/refonte-droits.test.mjs
//
// A function made by a migration is closed to everybody until that migration opens it by name (« grant execute … to
// authenticated »). This file keeps the list of what is open. A new function the app calls: add its name to APP below
// in the same change as its migration's grant; a new row rule or guard that calls a function as the signed-in person:
// add it to AS_PERSON. Anything else open is a door left open by mistake and fails here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, pool } from './helpers.mjs';

after(() => pool.end());

/** what the signed-in app calls (src/: callRpc, rpcNow, rpc, rpcOf) and what the server functions call with the person's own key */
const APP = [
  'access_of', 'apply_hours', 'blocks_overview', 'book_job', 'coffre_add', 'coffre_remove', 'coffre_report', 'dashboard', 'day_path',
  'extra_answer', 'inventory_buy', 'inventory_delete', 'invoice_finish', 'invoice_for_job', 'invoice_reopen', 'invoice_void',
  'job_customer', 'job_item_price', 'job_step', 'lock_windows', 'member_update', 'move_job', 'my_access', 'payment_add', 'payment_remove',
  'public_track', 'report_position', 'rights_table', 'set_job_duration', 'set_role_rights', 'set_stop_order', 'set_truck_start',
  'shift_end', 'shift_start', 'suggest_blocks', 'suggest_windows', 'team_map', 'treasury_report', 'update_me', 'vin_history', 'walk_in',
  'web_switch', 'windows_switch'
];
/** what the row rules, the guards and the functions that run as the person (not security definer) call */
const AS_PERSON = [
  'all_rights', 'block_pos', 'blocks', 'bset', 'by_person', 'can', 'coffre_may_add', 'customer_visible', 'fail', 'has_role', 'home_point',
  'invoice_editable', 'invoice_visible', 'is_field', 'is_owner', 'is_staff', 'items_need_machine', 'job_actor', 'job_id_visible',
  'job_items_editable', 'job_visible', 'km_between', 'local_now', 'local_today', 'me', 'my_truck_ids', 'now_min', 'payment_visible',
  'ranges_first', 'ranges_from', 'ranges_norm', 'ranges_overlap', 'right_default', 'right_of', 'right_rule', 'sees_calls',
  'truck_hours_editable', 'truck_ranges', 'words_need_machine'
];
/** made tonight by the daily reconciliation (another migration): open to the team, the check is inside. Present or not. */
const RECON = ['recon_summary', 'recon_ack', 'recon_now'];
/** existed before tonight, re-made and opened to the team by an earlier migration of tonight (its check inside):
 *  lock_windows_due (20261116000200_refonte_planification, the windows locked by the app where there is no pg_cron).
 *  Open with that migration, closed without it; the D1 loop of 20261116000300 leaves it as it finds it. */
const TONIGHT = ['lock_windows_due'];
/** the public key (the customer's tracking page) */
const ANON = ['public_track'];

const sorted = (a) => [...new Set(a)].sort();

async function openTo(h, role) {
  return (await h.q(`select distinct p.proname n from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.n);
}

test('the signed-in app may run exactly the functions it calls and the ones its row rules need', () => tx(async (h) => {
  const open = await openTo(h, 'authenticated');
  const present = new Set((await h.q(`select distinct proname n from pg_proc where pronamespace = 'public'::regnamespace`)).map((r) => r.n));
  const expected = sorted([...APP, ...AS_PERSON, ...RECON.filter((n) => present.has(n))]);
  const extra = open.filter((n) => !expected.includes(n) && !TONIGHT.includes(n));
  const missing = expected.filter((n) => !open.includes(n));
  assert.deepEqual(extra, [], 'open to the app but not in the list (close it, or add it to APP / AS_PERSON with the reason): ' + extra.join(', '));
  assert.deepEqual(missing, [], 'in the list but closed to the app: ' + missing.join(', '));
}));

test('lock_windows_due is open to the team exactly when its version checks the caller (left as srv-planif set it)', () => tx(async (h) => {
  const r = await h.one(`select has_function_privilege('authenticated', 'public.lock_windows_due()', 'execute') open,
    pg_get_functiondef('public.lock_windows_due()'::regprocedure) ~ 'is_staff\\(\\)' checks,
    has_function_privilege('anon', 'public.lock_windows_due()', 'execute') anon`);
  assert.equal(r.open, r.checks, r.checks ? 'the version that checks the team must stay open to the app' : 'the version that checks nobody must stay closed');
  assert.equal(r.anon, false);
}));

test('the public key runs one function, and nothing runs through PUBLIC', () => tx(async (h) => {
  assert.deepEqual(await openTo(h, 'anon'), ANON);
  const viaPublic = (await h.q(`select p.oid::regprocedure::text f from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE' order by 1`)).map((r) => r.f);
  assert.deepEqual(viaPublic, [], 'open to everybody (PUBLIC): ' + viaPublic.join(', '));
}));

test('a function made from now on is closed until its migration opens it (default privileges)', () => tx(async (h) => {
  await h.q(`create function public.zz_droits_probe() returns int language sql as 'select 1'`);
  const r = await h.one(`select has_function_privilege('anon', 'public.zz_droits_probe()', 'execute') anon,
    has_function_privilege('authenticated', 'public.zz_droits_probe()', 'execute') auth,
    has_function_privilege('service_role', 'public.zz_droits_probe()', 'execute') svc`);
  assert.deepEqual([r.anon, r.auth], [false, false]);
  void r.svc;
}));

test('every function the app’s source calls is open to the app', () => tx(async (h) => {
  const root = fileURLToPath(new URL('../../src', import.meta.url));
  if (!existsSync(root)) return;                                 // a copy of the tests without the app
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'dev') walk(p); } else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
  walk(root);
  const called = new Set();
  const re = /\b(?:callRpc|rpcNow|rpcOf|rpc)(?:<[^>]*>)?\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g;
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) called.add(m[1]);
  assert.ok(called.size >= 25, 'the scan finds the app’s calls: ' + [...called].join(', '));
  const open = new Set(await openTo(h, 'authenticated'));
  const closed = [...called].filter((n) => !open.has(n)).sort();
  assert.deepEqual(closed, [], 'called by the app but closed: ' + closed.join(', '));
  const notListed = [...called].filter((n) => !APP.includes(n)).sort();
  assert.deepEqual(notListed, [], 'called by the app but missing from APP: ' + notListed.join(', '));
}));

test('every function a row rule or a column default uses is open to the app', () => tx(async (h) => {
  const open = new Set(await openTo(h, 'authenticated'));
  const fns = new Set((await h.q(`select distinct proname n from pg_proc where pronamespace = 'public'::regnamespace`)).map((r) => r.n));
  const used = new Set();
  const exprs = (await h.q(`select coalesce(qual, '') || ' ' || coalesce(with_check, '') e from pg_policies where schemaname = 'public' and 'authenticated' = any(roles)
    union all select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.relnamespace = 'public'::regnamespace`)).map((r) => r.e);
  for (const e of exprs) for (const m of e.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) if (fns.has(m[1])) used.add(m[1]);
  const closed = [...used].filter((n) => !open.has(n)).sort();
  assert.ok(used.has('job_visible') && used.has('is_staff'));
  assert.deepEqual(closed, [], 'used by a row rule or a default but closed: ' + closed.join(', '));
}));

test('every security definer function has its search_path fixed', () => tx(async (h) => {
  const loose = (await h.q(`select p.oid::regprocedure::text f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`)).map((r) => r.f);
  assert.deepEqual(loose, []);
}));
