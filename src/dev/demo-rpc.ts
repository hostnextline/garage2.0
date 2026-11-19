/* DEV ONLY — pretend versions of the server's main operations, close enough to try the screens.
   The real rules (rights, planner, taxes, numbering) live in supabase/migrations and are tested there. One copy of each
   operation (demo-11): booking, moving, suggesting and the hours are in demo-extra/agenda.ts, the invoices in
   demo-extra/invoices.ts, the texts and trips in demo-extra/jobs.ts, the team in demo-extra/team.ts. */
import { registerRpc as strongRpc, put, find, table, rows, refuse, nowIso, type DemoRow } from './fake-server';
// the core's pretend operations give way to a section's own (registered in src/dev/demo-extra)
const registerRpc = (name: string, fn: Parameters<typeof strongRpc>[1]) => strongRpc(name, fn, { weak: true });
import { addDays, addMonths, today, nowMinute, dayOf, daysBetween } from '../lib/dates';
import { can, demoUser, invoiceEditable, isField, isOwner, isStaff, jobActor, myTruckIds, need } from './demo-rules';
import { renumber, started } from './demo-extra/agenda';

const me = demoUser;
const BLOCKS: Record<string, [number, number]> = { am: [480, 720], pm: [720, 960], eve: [960, 1200] };
/** the next job number, like the database's sequence (the same counter for a booking and a walk-in: demo-18) */
const nextJobNo = () => Math.max(200, ...table('jobs').map((x) => Number(x.number) || 0)) + 1;

function itemsOf(jobId: string) { return table('job_items').filter((i) => i.job_id === jobId && !i.deleted_at); }
function addItems(jobId: string, items: DemoRow[]) {
  return items.map((it, i) => put('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', sort: i + 1, ...it, id: String(it.id || crypto.randomUUID()), job_id: jobId }));
}

registerRpc('walk_in', (a) => {
  const j = a.p_job as DemoRow;
  need(isField(), 'Tu ne peux pas ouvrir une job.');
  const truck = (j.truck_id as string | null) || myTruckIds()[0] || null;
  if (truck && !(myTruckIds().includes(truck) || can('book') || isOwner())) refuse('not_allowed', 'Ce camion n’est pas le tien.');
  const now = nowMinute();
  // window mode: one block for the whole day (live: block 'day'); else the block of the moment
  const windows = ((find('settings', '1')?.booking || {}) as { windows_on?: boolean }).windows_on === true;
  const block = windows ? 'day' : now < 720 ? 'am' : now < 960 ? 'pm' : 'eve';
  const items = addItems(j.id, ((a.p_items as DemoRow[]) || []).map((i) => ({ status: 'done', ...i })));
  const job = put('jobs', { status: 'on_site', day: today(), block, stop_order: 9, eta_min: now, travel_min: 0, duration_min: 60, source: 'walk_in', number: nextJobNo(), created_by: me(), started_at: nowIso(), arrived_at: nowIso(), ...j, truck_id: truck });
  return { ok: true, job_id: job.id, rows: rows({ jobs: job, job_items: items }) };
});
registerRpc('set_stop_order', (a) => {
  need(isStaff(), 'Connecte-toi.');
  need(isOwner() || can('book') || myTruckIds().includes(String(a.p_truck)), 'Tu ne peux pas changer l’ordre de ce camion. Parle au propriétaire.');
  const ids = (a.p_jobs as string[]) || [];
  const route = table('jobs').filter((j) => j.truck_id === a.p_truck && j.day === a.p_day && j.block === a.p_block && !j.deleted_at && ['booked', 'en_route', 'on_site'].includes(String(j.status)));
  const live = route.filter((j) => j.status !== 'booked');
  const booked = route.filter((j) => j.status === 'booked').sort((x, y) => Number(x.stop_order ?? 99) - Number(y.stop_order ?? 99));
  const order = ids.length ? [...ids.map((id) => booked.find((j) => j.id === id)).filter(Boolean) as DemoRow[], ...booked.filter((j) => !ids.includes(j.id))] : booked;
  const out = order.map((j, i) => put('jobs', { id: j.id, manual_order: ids.length ? i + 1 : null, stop_order: live.length + i + 1, eta_min: BLOCKS[String(a.p_block)][0] + 20 + (live.length + i) * 70 }));
  return { ok: true, rows: rows({ jobs: out }) };
});
registerRpc('set_job_duration', (a) => {
  const j = find('jobs', a.p_job);
  if (!j) refuse('not_found', 'Cette job n’existe plus.');
  need(can('book') || myTruckIds().includes(String(j.truck_id)), 'Tu ne peux pas changer ce rendez-vous.');
  return { ok: true, rows: rows({ jobs: put('jobs', { id: j.id, duration_min: Number(a.p_duration) }) }) };
});
/* job_step with the database's rules (supabase/migrations/20261116000200_refonte_planification.sql): who may move the
   job, from which step, and the money (demo-05, demo-06, demo-07) */
