/* The treasury's reads and writes that api.ts does not have yet: the receipt sent even with no signal (it then waits
   in the outbox, before the expense that points to it), deleting an expense, the categories, the export lines. */
import { computed } from '@preact/signals';
import { Refused, saveReceipt, loadAttachment } from '../../data/api';
import { insertRow, deleteRow, isNetworkError, uuid, refetch } from '../../data/sync';
import { getRow } from '../../data/store';
import { preview } from '../../data/auth';
import { settings, expensesList, invoicesList, invoiceNumber, customer, customerName, truckLabel } from '../../data/select';
import { invoiceStatusWord } from '../../ui';
import { t } from '../../lib/i18n';
import { dayOf } from '../../lib/dates';
import type { Expense, Invoice } from '../../data/types';
import { inRange, type DayRange } from './period';
import { withTimeout } from '../dashboard/useReport';
import type { Photo } from './ocr';
import type { ExpenseLine, RevenueLine } from './exports';

/** the garage's list (Réglages); the database starts every garage with this one */
export const DEFAULT_CATEGORIES = ['Pièces', 'Huile et liquides', 'Carburant', 'Outils et équipement', 'Entretien des camions', 'Assurances', 'Publicité', 'Téléphone et internet', 'Frais bancaires', 'Repas', 'Autre'];
export const categories = computed<string[]>(() => {
  const list = (settings.value.expense_categories || []).filter((c) => typeof c === 'string' && c.trim());
  return list.length ? list : DEFAULT_CATEGORIES;
});
/** the categories to filter by: the list, then any other one an expense still uses */
export function filterCategories(rows: Expense[]): string[] {
  const out = [...categories.value];
  for (const e of rows) if (e.category && !out.some((c) => c.toLowerCase() === e.category.toLowerCase())) out.push(e.category);
  return out;
}

export const EXPENSE_METHODS = ['credit', 'debit', 'cash', 'interac', 'cheque', 'other'] as const;
export function methodLabel(m: string | null | undefined): string {
  if (!m) return '';
  const k = `treasury.methods.${m}`;
  const s = t(k);
  return s === k ? m : s;
}

export function periodExpenses(r: DayRange): Expense[] { return expensesList.value.filter((e) => inRange(e.day, r)); }
const issuedDay = (v: Invoice) => (v.issued_at ? dayOf(new Date(v.issued_at)) : null);
export function periodInvoices(r: DayRange): Invoice[] {
  return invoicesList.value.filter((v) => (v.status === 'issued' || v.status === 'paid') && inRange(issuedDay(v), r));
}

export function revenueLines(r: DayRange): RevenueLine[] {
  return periodInvoices(r).map((v) => ({
    day: issuedDay(v)!, number: invoiceNumber(v), customer: customerName(customer(v.customer_id)),
    subtotal: v.subtotal_cents, tps: v.tps_cents, tvq: v.tvq_cents, total: v.total_cents, paid: v.paid_cents,
    status: invoiceStatusWord(v.status === 'issued' && v.paid_cents > 0 ? 'partial' : v.status)
  }));
}
export function expenseLines(r: DayRange): ExpenseLine[] {
  return periodExpenses(r).map((e) => ({
    day: e.day, vendor: e.vendor || '', category: e.category || '', description: e.description || '',
    subtotal: e.subtotal_cents, tps: e.tps_cents, tvq: e.tvq_cents, total: e.total_cents,
    method: methodLabel(e.method), truck: truckLabel(e.truck_id), receipt: !!e.receipt_id
  }));
}

/** sends the receipt photo; with no signal it waits in the outbox (sent before the expense, in order) */
export async function uploadReceipt(p: Photo): Promise<{ id: string; queued: boolean }> {
  try {
    return { id: await withTimeout(saveReceipt(p.dataUrl, p.w, p.h), 30000), queued: false };
  } catch (e) {
    if (preview.value || !isNetworkError(e)) throw e;
    const data = p.dataUrl.split(',')[1] || '';
    const id = uuid();
    await insertRow('attachments', { id, kind: 'receipt', mime: 'image/jpeg', data, bytes: Math.round(data.length * 0.75), width: p.w, height: p.h, created_at: new Date().toISOString() }, { label: t('log.expense') });
    return { id, queued: true };
  }
}

const removed = new Set<string>();
export async function removeExpense(id: string) {
  if (preview.value) throw new Refused('preview', t('errors.preview'));
  removed.add(id);
  await deleteRow('expenses', id, { label: t('log.expense') });
}

/** A row just created can be dropped from the phone by the sync's « which ids do I still see? » check when both
    happen at the same moment (see the report: src/data/sync.ts checkIds). Until that is fixed there, look again a
    little later and bring the row back from the server if it vanished (never one the person deleted). */
export function keepAfterSave(table: 'expenses' | 'inventory_moves', id: string) {
  for (const ms of [5000, 15000]) {
    setTimeout(() => { if (!removed.has(id) && !getRow(table, id)) void refetch(table, id); }, ms);
  }
}

/** a receipt, read once per session */
const receipts = new Map<string, string>();
export async function receiptImage(id: string): Promise<string | null> {
  const known = receipts.get(id);
  if (known) return known;
  const url = await withTimeout(loadAttachment(id), 30000);
  if (url) receipts.set(id, url);
  return url;
}
export function rememberReceipt(id: string, dataUrl: string) { receipts.set(id, dataUrl); }

/** what a search finds in an expense: vendor, category, description, the amount as typed (« 97,71 », « 97.71 ») */
export function matches(e: Expense, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const amount = (e.total_cents / 100).toFixed(2);
  const hay = [e.vendor, e.category, e.description, methodLabel(e.method), amount, amount.replace('.', ',')].filter(Boolean).join(' ').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).every((w) => hay.includes(w));
}
