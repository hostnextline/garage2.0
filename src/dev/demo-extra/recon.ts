/* DEV ONLY — « Rapprochement d'hier » (Part 26, supabase/migrations/20261116000400_refonte_rapprochement.sql) in the
   demo: the day's sheet worked out from the pretend rows (invoiced, received by method and by person, given back,
   expenses, the Coffre, still to receive), and no difference found — the real checks run on the server only. Before,
   recon_summary was missing and the panel stayed hidden in the demo (demo-01, R23). */
import { registerRpc, find, table, refuse, nowIso, type DemoRow } from '../fake-server';
import { can, isOwner, need } from '../demo-rules';
import { addDays, dayOf, today } from '../../lib/dates';

const dayOfIso = (iso: unknown) => (iso ? dayOf(new Date(String(iso))) : '');
const live = (r: DemoRow) => !r.deleted_at;

function sheet(day: string) {
  const invoiced = table('invoices').filter((v) => live(v) && ['issued', 'paid'].includes(String(v.status)) && dayOfIso(v.issued_at) === day)
    .reduce((n, v) => n + Number(v.total_cents || 0), 0);
  const pays = table('payments').filter((p) => live(p) && dayOfIso(p.paid_at ?? p.created_at) === day);
  const by = new Map<string, { method: string; by: string | null; by_name: string | null; cents: number }>();
  for (const p of pays) {
    if (Number(p.amount_cents) < 0) continue;
    const who = (p.created_by as string | null) ?? null;
    const k = `${String(p.method)}|${who}`;
    const cur = by.get(k) || { method: String(p.method || 'other'), by: who, by_name: who ? String(find('staff', who)?.short_name ?? '') || null : null, cents: 0 };
    cur.cents += Number(p.amount_cents);
    by.set(k, cur);
  }
  const refunded = -pays.filter((p) => Number(p.amount_cents) < 0).reduce((n, p) => n + Number(p.amount_cents), 0);
  const cats = new Map<string, number>();
  for (const e of table('expenses')) if (live(e) && String(e.day) === day) cats.set(String(e.category), (cats.get(String(e.category)) || 0) + Number(e.total_cents || 0));
  const coffre = table('coffre').filter((c) => live(c) && String(c.received_on) === day);
  const toReceive = table('invoices').filter((v) => live(v) && v.status === 'issued').reduce((n, v) => n + Math.max(0, Number(v.total_cents) - Number(v.paid_cents || 0)), 0);
  return {
    invoiced_cents: invoiced, received: [...by.values()], refunded_cents: refunded,
    expenses: [...cats.entries()].map(([category, cents]) => ({ category, cents })),
    coffre_in_cents: coffre.filter((c) => c.kind !== 'purchase').reduce((n, c) => n + Number(c.amount_cents || 0), 0),
    coffre_out_cents: coffre.filter((c) => c.kind === 'purchase').reduce((n, c) => n + Number(c.amount_cents || 0), 0),
    to_receive_cents: toReceive
  };
}
const counts = () => ({ bad: 0, warn: 0, info: 0, acked: 0 });
/** a run of each night (at 3 h) up to yesterday */
function summary(days: number) {
  const n = Math.min(92, Math.max(1, Math.round(days) || 14));
  const runs = Array.from({ length: n }, (_, i) => addDays(today(), -1 - i)).map((day) => ({ day, status: 'ok', finished_at: `${addDays(day, 1)}T08:00:00.000Z`, counts: counts() }));
  return { ok: true, can_ack: true, last_run: { ...runs[0], sheet: sheet(runs[0].day) }, runs, findings: [] as DemoRow[] };
}
const mayRecon = () => need(isOwner() || can('treasury'), 'Le rapprochement est pour le propriétaire et la Trésorerie.');

export function load() {
  try {
    registerRpc('recon_summary', (a) => { mayRecon(); return summary(Number(a.p_days ?? 14)); });
    registerRpc('recon_now', () => { mayRecon(); return { ok: true, day: addDays(today(), -1), status: 'ok', at: nowIso() }; });
    // the demo finds no difference: there is nothing to mark « vu »
    registerRpc('recon_ack', () => { mayRecon(); refuse('not_found', 'Cette différence n’existe plus.'); });
  } catch (e) {
    console.warn('demo-extra/recon', e);
  }
}
