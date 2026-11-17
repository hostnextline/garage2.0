/* Every change the app makes goes through here: on screen at once, sent when possible (see sync.ts), refused with a
   clear message when the server says no. In « Voir l'app comme… » nothing can be changed. */
import { insertRow, updateRow, deleteRow, callRpc, uuid, forgetLocal, sentHooks, sendOrKeep, onConfirmed, pendingOps, flush } from './sync';
import { getRow, rowsOf } from './store';
import type { TableName } from './schema';
import { sb, callFn, preview, refreshAccess } from './auth';
import { ask } from './client';
import { REQUEST_MS } from './send';
import { itemsOf, settings, customerName, invoiceNumber } from './select';
import { t, tMaybe, lang } from '../lib/i18n';
import { money } from '../lib/money';
import type { Customer, CustomerNote, Vehicle, EngineSpec, Job, JobItem, Quote, Truck, TruckStart, Expense, InventoryItem, Invoice, Service, ServicePart, Settings, Staff, PayMethod, InvoiceLine } from './types';
import type { BlockKey, Range } from '../lib/dates';
import { appBase } from '../lib/config';
import { Refused, fromSource, classify } from '../lib/errors';
export { Refused, errorMessage } from '../lib/errors';

function guard() { if (preview.value) throw new Refused('preview', t('errors.preview')); }
const now = () => new Date().toISOString();
const SKIP = new Set(['phone_digits', 'created_at', 'updated_at', 'created_by', 'number', 'no_shows']);
async function upsert(table: TableName, obj: Record<string, unknown>, defaults: Record<string, unknown> = {}, label?: string): Promise<string> {
  const { id, ...rest } = obj as { id?: string };
  const clean = Object.fromEntries(Object.entries(rest).filter(([k]) => !SKIP.has(k)));
  if (id && getRow(table, id)) { await updateRow(table, id, clean, { label }); return id; }
  // a row this device does not hold may still exist on the server: what the person set is then sent as a change,
  // never the defaults (core-data-49)
  return (await insertRow(table, { ...defaults, ...clean, id: id || uuid(), created_at: now() }, { label, ...(id ? { patch: clean } : {}) })).id;
}

/* ---------- customers, cars, engine sheets ---------- */
/* a customer's file made, or its name / number changed, once it is on the server: its GoHighLevel contact is made or
   completed (the name on a number already there). In the background; a failure changes nothing in the app. */
sentHooks.customer = (id) => { void callFn('conversation', { action: 'contact', customer_id: id }, 20000).catch(() => undefined); };
export async function saveCustomer(c: Partial<Customer>): Promise<string> { guard(); return upsert('customers', c, { lang: 'fr' }, t('log.customer')); }
export async function deleteCustomer(id: string) { guard(); await deleteRow('customers', id); }
export async function saveNote(n: Partial<CustomerNote> & { customer_id: string }) { guard(); return upsert('customer_notes', n); }
export async function saveVehicle(v: Partial<Vehicle>): Promise<string> { guard(); return upsert('vehicles', v, {}, t('log.vehicle')); }
export async function saveSpec(spec: Partial<EngineSpec> & { key: string }) { guard(); return upsert('engine_specs', { ...spec, confirmed_at: now() }); }

