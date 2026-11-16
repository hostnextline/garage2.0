import { describe, it, expect } from 'vitest';
import { QC_TAXES } from '../../lib/money';
import type { Expense } from '../../data/types';
import { freshDraft, typedAmount, withTotal, withTaxed, checkDraft, applyReceipt, draftAmounts, type Draft, type ReadField } from './expenseDraft';
import { parseReceipt, splitFromTotal } from './receipt';

const R = QC_TAXES;
const TODAY = '2026-11-15';
const blank = () => freshDraft(null, TODAY);
const stored = (x: Partial<Expense>) => ({ id: 'e1', day: '2026-11-10', vendor: 'NAPA', category: 'Pièces', description: null, method: null, truck_id: null, receipt_id: null, notes: null, ...x } as Expense);
type FillOpts = Parameters<typeof applyReceipt>[3];
const opts = (typed: ReadField[] = []): [Set<ReadField>, FillOpts] => [new Set(typed), { categories: ['Pièces', 'Carburant', 'Repas', 'Autre'], history: [], rates: R, taxedByDefault: true }];

describe('the expense draft: a field left without a change changes nothing', () => {
  it('bug 03: leaving « Total payé » of a stored expense keeps its subtotal and taxes', () => {
    const d = freshDraft(stored({ subtotal_cents: 9000, tps_cents: 300, tvq_cents: 700, total_cents: 10000 }), TODAY);
    expect(typedAmount(d, 'total', 10000, R)).toBeNull();
    // the old handler re-split on every report of the field: 86,97 + 4,35 + 8,68
    expect(withTotal(d, 10000, R)).toMatchObject({ subtotal: 8697, tps: 435, tvq: 868 });
  });
  it('bug 04: leaving « Avant taxes » after a total keeps the total, for every total from 1,00 $ to 300,00 $', () => {
    for (let total = 100; total <= 30000; total++) {
      const d = withTotal(blank(), total, R);
      expect(typedAmount(d, 'subtotal', d.subtotal, R), String(total)).toBeNull();
      expect(typedAmount(d, 'tps', d.tps, R)).toBeNull();
      expect(typedAmount(d, 'tvq', d.tvq, R)).toBeNull();
    }
    // 10,00 $: 8,69 + 0,44 + 0,87 (the leftover cent is in the subtotal); a re-split from 8,69 gave 9,99 $
    expect(withTotal(blank(), 1000, R)).toMatchObject({ subtotal: 869, tps: 44, tvq: 87, total: 1000 });
  });
  it('bug 05: leaving the empty total is no value typed (the receipt read later still fills the amounts)', () => {
    expect(typedAmount(blank(), 'total', null, R)).toBeNull();
  });
  it('a real change is worked out from the field typed', () => {
    const d = typedAmount(blank(), 'total', 11498, R)!;
    expect(d).toMatchObject({ total: 11498, anchor: 'total' });
    expect(d.subtotal! + d.tps! + d.tvq!).toBe(11498);
    const s = typedAmount(d, 'subtotal', 9000, R)!;
    expect(s).toMatchObject({ subtotal: 9000, tps: 450, tvq: 898, total: 10348, anchor: 'subtotal' });
    const t = typedAmount(s, 'tps', 0, R)!;
    expect(t).toMatchObject({ subtotal: 9000, tps: 0, total: 9898 });
    const u = typedAmount(withTotal(blank(), 10000, R), 'tvq', 0, R)!;
    expect(u).toMatchObject({ total: 10000, tvq: 0, subtotal: 10000 - u.tps! });
  });
  it('the taxes switch: no taxes = the total is the price before taxes', () => {
    const d = withTaxed(withTotal(blank(), 5000, R), false, R);
    expect(d).toMatchObject({ total: 5000, subtotal: 5000, tps: 0, tvq: 0, taxed: false });
    expect(draftAmounts(d)).toEqual({ subtotal_cents: 5000, tps_cents: 0, tvq_cents: 0, total_cents: 5000 });
    expect(withTaxed(d, true, R)).toMatchObject(splitFromTotal(5000, R));
  });
  it('a garage without taxes starts a new expense without them', () => {
    expect(freshDraft(null, TODAY, false).taxed).toBe(false);
    expect(blank().taxed).toBe(true);
  });
  it('a stored expense with no taxes opens with « Pas de taxes »', () => {
    expect(freshDraft(stored({ subtotal_cents: 1495, tps_cents: 0, tvq_cents: 0, total_cents: 1495 }), TODAY).taxed).toBe(false);
  });
});

