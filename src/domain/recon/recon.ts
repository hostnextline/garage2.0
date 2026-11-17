/* « Rapprochement d'hier »: the server compares, every night, the invoices, payments, expenses, the Coffre and the
   stock (recon_summary). This reads its answer tolerantly (an older server, a field missing, a new kind of check)
   and decides what the panel shows. Pure (no drawing), tested in recon.test.ts: the Trésorerie panel draws it, and the
   frame may count the open differences (openCount) for the « Plus » tile. */
import type { Cents } from '../../lib/money';
import { addDays, type Day } from '../../lib/dates';

export type ReconStatus = 'ok' | 'warn' | 'bad';
export type Severity = 'bad' | 'warn' | 'info';
export interface ReconSheet {
  invoiced_cents: Cents;
  received: { method: string; by: string | null; by_name: string | null; cents: Cents }[];
  refunded_cents: Cents;
  expenses: { category: string; cents: Cents }[];
  coffre_in_cents: Cents; coffre_out_cents: Cents; to_receive_cents: Cents;
}
export interface ReconRun { day: string; status: ReconStatus; finished_at: string | null; counts: Record<string, number> }
export interface ReconFinding {
  id: string; check_id: string; severity: Severity; entity_table: string | null; entity_id: string | null;
  message_fr: string; message_en: string; first_day: string | null; last_day: string | null;
  state: 'open' | 'acked' | 'closed'; note: string | null;
}
export interface ReconSummary {
  can_ack: boolean;
  last_run: (ReconRun & { sheet: ReconSheet | null }) | null;
  runs: ReconRun[];
  findings: ReconFinding[];
}
/** what the panel works from: the summary, or « this server has no reconciliation yet » (the panel stays hidden) */
export type ReconAnswer = { available: true; summary: ReconSummary } | { available: false };

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const list = (x: unknown) => (Array.isArray(x) ? x.map(obj) : []);
const int = (x: unknown) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? n : 0; };
const str = (x: unknown) => (x == null ? null : String(x));
const status = (x: unknown): ReconStatus => (x === 'ok' || x === 'warn' || x === 'bad' ? x : 'warn');
const severity = (x: unknown): Severity => (x === 'bad' || x === 'warn' || x === 'info' ? x : 'warn');
function counts(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(x))) out[k] = int(v);
  return out;
}
function run(x: unknown): ReconRun | null {
  const r = obj(x);
  if (!r.day) return null;
  return { day: String(r.day).slice(0, 10), status: status(r.status), finished_at: str(r.finished_at), counts: counts(r.counts) };
}
function sheet(x: unknown): ReconSheet | null {
  if (!x || typeof x !== 'object') return null;
  const s = obj(x);
  return {
    invoiced_cents: int(s.invoiced_cents),
    received: list(s.received).map((r) => ({ method: String(r.method ?? 'other'), by: str(r.by), by_name: str(r.by_name), cents: int(r.cents) })),
    refunded_cents: int(s.refunded_cents),
    expenses: list(s.expenses).map((e) => ({ category: String(e.category ?? ''), cents: int(e.cents) })),
    coffre_in_cents: int(s.coffre_in_cents), coffre_out_cents: int(s.coffre_out_cents), to_receive_cents: int(s.to_receive_cents)
  };
}

/** the server's answer, made safe. An answer with neither `last_run` nor `runs` is not a reconciliation (a server
    without the function yet, or the demo's pretend server, which says { ok: true } to every unknown call). */
export function normalizeRecon(raw: unknown): ReconAnswer {
  const a = obj(raw);
  if (a.ok === false || (!('last_run' in a) && !Array.isArray(a.runs))) return { available: false };
  const last = run(a.last_run);
  const findings: ReconFinding[] = list(a.findings).filter((f) => f.id != null).map((f) => ({
    id: String(f.id), check_id: String(f.check_id ?? ''), severity: severity(f.severity),
    entity_table: str(f.entity_table), entity_id: str(f.entity_id),
    message_fr: String(f.message_fr ?? f.message_en ?? ''), message_en: String(f.message_en ?? f.message_fr ?? ''),
    first_day: str(f.first_day)?.slice(0, 10) ?? null, last_day: str(f.last_day)?.slice(0, 10) ?? null,
    state: f.state === 'acked' || f.state === 'closed' ? f.state : 'open', note: str(f.note)
  }));
  return {
    available: true,
    summary: {
      can_ack: a.can_ack === true,
      last_run: last ? { ...last, sheet: sheet(obj(a.last_run).sheet) } : null,
      runs: list(a.runs).map(run).filter((r): r is ReconRun => !!r).sort((x, y) => y.day.localeCompare(x.day)),
      findings
    }
  };
}