/* ---------- booking and jobs ---------- */
export interface BookInput {
  id?: string; customer_id: string; vehicle_id?: string | null; day: string; block: BlockKey; duration_min?: number; truck_id?: string | null;
  problem?: string | null; notes?: string | null; address?: string | null; unit?: string | null; postal_code?: string | null; lat?: number | null; lng?: number | null;
  card_on_file?: boolean; source?: string; quote_id?: string | null;
  /** « Réserver quand même » in a full block (owner, office) */
  force?: boolean;
  /** the vehicle asked for (the switch above the moments offered); nothing: the app chooses, the car first */
  vehicle_kind?: 'car' | 'truck' | null;
  /** « Plages d'arrivée » (block 'day'): the window chosen (its start, minutes of the day; the server keeps the stop inside it), or
      win_flex: any time that day, the window is fixed the evening before */
  win_start?: number | null; win_flex?: boolean;
}
export type ItemInput = Partial<JobItem> & { description: string };
export async function bookJob(job: BookInput, items: ItemInput[]) {
  guard();
  const id = job.id || uuid();
  return callRpc<{ ok: boolean; job_id: string; truck_id: string | null; forced?: boolean }>('book_job', { p_job: { ...job, id }, p_items: items }, { label: t('log.booking') }).then((r) => ({ ...r, id }));
}
/** `opts.queue: false`: a move that must happen now or not at all (never kept on the phone for later: R188) */
export async function moveJob(jobId: string, day: string, block: BlockKey, truckId: string | null = null, win: { start?: number | null; flex?: boolean } | null = null, opts: { queue?: false } = {}) {
  guard();
  const o = { label: t('log.move'), ...(opts.queue === false ? { queue: false } : {}) };
  // « Plages d'arrivée »: the new window (or flexible) goes with the move; the old call stays as it was for the blocks
  if (win) return callRpc<{ ok: boolean; changed: boolean }>('move_job', { p_job: jobId, p_day: day, p_block: block, p_truck: truckId, p_win_start: win.start ?? null, p_win_flex: win.flex === true }, o);
  return callRpc<{ ok: boolean; changed: boolean }>('move_job', { p_job: jobId, p_day: day, p_block: block, p_truck: truckId }, o);
}
export async function setJobDuration(jobId: string, minutes: number) {
  guard();
  return callRpc('set_job_duration', { p_job: jobId, p_duration: minutes });
}
export async function updateJob(jobId: string, patch: Partial<Record<'problem' | 'notes' | 'vehicle_id' | 'address' | 'unit' | 'postal_code' | 'lat' | 'lng' | 'card_on_file' | 'odometer_km', unknown>>) {
  guard();
  await updateRow('jobs', jobId, patch, { label: t('log.job') });
}
/** « Modifier le rendez-vous »: booked with the wrong customer (Part 24 nonies): the right one, their car, their address */
export async function changeJobCustomer(jobId: string, customerId: string, vehicleId: string | null = null) {
  guard();
  return callRpc<{ ok: boolean; vehicle_id: string | null }>('job_customer', { p_job: jobId, p_customer: customerId, p_vehicle: vehicleId }, { label: t('log.job'), queue: false });
}
export type StepAction = 'leave' | 'arrive' | 'finish' | 'cancel' | 'no_show' | 'reopen' | 'back' | 'waiver';
export async function jobStep(jobId: string, action: StepAction, data: Record<string, unknown> = {}) {
  guard();
  return callRpc('job_step', { p_job: jobId, p_action: action, p_data: data }, { label: t(`log.step.${action}`) });
}
export async function walkIn(job: Omit<BookInput, 'day' | 'block'>, items: ItemInput[]) {
  guard();
  const id = job.id || uuid();
  return callRpc<{ ok: boolean; job_id: string }>('walk_in', { p_job: { ...job, id }, p_items: items }, { label: t('log.walkIn') }).then((r) => ({ ...r, id }));
}
export async function addItem(jobId: string, item: ItemInput) {
  guard();
  // after the job's last line (a clock modulo used to wrap every 100 s and put a later line first: core-data-29)
  const sort = itemsOf(jobId).reduce((m, i) => Math.max(m, Number(i.sort) || 0), 0) + 1;
  return (await insertRow('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', sort, ...item, job_id: jobId, id: item.id || uuid(), created_at: now() })).id;
}
export async function updateItem(id: string, patch: Partial<JobItem>) { guard(); await updateRow('job_items', id, patch); }
export async function removeItem(id: string) { guard(); await deleteRow('job_items', id); }
/** « Changer le prix » of a line (everyone on the team; the server keeps the old and new prices) */
export async function setItemPrice(id: string, unitCents: number) { guard(); return callRpc('job_item_price', { p_item: id, p_unit_cents: unitCents }, { label: t('log.price') }); }
export async function answerExtra(itemId: string, accept: boolean, via: 'signature' | 'verbal', attachmentId: string | null = null) {
  guard();
  return callRpc('extra_answer', { p_item: itemId, p_accept: accept, p_via: via, p_attachment: attachmentId });
}
export async function saveSignature(jobId: string, dataUrl: string, signer: string, version: string) {
  guard();
  const [head, data] = dataUrl.split(',');
  const mime = /image\/(png|jpeg|svg\+xml)/.exec(head)?.[0] || 'image/png';
  // kept in the outbox like any change: a signature taken with no signal is sent when it comes back
  const att = await insertRow('attachments', { id: uuid(), kind: 'signature', mime, data, bytes: Math.round(data.length * 0.75), job_id: jobId, created_at: now() });
  return jobStep(jobId, 'waiver', { signer, version, attachment_id: att.id });
}

