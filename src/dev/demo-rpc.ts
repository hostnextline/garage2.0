/* DEV ONLY — pretend versions of the server's main operations, close enough to try the screens.
   The real rules (rights, planner, taxes, numbering) live in supabase/migrations and are tested there. */
import { registerRpc as strongRpc, registerFn as strongFn, put, find, table, rows, refuse, nowIso, type DemoRow } from './fake-server';
// the core's pretend operations give way to a section's own (registered in src/dev/demo-extra)
const registerRpc = (name: string, fn: Parameters<typeof strongRpc>[1]) => strongRpc(name, fn, { weak: true });
const registerFn = (name: string, fn: Parameters<typeof strongFn>[1]) => strongFn(name, fn, { weak: true });
import { addDays, today, nowMinute } from '../lib/dates';

const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const BLOCKS: Record<string, [number, number]> = { am: [480, 720], pm: [720, 960], eve: [960, 1200] };
const sub = (lines: { qty: number; unit_cents: number; kind?: string }[]) => lines.reduce((n, l) => n + Math.round(Number(l.qty) * Number(l.unit_cents) * (l.kind === 'discount' ? -1 : 1)), 0);
const withTaxes = (s: number) => ({ subtotal_cents: s, taxable_cents: s, tps_cents: Math.round(s * 0.05), tvq_cents: Math.round(s * 0.09975), total_cents: s + Math.round(s * 0.05) + Math.round(s * 0.09975) });
let jobNo = 200, invNo = 43, quoteNo = 8;

function itemsOf(jobId: string) { return table('job_items').filter((i) => i.job_id === jobId && !i.deleted_at); }
function place(day: string, block: string, wanted: string | null): string | null {
  if (wanted) return wanted;
  const trucks = table('trucks').filter((t) => t.active && !t.deleted_at);
  const load = (tid: string) => table('jobs').filter((j) => j.truck_id === tid && j.day === day && j.block === block && !j.deleted_at && !['cancelled', 'no_show'].includes(String(j.status))).length;
  return trucks.sort((a, b) => load(a.id) - load(b.id))[0]?.id ?? null;
}
function addItems(jobId: string, items: DemoRow[]) {
  return items.map((it, i) => put('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', sort: i + 1, ...it, id: String(it.id || crypto.randomUUID()), job_id: jobId }));
}

