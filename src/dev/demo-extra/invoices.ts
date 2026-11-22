/* DEV ONLY — demo rows and pretend operations for invoices and estimates (see README). Small, and never throws.
   - more invoices (old unpaid, partly paid in English, paid last month) and estimates (accepted, declined);
   - invoice_for_job / invoice_finish / invoice_void compute like the database (taxable lines, taxes off, discounts);
     invoice_reopen (« Modifier la facture ») and finishing it again under what was paid (« paid », over_cents);
   - a new estimate gets its number (the database's sequence).
   Texts (notify) are pretended by the jobs section's demo (?texts=off: « not connected »), card payment by the team's. */
import { put, table, find, registerRpc, rows, refuse, nowIso, type DemoRow } from '../fake-server';
import { can, invoiceEditable, isStaff, jobIdVisible, need } from '../demo-rules';
import { addDays, today } from '../../lib/dates';

const D = (n: number) => addDays(today(), n);
const at = (day: string, min: number) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).toISOString(); };
const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
type L = { description?: string; qty?: number; unit_cents?: number; taxable?: boolean; kind?: string };
/** the database's invoice_totals trigger */
function sums(lines: L[], taxesOn: unknown) {
  const tx = (find('settings', '1')?.taxes || {}) as { enabled?: boolean; tps?: number; tvq?: number };
  let sub = 0, taxable = 0;
  const out = lines.map((l) => { let lt = round(Number(l.qty ?? 1) * Number(l.unit_cents ?? 0)); if (l.kind === 'discount' && lt > 0) lt = -lt; sub += lt; if (l.taxable !== false) taxable += lt; return { ...l, total_cents: lt }; });
  const on = taxesOn !== false && tx.enabled !== false && taxable > 0;
  const tps = on ? round(taxable * (tx.tps ?? 0.05)) : 0, tvq = on ? round(taxable * (tx.tvq ?? 0.09975)) : 0;
  return { lines: out, subtotal_cents: sub, taxable_cents: Math.max(0, taxable), tps_cents: tps, tvq_cents: tvq, total_cents: sub + tps + tvq };
}
const paidOf = (invId: string) => table('payments').filter((p) => p.invoice_id === invId && !p.deleted_at).reduce((n, p) => n + Number(p.amount_cents), 0);

