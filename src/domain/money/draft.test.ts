import { describe, it, expect } from 'vitest';
import type { ItemKind } from '../../data/types';
import { workMissing, workToAdd, withoutGoneWork, lineOfWork, percentOf, syncPercents, discountBase, putBack, settleLines, draftPatch, jobOpen, type WorkItem } from './draft';

const made = '2026-11-15T13:00:00.000Z';
const item = (id: string, o: Partial<WorkItem> = {}): WorkItem => ({ id, status: 'planned', description: `work ${id}`, qty: 1, unit_cents: 10000, taxable: true, kind: 'service',
  created_at: '2026-11-15T09:00:00.000Z', updated_at: '2026-11-15T09:00:00.000Z', deleted_at: null, ...o });
type TL = { description: string; qty: number; unit_cents: number; taxable: boolean; kind?: ItemKind; item_id?: string | null };
const line = (item_id?: string, unit_cents = 10000): TL => ({ description: 'x', qty: 1, unit_cents, taxable: true, kind: 'service', item_id });
const disc = (description: string, unit_cents: number): TL => ({ description, qty: 1, unit_cents, taxable: true, kind: 'discount' });
const TPL = ['Rabais de {n} %', '{n}% discount'];

describe('the draft follows the work of its job', () => {
  it('work the customer accepted, or added on site, after the draft was made goes on it by itself', () => {
    const items = [item('a'), item('b', { status: 'approved', updated_at: '2026-11-15T14:10:00.000Z' }), item('c', { created_at: '2026-11-15T14:20:00.000Z', updated_at: '2026-11-15T14:20:00.000Z' })];
    expect(workToAdd([line('a')], items, made).map((i) => i.id)).toEqual(['b', 'c']);
  });
  it('older work missing from the draft was taken off on purpose: it is said missing, never put back by itself', () => {
    const items = [item('a'), item('b')];
    expect(workToAdd([line('a')], items, made)).toEqual([]);
    expect(workMissing([line('a')], items).map((i) => i.id)).toEqual(['b']);
  });
  it('work that is not billed (proposed, declined, removed, deleted) is never missing', () => {
    const later = '2026-11-15T15:00:00.000Z';
    const items = [item('p', { status: 'proposed', updated_at: later }), item('d', { status: 'declined', updated_at: later }), item('r', { status: 'removed', updated_at: later }), item('x', { deleted_at: later, updated_at: later })];
    expect(workMissing([], items)).toEqual([]);
    expect(workToAdd([], items, made)).toEqual([]);
  });
  it('no date for the draft: nothing is added by itself', () => {
    expect(workToAdd([], [item('a', { updated_at: '2030-01-01T00:00:00.000Z' })], null)).toEqual([]);
  });
  it('a line from the work, as « Faire la facture » makes it', () => {
    expect(lineOfWork(item('a', { qty: '1.5' as unknown as number, kind: 'labour', taxable: false }))).toEqual({ description: 'work a', qty: 1.5, unit_cents: 10000, taxable: false, kind: 'labour', item_id: 'a' });
  });
  it('work taken off the job leaves the draft; a line of work not on this phone, or written by hand, stays', () => {
    const lines = [line('a'), line('gone'), line('lost'), line(undefined)];
    const out = withoutGoneWork(lines, [item('a'), item('gone', { status: 'removed' })]);
    expect(out.map((l) => l.item_id)).toEqual(['a', 'lost', undefined]);
    // nothing to change: the same lines (no save for nothing)
    expect(withoutGoneWork(out, [item('a')])).toBe(out);
  });
});