/* ---------- « Historique du véhicule »: every visit of a car by its VIN, whoever owned it (needs the network) ---------- */
export interface VinVisit { job_id: string; number: number; day: string; status: string; here: boolean; open: boolean; work: string[]; km?: number | null }
export async function vinHistory(vin: string, customerId: string | null = null): Promise<VinVisit[]> {
  const r = await callRpc<{ vin: string; visits: VinVisit[] }>('vin_history', { p_vin: vin, p_customer: customerId }, { noOp: true });
  return r.data?.visits || [];
}

/* ---------- invoices and payments ---------- */
export async function invoiceForJob(jobId: string, refresh = true) { guard(); return callRpc('invoice_for_job', { p_job: jobId, p_refresh: refresh }, { label: t('log.invoice') }); }
export async function saveInvoiceDraft(id: string, patch: { lines?: InvoiceLine[]; taxes_on?: boolean; notes?: string | null }) { guard(); await updateRow('invoices', id, patch); }
export async function finishInvoice(id: string) { guard(); return callRpc<{ ok: boolean; number: number; again?: boolean }>('invoice_finish', { p_invoice: id }, { label: t('log.invoiceFinish') }); }

/** the payments of this invoice still waiting on this phone to be sent: those aimed at it, and those of its job that
    name no invoice (the server puts them on the job's finished invoice). One aimed at another invoice of the same job
    goes there whatever happens to this one: it does not hold this one back. */
function paymentWaitingFor(invoiceId: string): boolean {
  const jobId = getRow<Invoice>('invoices', invoiceId)?.job_id ?? null;
  return pendingOps((e) => e.kind === 'rpc' && e.rpc === 'payment_add' && !!e.args
    && (e.args.p_invoice === invoiceId || (e.args.p_invoice == null && !!jobId && e.args.p_job === jobId))).length > 0;
}
const PAYMENT_WAITING: Record<string, string> = {
  fr: 'Un paiement de cette facture attend encore d’être envoyé. Attends qu’il parte, puis modifie la facture.',
  en: 'A payment of this invoice is still waiting to be sent. Wait until it has left, then change the invoice.'
};
/** « Modifier la facture »: a finished invoice not paid goes back to a draft with its number (needs the network).
    It goes straight to the server: while a payment of this invoice still waits in the outbox, it would get there first
    and the payment would then be refused hours later (argent-app-03). The payment is given its chance to leave first
    (8 s at most); still waiting, the reopen is refused here and nothing changes. */
export async function reopenInvoice(id: string) {
  guard();
  if (paymentWaitingFor(id)) {
    await Promise.race([flush(), new Promise((r) => setTimeout(r, 8000))]);
    if (paymentWaitingFor(id)) throw new Refused('payment_waiting', tMaybe('errors.payment_waiting') ?? PAYMENT_WAITING[lang.value] ?? PAYMENT_WAITING.fr);
  }
  return callRpc<{ ok: boolean; number: number }>('invoice_reopen', { p_invoice: id }, { queue: false });
}
/** what the outbox says of a payment (the « en attente » and « refusé » lists, the stuck banner): how much, how and for
    whom, so a cash payment refused hours later still says which customer and how much to give back (argent-app-03) */