function addRows() {
  const job = (id: string, o: Partial<DemoRow>) => put('jobs', { id, number: 90 + Number(id.slice(-1)), truck_id: 't-complet', truck_pinned: false, stop_order: 1, eta_min: 540, travel_min: 15, duration_min: 60,
    problem: null, notes: null, address: null, unit: null, postal_code: null, lat: null, lng: null, card_on_file: false, lost_cents: null, lost_reason: null, cancelled_at: null,
    pay_later: false, pay_later_reason: null, waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null, confirm_sent_at: null, source: 'phone', quote_id: null,
    created_by: 'u-hassan', status: 'done', block: 'am', ...o });
  const invoice = (id: string, o: Partial<DemoRow> & { lines: L[] }) => put('invoices', { id, due_on: null, taxes_on: true, notes: null, sent_at: null, voided_at: null, void_reason: null, ...o, ...sums(o.lines, true) });
  job('j-inv1', { customer_id: 'c-kevin', vehicle_id: 'v-kevin', day: D(-18), started_at: at(D(-18), 500), arrived_at: at(D(-18), 520), finished_at: at(D(-18), 640), pay_later: true, pay_later_reason: 'Paiera le reste par virement Interac.' });
  put('job_items', { id: 'ji-inv1', job_id: 'j-inv1', kind: 'service', service_id: 's-freins-ar', item_id: null, description: 'Rear brakes (pads and rotors)', qty: 1, unit_cents: 34999, taxable: true, duration_min: 90, status: 'done', answered_at: null, answered_via: null, note: null, sort: 1 });
  invoice('f-38', { job_id: 'j-inv1', customer_id: 'c-kevin', number: 38, status: 'issued', issued_at: at(D(-18), 642), lang: 'en', paid_cents: 10000, sent_at: at(D(-18), 643),
    lines: [{ description: 'Rear brakes (pads and rotors)', qty: 1, unit_cents: 34999, taxable: true, kind: 'service' }, { description: 'Disposal fee (old rotors)', qty: 2, unit_cents: 225, taxable: false, kind: 'fee' }] });
  put('payments', { id: 'p-38', invoice_id: 'f-38', job_id: 'j-inv1', amount_cents: 10000, method: 'interac', paid_at: at(D(-18), 645), reference: 'CA7Q2KX9', stripe_session: null, note: null });
  job('j-inv2', { customer_id: 'c-sophie', vehicle_id: 'v-sophie', day: D(-33), started_at: at(D(-33), 480), arrived_at: at(D(-33), 500), finished_at: at(D(-33), 545) });
  put('job_items', { id: 'ji-inv2', job_id: 'j-inv2', kind: 'service', service_id: 's-huile', item_id: null, description: 'Changement d’huile et filtre', qty: 1, unit_cents: 8999, taxable: true, duration_min: 45, status: 'done', answered_at: null, answered_via: null, note: null, sort: 1 });
  const f35 = invoice('f-35', { job_id: 'j-inv2', customer_id: 'c-sophie', number: 35, status: 'paid', issued_at: at(D(-33), 546), lang: 'fr', paid_cents: 0, notes: 'Prochaine vidange vers 8 000 km.',
    lines: [{ description: 'Changement d’huile et filtre', qty: 1, unit_cents: 8999, taxable: true, kind: 'service' }, { description: 'Rabais client fidèle', qty: 1, unit_cents: 1000, taxable: true, kind: 'discount' }] });
  put('payments', { id: 'p-35', invoice_id: 'f-35', job_id: 'j-inv2', amount_cents: f35.total_cents, method: 'cash', paid_at: at(D(-33), 548), reference: null, stripe_session: null, note: null });
  put('invoices', { id: 'f-35', paid_cents: f35.total_cents });
  put('quotes', { id: 'q-5', number: 5, customer_id: 'c-kevin', vehicle_id: 'v-kevin', vehicle_text: null, contact_name: null, contact_phone: null, status: 'accepted', job_id: null, lang: 'en', valid_until: D(12), notes: null, created_at: at(D(-4), 900),
    items: [{ description: 'Tire mounting (4)', qty: 1, unit_cents: 9999, taxable: true, service_id: 's-pneus', duration_min: 60, kind: 'service' }, { description: 'Wheel balancing', qty: 4, unit_cents: 1500, taxable: true, kind: 'labour' }] });
  put('quotes', { id: 'q-6', number: 6, customer_id: null, vehicle_id: null, vehicle_text: '2015 Nissan Rogue', contact_name: 'Mathieu', contact_phone: '514 555-0172', status: 'declined', job_id: null, lang: 'fr', valid_until: D(-2), notes: null, created_at: at(D(-32), 840),
    items: [{ description: 'Vidange du liquide de refroidissement', qty: 1, unit_cents: 14999, taxable: true, service_id: 's-refroid', duration_min: 60, kind: 'service' }] });
}

