// Off-site backups with no password stored anywhere: a scheduled job of the garage's PRIVATE GitHub repository asks
// GitHub for a short signed ticket (OIDC) and calls this function with it. The function checks GitHub's signature,
// the audience and the repository (_shared/github.ts), then hands out the data table by table, page by page (no
// 1000-row ceiling). The keys of the outside services (table « secrets ») are never part of a backup.
//   { action: 'tables' }                       → { at, tables: [{ name, count }] }
//   { action: 'rows', table, from | after }    → { rows, next, last }: « after » = the « last » of the page before (pages that
//       never shift while the garage works during the night); « from » (an offset) still works as before.
//       attachments with { light: true }: the rows without their picture (up to 1000 a page)
//   { action: 'picture', id }                  → { id, data }: one picture (the job asks only those it does not hold yet)
//   { action: 'accounts' }                     → { accounts: [{ id, email, created_at, banned_until }] }: who has an account (the
//       sign-in side lives outside the tables: a restore into a NEW project makes each account again with the SAME id, then a
//       new-password link for each person). Never a password, never its fingerprint.
//   { action: 'done', tables, rows, commit }   → the job says the night's backup is written and committed: one row in
//       « ops_backup_runs » (the daily reconciliation checks that the last good one is younger than 26 hours).
//       « tables » is the number of tables, or the night's list { <table>: <rows> } (what ops/sauvegardes/sauvegarde.mjs
//       sends): the row keeps how many tables, and « rows », when given, must be the sum of the list (else it is the sum).
//       { ok: false } records a night that failed. Sent twice (the job tries again on a network hiccup): one row.
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb } from '../_shared/db.ts';
import { verifyGithub } from '../_shared/github.ts';
export { verifyGithub };

/** what a backup holds, in the order a restore would load it */
export const TABLES = [
  'settings', 'counters', 'staff', 'trucks', 'truck_week', 'truck_days', 'services', 'inventory_items', 'service_parts', 'engine_specs',
  'customers', 'customer_notes', 'vehicles', 'quotes', 'jobs', 'job_items', 'invoices', 'payments', 'expenses', 'inventory_moves',
  'shifts', 'trips', 'messages', 'public_links', 'invitations', 'activity', 'attachments',
  'coffre', 'positions', 'position_log', 'op_log', 'stripe_events', 'hermes_questions', 'ops_backup_runs',
  // the daily reconciliation (migration « refonte_rapprochement »): the days checked, the differences with the owner's
  // « vu » notes, and the stock's starting point (lost, the next run would quietly take a new one)
  'ops_recon_runs', 'ops_recon_findings', 'ops_recon_baseline'
] as const;
// never backed up: secrets (the keys of the texting and card services), rate_limits (a brake, worthless the next day),
// incoming_calls (the calls of the day, for the « Appel entrant » banner), incoming_texts (the week's texts that wake the
// « Texto entrant » bubble: the conversations themselves stay in GoHighLevel), push_subs (the devices that asked for the
// alert while the app is closed: a device asks again)
export const NOT_BACKED_UP = ['secrets', 'rate_limits', 'incoming_calls', 'incoming_texts', 'push_subs'] as const;
// tables of the « Refonte » migrations: while a database does not have them yet (this function deployed before its
// migration is applied), the backup goes on without them instead of failing every night
const LATER: readonly string[] = ['ops_backup_runs', 'ops_recon_runs', 'ops_recon_findings', 'ops_recon_baseline'];
const KEY: Record<string, string> = { counters: 'name', op_log: 'op' };
// the pictures (receipts, signatures) are kept as text in their rows: a few per page, so one answer stays well under the
// function's memory however big the pictures are (the job follows « next » / « last », the page size is its own business)
const PAGE: Record<string, number> = { attachments: 25 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(String(e.message || '')));

/** a whole number from the job (never a fraction, a negative or a text) */
function count(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}
/** the night's tables: a number, or the list { <table name>: <rows> } the job wrote (each a whole number) */
function tablesOf(v: unknown): { tables: number; sum: number | null } | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const list = Object.entries(v as Record<string, unknown>);
    if (list.length > 10000) return null;
    let sum = 0;
    for (const [name, n] of list) {
      const rows = count(n, 1e13);
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || rows == null) return null;
      sum += rows;
    }
    return { tables: list.length, sum };
  }
  const tables = count(v, 10000);
  return tables == null ? null : { tables, sum: null };
}