export function paymentLabel(invoiceId: string | null, amountCents: number, method: PayMethod, jobId: string | null = null): string {
  const inv = getRow<Invoice>('invoices', invoiceId);
  const jb = getRow<Job>('jobs', jobId ?? inv?.job_id ?? null);
  const who = customerName(getRow<Customer>('customers', inv?.customer_id ?? jb?.customer_id ?? null));
  const how = tMaybe(`invoices.methods.${method}`);
  const amount = `${money(amountCents, lang.value)}${how ? ` (${how})` : ''}`;
  return [`${t('log.payment')} ${amount}`, who, invoiceNumber(inv)].filter(Boolean).join(' · ');
}
export async function addPayment(invoiceId: string | null, amountCents: number, method: PayMethod, reference: string | null = null, jobId: string | null = null) {
  guard();
  return callRpc('payment_add', { p_invoice: invoiceId, p_amount_cents: amountCents, p_method: method, p_reference: reference, p_job: jobId, p_session: null }, { label: paymentLabel(invoiceId, amountCents, method, jobId) });
}
export async function removePayment(id: string) { guard(); return callRpc('payment_remove', { p_payment: id }); }
export async function voidInvoice(id: string, reason: string) { guard(); return callRpc('invoice_void', { p_invoice: id, p_reason: reason }); }
export async function saveQuote(q: Partial<Quote>): Promise<string> { guard(); return upsert('quotes', q, { status: 'open', lang: lang.value, items: [] }); }

/* ---------- trucks and hours ---------- */
export async function saveTruck(tr: Partial<Truck>): Promise<string> { guard(); return upsert('trucks', tr, { active: true, sort: 0 }); }
export async function applyHours(truckId: string, mode: 'day' | 'weeks' | 'always', week: Record<number, Range[]>, from: string, weeks = 1) {
  guard();
  return callRpc('apply_hours', { p_truck: truckId, p_mode: mode, p_week: week, p_from: from, p_weeks: weeks }, { label: t('log.hours') });
}

/** where one truck leaves from (null: « Départ des camions »); the server plans the coming blocks again (Part 18) */
export async function setTruckStart(truckId: string, start: TruckStart | null) {
  guard();
  return callRpc('set_truck_start', { p_truck: truckId, p_start: start }, { label: t('log.truckStart') });
}

/** the order of a truck's stops in a block, by hand (an empty list: back to the planner's order) */
export async function setStopOrder(truckId: string, day: string, block: string, jobIds: string[]) {
  guard();
  return callRpc('set_stop_order', { p_truck: truckId, p_day: day, p_block: block, p_jobs: jobIds }, { label: t('log.stopOrder') });
}

/* ---------- « Plages d'arrivée » (Part 25): both need the network (never kept for later) ---------- */
/** the garage books by 4-hour arrival windows (on) or by blocks (off): the server converts the coming appointments (owner) */
export async function windowsSwitch(on: boolean) {
  guard();
  return (await callRpc<{ ok: boolean; converted: number }>('windows_switch', { p_on: on }, { label: t('log.settings'), queue: false })).data;
}
/** the « flexible » appointments of a day get their window now, from where the route puts them (owner, office) */
export async function lockWindows(day: string) {
  guard();
  return (await callRpc<{ ok: boolean; fixed: number; jobs?: string[] }>('lock_windows', { p_day: day }, { label: t('log.settings'), queue: false })).data;
}

/* ---------- the conversation with a customer (GoHighLevel, both ways) ---------- */
/** `files`: the web addresses of the pictures and documents that came with the message */
export interface ChatMessage { id: string; at: string | null; dir: 'in' | 'out'; body: string; kind: string; status: string | null; files?: string[] }
export async function conversation(customerId: string) {
  return callFn<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }>('conversation', { action: 'get', customer_id: customerId }, 20000);
}
/** `op`: one id per typed text, kept until it is sent: the same text sent again (a lost answer, a second tap) goes once */
export async function sendChat(customerId: string, message: string, op?: string) {
  guard();
  return callFn<{ status: string; error?: string }>('conversation', { action: 'send', customer_id: customerId, message, ...(op ? { op } : {}) }, 20000);
}