function operations() {
  // a new estimate gets the next number, like the database's sequence
  const qs = table('quotes') as DemoRow[] & { numbered?: boolean };
  if (!qs.numbered) {
    const push = qs.push.bind(qs);
    qs.push = (...items: DemoRow[]) => { for (const r of items) if (r.number == null) r.number = Math.max(0, ...qs.map((x) => Number(x.number) || 0)) + 1; return push(...items); };
    qs.numbered = true;
  }
  registerRpc('invoice_for_job', (a) => {
    const j = find('jobs', a.p_job);
    if (!j) refuse('not_found', 'Cette job n’existe plus.');
    need(invoiceEditable(j.id), 'Tu ne peux pas faire la facture de cette job.');
    if (j.coffre_id) refuse('coffre_job', 'Cette job est au Coffre (famille et amis) : elle n’a pas de facture.');
    const lines = table('job_items').filter((i) => i.job_id === j.id && !i.deleted_at && ['planned', 'done', 'approved'].includes(String(i.status)))
      .sort((x, y) => Number(x.sort) - Number(y.sort)).map((i) => ({ description: String(i.description), qty: Number(i.qty), unit_cents: Number(i.unit_cents), taxable: i.taxable !== false, kind: String(i.kind), item_id: i.id }));
    const cur = table('invoices').find((v) => v.job_id === j.id && v.status !== 'void' && !v.deleted_at);
    if (cur && (cur.status !== 'draft' || a.p_refresh === false)) return { ok: true, rows: rows({ invoices: cur }) };
    const base = cur ? { id: cur.id } : { job_id: j.id, number: null, status: 'draft', issued_at: null, due_on: null, taxes_on: true, paid_cents: 0, notes: null, sent_at: null, voided_at: null, void_reason: null,
      lang: (find('customers', j.customer_id)?.lang as string) || 'fr' };
    const inv = put('invoices', { ...base, customer_id: j.customer_id, ...sums(lines, cur ? cur.taxes_on : true) });
    return { ok: true, rows: rows({ invoices: inv }) };
  });
  registerRpc('invoice_finish', (a) => {
    const v = find('invoices', a.p_invoice);
    if (!v || v.deleted_at) refuse('not_found', 'Cette facture n’existe plus.');
    need(invoiceEditable(v.job_id), 'Tu ne peux pas terminer cette facture.');
    if (v.status !== 'draft') return { ok: true, already: true, number: v.number, rows: rows({ invoices: v }) };
    const lines = (v.lines || []) as L[];
    if (!lines.length) refuse('empty', 'Ajoute au moins une ligne avant de terminer la facture.');
    if (lines.some((l) => !String(l.description || '').trim())) refuse('no_description', 'Une ligne n’a pas de description.');
    const m = sums(lines, v.taxes_on);
    if (m.total_cents < 0) refuse('negative', 'Le total est négatif. Vérifie le rabais.');
    // the payments waiting on the job (paid before the invoice, or while « Modifier la facture » was open) come back on it
    const waiting = table('payments').filter((p) => p.job_id === v.job_id && !p.invoice_id && !p.deleted_at);
    const paid = paidOf(v.id) + waiting.reduce((n, p) => n + Number(p.amount_cents), 0);
    for (const p of waiting) put('payments', { id: p.id, invoice_id: v.id });
    // a reopened invoice keeps its number (no number spent: again) and the day it was first issued
    const again = v.number != null;
    const no = again ? Number(v.number) : Math.max(0, ...table('invoices').map((x) => Number(x.number) || 0)) + 1;
    // under what was paid (paid ahead, or a line taken off after « Modifier la facture »): never refused (owner,
    // 2026-11-20, no more below_paid), finished « paid », and what goes back to the customer is said (the office gives it)
    const over = Math.max(0, paid - m.total_cents);
    const inv = put('invoices', { id: v.id, ...m, number: no, status: paid >= m.total_cents ? 'paid' : 'issued',
      issued_at: again && v.issued_at ? v.issued_at : nowIso(), due_on: again && v.due_on ? v.due_on : today(), paid_cents: paid });
    return { ok: true, number: no, again, over_cents: over, rows: rows({ invoices: inv, payments: table('payments').filter((p) => p.invoice_id === v.id) }) };
  });
  // « Modifier la facture » (Part 24 decies): a finished invoice, its job not over, goes back to a draft with its number;
  // what was paid waits on the job
  registerRpc('invoice_reopen', (a) => {
    need(isStaff(), 'Connecte-toi avec ton compte de l’équipe.');
    const v = find('invoices', a.p_invoice);
    if (!v || v.deleted_at) refuse('not_found', 'Cette facture n’existe plus.');
    need(invoiceEditable(v.job_id), 'Tu ne peux pas modifier cette facture.');
    const payload = (jobId: unknown) => rows({ jobs: find('jobs', jobId), job_items: table('job_items').filter((i) => i.job_id === jobId),
      invoices: table('invoices').filter((x) => x.job_id === jobId), payments: table('payments').filter((p) => p.job_id === jobId) });
    if (v.status === 'draft') return { ok: true, already: true, rows: payload(v.job_id) };
    if (v.status === 'void') refuse('void', 'Cette facture est annulée.');
    const j = find('jobs', v.job_id);
    if (!j || j.deleted_at || !['booked', 'en_route', 'on_site'].includes(String(j.status))) refuse('closed', 'La job est terminée : la facture ne se modifie plus. Annule-la pour en faire une nouvelle.');
    for (const p of table('payments')) if (p.invoice_id === v.id && !p.deleted_at) put('payments', { id: p.id, invoice_id: null, job_id: p.job_id ?? v.job_id });
    put('invoices', { id: v.id, status: 'draft', paid_cents: 0 });
    return { ok: true, number: v.number, rows: payload(j.id) };
  });
  // « Changer le prix » of a line of an appointment (Part 24 sexies)
  registerRpc('job_item_price', (a) => {
    need(isStaff(), 'Connecte-toi avec ton compte de l’équipe.');
    const cents = Number(a.p_unit_cents);
    if (a.p_unit_cents == null || !Number.isFinite(cents) || cents < 0 || cents > 10000000) refuse('bad_amount', 'Écris un prix (0 $ ou plus).');
    const i = find('job_items', a.p_item);
    if (!i || i.deleted_at) refuse('not_found', 'Cette ligne n’existe plus.');
    const j = find('jobs', i.job_id);
    if (!j || j.deleted_at || !jobIdVisible(j.id)) refuse('not_found', 'Ce rendez-vous n’existe plus (ou tu n’y as pas accès).');
    if (!['booked', 'en_route', 'on_site'].includes(String(j.status))) refuse('closed', 'Ce rendez-vous est terminé ou annulé : son prix ne change plus.');
    if (table('invoices').some((v) => v.job_id === j.id && !v.deleted_at && !['draft', 'void'].includes(String(v.status)))) {
      refuse('invoice_done', 'La facture est terminée : touche « Modifier la facture » d’abord pour changer un prix.');
    }
    const unit = i.kind === 'discount' || Number(i.unit_cents) < 0 ? -Math.abs(cents) : cents;
    put('job_items', { id: i.id, unit_cents: unit });
    // the draft invoice follows the work (trigger job_items_invoice_follow)
    for (const v of table('invoices')) {
      if (v.job_id !== j.id || v.deleted_at || v.status !== 'draft') continue;
      const lines = ((v.lines || []) as (L & { item_id?: string })[]).map((l) => (l.item_id === i.id ? { ...l, unit_cents: unit } : l));
      put('invoices', { id: v.id, ...sums(lines, v.taxes_on) });
    }
    return { ok: true, rows: rows({ job_items: find('job_items', i.id), invoices: table('invoices').filter((v) => v.job_id === j.id) }) };
  });
  registerRpc('invoice_void', (a) => {
    need(can('edit_invoices'), 'Seul le bureau peut annuler une facture.');
    const v = find('invoices', a.p_invoice);
    if (!v || v.deleted_at) refuse('not_found', 'Cette facture n’existe plus.');
    if (!String(a.p_reason || '').trim()) refuse('reason', 'Écris pourquoi la facture est annulée.');
    if (v.status === 'draft') return { ok: true, rows: rows({ invoices: put('invoices', { id: v.id, deleted_at: nowIso() }) }) };
    if (paidOf(v.id) > 0) refuse('has_payments', 'Cette facture a des paiements : retire-les (ou rembourse) avant de l’annuler.');
    return { ok: true, rows: rows({ invoices: put('invoices', { id: v.id, status: 'void', voided_at: nowIso(), void_reason: a.p_reason }) }) };
  });
}

export function load() {
  try { addRows(); } catch (e) { console.warn('[demo invoices] rows', e); }
  try { operations(); } catch (e) { console.warn('[demo invoices] operations', e); }
}