const liveInvoice = (jobId: string) => table('invoices').find((v) => v.job_id === jobId && v.status !== 'void' && !v.deleted_at);
/** job_paid: in the Coffre, or its invoice paid */
const jobPaid = (j: DemoRow) => j.coffre_id != null || liveInvoice(j.id)?.status === 'paid';
const workValue = (jobId: string) => itemsOf(jobId).filter((i) => ['planned', 'done', 'approved'].includes(String(i.status)))
  .reduce((n, i) => n + Math.round(Number(i.qty) * (i.kind === 'discount' ? -Math.abs(Number(i.unit_cents)) : Number(i.unit_cents))), 0);
/** use_parts: the parts confirmed (or planned) leave the stock, once per job */
function useParts(j: DemoRow, parts: unknown) {
  if (table('inventory_moves').some((m) => m.job_id === j.id && m.reason === 'used' && !m.deleted_at)) return [];
  const want = new Map<string, number>();
  if (Array.isArray(parts)) {
    for (const x of parts as { item_id?: unknown; qty?: unknown }[]) if (x && x.item_id != null && Number(x.qty) > 0) want.set(String(x.item_id), (want.get(String(x.item_id)) || 0) + Number(x.qty));
  } else {
    for (const i of itemsOf(j.id).filter((x) => ['planned', 'done', 'approved'].includes(String(x.status)))) {
      if (i.item_id) want.set(String(i.item_id), (want.get(String(i.item_id)) || 0) + Number(i.qty));
      for (const sp of table('service_parts')) if (sp.service_id === i.service_id && !sp.deleted_at) want.set(String(sp.item_id), (want.get(String(sp.item_id)) || 0) + Number(sp.qty) * Number(i.qty));
    }
  }
  const out: DemoRow[] = [];
  for (const [id, q] of want) {
    const it = find('inventory_items', id);
    if (!it || it.deleted_at || Math.round(q * 100) <= 0) continue;
    out.push(put('inventory_moves', { item_id: id, delta: -q, reason: 'used', job_id: j.id, note: `Job ${String(j.number)}`, created_by: me() }));
    put('inventory_items', { id, qty: Math.round((Number(it.qty) - q) * 100) / 100 });
  }
  return out;
}
const endTrips = (jobId: string, status: 'arrived' | 'cancelled') => table('trips').filter((t) => t.job_id === jobId && t.status === 'active').map((t) => put('trips', { id: t.id, status, ended_at: nowIso() }));
const isOpen = (day: string, block: string) => (block === 'day' ? day >= today() : !started(day, block));
registerRpc('job_step', (a) => {
  const j = find('jobs', a.p_job);
  if (!j || j.deleted_at) refuse('not_found', 'Cette job n’existe plus.');
  need(jobActor(j), 'Cette job n’est pas à toi.');
  const d = (a.p_data || {}) as Record<string, unknown>;
  const now = nowIso();
  const step = String(a.p_action);
  const inv = liveInvoice(j.id);
  const patch: Record<string, unknown> = { id: j.id };
  const lost = d.lost_cents != null && d.lost_cents !== '' ? Number(d.lost_cents) : workValue(j.id);
  let replan = false;
  if (step === 'leave') {
    if (j.status !== 'booked') refuse('bad_step', 'Cette job est déjà partie.');
    if (j.truck_id != null && table('jobs').some((o) => o.id !== j.id && o.day === j.day && o.truck_id === j.truck_id && o.status === 'on_site' && !o.deleted_at && !jobPaid(o) && !o.pay_later)) {
      refuse('unpaid_here', 'La job d’avant n’est pas encore payée : encaisse-la avant de partir.');
    }
    Object.assign(patch, { status: 'en_route', started_at: now });
  } else if (step === 'arrive') {
    if (j.status !== 'en_route') refuse('bad_step', 'Touche d’abord « Je pars ».');
    Object.assign(patch, { status: 'on_site', arrived_at: now });
    endTrips(j.id, 'arrived');
  } else if (step === 'finish') {
    if (!['on_site', 'en_route'].includes(String(j.status))) refuse('bad_step', 'Cette job n’est pas sur place.');
    if (!jobPaid(j)) {
      if (j.pay_later && inv && inv.status !== 'draft') { /* the office already let this customer pay later */ }
      else if (d.pay_later === true) {
        if (!(isOwner() || can('edit_invoices'))) refuse('pay_first', 'Paiement requis avant de partir. Seul le bureau peut laisser partir sans paiement.');
        if (!inv || inv.status === 'draft') refuse('invoice_first', 'Termine la facture d’abord.');
        Object.assign(patch, { pay_later: true, pay_later_reason: d.reason || null });
      } else refuse('pay_first', 'Paiement requis avant de partir : encaisse la facture.');
    }
    Object.assign(patch, { status: 'done', finished_at: now, arrived_at: j.arrived_at ?? now });
    endTrips(j.id, 'arrived');
    useParts(j, d.parts);
    for (const i of itemsOf(j.id)) if (i.status === 'planned' || i.status === 'approved') put('job_items', { id: i.id, status: 'done' });
  } else if (step === 'cancel') {
    if (!['booked', 'en_route'].includes(String(j.status))) refuse('bad_step', 'Cette job ne peut plus être annulée.');
    Object.assign(patch, { status: 'cancelled', cancelled_at: now, lost_cents: lost, lost_reason: d.reason || null });
    endTrips(j.id, 'cancelled');
    replan = true;
  } else if (step === 'no_show') {
    if (!['booked', 'en_route', 'on_site'].includes(String(j.status))) refuse('bad_step', 'Cette job ne peut plus passer à « Client absent ».');
    Object.assign(patch, { status: 'no_show', cancelled_at: now, lost_cents: lost, lost_reason: d.reason || null });
    const c = find('customers', j.customer_id);
    if (c) put('customers', { id: c.id, no_shows: Number(c.no_shows || 0) + 1 });
    endTrips(j.id, 'cancelled');
    replan = true;
  } else if (step === 'reopen') {
    if (!['cancelled', 'no_show'].includes(String(j.status))) refuse('bad_step', 'Cette job est déjà à l’agenda.');
    if (!isOpen(String(j.day), String(j.block))) refuse('block_started', 'Ce bloc est passé : déplace la job vers un autre moment.');
    if (j.status === 'no_show') { const c = find('customers', j.customer_id); if (c) put('customers', { id: c.id, no_shows: Math.max(0, Number(c.no_shows || 0) - 1) }); }
    Object.assign(patch, { status: 'booked', cancelled_at: null, lost_cents: null, lost_reason: null, started_at: null, arrived_at: null });
    replan = true;
  } else if (step === 'back') {
    if (j.status === 'en_route') { Object.assign(patch, { status: 'booked', started_at: null }); endTrips(j.id, 'cancelled'); }
    else if (j.status === 'on_site') Object.assign(patch, { status: 'en_route', arrived_at: null });
    // « Défaire » on a finished job: back on site (it was made « Réservé »: demo-06)
    else if (j.status === 'done' && (isOwner() || can('book'))) Object.assign(patch, { status: 'on_site', finished_at: null });
    else refuse('bad_step', 'Rien à défaire.');
  } else if (step === 'waiver') {
    if (!String(d.signer ?? '').trim()) refuse('signer', 'Écris le nom de la personne qui signe.');
    Object.assign(patch, { waiver_signed_at: now, waiver_signer: d.signer, waiver_version: d.version || null, waiver_attachment: d.attachment_id || null });
  } else refuse('bad_step', 'Étape inconnue.');
  put('jobs', patch);
  if (replan && j.block !== 'day') renumber(String(j.day), String(j.block));
  const jobId = j.id;
  return { ok: true, action: step, rows: rows({ jobs: find('jobs', jobId), job_items: itemsOf(jobId), invoices: table('invoices').filter((v) => v.job_id === jobId),
    payments: table('payments').filter((p) => p.job_id === jobId || table('invoices').some((v) => v.id === p.invoice_id && v.job_id === jobId)), trips: table('trips').filter((t) => t.job_id === jobId) }) };
});
registerRpc('extra_answer', (a) => {
  const i = find('job_items', a.p_item);
  if (!i || i.status !== 'proposed') refuse('not_extra', 'Ce n’est pas un travail proposé.');
  const j = find('jobs', i.job_id);
  need(!!j && jobActor(j), 'Cette job n’est pas à toi.');
  return { ok: true, rows: rows({ job_items: put('job_items', { id: i.id, status: a.p_accept ? 'approved' : 'declined', answered_at: nowIso(), answered_via: a.p_via, answer_attachment: a.p_attachment || null }) }) };
});
/* payment_add as a person sends it (supabase/migrations/20261116000100_refonte_argent.sql): the invoice finished, never
   more than what is left (too_much), money given back only by the office and never more than was paid, the card
   online only by Stripe, a payment with no finished invoice waits on the job */