describe('the expense draft: what may be saved', () => {
  const ok = (): Draft => ({ ...withTotal(blank(), 11498, R), category: 'Pièces' });
  it('a complete draft has no problem', () => expect(checkDraft(ok(), TODAY)).toEqual({}));
  it('date, total, category and the parts that add up', () => {
    expect(checkDraft({ ...ok(), day: '2026-02-30' }, TODAY).day).toBe('treasury.form.errDay');
    expect(checkDraft({ ...ok(), total: 0 }, TODAY).total).toBe('treasury.form.errTotal');
    expect(checkDraft({ ...ok(), category: ' ' }, TODAY).category).toBe('treasury.form.errCategory');
    expect(checkDraft({ ...ok(), tps: 1 }, TODAY).sum).toBe('treasury.form.errSum');
  });
  it('bug 22: a day after tomorrow (a year typed 2062) is refused; tomorrow passes (another time zone)', () => {
    expect(checkDraft({ ...ok(), day: '2062-11-10' }, TODAY).day).toBe('treasury.form.errDayFuture');
    expect(checkDraft({ ...ok(), day: '2026-11-17' }, TODAY).day).toBe('treasury.form.errDayFuture');
    expect(checkDraft({ ...ok(), day: '2026-11-16' }, TODAY).day).toBeUndefined();
  });
});

describe('the expense draft: what the receipt reader fills', () => {
  const CT = 'CANADIAN TIRE\n2026-11-03 14:32\nSOUS-TOTAL 84,98\nTPS 4,25\nTVQ 8,48\nTOTAL 97,71\n';
  it('fills the empty fields and says « read » when the amounts add up', () => {
    const r = applyReceipt(blank(), parseReceipt(CT, TODAY, R), ...opts());
    expect(r.draft).toMatchObject({ vendor: 'Canadian Tire', day: '2026-11-03', subtotal: 8498, tps: 425, tvq: 848, total: 9771, taxed: true });
    expect([...r.filled].sort()).toEqual(['amounts', 'category', 'day', 'vendor']);
    expect(r.draft.category).toBe('Pièces');
    expect(r.message).toBe('read');
  });
  it('never overwrites what the person typed, and then does not claim the receipt was read', () => {
    const mine = { ...withTotal(blank(), 5000, R), vendor: 'NAPA' };
    const r = applyReceipt(mine, parseReceipt(CT, TODAY, R), ...opts(['amounts', 'vendor']));
    expect(r.draft).toMatchObject({ vendor: 'NAPA', total: 5000, day: '2026-11-03' });
    expect(r.filled.has('amounts')).toBe(false);
    expect(r.message).toBe('partial');
  });
  it('nothing readable says so', () => {
    expect(applyReceipt(blank(), parseReceipt('', TODAY, R), ...opts()).message).toBe('nothing');
  });
  it('bug 10: a bill with a tip keeps the taxes printed (the tip is in the part before taxes)', () => {
    const g = parseReceipt('RESTO\nSOUS-TOTAL 50,00\nTPS 2,50\nTVQ 4,99\nTOTAL 65,49\n', TODAY, R);
    expect(g.consistent).toBe(false);
    const r = applyReceipt(blank(), g, ...opts());
    expect(r.draft).toMatchObject({ total: 6549, tps: 250, tvq: 499, subtotal: 5800, taxed: true });
    expect(r.message).toBe('partial');
  });
  it('only a total: split with the rates when the garage charges taxes, not otherwise', () => {
    const g = parseReceipt('INTACT ASSURANCE\nTOTAL 212,40\n', TODAY, R);
    expect(applyReceipt(blank(), g, ...opts()).draft).toMatchObject({ ...splitFromTotal(21240, R), taxed: true });
    const [typed, o] = opts();
    expect(applyReceipt(freshDraft(null, TODAY, false), g, typed, { ...o, taxedByDefault: false }).draft).toMatchObject({ total: 21240, subtotal: 21240, tps: 0, tvq: 0, taxed: false });
  });
});
