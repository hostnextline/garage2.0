import { describe, it, expect } from 'vitest';
import { liveInvoice, isFinished, isBilled, billable, unbilledWork, lineCents, estimateChanged, isOpen } from './billing';
import type { InvoiceLine, ItemStatus } from '../../data/types';
import { lineCents as invoiceLineCents } from '../money/invoice';

const line = (item_id?: string): InvoiceLine => ({ description: 'x', qty: 1, unit_cents: 1000, taxable: true, item_id });
const inv = (status: 'draft' | 'issued' | 'paid' | 'void', ids: (string | undefined)[], o: { deleted_at?: string | null; total_cents?: number } = {}) =>
  ({ status, lines: ids.map(line), total_cents: o.total_cents ?? 0, deleted_at: o.deleted_at ?? null });
const item = (id: string, status: ItemStatus, deleted = false) => ({ id, status, deleted_at: deleted ? 'x' : null });

describe('which invoice counts, which work it bills', () => {
  it('a cancelled or deleted invoice does not count', () => {
    expect(liveInvoice(inv('void', []))).toBeNull();
    expect(liveInvoice(inv('issued', [], { deleted_at: 'x' }))).toBeNull();
    expect(liveInvoice(null)).toBeNull();
    expect(liveInvoice(inv('draft', []))?.status).toBe('draft');
  });
  it('finished = issued or paid', () => {
    expect(isFinished(inv('issued', []))).toBe(true);
    expect(isFinished(inv('paid', []))).toBe(true);
    expect(isFinished(inv('draft', []))).toBe(false);
    expect(isFinished(inv('void', []))).toBe(false);
  });
  it('billed = on a line of a finished invoice', () => {
    expect(isBilled(inv('issued', ['a']), 'a')).toBe(true);
    expect(isBilled(inv('paid', ['a']), 'b')).toBe(false);
    expect(isBilled(inv('draft', ['a']), 'a')).toBe(false);
  });
  it('the work to bill: planned, done, accepted, not deleted', () => {
    expect(billable([item('a', 'planned'), item('b', 'done'), item('c', 'approved'), item('d', 'proposed'), item('e', 'declined'), item('f', 'removed'), item('g', 'planned', true)]).map((i) => i.id))
      .toEqual(['a', 'b', 'c']);
  });
});

describe('work missing from a finished invoice', () => {
  const work = [item('a', 'done'), item('b', 'approved'), item('c', 'proposed'), item('d', 'removed')];
  it('lists the billable work on no line of the finished invoice', () => {
    expect(unbilledWork(work, inv('issued', ['a'])).map((i) => i.id)).toEqual(['b']);
    expect(unbilledWork(work, inv('paid', ['a', undefined])).map((i) => i.id)).toEqual(['b']);
    expect(unbilledWork(work, inv('issued', ['a', 'b']))).toEqual([]);
  });
  it('the server’s rule (job_unbilled): whenever the work came, left off the finished invoice it is missing (terrain-01, argent-app-01)', () => {
    const finished = { ...inv('issued', ['a']), issued_at: '2026-11-15T15:00:00Z' };
    // already there when the invoice was finished, taken off the draft: the server refuses « Terminé » for it
    const old = [{ ...item('a', 'done'), created_at: '2026-11-15T09:00:00Z' }, { ...item('b', 'planned'), created_at: '2026-11-15T09:00:00Z' }];
    expect(unbilledWork(old, finished).map((i) => i.id)).toEqual(['b']);
    const late = { ...item('c', 'planned'), created_at: '2026-11-15T15:00:01Z' };
    expect(unbilledWork([...old, late], finished).map((i) => i.id)).toEqual(['b', 'c']);
    // a line just added on this phone (no time yet)
    expect(unbilledWork([...old, item('d', 'planned')], finished).map((i) => i.id)).toEqual(['b', 'd']);
    // marked « Pas fait »: no longer missing (the way out the server gives)
    expect(unbilledWork([old[0], { ...old[1], status: 'removed' as const }], finished)).toEqual([]);
  });
  it('nothing is missing from a draft (it follows the work) nor when there is no invoice', () => {
    expect(unbilledWork(work, inv('draft', []))).toEqual([]);
    expect(unbilledWork(work, null)).toEqual([]);
    expect(unbilledWork(work, inv('void', []))).toEqual([]);
  });
});

describe('the amount of a line', () => {
  it('quantity × price, a discount counts against', () => {
    expect(lineCents({ qty: 2, unit_cents: 1250, kind: 'service' })).toBe(2500);
    expect(lineCents({ qty: 1, unit_cents: -500, kind: 'discount' })).toBe(-500);
    expect(lineCents({ qty: 1, unit_cents: 500, kind: 'discount' })).toBe(-500);
    expect(lineCents({ qty: 4.5, unit_cents: 999, kind: 'part' })).toBe(4496);
  });
  it('a line that is not a discount keeps its sign, as on the invoice and on the server (R46)', () => {
    // before: −15 $ on a service counted +15 $ on the job sheet while the invoice said −15 $
    expect(lineCents({ qty: 1, unit_cents: -1500, kind: 'service' })).toBe(-1500);
    expect(lineCents({ qty: 2, unit_cents: -500, kind: 'part' })).toBe(-1000);
    // the invoice's own count of the same line
    for (const l of [{ qty: 1, unit_cents: -1500, kind: 'service' as const }, { qty: 3, unit_cents: 333, kind: 'discount' as const }, { qty: 1.5, unit_cents: 1001, kind: 'labour' as const }])
      expect(lineCents(l)).toBe(invoiceLineCents(l));
  });
});

describe('« Le total a changé » after an estimate signed online (jobs-b-09)', () => {
  it('compares with the draft invoice when there is one: the server kept its total as the signed amount', () => {
    // taxes switched off on the draft: the draft says 10 000, the work with taxes 11 498; the customer signed 10 000
    expect(estimateChanged(10000, 11498, inv('draft', ['a'], { total_cents: 10000 }), 'on_site')).toBe(false);
    expect(estimateChanged(10000, 11498, inv('draft', ['a'], { total_cents: 12000 }), 'on_site')).toBe(true);
  });
  it('no draft: the work’s total, as before', () => {
    expect(estimateChanged(11498, 11498, null, 'booked')).toBe(false);
    expect(estimateChanged(11498, 13000, null, 'booked')).toBe(true);
    expect(estimateChanged(11498, 13000, inv('issued', ['a'], { total_cents: 11498 }), 'on_site')).toBe(true);
  });
  it('never once the job is over', () => {
    expect(estimateChanged(1, 2, null, 'done')).toBe(false);
    expect(estimateChanged(1, 2, null, 'cancelled')).toBe(false);
  });
  it('open statuses', () => {
    expect(['booked', 'en_route', 'on_site', 'done', 'cancelled', 'no_show'].filter((s) => isOpen(s as never))).toEqual(['booked', 'en_route', 'on_site']);
  });
});