/** the same with a number that has no file yet (somebody new who texted the garage): the owner only */
export async function conversationPhone(phone: string) {
  return callFn<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }>('conversation', { action: 'get', phone }, 20000);
}
export async function sendChatPhone(phone: string, message: string, op?: string) {
  guard();
  return callFn<{ status: string; error?: string }>('conversation', { action: 'send', phone, message, ...(op ? { op } : {}) }, 20000);
}

/* ---------- « Coffre » (family and friends, Part 20): no invoice, no taxes, its own register (owner) ---------- */
export async function coffreAdd(jobIds: string[], amountCents: number, note: string | null, day: string | null = null) {
  guard();
  return callRpc<{ ok: boolean; id: string }>('coffre_add', { p_jobs: jobIds, p_amount: amountCents, p_note: note, p_day: day }, { label: t('log.coffre') });
}
export async function coffreRemove(id: string) {
  guard();
  return callRpc('coffre_remove', { p_id: id }, { label: t('log.coffre') });
}

/* ---------- settings, team ---------- */
/** a part of the settings saved whole: what the screen showed before goes with it, so only the keys the person changed
    overwrite the server's when it is sent (another device's change to another key stays: core-data-19) */
export async function saveSettings(part: keyof Settings, value: unknown) {
  guard();
  await updateRow('settings', '1', { [part]: value }, { label: t('log.settings'), prev: { [part]: settings.value[part] } });
}
export async function saveService(sv: Partial<Service>): Promise<string> { guard(); return upsert('services', sv, { active: true, taxable: true, is_promo: false, includes: [], category: 'autre', duration_min: 60, sort: 0 }); }
export async function saveServicePart(sp: Partial<ServicePart>) { guard(); return upsert('service_parts', sp, { qty: 1 }); }
export async function setRoleRight(role: string, right: string, on: boolean) { guard(); return callRpc('set_role_rights', { p_role: role, p_right: right, p_on: on }, { queue: false }); }
export async function memberUpdate(staffId: string, patch: Partial<Staff>) {
  guard();
  const r = await callRpc('member_update', { p_staff: staffId, p_patch: patch }, { queue: false });
  await refreshAccess();
  return r;
}
/** my own phone, language, switches: sent now; without signal kept on the phone and sent later; a refusal is listed in
    the frame (it used to be dropped in silence while the screen said « Enregistré »: core-data-30) */
export async function updateMe(patch: { phone?: string; lang?: string; prefs?: Record<string, unknown> }) {
  if (preview.value) return;
  try { await sendOrKeep('update_me', { p_patch: patch }); } catch { /* signed out meanwhile: the account keeps its old value */ }
}

/* ---------- treasury and inventory ---------- */
export async function saveExpense(e: Partial<Expense>): Promise<string> { guard(); return upsert('expenses', e, { category: 'Autre', subtotal_cents: 0, tps_cents: 0, tvq_cents: 0, total_cents: 0 }, t('log.expense')); }
/** a receipt picture, sent straight away (receipts are not kept on every phone). `opts.id`: the id the screen keeps for
    this picture, so sending it again (a lost answer) is harmless: « already there » is a success; `opts.signal` stops it
    (R116) */
