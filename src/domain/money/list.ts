/* « Factures »: the tabs, their order and the total under the list (pure, tested in list.test.ts). */
import type { Invoice } from '../../data/types';

export type ListTab = 'unpaid' | 'draft' | 'paid' | 'void' | 'all';
export const LIST_TABS: ListTab[] = ['unpaid', 'draft', 'paid', 'void', 'all'];
type Row = Pick<Invoice, 'status' | 'number' | 'issued_at' | 'created_at'>;

/** the day an invoice is listed by: finished on, else started on */
export const listDate = (v: Pick<Invoice, 'issued_at' | 'created_at'>) => v.issued_at || v.created_at || '';
export function inTab(v: Pick<Invoice, 'status'>, tab: ListTab): boolean {
  if (tab === 'unpaid') return v.status === 'issued';
  if (tab === 'all') return true;
  return v.status === (tab === 'draft' ? 'draft' : tab === 'paid' ? 'paid' : 'void');
}
export function tabCounts(all: Pick<Invoice, 'status'>[]): Record<ListTab, number> {
  const c: Record<ListTab, number> = { unpaid: 0, draft: 0, paid: 0, void: 0, all: all.length };
  for (const v of all) { if (v.status === 'issued') c.unpaid++; else if (v.status === 'draft') c.draft++; else if (v.status === 'paid') c.paid++; else if (v.status === 'void') c.void++; }
  return c;
}
/** « À payer »: the oldest first (the one to chase); the others: the newest first */
export function sortForTab<T extends Row>(list: T[], tab: ListTab): T[] {
  return tab === 'unpaid'
    ? list.sort((a, b) => listDate(a).localeCompare(listDate(b)) || Number(a.number) - Number(b.number))
    : list.sort((a, b) => listDate(b).localeCompare(listDate(a)) || Number(b.number ?? 0) - Number(a.number ?? 0));
}
/** the total under the list: what is owed on « À payer »; on « Toutes », what was billed (a cancelled invoice and an
    unfinished draft are listed but billed nothing); the other tabs hold one kind only and add it up */
export function footTotal(rows: { status: Invoice['status']; total: number; balance: number }[], tab: ListTab): number {
  if (tab === 'unpaid') return rows.reduce((s, r) => s + r.balance, 0);
  if (tab === 'all') return rows.reduce((s, r) => s + (r.status === 'issued' || r.status === 'paid' ? r.total : 0), 0);
  return rows.reduce((s, r) => s + r.total, 0);
}
