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

/** what the signed-in app calls (src/: callRpc, rpcNow, rpc, rpcOf) and what the server functions call with the person's own key.
 *  recon_summary, recon_ack, recon_now: « Rapprochement d'hier » in Trésorerie (src/features/treasury/ReconPanel.tsx; ack and
 *  now go through its own `change`, which the scan below does not see) and the function « recon »; each checks the owner or
 *  « Trésorerie » inside (20261116000400_refonte_rapprochement, tested in refonte-rapprochement.test.mjs).
 *  service_part_set: « Pièces » of a service in Réglages (R173; settings-team's PartsPanel switches to it, tested in
 *  refonte-acces.test.mjs).
 *  shift_save, shift_remove: « Heures travaillées » (Part 26 of live, 20261119000100_heures.sql: its own grant to the app;
 *  each checks hours_all() inside, tested in heures.test.mjs). */
const APP = [
  'service_part_set', 'shift_save', 'shift_remove',
  'access_of', 'apply_hours', 'blocks_overview', 'book_job', 'coffre_add', 'coffre_remove', 'coffre_report', 'dashboard',
  'extra_answer', 'inventory_buy', 'inventory_delete', 'invoice_finish', 'invoice_for_job', 'invoice_reopen', 'invoice_void',
  'job_customer', 'job_item_price', 'job_step', 'lock_windows', 'member_update', 'move_job', 'my_access', 'payment_add', 'payment_remove',
  'public_track', 'recon_ack', 'recon_now', 'recon_summary', 'report_position', 'rights_table', 'set_job_duration', 'set_role_rights', 'set_stop_order', 'set_truck_start',
  'shift_end', 'shift_start', 'suggest_blocks', 'suggest_windows', 'team_map', 'treasury_report', 'update_me', 'vin_history', 'walk_in',
  'web_switch', 'windows_switch',
  // « Vraies routes » (Part 27, 20261119000200): the owner's switch in Réglages → Réservations; it checks the owner inside
  'roads_switch',
  // « Vraies routes » (Part 27): what « La voiture ferme » and « Ordre des arrêts » would do, said before it is done (the app
  // shows them with the real roads instead of a phone's guess). Each runs the action itself (move_job, set_stop_order) in a
  // block that is always undone, so it checks the very right of that action and writes nothing (vraies-routes-apercu.test.mjs)
  'move_preview', 'stop_order_preview'
  // (« exact move », STATE.md 2026-11-21: move_job's 8-argument form and move_preview's form (p_job, p_day, p_truck, p_at) are
  // these same names; their helpers exact_* and route_hold stay closed: tests/db/exact-move.test.mjs)
];
/** what the row rules, the guards and the functions that run as the person (not security definer) call
 *  (hours_all: the read rule of shifts, 20261119000100_heures.sql) */
const AS_PERSON = [
  'hours_all',
  'all_rights', 'block_pos', 'blocks', 'bset', 'by_person', 'can', 'coffre_may_add', 'customer_visible', 'fail', 'has_role', 'home_point',
  'invoice_editable', 'invoice_visible', 'is_field', 'is_owner', 'is_staff', 'items_need_machine', 'job_actor', 'job_id_visible',
  'job_items_editable', 'job_visible', 'km_between', 'local_now', 'local_today', 'me', 'my_truck_ids', 'now_min', 'payment_visible',
  'ranges_first', 'ranges_from', 'ranges_norm', 'ranges_overlap', 'right_default', 'right_flag', 'right_of', 'right_rule', 'sees_calls',
  'truck_hours_editable', 'truck_ranges', 'words_need_machine'
];
/** existed before tonight, re-made and opened to the team by an earlier migration of tonight (its check inside):
 *  lock_windows_due (20261116000200_refonte_planification, the windows locked by the app where there is no pg_cron).
 *  Open with that migration, closed without it; the D1 loop of 20261116000300 leaves it as it finds it. */
const TONIGHT = ['lock_windows_due'];
/** the public key (the customer's tracking page) */
const ANON = ['public_track'];

