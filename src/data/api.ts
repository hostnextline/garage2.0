/* Every change the app makes goes through here: on screen at once, sent when possible (see sync.ts), refused with a
   clear message when the server says no. In « Voir l'app comme… » nothing can be changed. */
import { insertRow, updateRow, deleteRow, callRpc, uuid, isNetworkError, forgetLocal, sentHooks } from './sync';
import { getRow, rowsOf } from './store';
import type { TableName } from './schema';
import { sb, callFn, preview, refreshAccess } from './auth';
import { t, lang } from '../lib/i18n';
import type { Customer, CustomerNote, Vehicle, EngineSpec, JobItem, Quote, Truck, TruckStart, Expense, InventoryItem, Service, ServicePart, Settings, Staff, PayMethod, InvoiceLine } from './types';
import type { BlockKey, Range } from '../lib/dates';
import { appBase } from '../lib/config';

export class Refused extends Error {
  constructor(public code: string, message: string) { super(message); }
}
/** the message to show a person for an error (the server's own words, translated when we know the case) */
export function errorMessage(e: unknown): string {
  if (!e) return t('common.genericError', { msg: '' });
  if (typeof e === 'string') return e;
  const err = e as { hint?: string; code?: string; message?: string; error?: string };
  if (isNetworkError(err)) return t('common.networkError');
  // our own refusals carry a short code (database: hint; server functions: code) and a French sentence
  const own = String(err.hint || (/^[a-z_]+$/.test(String(err.code || '')) ? err.code : '') || '');
  const said = String(err.error || err.message || '');
  if (own) {
    if (lang.value === 'fr' && said) return said;
    const k = `errors.${own}`; const tr = t(k);
    if (tr !== k) return tr;
    return said || t('common.genericError', { msg: own });
  }
  if (err.code === '42501' || /row-level security|permission denied/i.test(said)) return lang.value === 'fr' && /[éèàù’]/.test(said) ? said : t('common.notAllowed');
  return t('common.genericError', { msg: said });
}
function guard() { if (preview.value) throw new Refused('preview', t('errors.preview')); }
const now = () => new Date().toISOString();
const SKIP = new Set(['phone_digits', 'created_at', 'updated_at', 'created_by', 'number', 'no_shows']);
async function upsert(table: TableName, obj: Record<string, unknown>, defaults: Record<string, unknown> = {}, label?: string): Promise<string> {
  const { id, ...rest } = obj as { id?: string };
  const clean = Object.fromEntries(Object.entries(rest).filter(([k]) => !SKIP.has(k)));
  if (id && getRow(table, id)) { await updateRow(table, id, clean, { label }); return id; }
  return (await insertRow(table, { ...defaults, ...clean, id: id || uuid(), created_at: now() }, { label })).id;
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
}
export type ItemInput = Partial<JobItem> & { description: string };
export async function bookJob(job: BookInput, items: ItemInput[]) {
  guard();
  const id = job.id || uuid();
  return callRpc<{ ok: boolean; job_id: string; truck_id: string | null; forced?: boolean }>('book_job', { p_job: { ...job, id }, p_items: items }, { label: t('log.booking') }).then((r) => ({ ...r, id }));
}
export async function moveJob(jobId: string, day: string, block: BlockKey, truckId: string | null = null) {
  guard();
  return callRpc<{ ok: boolean; changed: boolean }>('move_job', { p_job: jobId, p_day: day, p_block: block, p_truck: truckId }, { label: t('log.move') });
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
  return (await insertRow('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', sort: Date.now() % 100000, ...item, job_id: jobId, id: item.id || uuid(), created_at: now() })).id;
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
/** « Modifier la facture »: a finished invoice not paid goes back to a draft with its number (needs the network) */
export async function reopenInvoice(id: string) { guard(); return callRpc<{ ok: boolean; number: number }>('invoice_reopen', { p_invoice: id }, { queue: false }); }
export async function addPayment(invoiceId: string | null, amountCents: number, method: PayMethod, reference: string | null = null, jobId: string | null = null) {
  guard();
  return callRpc('payment_add', { p_invoice: invoiceId, p_amount_cents: amountCents, p_method: method, p_reference: reference, p_job: jobId, p_session: null }, { label: t('log.payment') });
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

/* ---------- the conversation with a customer (GoHighLevel, both ways) ---------- */
export interface ChatMessage { id: string; at: string | null; dir: 'in' | 'out'; body: string; kind: string; status: string | null }
export async function conversation(customerId: string) {
  return callFn<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }>('conversation', { action: 'get', customer_id: customerId }, 20000);
}
export async function sendChat(customerId: string, message: string) {
  guard();
  return callFn<{ status: string; error?: string }>('conversation', { action: 'send', customer_id: customerId, message }, 20000);
}