export async function saveReceipt(dataUrl: string, w: number, h: number, opts: { id?: string; signal?: AbortSignal } = {}): Promise<string> {
  guard();
  const [head, data] = dataUrl.split(',');
  const mime = /image\/(png|jpeg|webp)|application\/pdf/.exec(head)?.[0] || 'image/jpeg';
  const id = opts.id || uuid();
  // a picture gets the time it needs, then stops
  const ms = Math.min(120000, REQUEST_MS + Math.floor(data.length / 20000) * 1000);
  try {
    await ask((s) => sb.from('attachments').insert({ id, kind: 'receipt', mime, data, bytes: Math.round(data.length * 0.75), width: w, height: h }).abortSignal(s), ms, opts.signal);
  } catch (e) {
    if (!(opts.id && classify(e).sub === 'duplicate')) throw e;
  }
  return id;
}
/** the plain pictures a kept attachment may be shown as (an SVG can carry a script: never trusted, x-security-01) */
const SAFE_PICTURE = /^image\/(jpeg|png|webp|gif)$/;
/** a picture kept on the server (a signature), as a data URL. null when there is none, or when what is stored is not a
    plain picture; a read that fails throws (no signal or the server unwell is not « no signature »: R106) */
export async function loadAttachment(id: string): Promise<string | null> {
  const data = await ask<{ mime: string; data: string } | null>((s) => sb.from('attachments').select('mime, data').eq('id', id).abortSignal(s).maybeSingle(), 30000);
  if (!data || typeof data.data !== 'string') return null;
  const mime = String(data.mime || '').trim().toLowerCase();
  return SAFE_PICTURE.test(mime) ? `data:${mime};base64,${data.data}` : null;
}
export async function saveInventoryItem(i: Partial<InventoryItem>): Promise<string> {
  guard();
  const { qty, ...rest } = i;
  const isNew = !(i.id && getRow('inventory_items', i.id));
  const id = await upsert('inventory_items', rest, { unit: 'unité', active: true, qty: 0 });
  if (isNew && qty) await moveStock(id, Number(qty), 'restock', null);
  return id;
}
/** an item removed with no trace: the server deletes it with its moves and its links to services; the phone forgets them */
export async function deleteInventoryItem(id: string) {
  guard();
  const r = await callRpc('inventory_delete', { p_item: id }, { label: t('log.inventory') });
  // forgotten once the server has really deleted them (a refused delete no longer loses the item on this phone)
  const forget = () => {
    const moves = rowsOf<{ id: string; item_id: string }>('inventory_moves').filter((m) => m.item_id === id).map((m) => m.id);
    const links = rowsOf<{ id: string; item_id: string }>('service_parts').filter((p) => p.item_id === id).map((p) => p.id);
    void forgetLocal('inventory_moves', moves);
    void forgetLocal('service_parts', links);
    void forgetLocal('inventory_items', [id]);
  };
  if (r.queued && r.op) onConfirmed(r.op, forget); else forget();
  return r;
}
/** stock bought: the quantity comes in and the money leaves the Trésorerie (an expense) or the Coffre, in one step */
export type PaidFrom = 'treasury' | 'coffre' | 'none';
/** `op`: one id per submission of the form (a repeat after a reload is done once by the server: R212) */
export async function buyStock(itemId: string, qty: number, totalCents: number | null, from: PaidFrom, vendor: string | null, note: string | null, op?: string) {
  guard();
  return callRpc('inventory_buy', { p_item: itemId, p_qty: qty, p_total_cents: totalCents, p_from: from, p_vendor: vendor, p_note: note, ...(op ? { p_op: op } : {}) }, { label: t('log.inventory') });
}
/** `id`: the move's own id, given by the form (the same move sent twice is one row: R212) */
export async function moveStock(itemId: string, delta: number, reason: 'restock' | 'adjust' | 'used' | 'return', note: string | null, id?: string) {
  guard();
  return (await insertRow('inventory_moves', { id: id || uuid(), item_id: itemId, delta, reason, note, created_at: now() })).id;
}

/* ---------- the day ---------- */
export async function shiftStart() { guard(); return callRpc('shift_start', {}, { noOp: true }); }
export async function shiftEnd() { guard(); return callRpc('shift_end', {}, { noOp: true }); }
export async function reportPosition(lat: number, lng: number, accuracy: number | null, heading: number | null, speed: number | null, jobId: string | null) {
  if (preview.value) return { ok: false };
  // a request that hangs no longer holds back the next positions: it stops after 15 s
  const data = await ask((s) => sb.rpc('report_position', { p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_heading: heading, p_speed: speed, p_job: jobId }).abortSignal(s), REQUEST_MS).catch(() => undefined);
  return data as { ok: boolean; reason?: string };
}