registerRpc('book_job', (a) => {
  const j = a.p_job as DemoRow & { day: string; block: string; customer_id: string; truck_id?: string };
  if (!j.customer_id) refuse('no_customer', 'Choisis le client avant de réserver.');
  if (!BLOCKS[j.block]) refuse('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.');
  if (j.day < today() || (j.day === today() && nowMinute() >= BLOCKS[j.block][0])) refuse('block_started', 'Ce bloc est déjà commencé : choisis un autre bloc.');
  const truck = place(j.day, j.block, j.truck_id || null);
  const n = table('jobs').filter((x) => x.day === j.day && x.block === j.block && x.truck_id === truck).length;
  const items = addItems(j.id, (a.p_items as DemoRow[]) || []);
  const dur = Number(j.duration_min) || items.reduce((m, i) => m + (Number(i.duration_min) || 45), 0) || 60;
  const job = put('jobs', { status: 'booked', truck_pinned: !!j.truck_id, stop_order: n + 1, eta_min: BLOCKS[j.block][0] + 20 + n * 70, travel_min: 18, source: 'phone', number: ++jobNo, created_by: me(), ...j, truck_id: truck, duration_min: dur });
  return { ok: true, job_id: job.id, truck_id: truck, rows: rows({ jobs: job, job_items: items }) };
});
registerRpc('walk_in', (a) => {
  const j = a.p_job as DemoRow;
  const now = nowMinute();
  const block = now < 720 ? 'am' : now < 960 ? 'pm' : 'eve';
  const items = addItems(j.id, (a.p_items as DemoRow[]) || []);
  const job = put('jobs', { status: 'on_site', day: today(), block, stop_order: 9, eta_min: now, travel_min: 0, duration_min: 60, source: 'walk_in', number: ++jobNo, created_by: me(), started_at: nowIso(), arrived_at: nowIso(), ...j });
  return { ok: true, job_id: job.id, rows: rows({ jobs: job, job_items: items }) };
});
registerRpc('move_job', (a) => {
  const j = find('jobs', a.p_job);
  if (!j) refuse('not_found', 'Ce rendez-vous n’existe plus.');
  if (j.status !== 'booked') refuse('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.');
  const job = put('jobs', { id: j.id, day: a.p_day, block: a.p_block, truck_id: place(String(a.p_day), String(a.p_block), (a.p_truck as string) || null) });
  return { ok: true, changed: true, rows: rows({ jobs: job }) };
});
registerRpc('set_job_duration', (a) => ({ ok: true, rows: rows({ jobs: put('jobs', { id: String(a.p_job), duration_min: Number(a.p_duration) }) }) }));
registerRpc('job_step', (a) => {
  const j = find('jobs', a.p_job);
  if (!j) refuse('not_found', 'Cette job n’existe plus.');
  const d = (a.p_data || {}) as Record<string, unknown>;
  const now = nowIso();
  const step = String(a.p_action);
  const patch: Record<string, unknown> = { id: j.id };
  if (step === 'leave') { if (j.status !== 'booked') refuse('bad_step', 'Cette job est déjà partie.'); Object.assign(patch, { status: 'en_route', started_at: now }); }
  else if (step === 'arrive') { if (j.status !== 'en_route') refuse('bad_step', 'Touche d’abord « Je pars ».'); Object.assign(patch, { status: 'on_site', arrived_at: now }); }
  else if (step === 'waiver') Object.assign(patch, { waiver_signed_at: now, waiver_signer: d.signer, waiver_version: d.version, waiver_attachment: d.attachment_id || null });
  else if (step === 'finish') {
    const inv = table('invoices').find((v) => v.job_id === j.id && v.status !== 'void');
    if (!d.pay_later && (!inv || inv.status !== 'paid')) refuse('pay_first', 'Paiement requis avant de partir : encaisse la facture.');
    Object.assign(patch, { status: 'done', finished_at: now, pay_later: !!d.pay_later, pay_later_reason: d.reason || null });
    for (const i of itemsOf(j.id)) if (i.status === 'planned' || i.status === 'approved') put('job_items', { id: i.id, status: 'done' });
  }
  else if (step === 'cancel') Object.assign(patch, { status: 'cancelled', cancelled_at: now, lost_reason: d.reason || null });
  else if (step === 'no_show') Object.assign(patch, { status: 'no_show', cancelled_at: now, lost_reason: d.reason || null });
  else if (step === 'reopen') Object.assign(patch, { status: 'booked', cancelled_at: null, lost_cents: null, lost_reason: null });
  else if (step === 'back') Object.assign(patch, j.status === 'on_site' ? { status: 'en_route', arrived_at: null } : { status: 'booked', started_at: null });
  else refuse('bad_step', 'Étape inconnue.');
  return { ok: true, rows: rows({ jobs: put('jobs', patch), job_items: itemsOf(j.id) }) };
});
registerRpc('extra_answer', (a) => {
  const i = find('job_items', a.p_item);
  if (!i || i.status !== 'proposed') refuse('not_extra', 'Ce n’est pas un travail proposé.');
  return { ok: true, rows: rows({ job_items: put('job_items', { id: i.id, status: a.p_accept ? 'approved' : 'declined', answered_at: nowIso(), answered_via: a.p_via, answer_attachment: a.p_attachment || null }) }) };
});
registerRpc('invoice_for_job', (a) => {
  const j = find('jobs', a.p_job);
  if (!j) refuse('not_found', 'Cette job n’existe plus.');
  const lines = itemsOf(j.id).filter((i) => ['planned', 'done', 'approved'].includes(String(i.status)))
    .map((i) => ({ description: String(i.description), qty: Number(i.qty), unit_cents: Math.abs(Number(i.unit_cents)) * (i.kind === 'discount' ? -1 : 1), taxable: !!i.taxable, kind: String(i.kind) }));
  const cur = table('invoices').find((v) => v.job_id === j.id && v.status !== 'void');
  const s = sub(lines);
  if (cur && cur.status !== 'draft') return { ok: true, invoice_id: cur.id, rows: rows({ invoices: cur }) };
  const inv = put('invoices', { ...(cur ? { id: cur.id } : {}), job_id: j.id, customer_id: j.customer_id, number: null, status: 'draft', issued_at: null, due_on: null, lines, taxes_on: true, ...withTaxes(s), paid_cents: 0, lang: (find('customers', j.customer_id)?.lang as string) || 'fr', notes: null, sent_at: null, voided_at: null, void_reason: null });
  return { ok: true, invoice_id: inv.id, rows: rows({ invoices: inv }) };
});
registerRpc('invoice_finish', (a) => {
  const v = find('invoices', a.p_invoice);
  if (!v) refuse('not_found', 'Cette facture n’existe plus.');
  if (!(v.lines as unknown[]).length) refuse('empty', 'Ajoute au moins une ligne avant de terminer la facture.');
  const s = sub(v.lines as { qty: number; unit_cents: number }[]);
  const inv = put('invoices', { id: v.id, status: 'issued', number: v.number ?? ++invNo, issued_at: nowIso(), ...withTaxes(v.taxes_on === false ? 0 : s), ...(v.taxes_on === false ? { subtotal_cents: s, total_cents: s } : {}) });
  return { ok: true, number: inv.number, rows: rows({ invoices: inv }) };
});
registerRpc('payment_add', (a) => {
  const v = find('invoices', a.p_invoice);
  if (!v) refuse('not_found', 'Rien à payer.');
  if (v.status === 'draft') refuse('invoice_first', 'Termine la facture avant d’encaisser.');
  const amount = Number(a.p_amount_cents);
  if (!amount) refuse('amount', 'Écris le montant reçu.');
  const p = put('payments', { invoice_id: v.id, job_id: v.job_id, amount_cents: amount, method: a.p_method, paid_at: nowIso(), reference: a.p_reference || null, stripe_session: null, note: null });
  const paid = table('payments').filter((x) => x.invoice_id === v.id && !x.deleted_at).reduce((n, x) => n + Number(x.amount_cents), 0);
  const inv = put('invoices', { id: v.id, paid_cents: paid, status: paid >= Number(v.total_cents) ? 'paid' : 'issued' });
  return { ok: true, rows: rows({ payments: p, invoices: inv }) };
});
registerRpc('payment_remove', (a) => {
  const p = find('payments', a.p_payment);
  if (!p) refuse('not_found', 'Ce paiement n’existe plus.');
  put('payments', { id: p.id, deleted_at: nowIso() });
  const v = find('invoices', p.invoice_id)!;
  const paid = table('payments').filter((x) => x.invoice_id === v.id && !x.deleted_at).reduce((n, x) => n + Number(x.amount_cents), 0);
  return { ok: true, rows: rows({ payments: find('payments', p.id), invoices: put('invoices', { id: v.id, paid_cents: paid, status: paid >= Number(v.total_cents) ? 'paid' : 'issued' }) }) };
});
registerRpc('invoice_void', (a) => {
  const v = find('invoices', a.p_invoice);
  if (!v) refuse('not_found', 'Cette facture n’existe plus.');
  if (Number(v.paid_cents) > 0) refuse('has_payments', 'Cette facture a des paiements : retire-les (ou rembourse) avant de l’annuler.');
  return { ok: true, rows: rows({ invoices: put('invoices', { id: v.id, status: 'void', voided_at: nowIso(), void_reason: a.p_reason }) }) };
});
registerRpc('suggest_blocks', (a) => {
  const from = String(a.p_from || today());
  const out: DemoRow[] = [];
  for (let i = 0; i < 10 && out.length < Number(a.p_limit || 6); i++) {
    const day = addDays(from, i);
    for (const block of ['am', 'pm', 'eve']) {
      if (day === today() && nowMinute() >= BLOCKS[block][0]) continue;
      if (new Date(day + 'T12:00').getDay() === 0) continue;
      out.push({ id: `${day}-${block}`, day, block, drive_min: 8 + ((i * 7 + block.length * 3) % 19), near: (i + block.length) % 3, truck: 't-complet', left: 90 + ((i * 13) % 120) } as unknown as DemoRow);
      if (out.length >= Number(a.p_limit || 6)) break;
    }
  }
  return out;
});
registerRpc('shift_start', () => {
  const open = table('shifts').find((s) => s.staff_id === me() && !s.ended_at);
  return { ok: true, rows: rows({ shifts: open || put('shifts', { staff_id: me(), started_at: nowIso(), ended_at: null }) }) };
});
registerRpc('shift_end', () => {
  const open = table('shifts').filter((s) => s.staff_id === me() && !s.ended_at).map((s) => put('shifts', { id: s.id, ended_at: nowIso() }));
  const pos = find('positions', me()); if (pos) put('positions', { id: me(), deleted_at: nowIso() });
  return { ok: true, rows: rows({ shifts: open, positions: pos }) };
});
registerRpc('report_position', (a) => { put('positions', { id: me(), lat: a.p_lat, lng: a.p_lng, accuracy_m: a.p_accuracy, heading: a.p_heading, speed_kmh: a.p_speed, job_id: a.p_job, at: nowIso(), deleted_at: null }); return { ok: true }; });
registerRpc('update_me', (a) => {
  const s = find('staff', me())!;
  const p = (a.p_patch || {}) as Record<string, unknown>;
  return { ok: true, rows: rows({ staff: put('staff', { id: s.id, ...(p.phone !== undefined ? { phone: p.phone || null } : {}), ...(p.lang ? { lang: p.lang } : {}), prefs: { ...(s.prefs as object), ...((p.prefs as object) || {}) } }) }) };
});
registerRpc('member_update', (a) => ({ ok: true, rows: rows({ staff: put('staff', { id: String(a.p_staff), ...(a.p_patch as object) }) }) }));
registerRpc('set_role_rights', (a) => {
  const s = find('settings', '1')!;
  const rr = { ...(s.role_rights as Record<string, Record<string, boolean>>) };
  rr[String(a.p_role)] = { ...(rr[String(a.p_role)] || {}), [String(a.p_right)]: !!a.p_on };
  return { ok: true, rows: rows({ settings: put('settings', { id: '1', role_rights: rr }) }) };
});
registerRpc('apply_hours', (a) => {
  const truck = String(a.p_truck), week = a.p_week as Record<string, [number, number][]>, mode = String(a.p_mode), from = String(a.p_from);
  const changed: DemoRow[] = [];
  if (mode === 'always') for (let d = 0; d < 7; d++) changed.push(put('truck_week', { id: `w-${truck}-${d}`, truck_id: truck, dow: d, ranges: week[d] || [] }));
  else {
    const n = mode === 'day' ? 1 : Number(a.p_weeks || 1) * 7;
    for (let i = 0; i < n; i++) { const day = addDays(from, i); const d = new Date(day + 'T12:00').getDay(); changed.push(put('truck_days', { id: `d-${truck}-${day}`, truck_id: truck, day, ranges: week[d] || [], note: null })); }
  }
  return { ok: true, rows: rows(mode === 'always' ? { truck_week: changed } : { truck_days: changed }) };
});
registerRpc('team_map', (a) => {
  const day = String(a.p_day || today());
  return {
    home: { lat: 45.5005053, lng: -73.6577429, label: 'Centrale', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5' },
    trucks: table('trucks').filter((t) => !t.deleted_at).map((t) => ({ id: t.id, name: t.name, color: t.color, driver_id: t.driver_id })),
    jobs: table('jobs').filter((j) => j.day === day && !j.deleted_at && !['cancelled', 'no_show'].includes(String(j.status))).map((j) => {
      const c = find('customers', j.customer_id);
      return { id: j.id, number: j.number, truck_id: j.truck_id, order: j.stop_order, eta_min: j.eta_min, status: j.status, block: j.block, name: c?.first_name || c?.company || '—', address: j.address || c?.address, lat: j.lat ?? c?.lat, lng: j.lng ?? c?.lng };
    }),
    people: table('positions').filter((p) => !p.deleted_at).map((p) => { const s = find('staff', p.id); return { id: p.id, name: s?.short_name || s?.full_name, color: s?.color, lat: p.lat, lng: p.lng, at: p.at, job_id: p.job_id }; }),
    trips: table('trips').filter((t) => t.status === 'active').map((t) => ({ job_id: t.job_id, staff_id: t.staff_id, eta_at: t.eta_at, km: t.km, minutes: t.minutes, route: t.route }))
  };
});
registerRpc('dashboard', (a) => {
  const month = String(a.p_month || today()).slice(0, 7);
  const inv = table('invoices').filter((v) => ['issued', 'paid'].includes(String(v.status)) && String(v.issued_at || '').slice(0, 7) === month);
  const s = (k: string, list = inv) => list.reduce((n, v) => n + Number(v[k] || 0), 0);
  const jobs = table('jobs').filter((j) => String(j.day).slice(0, 7) === month && !j.deleted_at);
  return {
    month: month + '-01', revenue_cents: s('subtotal_cents'), tps_cents: s('tps_cents'), tvq_cents: s('tvq_cents'), invoices: inv.length, avg_ticket_cents: inv.length ? Math.round(s('subtotal_cents') / inv.length) : 0,
    collected_cents: table('payments').filter((p) => !p.deleted_at).reduce((n, p) => n + Number(p.amount_cents), 0),
    receivable_cents: table('invoices').filter((v) => v.status === 'issued').reduce((n, v) => n + Number(v.total_cents) - Number(v.paid_cents), 0),
    receivable_count: table('invoices').filter((v) => v.status === 'issued').length, drafts: table('invoices').filter((v) => v.status === 'draft').length,
    jobs_done: jobs.filter((j) => j.status === 'done').length, jobs_booked: jobs.filter((j) => ['booked', 'en_route', 'on_site'].includes(String(j.status))).length,
    jobs_cancelled: jobs.filter((j) => j.status === 'cancelled').length, jobs_no_show: jobs.filter((j) => j.status === 'no_show').length,
    lost_cents: jobs.reduce((n, j) => n + Number(j.lost_cents || 0), 0), km: 184, goal_cents: 2500000,
    by_truck: [{ truck_id: 't-complet', revenue_cents: Math.round(s('subtotal_cents') * 0.7), invoices: 3 }, { truck_id: 't-voiture', revenue_cents: Math.round(s('subtotal_cents') * 0.3), invoices: 1 }],
    months: [5, 4, 3, 2, 1, 0].map((k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return { month: d.toISOString().slice(0, 7) + '-01', revenue_cents: k === 0 ? s('subtotal_cents') : 900000 + k * 137000 }; }),
    top_services: [{ name: 'Changement d’huile et filtre', n: 14 }, { name: 'Freins avant (plaquettes et disques)', n: 6 }, { name: 'Diagnostic 1 h', n: 4 }]
  };
});
registerRpc('treasury_report', (a) => {
  const from = String(a.p_from), to = String(a.p_to);
  const inv = table('invoices').filter((v) => ['issued', 'paid'].includes(String(v.status)) && String(v.issued_at || '').slice(0, 10) >= from && String(v.issued_at || '').slice(0, 10) <= to);
  const ex = table('expenses').filter((e) => !e.deleted_at && String(e.day) >= from && String(e.day) <= to);
  const s = (list: DemoRow[], k: string) => list.reduce((n, v) => n + Number(v[k] || 0), 0);
  const cats = new Map<string, { t: number; s: number; n: number }>();
  for (const e of ex) { const c = cats.get(String(e.category)) || { t: 0, s: 0, n: 0 }; c.t += Number(e.total_cents); c.s += Number(e.subtotal_cents); c.n++; cats.set(String(e.category), c); }
  return {
    from, to,
    revenue: { subtotal: s(inv, 'subtotal_cents'), tps: s(inv, 'tps_cents'), tvq: s(inv, 'tvq_cents'), total: s(inv, 'total_cents'), count: inv.length },
    expenses: { subtotal: s(ex, 'subtotal_cents'), tps: s(ex, 'tps_cents'), tvq: s(ex, 'tvq_cents'), total: s(ex, 'total_cents'), count: ex.length },
    by_category: [...cats.entries()].map(([category, c]) => ({ category, total: c.t, subtotal: c.s, n: c.n })),
    collected: [{ method: 'debit', total: 41241, n: 1 }, { method: 'credit', total: 17245, n: 1 }],
    profit: s(inv, 'subtotal_cents') - s(ex, 'subtotal_cents'), tps_to_remit: s(inv, 'tps_cents') - s(ex, 'tps_cents'), tvq_to_remit: s(inv, 'tvq_cents') - s(ex, 'tvq_cents')
  };
});
registerFn('notify', (b) => ({ ok: true, status: 'sent', message: `Texto (démo) : ${String(b.kind)}`, link: 'https://example.com/client.html#t=demo', phone: '514 555-0141' }));
registerFn('enroute', (b) => ({ ok: true, sms: 'sent', link: 'https://example.com/client.html#suivi=demo', minutes: 14, km: 6.2, eta_at: new Date(Date.now() + 14 * 60000).toISOString(), message: `Trajet (démo) : ${String(b.action)}` }));
registerFn('vin', () => ({ ok: true, vehicle: { year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', engine: '2.0 L 4 cyl.', displacement: 2.0, cylinders: 4, fuel: 'essence', drive: 'FWD' } }));
registerFn('team', (b) => {
  if (b.action === 'list') return { ok: true, invitations: [], sign_ins: {} };
  if (b.action === 'secrets') return { ok: true, ghl: { on: false, token_end: null, location: null }, stripe: { on: false, test: false, end: null, webhook: false } };
  if (b.action === 'invite' || b.action === 'reset-link') return { ok: true, link: 'https://example.com/#invite=demo-demo-demo-demo-demo', sent: 'off', channel: 'none' };
  return { ok: true };
});
void quoteNo;