describe('« Rabais de 10 % » stays 10 %', () => {
  it('reads the percent in the words the chip writes, in both languages', () => {
    expect(percentOf('Rabais de 10 %', TPL)).toBe(10);
    expect(percentOf('15% discount', TPL)).toBe(15);
    expect(percentOf('Rabais', TPL)).toBeNull();
    expect(percentOf('Rabais de dix %', TPL)).toBeNull();
    expect(percentOf('Rabais de 10 % ami', TPL)).toBeNull();
  });
  it('a line added after the chip was tapped: the amount follows (it was frozen at 10 % of the old lines)', () => {
    const lines = [line('a', 30000), disc('Rabais de 10 %', 3000), line('b', 20000)];
    const out = syncPercents(lines, TPL);
    expect(out[1].unit_cents).toBe(5000);
    expect(discountBase(out)).toBe(50000);
    expect(syncPercents(out, TPL)).toBe(out);
  });
  it('work taken off: the discount gets smaller with it; a discount written by hand never moves', () => {
    const lines = [line('a', 20000), disc('Rabais de 10 %', 5000), disc('Rabais fidélité', 1500)];
    const out = syncPercents(lines, TPL);
    expect(out.map((l) => l.unit_cents)).toEqual([20000, 2000, 1500]);
  });
  it('nothing to take a percent on: left as it is', () => {
    const lines = [disc('Rabais de 10 %', 500)];
    expect(syncPercents(lines, TPL)).toBe(lines);
  });
});

describe('« Annuler » after a line was removed', () => {
  it('puts back that one line at its place in the lines as they are now', () => {
    const a = { k: 'a' }, b = { k: 'b', price: 1 }, c = { k: 'c' };
    const now = [a, { ...b, price: 2 }].filter((x) => x.k !== 'b').concat([c]);   // b removed, then c added
    expect(putBack(now, b, 1)).toEqual([a, b, c]);
    expect(putBack([a], b, 9)).toEqual([a, b]);
    const same = [a, b];
    expect(putBack(same, b, 0)).toBe(same);
  });
});

describe('the draft takes the job’s work by itself', () => {
  const late = '2026-11-15T14:10:00.000Z';
  const o = (addNew: boolean) => ({ addNew, madeAt: made, percentWords: TPL, toLine: (i: WorkItem): TL => lineOfWork(i) });
  it('an extra the customer accepted goes on it, and « Rabais de 10 % » grows with it', () => {
    const lines = [line('a', 30000), disc('Rabais de 10 %', 3000)];
    const r = settleLines(lines, [item('a', { unit_cents: 30000 }), item('b', { status: 'approved', unit_cents: 20000, updated_at: late })], o(true));
    expect(r.added.map((i) => i.id)).toEqual(['b']);
    expect(r.lines.map((l) => [l.item_id ?? null, l.unit_cents])).toEqual([['a', 30000], [null, 5000], ['b', 20000]]);
  });
  it('someone who may not change the job: work gone still leaves, new work is only said (the banner)', () => {
    const r = settleLines([line('a'), line('r')], [item('a'), item('r', { status: 'removed' }), item('b', { updated_at: late })], o(false));
    expect(r.added).toEqual([]);
    expect(r.lines.map((l) => l.item_id)).toEqual(['a']);
  });
  it('nothing to take: the same lines (no save)', () => {
    const lines = [line('a')];
    expect(settleLines(lines, [item('a')], o(true)).lines).toBe(lines);
  });
  it('the job coming or under way', () => {
    expect(['booked', 'en_route', 'on_site', 'done', 'cancelled', 'no_show', undefined].map(jobOpen)).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('only what changed is sent', () => {
  const base = { lines: [line('a')], taxesOn: true, notes: 'Merci' };
  it('a note typed: the note alone (a line added on another phone is not overwritten)', () => {
    expect(draftPatch({ ...base, notes: 'Merci Julie ' }, base)).toEqual({ notes: 'Merci Julie' });
  });
  it('a line changed, the taxes switched, a note erased', () => {
    expect(draftPatch({ ...base, lines: [line('a', 12000)] }, base)).toEqual({ lines: [{ description: 'x', qty: 1, unit_cents: 12000, taxable: true, kind: 'service', item_id: 'a' }] });
    expect(draftPatch({ ...base, taxesOn: false }, base)).toEqual({ taxes_on: false });
    expect(draftPatch({ ...base, notes: '  ' }, base)).toEqual({ notes: null });
  });
  it('the screen\'s own keys and spaces are not changes', () => {
    expect(draftPatch({ ...base, lines: [{ ...line('a'), _k: 'l1' } as never], notes: 'Merci ' }, base)).toBeNull();
  });
});