/* ---------- needs the network (each request stops at its limit; the error says no signal, server unwell or refused) ---------- */
export async function suggestBlocks(lat: number | null, lng: number | null, duration: number, from: string, days = 14, exclude: string | null = null, need = false, kind: 'car' | 'truck' | null = null) {
  const data = await ask((s) => sb.rpc('suggest_blocks', { p_lat: lat, p_lng: lng, p_duration: duration, p_from: from, p_days: days, p_exclude: exclude, p_limit: 60, p_need: need, p_kind: kind }).abortSignal(s), REQUEST_MS);
  /* every moment of the page, the best first. « Garde-route » (optional: an older server does not send them): what the
     job adds to the truck's whole day (add_min, add_km), the day's driving with it (day_min), the longest drive to a
     neighbouring customer that day (hop_min, null without another stop), the truck's other stops (stops), and
     far = 'hop' | 'day' when a limit of the settings is passed (null = fine) */
  return (data || []) as Suggestion[];
}
/** a moment offered. With « Plages d'arrivée »: block 'day', the estimated arrival and the window to tell the customer */
export interface Suggestion { day: string; block: BlockKey; drive_min: number; near: number; truck: string | null; left: number; eta?: number | null; win_start?: number | null; win_end?: number | null;
  pos?: number; add_min?: number; add_km?: number; day_min?: number; hop_min?: number | null; stops?: number; far?: 'hop' | 'day' | null }
/** « Plages d'arrivée »: every window still possible on one day (the best first), for « Autres heures ce jour-là » */
export async function suggestWindows(lat: number | null, lng: number | null, duration: number, day: string, exclude: string | null = null, need = false, kind: 'car' | 'truck' | null = null) {
  const data = await ask((s) => sb.rpc('suggest_windows', { p_lat: lat, p_lng: lng, p_duration: duration, p_day: day, p_exclude: exclude, p_need: need, p_kind: kind }).abortSignal(s), REQUEST_MS);
  return (data || []) as Suggestion[];
}
export async function rpcNow<T>(name: string, args: Record<string, unknown>, ms = 15000): Promise<T> {
  try { return (await ask((s) => sb.rpc(name, args).abortSignal(s), ms)) as T; }
  catch (e) { throw fromSource(e, name); }
}
/** `op`: one id per text sent, kept by the screen until it succeeds: the same send asked twice (an answer lost, a second
    tap) is one text on the server; a new one for a deliberate « Renvoyer » */
export async function notify(kind: string, jobId: string, opts: { resend?: boolean; op?: string } = {}) {
  guard();
  return callFn<{ status: string; message?: string; link?: string; phone?: string | null }>('notify', { kind, job_id: jobId, base: appBase(), ...opts });
}
/** the trip of a job (start, refresh, end), or the trip back to the start after the last job (return, return_end: no job) */
export async function enroute(action: 'start' | 'refresh' | 'end' | 'return' | 'return_end', jobId: string | null, opts: { pos?: { lat: number; lng: number }; notify?: boolean; resend?: boolean; op?: string } = {}) {
  guard();
  return callFn<{ sms: string; link?: string; message?: string; phone?: string | null; place?: string; eta_at?: string | null; minutes?: number | null; km?: number | null; rows?: unknown }>('enroute', { action, ...(jobId ? { job_id: jobId } : {}), base: appBase(), ...opts });
}
export async function team<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}) {
  if (!['list', 'secrets', 'invite-info'].includes(action)) guard();
  return callFn<T>('team', { action, base: appBase(), ...body });
}
export async function decodeVin(vin: string) {
  return callFn<{ vehicle: Record<string, unknown> }>('vin', { vin }, 15000);
}
