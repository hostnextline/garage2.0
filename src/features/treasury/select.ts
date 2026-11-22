/* What the treasury reads from the phone's copy: the expense categories, the words of a payment method, the
   expenses of a period (sorted, searched, summed by category) and the « signature » of the period's rows that tells
   the screen when the server's report must be asked again. Pure functions of rows; `categories` follows the settings. */
import { computed } from '@preact/signals';
import { tMaybe } from '../../lib/i18n';
import { matches } from '../../lib/text';
import type { Cents } from '../../lib/money';
import { settings } from '../../data/select';
import type { Expense } from '../../data/types';
import { inRange, type DayRange } from '../../domain/money/period';

/** the list every garage starts with (the database has the same one) when Réglages has none */
const DEFAULT_CATEGORIES = ['Pièces', 'Huile et liquides', 'Carburant', 'Outils et équipement', 'Entretien des camions', 'Assurances', 'Publicité', 'Téléphone et internet', 'Frais bancaires', 'Repas', 'Autre'];
export function categoryList(fromSettings: unknown): string[] {
  const list = (Array.isArray(fromSettings) ? fromSettings : []).filter((c): c is string => typeof c === 'string' && !!c.trim());
  return list.length ? list : DEFAULT_CATEGORIES;
}
/** the garage's list (Réglages) */
export const categories = computed<string[]>(() => categoryList(settings.value.expense_categories));

/** the categories to filter by: the list, then any other one an expense still uses (a category renamed since) */
export function filterCategories(list: string[], rows: Expense[]): string[] {
  const out = [...list];
  for (const e of rows) if (e.category && !out.some((c) => c.toLowerCase() === e.category.toLowerCase())) out.push(e.category);
  return out;
}

export const EXPENSE_METHODS = ['credit', 'debit', 'cash', 'interac', 'cheque', 'other'] as const;
/** the words of a payment method; an unknown one is shown as stored */
export function methodLabel(m: string | null | undefined): string {
  if (!m) return '';
  // a method the dictionaries do not know (written by another app, a new kind) is shown as it is stored (R170)
  return tMaybe(`treasury.methods.${m}`) ?? m;
}

/** the expenses of a period, newest first (same day: the one typed last first) */
export function periodExpenses(rows: Expense[], r: DayRange): Expense[] {
  return rows.filter((e) => inRange(e.day, r))
    .sort((a, b) => b.day.localeCompare(a.day) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** what a search finds in an expense: vendor, category, description, method, the amount as typed (« 97,71 », « 97.71 ») */
export function expenseMatches(e: Expense, q: string): boolean {
  const amount = (e.total_cents / 100).toFixed(2);
  return matches(q, e.vendor, e.category, e.description, methodLabel(e.method), amount, amount.replace('.', ','));
}

/** before taxes by category, the largest first: what the screen shows while the server's report is not there */
export function byCategory(rows: Expense[]): { category: string; subtotal: Cents; n: number }[] {
  const m = new Map<string, { subtotal: Cents; n: number }>();
  for (const e of rows) { const c = m.get(e.category) || { subtotal: 0, n: 0 }; c.subtotal += e.subtotal_cents; c.n++; m.set(e.category, c); }
  return [...m.entries()].map(([category, v]) => ({ category, subtotal: v.subtotal, n: v.n })).sort((a, b) => b.subtotal - a.subtotal);
}

/** changes whenever a row of the period is added, changed or removed on this phone (or arrives from another one).
    A change made on the phone does not always touch updated_at, so the whole row counts (a few hundred rows: cheap). */
export function rowsSignature(rows: object[]): string {
  let h = 5381;
  const text = rows.map((r) => JSON.stringify(r)).sort().join('\n');
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${rows.length}:${h.toString(36)}`;
}