/** Yesterday's app: what /Users/hassan/garage2.0-refonte (acf46c3, the app live runs until the cutover, the phones that
 *  keep it open for hours after, and the one a rollback publishes again) calls, frozen here from its source the way
 *  the test below scans today's: src/ (its data layer adds p_op to every queued call but vin_history, shift_start,
 *  shift_end), its customer page (src/client/api.ts: a plain fetch of /rest/v1/rpc/public_track with the public key)
 *  and its server functions (supabase/functions: as the person through userDb, or with the server key through adminDb),
 *  which run against the new database until the new ones are deployed. [role, function, the argument names it sends].
 *  Not listed: job_payload, which its enroute asks as the person and which has been closed to the app since Part 13
 *  (x-rights-21: the answer was already null, nothing changes). */
const OLD = [
  // src/data (callRpc, sb.rpc, rpcNow) — the signed-in app
  ['authenticated', 'access_of', ['p_staff']],
  ['authenticated', 'apply_hours', ['p_op', 'p_from', 'p_mode', 'p_truck', 'p_week', 'p_weeks']],
  ['authenticated', 'book_job', ['p_op', 'p_items', 'p_job']],
  ['authenticated', 'coffre_add', ['p_op', 'p_amount', 'p_day', 'p_jobs', 'p_note']],
  ['authenticated', 'coffre_remove', ['p_op', 'p_id']],
  ['authenticated', 'coffre_report', ['p_from', 'p_to']],
  ['authenticated', 'dashboard', ['p_month']],
  ['authenticated', 'extra_answer', ['p_op', 'p_accept', 'p_attachment', 'p_item', 'p_via']],
  ['authenticated', 'inventory_buy', ['p_op', 'p_from', 'p_item', 'p_note', 'p_qty', 'p_total_cents', 'p_vendor']],
  ['authenticated', 'inventory_delete', ['p_op', 'p_item']],
  ['authenticated', 'invoice_finish', ['p_op', 'p_invoice']],
  ['authenticated', 'invoice_for_job', ['p_op', 'p_job', 'p_refresh']],
  ['authenticated', 'invoice_reopen', ['p_op', 'p_invoice']],
  ['authenticated', 'invoice_void', ['p_op', 'p_invoice', 'p_reason']],
  ['authenticated', 'job_customer', ['p_op', 'p_customer', 'p_job', 'p_vehicle']],
  ['authenticated', 'job_item_price', ['p_op', 'p_item', 'p_unit_cents']],
  ['authenticated', 'job_step', ['p_op', 'p_action', 'p_data', 'p_job']],
  ['authenticated', 'lock_windows', ['p_op', 'p_day']],
  ['authenticated', 'member_update', ['p_op', 'p_patch', 'p_staff']],
  ['authenticated', 'move_job', ['p_op', 'p_block', 'p_day', 'p_job', 'p_truck']],
  ['authenticated', 'move_job', ['p_op', 'p_block', 'p_day', 'p_job', 'p_truck', 'p_win_flex', 'p_win_start']],
  ['authenticated', 'my_access', []],
  ['authenticated', 'payment_add', ['p_op', 'p_amount_cents', 'p_invoice', 'p_job', 'p_method', 'p_reference', 'p_session']],
  ['authenticated', 'payment_remove', ['p_op', 'p_payment']],
  ['authenticated', 'report_position', ['p_accuracy', 'p_heading', 'p_job', 'p_lat', 'p_lng', 'p_speed']],
  ['authenticated', 'rights_table', []],
  ['authenticated', 'set_job_duration', ['p_op', 'p_duration', 'p_job']],
  ['authenticated', 'set_role_rights', ['p_op', 'p_on', 'p_right', 'p_role']],
  ['authenticated', 'set_stop_order', ['p_op', 'p_block', 'p_day', 'p_jobs', 'p_truck']],
  ['authenticated', 'set_truck_start', ['p_op', 'p_start', 'p_truck']],
  ['authenticated', 'shift_end', []],
  ['authenticated', 'shift_start', []],
  ['authenticated', 'suggest_blocks', ['p_days', 'p_duration', 'p_exclude', 'p_from', 'p_kind', 'p_lat', 'p_limit', 'p_lng', 'p_need']],
  ['authenticated', 'suggest_windows', ['p_day', 'p_duration', 'p_exclude', 'p_kind', 'p_lat', 'p_lng', 'p_need']],
  ['authenticated', 'team_map', ['p_day']],
  ['authenticated', 'treasury_report', ['p_from', 'p_to']],
  ['authenticated', 'update_me', ['p_patch']],
  ['authenticated', 'vin_history', ['p_customer', 'p_vin']],
  ['authenticated', 'walk_in', ['p_op', 'p_items', 'p_job']],
  ['authenticated', 'windows_switch', ['p_op', 'p_on']],
  // live's app since 2026-11-19 (aa1b4e6, « Heures travaillées »)
  ['authenticated', 'shift_save', ['p_op', 'p_end', 'p_shift', 'p_staff', 'p_start']],
  ['authenticated', 'shift_remove', ['p_op', 'p_shift']],
  // its server functions as the person (_shared/db.ts caller(), notify, enroute)
  ['authenticated', 'invoice_for_job', ['p_job', 'p_op', 'p_refresh']],
  ['authenticated', 'job_step', ['p_action', 'p_data', 'p_job', 'p_op']],
  // its customer page, with the public key
  ['anon', 'public_track', ['p_token']],
  // its server functions with the server key (book, ring, hermes, team, stripe through _shared/payments.ts)
  ['service_role', 'rate_hit', ['p_key', 'p_max', 'p_window_sec']],
  ['service_role', 'web_services', []],
  ['service_role', 'web_suggest', ['p_days', 'p_from', 'p_lat', 'p_limit', 'p_lng', 'p_services']],
  ['service_role', 'web_book', ['p']],
  ['service_role', 'remove_member', ['p_staff']],
  ['service_role', 'payment_add', ['p_amount_cents', 'p_invoice', 'p_job', 'p_method', 'p_op', 'p_reference', 'p_session']],
  ['service_role', 'invoice_for_job', ['p_job', 'p_op', 'p_refresh']]
];