/** the same with a number that has no file yet (somebody new who texted the garage): the owner only */
export async function conversationPhone(phone: string) {
  return callFn<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }>('conversation', { action: 'get', phone }, 20000);
}
export async function sendChatPhone(phone: string, message: string) {
  guard();
  return callFn<{ status: string; error?: string }>('conversation', { action: 'send', phone, message }, 20000);
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
export async function saveSettings(part: keyof Settings, value: unknown) { guard(); await updateRow('settings', '1', { [part]: value }, { label: t('log.settings') }); }
export async function saveService(sv: Partial<Service>): Promise<string> { guard(); return upsert('services', sv, { active: true, taxable: true, is_promo: false, includes: [], category: 'autre', duration_min: 60, sort: 0 }); }
export async function saveServicePart(sp: Partial<ServicePart>) { guard(); return upsert('service_parts', sp, { qty: 1 }); }
export async function setRoleRight(role: string, right: string, on: boolean) { guard(); return callRpc('set_role_rights', { p_role: role, p_right: right, p_on: on }, { queue: false }); }
export async function memberUpdate(staffId: string, patch: Partial<Staff>) {
  guard();
  const r = await callRpc('member_update', { p_staff: staffId, p_patch: patch }, { queue: false });
  await refreshAccess();
  return r;
}
export async function updateMe(patch: { phone?: string; lang?: string; prefs?: Record<string, unknown> }) {
  if (preview.value) return;
  try { await sb.rpc('update_me', { p_patch: patch }); } catch { /* the device keeps it until next time */ }
}

/* ---------- treasury and inventory ---------- */
export async function deleteExpense(id: string) { guard(); await deleteRow('expenses', id, { label: t('log.expense') }); }
export async function saveExpense(e: Partial<Expense>): Promise<string> { guard(); return upsert('expenses', e, { category: 'Autre', subtotal_cents: 0, tps_cents: 0, tvq_cents: 0, total_cents: 0 }, t('log.expense')); }
export async function saveReceipt(dataUrl: string, w: number, h: number): Promise<string> {
  guard();
  const [head, data] = dataUrl.split(',');
  const mime = /image\/(png|jpeg|webp)|application\/pdf/.exec(head)?.[0] || 'image/jpeg';
  const id = uuid();
  // receipts are sent straight away (they are not kept on every phone)
  const { error } = await sb.from('attachments').insert({ id, kind: 'receipt', mime, data, bytes: Math.round(data.length * 0.75), width: w, height: h });
  if (error) throw error;
  return id;
}
export async function loadAttachment(id: string): Promise<string | null> {
  const { data } = await sb.from('attachments').select('mime, data').eq('id', id).maybeSingle();
  return data ? `data:${(data as { mime: string }).mime};base64,${(data as { data: string }).data}` : null;
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
  const moves = rowsOf<{ id: string; item_id: string }>('inventory_moves').filter((m) => m.item_id === id).map((m) => m.id);
  const links = rowsOf<{ id: string; item_id: string }>('service_parts').filter((p) => p.item_id === id).map((p) => p.id);
  await forgetLocal('inventory_moves', moves);
  await forgetLocal('service_parts', links);
  await forgetLocal('inventory_items', [id]);
  return r;
}
/** stock bought: the quantity comes in and the money leaves the Trésorerie (an expense) or the Coffre, in one step */
export type PaidFrom = 'treasury' | 'coffre' | 'none';
export async function buyStock(itemId: string, qty: number, totalCents: number | null, from: PaidFrom, vendor: string | null, note: string | null) {
  guard();
  return callRpc('inventory_buy', { p_item: itemId, p_qty: qty, p_total_cents: totalCents, p_from: from, p_vendor: vendor, p_note: note }, { label: t('log.inventory') });
}
export async function moveStock(itemId: string, delta: number, reason: 'restock' | 'adjust' | 'used' | 'return', note: string | null) {
  guard();
  return (await insertRow('inventory_moves', { id: uuid(), item_id: itemId, delta, reason, note, created_at: now() })).id;
}

/* ---------- the day ---------- */
export async function shiftStart() { guard(); return callRpc('shift_start', {}, { noOp: true }); }
export async function shiftEnd() { guard(); return callRpc('shift_end', {}, { noOp: true }); }
export async function reportPosition(lat: number, lng: number, accuracy: number | null, heading: number | null, speed: number | null, jobId: string | null) {
  if (preview.value) return { ok: false };
  const { data } = await sb.rpc('report_position', { p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_heading: heading, p_speed: speed, p_job: jobId });
  return data as { ok: boolean; reason?: string };
}

/* ---------- needs the network ---------- */
function inTime<T>(p: PromiseLike<T>, ms = 15000): Promise<T> {
  return new Promise<T>((res, rej) => {
    const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    Promise.resolve(p).then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); });
  });
}
export async function suggestBlocks(lat: number | null, lng: number | null, duration: number, from: string, days = 14, exclude: string | null = null, need = false, kind: 'car' | 'truck' | null = null) {
  const { data, error } = await inTime(sb.rpc('suggest_blocks', { p_lat: lat, p_lng: lng, p_duration: duration, p_from: from, p_days: days, p_exclude: exclude, p_limit: 6, p_need: need, p_kind: kind }));
  if (error) throw error;
  return (data || []) as { day: string; block: BlockKey; drive_min: number; near: number; truck: string | null; left: number }[];
}
export async function rpcNow<T>(name: string, args: Record<string, unknown>, ms = 15000): Promise<T> {
  const { data, error } = await inTime(sb.rpc(name, args), ms);
  if (error) throw error;
  return data as T;
}
export async function notify(kind: string, jobId: string, opts: { resend?: boolean } = {}) {
  guard();
  return callFn<{ status: string; message?: string; link?: string; phone?: string | null }>('notify', { kind, job_id: jobId, base: appBase(), ...opts });
}
/** the trip of a job (start, refresh, end), or the trip back to the start after the last job (return, return_end: no job) */
export async function enroute(action: 'start' | 'refresh' | 'end' | 'return' | 'return_end', jobId: string | null, opts: { pos?: { lat: number; lng: number }; notify?: boolean; resend?: boolean } = {}) {
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