export const handler = serve(async (req) => {
  const ticket = req.headers.get('x-github-oidc') || '';
  await verifyGithub(ticket);
  const b = await body(req);
  const db = adminDb();
  const action = String(b.action || 'tables');
  if (action === 'tables') {
    const out: { name: string; count: number }[] = [];
    for (const t of TABLES) {
      if (LATER.includes(t)) {
        // a table of a migration maybe not applied yet: asked with a GET (a HEAD on a missing table answers an empty 404,
        // which the client library takes for « 0 rows »: the night would list it, then fail reading its rows)
        const { error: e0 } = await db.from(t).select('*').limit(0);
        if (missing(e0)) continue;
      }
      const { count: n, error } = await db.from(t).select('*', { count: 'exact', head: true });
      if (error && LATER.includes(t) && missing(error)) continue;
      if (error) throw error;
      out.push({ name: t, count: n || 0 });
    }
    return json({ ok: true, at: new Date().toISOString(), tables: out });
  }
  if (action === 'rows') {
    const t = String(b.table || '');
    if (!(TABLES as readonly string[]).includes(t)) fail('table', 'Table inconnue.');
    const from = Math.max(0, Number(b.from) || 0);
    const key = KEY[t] || 'id';
    // « after » (the key of the last row of the page before, given back as « last »): the next page starts after that row,
    // so a row added or deleted during the night never shifts the pages (by « from », one row would be skipped or doubled)
    const after = typeof b.after === 'string' && b.after.length > 0 && b.after.length <= 200 ? b.after : null;
    if (t === 'attachments' && b.light === true && (after == null || UUID.test(after))) {
      // the rows without their picture (each picture is asked apart: { action: 'picture', id })
      const limit = Math.min(Math.max(1, Number(b.limit) || 1000), 1000);
      const { data, error } = await db.rpc('backup_attachments_light', { p_after: after, p_from: from, p_limit: limit });
      if (!error) {
        const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
        const full = rows.length === limit;
        return json({ ok: true, table: t, from, light: true, rows, next: full ? from + limit : null, last: full ? String(rows[rows.length - 1].id) : null });
      }
      // a database without it yet (20261116000500 not applied): the rows with their pictures, as before
      if (!(error.code === 'PGRST202' || error.code === '42883')) throw error;
    }
    const limit = Math.min(Number(b.limit) || PAGE[t] || 1000, PAGE[t] || 1000);
    let q = db.from(t).select('*').order(key, { ascending: true });
    q = after != null ? q.gt(key, after).limit(limit) : q.range(from, from + limit - 1);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data || []) as Record<string, unknown>[];
    const full = rows.length === limit;
    return json({ ok: true, table: t, from, rows, next: full ? from + limit : null, last: full ? String(rows[rows.length - 1][key]) : null });
  }
  if (action === 'picture') {
    const id = String(b.id || '');
    if (!UUID.test(id)) fail('not_found', 'Cette image n’existe plus.', 404);
    const { data, error } = await db.from('attachments').select('id, data').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) fail('not_found', 'Cette image n’existe plus.', 404);
    return json({ ok: true, id, data: (data as { data: string }).data });
  }
  if (action === 'accounts') {
    const accounts: { id: string; email: string | null; created_at: string | null; banned_until: string | null }[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      for (const u of data.users) accounts.push({ id: u.id, email: u.email || null, created_at: u.created_at || null, banned_until: (u as { banned_until?: string }).banned_until || null });
      if (data.users.length < 200) break;
    }
    accounts.sort((x, y) => x.id.localeCompare(y.id));
    return json({ ok: true, at: new Date().toISOString(), accounts });
  }
  if (action === 'done') {
    const list = tablesOf(b.tables);
    const given = b.rows == null || b.rows === '' ? null : count(b.rows, 1e13);
    // rows is needed with a number of tables; with the list it may be left out (it is the list's sum)
    const rows = given ?? (list?.sum ?? null);
    if (!list || rows == null || (b.rows != null && b.rows !== '' && given == null)) fail('bad_run', 'Le compte des tables et des lignes doit être un nombre entier.');
    if (list.sum != null && rows !== list.sum) fail('bad_run', `Le total des lignes (${rows}) n’est pas la somme des tables (${list.sum}).`);
    const tables = list.tables;
    const commit = b.commit == null || b.commit === '' ? null : String(b.commit).trim();
    if (commit != null && !/^[0-9a-f]{7,64}$/i.test(commit)) fail('bad_run', 'Le numéro du commit n’a pas l’air bon.');
    const ok = b.ok !== false;
    // the same night said twice (the job tries again when the answer is lost): the row already written is the answer
    let seen = db.from('ops_backup_runs').select('id, at').eq('ok', ok).eq('tables', tables).eq('rows', rows).gte('at', new Date(Date.now() - 3600 * 1000).toISOString());
    seen = commit == null ? seen.is('commit', null) : seen.eq('commit', commit.toLowerCase());
    const { data: before, error: e1 } = await seen.order('at', { ascending: false }).limit(1);
    if (missing(e1)) fail('not_ready', 'La table des sauvegardes n’existe pas encore sur cette base (migration « refonte_sauvegarde » à appliquer).', 503);
    if (e1) throw e1;
    const again = ((before || []) as { id: string; at: string }[])[0];
    if (again) return json({ ok: true, id: again.id, at: again.at, again: true });
    const { data: run, error } = await db.from('ops_backup_runs').insert({ tables, rows, commit: commit?.toLowerCase() ?? null, ok }).select('id, at').single();
    if (error) throw error;
    return json({ ok: true, id: (run as { id: string }).id, at: (run as { at: string }).at });
  }
  fail('action', 'Action inconnue.');
});