const RANK: Record<Severity, number> = { bad: 0, warn: 1, info: 2 };
/** the differences to show: not closed, the most serious first, then the newest; one already seen goes after */
export function shownFindings(s: ReconSummary): ReconFinding[] {
  return s.findings.filter((f) => f.state !== 'closed')
    .sort((a, b) => Number(a.state === 'acked') - Number(b.state === 'acked') || RANK[a.severity] - RANK[b.severity]
      || String(b.last_day || '').localeCompare(String(a.last_day || '')));
}
/** « Tout balance »: the last night's run found nothing to look at */
export function allBalanced(s: ReconSummary): boolean {
  return !!s.last_run && s.last_run.status === 'ok' && !s.findings.some((f) => f.state === 'open' && f.severity !== 'info');
}
/** the message in the person's language (the other one when it is missing) */
export function findingText(f: ReconFinding, lang: string): string {
  return (lang === 'en' ? f.message_en || f.message_fr : f.message_fr || f.message_en) || f.check_id;
}

/** where a difference leads: a screen of the app, the expense (opened on this screen), or nowhere */
export type FindingTarget = { href: string } | { expense: string } | null;
export function findingTarget(f: Pick<ReconFinding, 'entity_table' | 'entity_id'>, paymentOf: (id: string) => { invoice_id: string | null; job_id: string | null } | undefined,
  /** the expense is on this phone (an expense opens in its sheet: one the phone does not hold opens nothing) */
  hasExpense: (id: string) => boolean = () => true): FindingTarget {
  const id = f.entity_id;
  if (!id) return f.entity_table === 'coffre' ? { href: '#/coffre' } : null;
  const enc = encodeURIComponent(id);
  switch (f.entity_table) {
    case 'invoices': return { href: `#/invoice/${enc}` };
    case 'jobs': return { href: `#/job/${enc}` };
    case 'customers': return { href: `#/customer/${enc}` };
    case 'vehicles': return { href: `#/vehicle/${enc}` };
    case 'quotes': return { href: `#/quote/${enc}` };
    case 'expenses': return hasExpense(id) ? { expense: id } : null;
    case 'coffre': return { href: '#/coffre' };
    case 'inventory_items': case 'inventory_moves': return { href: '#/inventory' };
    case 'payments': {
      // a payment has no screen of its own: its invoice, else the job it waits on
      const p = paymentOf(id);
      if (p?.invoice_id) return { href: `#/invoice/${encodeURIComponent(p.invoice_id)}` };
      if (p?.job_id) return { href: `#/job/${encodeURIComponent(p.job_id)}` };
      return null;
    }
    default: return null;
  }
}

/** the server has no such function yet (an app newer than its database): not an error to show */
export function isMissingFunction(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string } | null;
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || err.status === 404 || /could not find the function/i.test(String(err.message || ''));
}

/** the number of differences still to look at (for the count on the « Plus » tile of Trésorerie) */
export function openCount(a: ReconAnswer | null | undefined): number {
  return a && a.available ? a.summary.findings.filter((f) => f.state === 'open' && f.severity !== 'info').length : 0;
}

/** which day the last check is about, seen from today (a Montréal day): yesterday (the night's check, the usual),
    today so far (« Vérifier maintenant » also checks today, and the newest day is the one the server answers), or an
    older day (the night's check did not run). The panel's title and the sheet's caption follow it. */
export type RunWhen = 'yesterday' | 'today' | 'older';
export function runWhen(day: string, today: Day): RunWhen {
  if (day >= today) return 'today';
  return day === addDays(today, -1) ? 'yesterday' : 'older';
}
