/* Every change the app makes goes through here: on screen at once, sent when possible (see sync.ts), refused with a
   clear message when the server says no. In « Voir l'app comme… » nothing can be changed. */
import { insertRow, updateRow, deleteRow, callRpc, uuid, isNetworkError } from './sync';
import { getRow } from './store';
import type { TableName } from './schema';
import { sb, callFn, preview, refreshAccess } from './auth';
import { t, lang } from '../lib/i18n';
import type { Customer, CustomerNote, Vehicle, EngineSpec, JobItem, Quote, Truck, Expense, InventoryItem, Service, ServicePart, Settings, Staff, PayMethod, InvoiceLine } from './types';
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
}
export type ItemInput = Partial<JobItem> & { description: string };
export async function bookJob(job: BookInput, items: ItemInput[]) {
  guard();
  const id = job.id || uuid();
  return callRpc<{ ok: boolean; job_id: string; truck_id: string | null }>('book_job', { p_job: { ...job, id }, p_items: items }, { label: t('log.booking') }).then((r) => ({ ...r, id }));
}
export async function moveJob(jobId: string, day: string, block: BlockKey, truckId: string | null = null) {
  guard();
  return callRpc<{ ok: boolean; changed: boolean }>('move_job', { p_job: jobId, p_day: day, p_block: block, p_truck: truckId }, { label: t('log.move') });
}
export async function setJobDuration(jobId: string, minutes: number) {
  guard();
  return callRpc('set_job_duration', { p_job: jobId, p_duration: minutes });
}
export async function updateJob(jobId: string, patch: Partial<Record<'problem' | 'notes' | 'vehicle_id' | 'address' | 'unit' | 'postal_code' | 'lat' | 'lng' | 'card_on_file', unknown>>) {
  guard();
  await updateRow('jobs', jobId, patch, { label: t('log.job') });
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
export async function answerExtra(itemId: string, accept: boolean, via: 'signature' | 'verbal') {
  guard();
  return callRpc('extra_answer', { p_item: itemId, p_accept: accept, p_via: via });
}
export async function saveSignature(jobId: string, dataUrl: string, signer: string, version: string) {
  guard();
  const [head, data] = dataUrl.split(',');
  const mime = /image\/(png|jpeg|svg\+xml)/.exec(head)?.[0] || 'image/png';
  // kept in the outbox like any change: a signature taken with no signal is sent when it comes back
  const att = await insertRow('attachments', { id: uuid(), kind: 'signature', mime, data, bytes: Math.round(data.length * 0.75), job_id: jobId, created_at: now() });
  return jobStep(jobId, 'waiver', { signer, version, attachment_id: att.id });
}

/* ---------- invoices and payments ---------- */
export async function invoiceForJob(jobId: string, refresh = true) { guard(); return callRpc('invoice_for_job', { p_job: jobId, p_refresh: refresh }, { label: t('log.invoice') }); }
export async function saveInvoiceDraft(id: string, patch: { lines?: InvoiceLine[]; taxes_on?: boolean; notes?: string | null }) { guard(); await updateRow('invoices', id, patch); }
export async function finishInvoice(id: string) { guard(); return callRpc<{ ok: boolean; number: number }>('invoice_finish', { p_invoice: id }, { label: t('log.invoiceFinish') }); }
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
export async function suggestBlocks(lat: number | null, lng: number | null, duration: number, from: string, days = 14, exclude: string | null = null) {
  const { data, error } = await sb.rpc('suggest_blocks', { p_lat: lat, p_lng: lng, p_duration: duration, p_from: from, p_days: days, p_exclude: exclude, p_limit: 6 });
  if (error) throw error;
  return (data || []) as { day: string; block: BlockKey; drive_min: number; near: number; truck: string | null; left: number }[];
}
export async function rpcNow<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function notify(kind: string, jobId: string, opts: { resend?: boolean } = {}) {
  guard();
  return callFn<{ status: string; message?: string; link?: string; phone?: string | null }>('notify', { kind, job_id: jobId, base: appBase(), ...opts });
}
export async function enroute(action: 'start' | 'refresh' | 'end', jobId: string, opts: { pos?: { lat: number; lng: number }; notify?: boolean; resend?: boolean } = {}) {
  guard();
  return callFn<{ sms: string; link?: string; message?: string; phone?: string | null; eta_at?: string | null; minutes?: number | null; km?: number | null; rows?: unknown }>('enroute', { action, job_id: jobId, base: appBase(), ...opts });
}
export async function team<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}) {
  if (!['list', 'secrets', 'invite-info'].includes(action)) guard();
  return callFn<T>('team', { action, base: appBase(), ...body });
}
export async function decodeVin(vin: string) {
  return callFn<{ vehicle: Record<string, unknown> }>('vin', { vin }, 15000);
}
