// Who may call what (Part 26). Postgres gives EXECUTE on a new function to everyone by default (and the real project
// to « authenticated » on top), so a function made without a word about rights was callable by anyone signed in. Part 26
// closes that default, and this test keeps the exact list of what the app (authenticated) and the public (anon) may
// call: a new function shows up here on purpose, with its grant, or not at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tx } from './helpers.mjs';

/** the public (the customer's page, the booking page): the tracking page and the pulse */
const ANON = ['fold_name', 'health', 'public_track'];
/** the signed-in app: its operations, its helpers (row rules and triggers call them as the person) */
const AUTHENTICATED = [
  'access_of', 'all_rights', 'apply_hours', 'block_pos', 'blocks', 'blocks_overview', 'book_job', 'bset', 'by_person', 'can',
  'coffre_add', 'coffre_may_add', 'coffre_remove', 'coffre_report', 'customer_visible', 'dashboard', 'day_path', 'extra_answer',
  'fail', 'fold_name', 'has_role', 'health', 'home_point', 'inventory_apply_move', 'inventory_buy', 'inventory_delete', 'inventory_guard', 'invoice_editable',
  'invoice_finish', 'invoice_for_job', 'invoice_totals', 'invoice_visible', 'invoice_void', 'invoices_guard', 'is_field',
  'is_owner', 'is_staff', 'job_actor', 'job_customer', 'job_id_visible', 'job_item_price', 'job_items_editable', 'job_step', 'job_visible', 'km_between',
  'local_now', 'local_today', 'log_activity', 'me', 'member_update', 'move_job', 'my_access', 'my_truck_ids', 'now_min',
  'payment_add', 'payment_remove', 'payment_visible', 'public_track', 'ranges_first', 'ranges_from', 'ranges_norm',
  'ranges_norm_trg', 'ranges_overlap', 'replan_after_hours', 'report_error', 'report_position', 'right_default', 'right_of',
  'right_rule', 'rights_table', 'set_job_duration', 'set_role_rights', 'set_stop_order', 'set_truck_start', 'settings_guard',
  'shift_end', 'shift_start', 'suggest_blocks', 'team_map', 'touch', 'treasury_report', 'truck_hours_editable', 'truck_ranges',
  'update_me', 'walk_in'
];

const callable = (h, role) => h.q(`select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and has_function_privilege($1, p.oid, 'execute') order by 1`, [role]).then((r) => r.map((x) => x.proname));

test('Part 26: exactly these functions are callable by the app and by the public', async () => {
  await tx(async (h) => {
    assert.deepEqual(await callable(h, 'anon'), [...ANON].sort(), 'the public may call exactly these');
    assert.deepEqual(await callable(h, 'authenticated'), [...AUTHENTICATED].sort(), 'the signed-in app may call exactly these (a new one is granted on purpose, in its migration, and listed here)');
    // a function made without a word about rights is closed to the app (and to the public), like on the real project now
    await h.q(`create function public.zz_forgotten() returns int language sql as 'select 1'`);
    assert.equal(await h.val(`select has_function_privilege('authenticated', 'public.zz_forgotten()', 'execute')`), false, 'closed by default');
    assert.equal(await h.val(`select has_function_privilege('anon', 'public.zz_forgotten()', 'execute')`), false);
    assert.equal(await h.val(`select has_function_privilege('service_role', 'public.zz_forgotten()', 'execute')`), true, 'the server itself still may');
  });
});

test('Part 26: the app reports its errors (counted, braked, never failing); health() tells the pulse', async () => {
  await tx(async (h) => {
    const p = await h.person('Saleh Ismail', ['mechanic']);
    await h.as(p);
    assert.equal(await h.rpc('report_error', { p_message: 'TypeError: x is not a function', p_stack: 'at a.js:1', p_page: '#/today', p_version: 'abc1234', p_agent: 'iPhone' }), true);
    assert.equal(await h.rpc('report_error', { p_message: 'TypeError: x is not a function', p_stack: 'at a.js:2', p_page: '#/today', p_version: 'abc1234', p_agent: 'iPhone' }), true);
    assert.equal(await h.rpc('report_error', { p_message: '   ', p_stack: null, p_page: null, p_version: null, p_agent: null }), false, 'nothing to say');
    // the table itself is not readable by the app
    const read = await h.fails(() => h.q(`select * from public.app_errors`));
    assert.ok(read, 'app_errors is not readable by the app');
    await h.as(null);
    const rows = await h.q(`select who, n, version, page, message, stack from public.app_errors where who = $1`, [p]);
    assert.equal(rows.length, 1, 'the same error within an hour is one row');
    assert.deepEqual([rows[0].n, rows[0].version, rows[0].page, rows[0].stack], [2, 'abc1234', '#/today', 'at a.js:1']);
    // the brake: 20 an hour per person, then silently refused
    await h.as(p);
    let ok = 0;
    for (let i = 0; i < 25; i++) if (await h.rpc('report_error', { p_message: `Erreur ${i}`, p_stack: null, p_page: null, p_version: 'abc1234', p_agent: null })) ok++;
    assert.equal(ok, 18, '2 already counted + 18 = 20 an hour');
    // health(): the public may read the pulse, nothing else
    await h.as(null);
    await h.q(`set local role anon`);
    const hv = await h.val(`select public.health()`);
    assert.equal(hv.ok, true);
    assert.match(String(hv.schema), /^2026\d{10}$/, 'the newest migration applied: ' + hv.schema);
    assert.equal(hv.backup_done, null, 'no backup in the test copy yet');
    await h.q(`reset role`);
    await h.q(`insert into public.heartbeats (name, at, note) values ('backup_done', now() - interval '2 hours', '1234 stripe_events')`);
    const hv2 = await h.val(`select public.health()`);
    assert.ok(hv2.backup_done && Date.now() - Date.parse(hv2.backup_done) > 3600_000, 'the last backup shows');
    // housekeeping prunes old errors
    await h.q(`update public.app_errors set last_at = now() - interval '91 days' where who = $1`, [p]);
    await h.q(`select public.housekeeping()`);
    assert.equal(Number(await h.val(`select count(*) from public.app_errors where who = $1`, [p])), 0);
  });
});