const METHODS = ['cash', 'debit', 'credit', 'interac', 'card_online', 'cheque', 'other'];
const paidOnInvoice = (id: string) => table('payments').filter((x) => x.invoice_id === id && !x.deleted_at).reduce((n, x) => n + Number(x.amount_cents), 0);
const cents = (n: number) => (n / 100).toFixed(2).replace('.', ',');
registerRpc('payment_add', (a) => {
  const amount = Number(a.p_amount_cents);
  if (!amount || !Number.isFinite(amount)) refuse('amount', 'Écris le montant reçu.');
  const method = String(a.p_method ?? '');
  if (!METHODS.includes(method)) refuse('method', 'Choisis le mode de paiement.');
  if (method === 'card_online') refuse('method', 'La carte en ligne s’inscrit toute seule quand le client paie sa facture : choisis un autre mode de paiement.');
  const office = isOwner() || can('edit_invoices');
  if (amount < 0 && !office) refuse('not_allowed', 'Seul le bureau peut noter de l’argent remis au client.');
  let v = a.p_invoice ? find('invoices', a.p_invoice) : undefined;
  if (a.p_invoice && (!v || v.deleted_at)) refuse('not_found', 'Cette facture n’existe plus.');
  const jobId = (a.p_job as string | null) || (v?.job_id as string | null) || null;
  if (!v && !jobId) refuse('not_found', 'Rien à payer.');
  if (jobId && !find('jobs', jobId)) refuse('not_found', 'Cette job n’existe plus.');
  if (v) {
    need(invoiceEditable(v.job_id), 'Tu ne peux pas encaisser cette facture.');
    if (v.status === 'void') refuse('void', 'Cette facture est annulée.');
    if (v.status === 'draft') {
      // money given back by the office while « Modifier la facture » is open waits on the job
      if (v.number != null && v.job_id != null && office) v = undefined;
      else refuse('invoice_first', 'Termine la facture avant d’encaisser.');
    }
  } else need(invoiceEditable(jobId), 'Tu ne peux pas encaisser cette job.');
  if (!v && jobId) v = table('invoices').find((x) => x.job_id === jobId && ['issued', 'paid'].includes(String(x.status)) && !x.deleted_at);
  const before = v ? paidOnInvoice(v.id) : table('payments').filter((x) => x.job_id === jobId && !x.invoice_id && !x.deleted_at).reduce((n, x) => n + Number(x.amount_cents), 0);
  if (amount < 0 && before + amount < 0) refuse('refund_too_much', `Le client a payé ${cents(Math.max(before, 0))} $ : tu ne peux pas lui remettre plus.`);
  if (amount > 0 && v) {
    const left = Math.max(Number(v.total_cents) - before, 0);
    if (left === 0) refuse('too_much', 'Cette facture est déjà payée au complet : il ne reste rien à encaisser.');
    if (amount > left) refuse('too_much', `Il reste ${cents(left)} $ à payer sur cette facture : le montant écrit est trop haut.`);
  }
  const p = put('payments', { invoice_id: v?.id ?? null, job_id: jobId, amount_cents: amount, method, paid_at: nowIso(), reference: a.p_reference || null, stripe_session: null, note: null, created_by: me() });
  let inv: DemoRow | undefined;
  if (v) { const paid = paidOnInvoice(v.id); inv = put('invoices', { id: v.id, paid_cents: paid, status: paid >= Number(v.total_cents) ? 'paid' : 'issued' }); }
  return { ok: true, id: p.id, rows: rows({ payments: p, invoices: inv }) };
});
registerRpc('payment_remove', (a) => {
  need(isOwner() || can('edit_invoices'), 'Seul le bureau peut retirer un paiement.');
  const p = find('payments', a.p_payment);
  if (!p || p.deleted_at) refuse('not_found', 'Ce paiement n’existe plus.');
  if (p.method === 'card_online') refuse('card_online', 'Un paiement par carte en ligne ne se retire pas : rembourse-le dans Stripe.');
  put('payments', { id: p.id, deleted_at: nowIso() });
  // a payment waiting on the job (no invoice) has no invoice to put right (it was a 500 here: demo-21)
  const v = p.invoice_id ? find('invoices', p.invoice_id) : undefined;
  if (!v) return { ok: true, rows: rows({ payments: find('payments', p.id) }) };
  const paid = paidOnInvoice(v.id);
  return { ok: true, rows: rows({ payments: find('payments', p.id), invoices: put('invoices', { id: v.id, paid_cents: paid, status: paid >= Number(v.total_cents) ? 'paid' : 'issued' }) }) };
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
registerRpc('member_update', (a) => (need(isOwner(), 'Seul le propriétaire gère l’équipe.'), { ok: true, rows: rows({ staff: put('staff', { id: String(a.p_staff), ...(a.p_patch as object) }) }) }));
registerRpc('set_role_rights', (a) => {
  need(isOwner(), 'Seul le propriétaire change les droits.');
  const s = find('settings', '1')!;
  const rr = { ...(s.role_rights as Record<string, Record<string, boolean>>) };
  rr[String(a.p_role)] = { ...(rr[String(a.p_role)] || {}), [String(a.p_right)]: !!a.p_on };
  return { ok: true, rows: rows({ settings: put('settings', { id: '1', role_rights: rr }) }) };
});
registerRpc('team_map', (a) => {
  need(can('map'), 'Tu n’as pas accès à la carte. Parle au propriétaire.');
  const day = String(a.p_day || today());
  if (!can('agenda') && Math.abs(daysBetween(today(), day)) > 1) refuse('not_allowed', 'La carte montre seulement hier, aujourd’hui et demain.');
  return {
    home: { lat: 45.5005053, lng: -73.6577429, label: 'Centrale', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5' },
    trucks: table('trucks').filter((t) => !t.deleted_at).map((t) => ({ id: t.id, name: t.name, color: t.color, driver_id: t.driver_id, start: t.start ?? null })),
    jobs: table('jobs').filter((j) => j.day === day && !j.deleted_at && !['cancelled', 'no_show'].includes(String(j.status))).map((j) => {
      const c = find('customers', j.customer_id);
      return { id: j.id, number: j.number, truck_id: j.truck_id, order: j.stop_order, eta_min: j.eta_min, status: j.status, block: j.block, win_start: j.win_start ?? null, win_end: j.win_end ?? null, win_flex: j.win_flex === true, name: c?.first_name || c?.company || '—', address: j.address || c?.address, lat: j.lat ?? c?.lat, lng: j.lng ?? c?.lng };
    }),
    people: table('positions').filter((p) => !p.deleted_at).map((p) => { const s = find('staff', p.id); return { id: p.id, name: s?.short_name || s?.full_name, color: s?.color, lat: p.lat, lng: p.lng, at: p.at, job_id: p.job_id }; }),
    trips: table('trips').filter((t) => t.status === 'active').map((t) => ({ job_id: t.job_id, staff_id: t.staff_id, eta_at: t.eta_at, km: t.km, minutes: t.minutes, route: t.route }))
  };
});
/* « Chiffres » and « Trésorerie »: worked out from the pretend rows like the database (Montréal days, deleted rows left
   out, what was received in the period by its payments: demo-08). Only the five months before the demo's seed are
   still made up (the seed has no history). */
const mDay = (iso: unknown) => (iso ? dayOf(new Date(String(iso))) : '');
const liveRow = (r: DemoRow) => !r.deleted_at;
registerRpc('dashboard', (a) => {
  need(can('money'), 'Tu n’as pas accès aux chiffres du garage.');
  const month = String(a.p_month || today()).slice(0, 7);
  const inv = table('invoices').filter((v) => liveRow(v) && ['issued', 'paid'].includes(String(v.status)) && mDay(v.issued_at).slice(0, 7) === month);
  const s = (k: string, list = inv) => list.reduce((n, v) => n + Number(v[k] || 0), 0);
  const jobs = table('jobs').filter((j) => String(j.day).slice(0, 7) === month && liveRow(j));
  const jobIds = new Set(jobs.map((j) => j.id));
  const trucks = new Map<string | null, { revenue_cents: number; invoices: number }>();
  for (const v of inv) {
    const t = (find('jobs', v.job_id)?.truck_id as string | null) ?? null;
    const c = trucks.get(t) || { revenue_cents: 0, invoices: 0 };
    c.revenue_cents += Number(v.subtotal_cents || 0); c.invoices++;
    trucks.set(t, c);
  }
  const last30 = addDays(today(), -30);
  const top = new Map<string, number>();
  for (const i of table('job_items')) {
    const j = find('jobs', i.job_id);
    if (!liveRow(i) || i.kind !== 'service' || !['planned', 'done', 'approved'].includes(String(i.status)) || j?.status !== 'done' || String(j.day) < last30) continue;
    top.set(String(i.description), (top.get(String(i.description)) || 0) + 1);
  }
  const issued = table('invoices').filter((v) => liveRow(v) && v.status === 'issued');
  return {
    month: month + '-01', revenue_cents: s('subtotal_cents'), tps_cents: s('tps_cents'), tvq_cents: s('tvq_cents'), invoices: inv.length, avg_ticket_cents: inv.length ? Math.round(s('subtotal_cents') / inv.length) : 0,
    collected_cents: table('payments').filter((p) => liveRow(p) && mDay(p.paid_at).slice(0, 7) === month).reduce((n, p) => n + Number(p.amount_cents), 0),
    receivable_cents: issued.reduce((n, v) => n + Number(v.total_cents) - Number(v.paid_cents), 0),
    receivable_count: issued.length, drafts: table('invoices').filter((v) => liveRow(v) && v.status === 'draft').length,
    jobs_done: jobs.filter((j) => j.status === 'done').length, jobs_booked: jobs.filter((j) => ['booked', 'en_route', 'on_site'].includes(String(j.status))).length,
    jobs_cancelled: jobs.filter((j) => j.status === 'cancelled').length, jobs_no_show: jobs.filter((j) => j.status === 'no_show').length,
    lost_cents: jobs.filter((j) => ['cancelled', 'no_show'].includes(String(j.status))).reduce((n, j) => n + Number(j.lost_cents || 0), 0),
    km: Math.round(table('trips').filter((t) => jobIds.has(String(t.job_id))).reduce((n, t) => n + Number(t.km || 0), 0) * 10) / 10,
    goal_cents: Number(((find('settings', '1')?.billing || {}) as { goal_cents?: number }).goal_cents ?? 0) || null,
    by_truck: [...trucks.entries()].map(([truck_id, c]) => ({ truck_id, ...c })),
    months: [5, 4, 3, 2, 1, 0].map((k) => ({ month: addMonths(`${month}-01`, -k), revenue_cents: k === 0 ? s('subtotal_cents') : 900000 + k * 137000 })),
    top_services: [...top.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name, n]) => ({ name, n }))
  };
});
registerRpc('treasury_report', (a) => {
  need(can('treasury'), 'Tu n’as pas accès à la trésorerie.');
  const from = String(a.p_from), to = String(a.p_to);
  const inside = (d: string) => d >= from && d <= to;
  const inv = table('invoices').filter((v) => liveRow(v) && ['issued', 'paid'].includes(String(v.status)) && inside(mDay(v.issued_at)));
  const ex = table('expenses').filter((e) => liveRow(e) && inside(String(e.day)));
  const pay = table('payments').filter((p) => liveRow(p) && inside(mDay(p.paid_at)));
  const s = (list: DemoRow[], k: string) => list.reduce((n, v) => n + Number(v[k] || 0), 0);
  const cats = new Map<string, { t: number; s: number; n: number }>();
  for (const e of ex) { const c = cats.get(String(e.category)) || { t: 0, s: 0, n: 0 }; c.t += Number(e.total_cents); c.s += Number(e.subtotal_cents); c.n++; cats.set(String(e.category), c); }
  const methods = new Map<string, { total: number; n: number }>();
  for (const p of pay) { const m = methods.get(String(p.method)) || { total: 0, n: 0 }; m.total += Number(p.amount_cents); m.n++; methods.set(String(p.method), m); }
  return {
    from, to,
    revenue: { subtotal: s(inv, 'subtotal_cents'), tps: s(inv, 'tps_cents'), tvq: s(inv, 'tvq_cents'), total: s(inv, 'total_cents'), count: inv.length },
    expenses: { subtotal: s(ex, 'subtotal_cents'), tps: s(ex, 'tps_cents'), tvq: s(ex, 'tvq_cents'), total: s(ex, 'total_cents'), count: ex.length },
    by_category: [...cats.entries()].map(([category, c]) => ({ category, total: c.t, subtotal: c.s, n: c.n })).sort((x, y) => y.total - x.total),
    collected: [...methods.entries()].map(([method, m]) => ({ method, total: m.total, n: m.n })),
    profit: s(inv, 'subtotal_cents') - s(ex, 'subtotal_cents'), tps_to_remit: s(inv, 'tps_cents') - s(ex, 'tps_cents'), tvq_to_remit: s(inv, 'tvq_cents') - s(ex, 'tvq_cents')
  };
});
