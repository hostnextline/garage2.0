// Off-site backups with no password stored anywhere: a scheduled job of the garage's PRIVATE GitHub repository asks
// GitHub for a short signed ticket (OIDC) and calls this function with it. The function checks GitHub's signature,
// the audience and the repository (_shared/github.ts), then hands out the data table by table, page by page (no
// 1000-row ceiling). The keys of the outside services (table « secrets ») are never part of a backup.
//   { action: 'tables' }                       → { at, tables: [{ name, count }] }
//   { action: 'rows', table, from }            → { rows, next }
//   { action: 'accounts' }                     → { accounts: [{ id, email, created_at, banned_until }] }: who has an account (the
//       sign-in side lives outside the tables: a restore into a NEW project makes each account again with the SAME id, then a
//       new-password link for each person). Never a password, never its fingerprint.
//   { action: 'done', tables, rows, commit }   → the job says the night's backup is written and committed: one row in
//       « ops_backup_runs » (the daily reconciliation checks that the last good one is younger than 26 hours).
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
  'coffre', 'positions', 'position_log', 'op_log', 'stripe_events', 'hermes_questions', 'ops_backup_runs'
] as const;
// never backed up: secrets (the keys of the texting and card services), rate_limits (a brake, worthless the next day),
// incoming_calls (the calls of the day, for the « Appel entrant » banner), incoming_texts (the week's texts that wake the
// « Texto entrant » bubble: the conversations themselves stay in GoHighLevel), push_subs (the devices that asked for the
// alert while the app is closed: a device asks again)
export const NOT_BACKED_UP = ['secrets', 'rate_limits', 'incoming_calls', 'incoming_texts', 'push_subs'] as const;
// tables of the « Refonte » migrations: while a database does not have them yet (this function deployed before its
// migration is applied), the backup goes on without them instead of failing every night
const LATER: readonly string[] = ['ops_backup_runs'];
const KEY: Record<string, string> = { counters: 'name', op_log: 'op' };
const PAGE: Record<string, number> = { attachments: 100 };
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(String(e.message || '')));

/** a whole number from the job (never a fraction, a negative or a text) */
function count(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
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
    const limit = Math.min(Number(b.limit) || PAGE[t] || 1000, PAGE[t] || 1000);
    const from = Math.max(0, Number(b.from) || 0);
    const { data, error } = await db.from(t).select('*').order(KEY[t] || 'id', { ascending: true }).range(from, from + limit - 1);
    if (error) throw error;
    const rows = data || [];
    return json({ ok: true, table: t, from, rows, next: rows.length === limit ? from + limit : null });
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
    const tables = count(b.tables, 10000), rows = count(b.rows, 1e13);
    if (tables == null || rows == null) fail('bad_run', 'Le compte des tables et des lignes doit être un nombre entier.');
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