const sorted = (a) => [...new Set(a)].sort();

async function openTo(h, role) {
  return (await h.q(`select distinct p.proname n from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.n);
}

test('the signed-in app may run exactly the functions it calls and the ones its row rules need', () => tx(async (h) => {
  const open = await openTo(h, 'authenticated');
  const expected = sorted([...APP, ...AS_PERSON]);
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
  // the customer page has no account: a plain fetch of /rest/v1/rpc/<name> with the public key (src/client/api.ts)
  const pub = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)/g)) if (!/\/demo\.ts$/.test(f)) pub.add(m[1]);
  assert.ok(pub.has('public_track'), 'the scan finds the customer page’s call');
  const anon = new Set(await openTo(h, 'anon'));
  assert.deepEqual([...pub].filter((n) => !anon.has(n)).sort(), [], 'called by the customer page but closed to the public key');
  assert.deepEqual([...pub].filter((n) => !ANON.includes(n)).sort(), [], 'called by the customer page but missing from ANON');
}));

test('yesterday’s app keeps every function it calls: one function answers each of its calls, with the arguments it sends, open to the role that calls it', () => tx(async (h) => {
  // what PostgREST does with a named call: the functions of that name whose arguments hold every name sent and whose
  // other arguments have a default; none = « not found », two = « ambiguous », one = it runs if the role may
  const fns = await h.q(`select p.oid, p.proname n, p.pronargs, p.pronargdefaults,
      coalesce((select array_agg(p.proargnames[i] order by i) from generate_subscripts(p.proargnames, 1) i
        where p.proargmodes is null or p.proargmodes[i] in ('i', 'b', 'v')), '{}') args
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname = any($1)`, [[...new Set(OLD.map((c) => c[1]))]]);
  const wrong = [];
  for (const [role, name, sent] of OLD) {
    const fits = fns.filter((f) => f.n === name && sent.every((a) => f.args.includes(a))
      && f.args.slice(0, f.pronargs - f.pronargdefaults).every((a) => sent.includes(a)));
    if (fits.length !== 1) { wrong.push(`${name}(${sent.join(', ')}): ${fits.length} function(s) answer`); continue; }
    const may = await h.val(`select has_function_privilege($1, $2::oid, 'execute')`, [role, fits[0].oid]);
    if (!may) wrong.push(`${name}(${sent.join(', ')}): closed to ${role}`);
  }
  assert.deepEqual(wrong, [], 'yesterday’s app would be refused:\n' + wrong.join('\n'));
  // and the list is the one today's rules expect for the app (a name of yesterday no longer in APP would be closed)
  const gone = sorted(OLD.filter((c) => c[0] === 'authenticated').map((c) => c[1])).filter((n) => !APP.includes(n));
  assert.deepEqual(gone, [], 'called by yesterday’s app, missing from APP: ' + gone.join(', '));
  assert.deepEqual(sorted(OLD.filter((c) => c[0] === 'anon').map((c) => c[1])), ANON);
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
