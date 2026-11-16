import { describe, it, expect } from 'vitest';
import type { Invoice } from '../../data/types';
import { inTab, tabCounts, sortForTab, footTotal, listDate } from './list';

const v = (status: Invoice['status'], number: number | null, issued_at: string | null, created_at = '2026-11-01T12:00:00Z') => ({ status, number, issued_at, created_at }) as Invoice;

describe('the invoice list', () => {
  it('tabs and their counts', () => {
    const all = [v('issued', 1, '2026-11-02'), v('draft', null, null), v('paid', 2, '2026-11-03'), v('void', 3, '2026-11-04'), v('issued', 4, '2026-11-05')];
    expect(tabCounts(all)).toEqual({ unpaid: 2, draft: 1, paid: 1, void: 1, all: 5 });
    expect(all.filter((x) => inTab(x, 'unpaid')).map((x) => x.number)).toEqual([1, 4]);
    expect(all.filter((x) => inTab(x, 'all'))).toHaveLength(5);
  });
  it('« À payer » the oldest first, the others the newest first', () => {
    const list = [v('issued', 5, '2026-11-05'), v('issued', 2, '2026-11-02')];
    expect(sortForTab([...list], 'unpaid').map((x) => x.number)).toEqual([2, 5]);
    expect(sortForTab([...list], 'all').map((x) => x.number)).toEqual([5, 2]);
    expect(listDate(v('draft', null, null, '2026-11-09'))).toBe('2026-11-09');
  });
  it('the total under « Toutes » counts neither cancelled invoices nor drafts', () => {
    const rows = [{ status: 'paid' as const, total: 10000, balance: 0 }, { status: 'issued' as const, total: 5000, balance: 2000 }, { status: 'void' as const, total: 9999, balance: 0 }, { status: 'draft' as const, total: 777, balance: 777 }];
    expect(footTotal(rows, 'all')).toBe(15000);
    // a tab of one kind adds up that kind (what was cancelled, what is still in draft)
    expect(footTotal(rows.filter((r) => r.status === 'void'), 'void')).toBe(9999);
    expect(footTotal(rows.filter((r) => r.status === 'issued'), 'unpaid')).toBe(2000);
  });
});
