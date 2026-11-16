// « Rapprochement quotidien »: every night, and when the owner asks, the garage checks its own books and its own data.
// The checks that need only the database are SQL (public.recon_run, one snapshot); this function adds the ones that need
// the outside, as findings of the same run (public.recon_add):
//   - every card payment Stripe took in the last 72 hours is in « payments », for the same amount (skipped, and said
//     so, while Stripe is not connected);
//   - the last good backup is younger than 26 hours (« ops_backup_runs », written by the backup job's { action: 'done' }).
//
//   { action: 'run', day? }            the nightly backup job (GitHub ticket in « x-github-oidc », as for « backup »), or
//                                      from the app: the owner or a person with the « Trésorerie » right.
//                                      → { run: { run_id, day, status, counts }, outside: { stripe, backup }, added: [...], status, bad,
//                                          findings: [{ check, severity, message_fr }] }
//                                      (« bad » true = money or data is wrong: the nightly job ends red; « findings » = what is
//                                      still open after this run, bad first: the nightly job lists them in its GitHub summary)
//   { action: 'last', days? }          (owner or « Trésorerie ») → { summary }: public.recon_summary — the last runs and
//                                      what is still open
//   { action: 'ack', finding, note? }  (owner or « Trésorerie ») → public.recon_ack: a finding noted as seen
// Nothing is ever changed by a check: it only says what does not balance.
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, caller, secret, type Caller } from '../_shared/db.ts';
import { stripeCall } from '../_shared/stripe.ts';
import { verifyGithub } from '../_shared/github.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);
type DbError = { code?: string; message?: string; hint?: string | null };
/** a database refusal: the garage's own (its code is the hint) goes out as it is; « the reconciliation is not installed
    on this database yet » is said plainly; anything else is a server error */
