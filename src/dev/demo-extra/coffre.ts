/* DEV ONLY — pretend « Coffre » operations (Part 20), with the database's rules (supabase/migrations: coffre_add of
   20261116000100_refonte_argent.sql, coffre_report of 20261108000180_achat_inventaire.sql and Part 24 septies): the
   work's value, a job already paid refused, the totals and the balance of the report (demo-08). */
import { registerRpc, put, find, table, rows, refuse, nowIso, type DemoRow } from '../fake-server';
import { can, demoUser, isOwner, isStaff, jobIdVisible, need } from '../demo-rules';
import { today } from '../../lib/dates';

const workOf = (jobId: string) => table('job_items').filter((i) => i.job_id === jobId && !i.deleted_at && ['planned', 'done', 'approved'].includes(String(i.status)));
const valueOf = (jobId: string) => workOf(jobId).reduce((n, i) => n + Math.round(Number(i.qty) * (i.kind === 'discount' ? -Math.abs(Number(i.unit_cents)) : Number(i.unit_cents))), 0);
const paidOn = (jobId: string) => table('payments').filter((p) => !p.deleted_at && (p.job_id === jobId || find('invoices', p.invoice_id)?.job_id === jobId))
  .reduce((n, p) => n + Number(p.amount_cents), 0);
const qtyText = (q: unknown) => String(Math.round(Number(q) * 100) / 100).replace('.', ',');

export function load() {
  registerRpc('coffre_add', (a) => {
    need(isStaff(), 'Connecte-toi avec ton compte de l’équipe pour mettre des jobs au Coffre.');
    const ids = [...new Set((a.p_jobs as string[]) || [])];
    if (!ids.length) refuse('no_job', 'Choisis les jobs payées par le Coffre.');
    if (ids.length > 30) refuse('too_many', 'Au plus 30 jobs à la fois.');
    const amount = Number(a.p_amount);
    if (a.p_amount == null || !Number.isFinite(amount) || amount < 0 || amount > 10000000) refuse('bad_amount', 'Écris le montant reçu (0 $ si rien).');
    const jobs = ids.map((id) => find('jobs', id)).filter(Boolean) as DemoRow[];
    if (jobs.length !== ids.length) refuse('no_job', 'Une des jobs n’existe plus.');
    jobs.sort((x, y) => String(x.day).localeCompare(String(y.day)) || Number(x.number) - Number(y.number));
    for (const j of jobs) {
      need(jobIdVisible(j.id), 'Une de ces jobs n’est pas dans ce que tu vois : demande au bureau de la mettre au Coffre.');
      if (j.deleted_at || ['cancelled', 'no_show'].includes(String(j.status))) refuse('bad_job', `La job ${String(j.number)} est annulée : elle ne va pas au Coffre.`);
      if (j.coffre_id) refuse('already', `La job ${String(j.number)} est déjà au Coffre.`);
      if (paidOn(j.id) !== 0) refuse('has_payment', `La job ${String(j.number)} a déjà un paiement : retire-le d’abord, ou garde-la en facture.`);
    }
    const id = crypto.randomUUID();
    put('coffre', { id, kind: 'received', customer_id: jobs[0].customer_id ?? null, amount_cents: amount, value_cents: jobs.reduce((n, j) => n + valueOf(j.id), 0),
      received_on: (a.p_day as string) || today(), note: String(a.p_note ?? '').trim() || null, job_ids: jobs.map((j) => j.id), job_numbers: jobs.map((j) => j.number),
      created_by: demoUser(), created_at: nowIso() });
    const changed = jobs.map((j) => put('jobs', { id: j.id, coffre_id: id, pay_later: false }));
    const inv = table('invoices').filter((v) => ids.includes(String(v.job_id)) && !v.deleted_at && v.status !== 'void')
      .map((v) => put('invoices', v.status === 'draft' && v.number == null ? { id: v.id, deleted_at: nowIso() } : { id: v.id, status: 'void', voided_at: nowIso(), void_reason: 'Coffre (famille et amis)' }));
    return { ok: true, id, rows: rows({ jobs: changed, invoices: inv }) };
  });
  registerRpc('coffre_remove', (a) => {
    need(isOwner(), 'Seul le propriétaire change le Coffre.');
    const c = find('coffre', a.p_id);
    if (!c || c.deleted_at) refuse('not_found', 'Cette entrée du Coffre n’existe plus.');
    put('coffre', { id: c.id, deleted_at: nowIso() });
    const jobs = table('jobs').filter((j) => j.coffre_id === c.id).map((j) => put('jobs', { id: j.id, coffre_id: null }));
    return { ok: true, rows: rows({ jobs }) };
  });
  registerRpc('coffre_report', (a) => {
    need(isOwner() || can('treasury'), 'Tu n’as pas accès au Coffre.');
    const from = String(a.p_from || '2000-01-01'), to = String(a.p_to || '2999-12-31');
    const all = table('coffre').filter((c) => !c.deleted_at);
    const list = all.filter((c) => String(c.received_on) >= from && String(c.received_on) <= to)
      .sort((x, y) => String(x.received_on).localeCompare(String(y.received_on)) || String(x.created_at).localeCompare(String(y.created_at)))
      .map((c) => {
        const cu = find('customers', c.customer_id);
        const purchase = c.kind === 'purchase';
        const by = find('staff', c.created_by);
        return { id: c.id, kind: c.kind ?? 'received', day: c.received_on, customer_id: c.customer_id ?? null,
          customer: purchase ? String(c.item_name ?? '—') : ([cu?.first_name, cu?.last_name].filter(Boolean).join(' ') || (cu?.company as string) || '—'),
          item_id: c.item_id ?? null, qty: c.qty ?? null, amount_cents: Number(c.amount_cents || 0), value_cents: Number(c.value_cents || 0), note: c.note ?? null,
          job_ids: c.job_ids ?? [], job_numbers: c.job_numbers ?? [],
          work: purchase ? `${qtyText(c.qty)} × ${String(c.item_name ?? '')}` : [...new Set(((c.job_ids as string[]) || []).flatMap((id) => workOf(id).map((i) => String(i.description))))].join(', '),
          by: by ? String(by.short_name || by.full_name) : null };
      });
    const sum = (xs: { amount_cents: number }[]) => xs.reduce((n, x) => n + x.amount_cents, 0);
    return { from: a.p_from ?? null, to: a.p_to ?? null, rows: list, count: list.length,
      amount_cents: sum(list.filter((x) => x.kind !== 'purchase')), spent_cents: sum(list.filter((x) => x.kind === 'purchase')),
      value_cents: list.reduce((n, x) => n + x.value_cents, 0),
      balance_cents: all.reduce((n, c) => n + (c.kind === 'purchase' ? -1 : 1) * Number(c.amount_cents || 0), 0),
      stock_cents: table('inventory_items').filter((i) => !i.deleted_at && i.pool === 'coffre' && i.active !== false).reduce((n, i) => n + Math.round(Math.max(0, Number(i.qty)) * Number(i.cost_cents || 0)), 0) };
  });
}
