/* DEV ONLY — pretend « Coffre » operations (Part 20). The real rules live in supabase/migrations/20261107000200_coffre.sql. */
import { registerRpc, put, find, table, rows, refuse, nowIso } from '../fake-server';

export function load() {
  registerRpc('coffre_add', (a) => {
    const ids = (a.p_jobs as string[]) || [];
    if (!ids.length) refuse('no_job', 'Choisis les jobs payées par le Coffre.');
    const jobs = ids.map((id) => find('jobs', id)).filter(Boolean);
    const id = crypto.randomUUID();
    put('coffre', { id, customer_id: jobs[0]?.customer_id ?? null, amount_cents: Number(a.p_amount) || 0, value_cents: 0, received_on: a.p_day || nowIso().slice(0, 10),
      note: a.p_note ?? null, job_ids: ids, job_numbers: jobs.map((j) => j!.number), created_at: nowIso() });
    const changed = jobs.map((j) => put('jobs', { id: j!.id, coffre_id: id, pay_later: false }));
    const inv = table('invoices').filter((v) => ids.includes(String(v.job_id)) && !v.deleted_at && v.status !== 'void')
      .map((v) => put('invoices', v.status === 'draft' ? { id: v.id, deleted_at: nowIso() } : { id: v.id, status: 'void', void_reason: 'Coffre (famille et amis)' }));
    return { ok: true, id, rows: rows({ jobs: changed, invoices: inv }) };
  });
  registerRpc('coffre_remove', (a) => {
    const c = find('coffre', a.p_id);
    if (!c) refuse('not_found', 'Cette entrée du Coffre n’existe plus.');
    put('coffre', { id: c!.id, deleted_at: nowIso() });
    const jobs = table('jobs').filter((j) => j.coffre_id === c!.id).map((j) => put('jobs', { id: j.id, coffre_id: null }));
    return { ok: true, rows: rows({ jobs }) };
  });
  registerRpc('coffre_report', (a) => {
    const list = table('coffre').filter((c) => !c.deleted_at && String(c.received_on) >= String(a.p_from) && String(c.received_on) <= String(a.p_to)).map((c) => {
      const cu = find('customers', c.customer_id);
      return { ...c, day: c.received_on, customer: [cu?.first_name, cu?.last_name].filter(Boolean).join(' ') || '—', work: '', by: 'Hassan' };
    });
    return { rows: list, count: list.length };
  });
}