function dbFail(e: DbError): never {
  if (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205') fail('not_ready', 'Le rapprochement n’est pas encore installé sur cette base.', 503);
  if (e.code === 'P0001' && e.hint) fail(String(e.hint), String(e.message || ''), 400);
  throw new Error(`recon: ${e.code || ''} ${e.message || ''}`);
}
/** today's date in Montréal, and the day before (the day the nightly run checks) */
function localDays(): { today: string; yesterday: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  return { today: iso(new Date(Date.UTC(y, m - 1, d))), yesterday: iso(new Date(Date.UTC(y, m - 1, d - 1))) };
}
const moneyFr = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} $`;
const moneyEn = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type Severity = 'bad' | 'warn' | 'info';
interface Added { id: string | null; check: string; severity: Severity; entity_table: string | null; entity_id: string | null; message_fr: string; message_en: string }
type Add = (check: string, severity: Severity, table: string | null, id: string | null, fr: string, en: string, data: Record<string, unknown>) => Promise<void>;

/** Stripe's side of the last 72 hours against « payments »: money Stripe took must be written here, for the same amount */
async function stripeCheck(add: Add): Promise<Record<string, unknown>> {
  const key = await secret('stripe_key');
  if (!key) return { status: 'off', note: 'Stripe n’est pas branché : les paiements par carte ne sont pas vérifiés.' };
  const since = Math.floor(Date.now() / 1000) - 72 * 3600;
  const paid: Record<string, any>[] = [];
  let seen = 0, foreign = 0;
  try {
    let after = '';
    for (let page = 0; page < 20; page++) {
      const d = await stripeCall(key, 'GET', `/checkout/sessions?limit=100&created%5Bgte%5D=${since}${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`);
      const list: Record<string, any>[] | null = Array.isArray(d?.data) ? d.data : null;
      if (!list) throw new Error('Stripe : liste illisible');
      seen += list.length;
      for (const s of list) {
        if (s?.payment_status !== 'paid' || !(Number(s.amount_total) > 0)) continue;
        // only the pages the garage's own app opened (they carry the job or the invoice): the same rule as the payment notice
        if (s.metadata?.job_id || s.metadata?.invoice_id) paid.push(s); else foreign++;
      }
      if (!d.has_more || !list.length) break;
      after = String(list[list.length - 1].id);
    }
  } catch (e) {
    const error = String((e as Error)?.message || e).slice(0, 200);
    await add('stripe_unreachable', 'warn', null, null,
      'Stripe n’a pas répondu : les paiements par carte des 3 derniers jours n’ont pas pu être vérifiés cette fois-ci.',
      'Stripe did not answer: the card payments of the last 3 days could not be checked this time.', { error });
    return { status: 'error', error };
  }
  const db = adminDb();
  const rows = new Map<string, { id: string; amount_cents: number; deleted_at: string | null }>();
  for (let i = 0; i < paid.length; i += 40) {
    const { data, error } = await db.from('payments').select('id, stripe_session, amount_cents, deleted_at').in('stripe_session', paid.slice(i, i + 40).map((s) => String(s.id)));
    if (error) dbFail(error);
    for (const r of (data || []) as { id: string; stripe_session: string; amount_cents: number; deleted_at: string | null }[]) rows.set(r.stripe_session, r);
  }
  let missing = 0, wrong = 0;
  for (const s of paid) {
    const amount = Number(s.amount_total), row = rows.get(String(s.id));
    const invoice = uuid(s.metadata?.invoice_id), job = uuid(s.metadata?.job_id);
    const table = invoice ? 'invoices' : job ? 'jobs' : null, id = invoice || job;
    // sig = the checkout page: two pages paid on the same job (or invoice) are two differences, never one overwriting the other
    const data = { sig: String(s.id), session: s.id, amount_cents: amount, payment_intent: s.payment_intent || null, job_id: job, invoice_id: invoice, payment_id: row?.id ?? null, recorded_cents: row && !row.deleted_at ? row.amount_cents : null };
    if (!row || row.deleted_at) {
      missing++;
      await add('stripe_paid_not_recorded', 'bad', table, id,
        `Stripe a encaissé ${moneyFr(amount)} par carte, mais aucun paiement n’est inscrit dans l’app pour cette carte.`,
        `Stripe took ${moneyEn(amount)} by card, but no payment is recorded in the app for it.`, data);
    } else if (row.amount_cents !== amount) {
      wrong++;
      await add('stripe_amount', 'bad', table, id,
        `Stripe a encaissé ${moneyFr(amount)} par carte, mais l’app a inscrit ${moneyFr(row.amount_cents)}.`,
        `Stripe took ${moneyEn(amount)} by card, but the app recorded ${moneyEn(row.amount_cents)}.`, data);
    }
  }
  return { status: 'ok', sessions: seen, paid: paid.length, missing, wrong, foreign };
}

/** the nightly backup: the last one that said « done » and good must be younger than 26 hours */
async function backupCheck(add: Add): Promise<Record<string, unknown>> {
  const { data, error } = await adminDb().from('ops_backup_runs').select('id, at, tables, rows, commit').eq('ok', true).order('at', { ascending: false }).limit(1);
  if (error) {
    await add('backup_unknown', 'warn', 'ops_backup_runs', null, 'La dernière sauvegarde n’a pas pu être lue.', 'The last backup could not be read.', { error: String(error.message || '').slice(0, 200) });
    return { status: 'error' };
  }
  const last = ((data || []) as { id: string; at: string; tables: number; rows: number; commit: string | null }[])[0];
  if (!last) {
    await add('backup_late', 'bad', 'ops_backup_runs', null,
      'Aucune sauvegarde réussie n’est inscrite : la sauvegarde de nuit n’a jamais dit « terminé ».',
      'No successful backup is on record: the nightly backup never said “done”.', { last_at: null });
    return { status: 'none', last_at: null };
  }
  const hours = Math.round(((Date.now() - Date.parse(last.at)) / 3600000) * 10) / 10;
  if (hours > 26) {
    await add('backup_late', 'bad', 'ops_backup_runs', last.id,
      `La dernière sauvegarde réussie date de ${Math.floor(hours)} heures : elle devrait avoir moins de 26 heures.`,
      `The last successful backup is ${Math.floor(hours)} hours old: it should be less than 26 hours old.`, { last_at: last.at, hours });
    return { status: 'late', last_at: last.at, hours };
  }
  return { status: 'ok', last_at: last.at, hours, tables: last.tables, rows: last.rows, commit: last.commit };
}

/** as the person (the database knows who asks and decides what they see); when the database keeps that function for the
    server alone, as the server — the person's right was checked above */
async function asPerson(c: Caller, name: string, args: Record<string, unknown>): Promise<unknown> {
  const mine = await c.db.rpc(name, args);
  if (!mine.error) return mine.data;
  if (mine.error.code !== '42501') dbFail(mine.error);
  const { data, error } = await adminDb().rpc(name, args);
  if (error) dbFail(error);
  return data;
}

type Said = { check: string; severity: string; message_fr: string };
const RANK: Record<string, number> = { bad: 0, warn: 1, info: 2 };
/** what this run leaves open (bad first), for the nightly job's summary: the database's own checks and the ones added here.
    For the app (a person), only what this function added (the database decides what each person sees, in « last »). */
async function openFindings(runId: string, added: Added[], job: boolean): Promise<Said[]> {
  const mine: Said[] = added.map((a) => ({ check: a.check, severity: a.severity, message_fr: a.message_fr }));
  if (!job) return mine;
  const { data, error } = await adminDb().from('ops_recon_findings').select('check_id, severity, message_fr')
    .eq('last_run', runId).eq('state', 'open').limit(200);
  if (error) return mine;   // a database that keeps its findings elsewhere: what was added here is still said
  const all = ((data || []) as { check_id: string; severity: string; message_fr: string }[]).map((f) => ({ check: f.check_id, severity: f.severity, message_fr: f.message_fr }));
  return (all.length ? all : mine).sort((x, y) => (RANK[x.severity] ?? 3) - (RANK[y.severity] ?? 3) || x.check.localeCompare(y.check));
}

export const handler = serve(async (req) => {
  // who is asking, before anything else: the backup job's GitHub ticket, or a signed-in person
  const ticket = req.headers.get('x-github-oidc');
  let c: Caller | null = null;
  if (ticket) await verifyGithub(ticket);
  else {
    c = await caller(req);
    if (!(c.access.owner || c.access.rights?.treasury)) fail('not_allowed', 'Le rapprochement est pour le propriétaire et la Trésorerie.', 403);
  }
  const b = await body(req);
  const action = String(b.action || '');
  if (action !== 'run' && action !== 'last' && action !== 'ack') fail('action', 'Action inconnue.');
  if (!c && action !== 'run') fail('not_allowed', 'La sauvegarde de nuit lance le rapprochement, rien d’autre.', 403);

  if (action === 'last') {
    const n = Number(b.days);
    const days = Number.isInteger(n) && n >= 1 && n <= 90 ? n : 7;
    return json({ ok: true, summary: await asPerson(c!, 'recon_summary', { p_days: days }) });
  }
  if (action === 'ack') {
    const finding = uuid(b.finding);
    if (!finding) fail('not_found', 'Cet écart n’existe plus.', 404);
    const note = b.note == null ? null : String(b.note).trim().slice(0, 500) || null;
    return json({ ok: true, result: (await asPerson(c!, 'recon_ack', { p_finding: finding, p_note: note })) ?? null });
  }

  // run
  const { today, yesterday } = localDays();
  let day = yesterday;
  if (b.day != null && b.day !== '') {
    const asked = String(b.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asked) || Number.isNaN(Date.parse(`${asked}T00:00:00Z`)) || new Date(`${asked}T00:00:00Z`).toISOString().slice(0, 10) !== asked) fail('bad_day', 'Ce jour n’est pas une date.');
    if (asked > today) fail('bad_day', 'Ce jour n’est pas encore arrivé.');
    day = asked;
  }
  const db = adminDb();
  if (c) {
    // « Vérifier maintenant » pressed again and again: each run asks Stripe
    const { data: free, error } = await db.rpc('rate_hit', { p_key: 'recon:run', p_window_sec: 600, p_max: 10 });
    if (error) dbFail(error);
    if (free !== true) fail('busy', 'Le rapprochement vient d’être fait plusieurs fois. Réessaie dans quelques minutes.', 429);
  }
  const { data: run, error } = await db.rpc('recon_run', { p_day: day, p_source: c ? 'app' : 'backup' });
  if (error) dbFail(error);
  const r = (run || {}) as Record<string, unknown>;
  const runId = uuid(r.run_id);
  if (!runId) throw new Error('recon_run gave no run_id');

  const added: Added[] = [];
  const add: Add = async (check, severity, table, id, fr, en, data) => {
    const { data: fid, error: e } = await db.rpc('recon_add', { p_run: runId, p_check: check, p_severity: severity, p_entity_table: table, p_entity_id: id, p_message_fr: fr, p_message_en: en, p_data: data });
    if (e) dbFail(e);
    added.push({ id: uuid(fid), check, severity, entity_table: table, entity_id: id, message_fr: fr, message_en: en });
  };
  const stripe = await stripeCheck(add);
  const backup = await backupCheck(add);
  const bad = r.status === 'bad' || added.some((a) => a.severity === 'bad');
  return json({ ok: true, run: r, outside: { stripe, backup }, added, findings: await openFindings(runId, added, !c), status: bad ? 'bad' : r.status ?? null, bad });
});
