import { describe, it, expect } from 'vitest';
import { nextStep, draftIsStale, type StepRights, type StepKind } from './nextStep';
import type { JobStatus, ItemStatus, InvoiceLine } from '../../data/types';

const TODAY = '2026-11-04';
const job = (status: JobStatus, o: { waiver?: boolean; payLater?: boolean; day?: string } = {}) => ({
  id: 'j1', status, day: o.day ?? TODAY, waiver_signed_at: o.waiver ? '2026-11-04T14:00:00Z' : null, pay_later: !!o.payLater
});
const item = (id: string, status: ItemStatus, deleted = false) => ({ id, status, deleted_at: deleted ? '2026-11-04T15:00:00Z' : null });
const line = (item_id?: string): InvoiceLine => ({ description: 'x', qty: 1, unit_cents: 1000, taxable: true, item_id });
type Inv = { status: 'draft' | 'issued' | 'paid' | 'void'; total_cents: number; paid_cents: number; lines: InvoiceLine[]; deleted_at?: string | null } | null;
const INVOICES: Record<string, Inv> = {
  none: null,
  draft: { status: 'draft', total_cents: 11498, paid_cents: 0, lines: [line('i1')] },
  staleDraft: { status: 'draft', total_cents: 11498, paid_cents: 0, lines: [] },
  issued: { status: 'issued', total_cents: 11498, paid_cents: 0, lines: [line('i1')] },
  partial: { status: 'issued', total_cents: 11498, paid_cents: 5000, lines: [line('i1')] },
  paid: { status: 'paid', total_cents: 11498, paid_cents: 11498, lines: [line('i1')] },
  void: { status: 'void', total_cents: 11498, paid_cents: 0, lines: [line('i1')] },
  deleted: { status: 'issued', total_cents: 11498, paid_cents: 0, lines: [line('i1')], deleted_at: '2026-11-04T16:00:00Z' }
};
const RIGHTS: Record<string, StepRights> = {
  mechanic: { act: true, invoice: true, payLater: false },
  office: { act: true, invoice: true, payLater: true },
  actOnly: { act: true, invoice: false, payLater: false },
  viewer: { act: false, invoice: false, payLater: false }
};
const ctx = { today: TODAY };
const work = [item('i1', 'planned')];

describe('nextStep: one answer for each state', () => {
  it('booked: « Je pars », not before the day, not while the job before is unpaid', () => {
    expect(nextStep(job('booked'), work, null, RIGHTS.mechanic, ctx)).toEqual({ kind: 'leave' });
    expect(nextStep(job('booked', { day: '2026-11-05' }), work, null, RIGHTS.mechanic, ctx).kind).toBe('later');
    expect(nextStep(job('booked', { day: '2026-11-03' }), work, null, RIGHTS.mechanic, ctx).kind).toBe('leave');
    expect(nextStep(job('booked'), work, null, RIGHTS.mechanic, { today: TODAY, blockedBy: 'j0' })).toEqual({ kind: 'blocked', jobId: 'j0' });
    // its own id is never a blocker
    expect(nextStep(job('booked'), work, null, RIGHTS.mechanic, { today: TODAY, blockedBy: 'j1' }).kind).toBe('leave');
    expect(nextStep(job('booked'), work, null, RIGHTS.viewer, ctx).kind).toBe('none');
  });
  it('en route: « Je suis arrivé »', () => {
    expect(nextStep(job('en_route'), work, null, RIGHTS.mechanic, ctx).kind).toBe('arrive');
    expect(nextStep(job('en_route'), work, null, RIGHTS.viewer, ctx).kind).toBe('none');
  });
  it('on site: the authorization comes first, whatever the invoice', () => {
    for (const inv of Object.values(INVOICES)) expect(nextStep(job('on_site'), work, inv, RIGHTS.mechanic, ctx).kind).toBe('waiver');
  });
  it('on site, signed: invoice, then payment, then finish', () => {
    const s = (inv: Inv, r = RIGHTS.mechanic, items = work) => nextStep(job('on_site', { waiver: true }), items, inv, r, ctx);
    expect(s(INVOICES.none)).toEqual({ kind: 'invoice', draft: false });
    expect(s(INVOICES.draft)).toEqual({ kind: 'invoice', draft: true, stale: false });
    expect(s(INVOICES.staleDraft)).toEqual({ kind: 'invoice', draft: true, stale: true });
    expect(s(INVOICES.issued)).toEqual({ kind: 'pay', payLater: false, due: 11498 });
    expect(s(INVOICES.partial)).toEqual({ kind: 'pay', payLater: false, due: 6498 });
    expect(s(INVOICES.issued, RIGHTS.office)).toEqual({ kind: 'pay', payLater: true, due: 11498 });
    expect(s(INVOICES.paid)).toEqual({ kind: 'finish' });
    // a cancelled or deleted invoice does not count: make a new one
    expect(s(INVOICES.void).kind).toBe('invoice');
    expect(s(INVOICES.deleted).kind).toBe('invoice');
  });
  it('on site: proposed work is answered before the invoice; no work means add some', () => {
    const signed = job('on_site', { waiver: true });
    const withExtra = [item('i1', 'planned'), item('i2', 'proposed')];
    expect(nextStep(signed, withExtra, null, RIGHTS.mechanic, ctx)).toEqual({ kind: 'answer', itemId: 'i2' });
    expect(nextStep(signed, withExtra, INVOICES.draft, RIGHTS.mechanic, ctx)).toEqual({ kind: 'answer', itemId: 'i2' });
    // once the invoice is finished, payment comes first (the proposal waits for another invoice)
    expect(nextStep(signed, withExtra, INVOICES.issued, RIGHTS.mechanic, ctx).kind).toBe('pay');
    // a deleted proposal does not wait for anything
    expect(nextStep(signed, [item('i1', 'planned'), item('i2', 'proposed', true)], null, RIGHTS.mechanic, ctx).kind).toBe('invoice');
    expect(nextStep(signed, [], null, RIGHTS.mechanic, ctx).kind).toBe('work');
    expect(nextStep(signed, [item('i1', 'removed'), item('i2', 'declined')], null, RIGHTS.mechanic, ctx).kind).toBe('work');
    expect(nextStep(signed, [item('i1', 'approved')], null, RIGHTS.mechanic, ctx).kind).toBe('invoice');
    expect(nextStep(signed, [item('i1', 'done')], null, RIGHTS.mechanic, ctx).kind).toBe('invoice');
  });
  it('on site: « payer plus tard » already granted finishes with the invoice issued', () => {
    const later = job('on_site', { waiver: true, payLater: true });
    expect(nextStep(later, work, INVOICES.issued, RIGHTS.mechanic, ctx)).toEqual({ kind: 'finish', later: true, due: 11498 });
    // but not without a finished invoice
    expect(nextStep(later, work, INVOICES.draft, RIGHTS.mechanic, ctx).kind).toBe('invoice');
    expect(nextStep(later, work, null, RIGHTS.mechanic, ctx).kind).toBe('invoice');
  });
  it('on site without the invoice right: no invoice or payment button', () => {
    const signed = job('on_site', { waiver: true });
    expect(nextStep(signed, work, null, RIGHTS.actOnly, ctx).kind).toBe('none');
    expect(nextStep(signed, work, INVOICES.issued, RIGHTS.actOnly, ctx).kind).toBe('none');
    // what does not need the invoice right still shows
    expect(nextStep(signed, work, INVOICES.paid, RIGHTS.actOnly, ctx).kind).toBe('finish');
    expect(nextStep(job('on_site'), work, null, RIGHTS.actOnly, ctx).kind).toBe('waiver');
    expect(nextStep(signed, [item('i2', 'proposed')], null, RIGHTS.actOnly, ctx).kind).toBe('answer');
  });
  it('done: the stamp, and what is left to collect', () => {
    expect(nextStep(job('done', { waiver: true }), work, INVOICES.paid, RIGHTS.mechanic, ctx)).toEqual({ kind: 'done', paid: true, due: 0 });
    expect(nextStep(job('done', { payLater: true }), work, INVOICES.issued, RIGHTS.office, ctx)).toEqual({ kind: 'done', paid: false, due: 11498 });
    expect(nextStep(job('done'), work, INVOICES.partial, RIGHTS.viewer, ctx)).toEqual({ kind: 'done', paid: false, due: 6498 });
    expect(nextStep(job('done'), work, null, RIGHTS.mechanic, ctx)).toEqual({ kind: 'done', paid: false, due: 0 });
  });
  it('cancelled and no-show are closed for everyone', () => {
    for (const s of ['cancelled', 'no_show'] as JobStatus[]) for (const r of Object.values(RIGHTS)) for (const inv of Object.values(INVOICES)) {
      expect(nextStep(job(s, { waiver: true }), work, inv, r, ctx).kind).toBe('closed');
    }
  });
});

describe('nextStep: every status × waiver × invoice × rights', () => {
  const statuses: JobStatus[] = ['booked', 'en_route', 'on_site', 'done', 'cancelled', 'no_show'];
  /** the rule, written another way: what must come out */
  function expected(status: JobStatus, waiver: boolean, inv: Inv, r: StepRights): StepKind {
    const live = inv && inv.status !== 'void' && !inv.deleted_at ? inv : null;
    if (status === 'cancelled' || status === 'no_show') return 'closed';
    if (status === 'done') return 'done';
    if (!r.act) return 'none';
    if (status === 'booked') return 'leave';
    if (status === 'en_route') return 'arrive';
    if (!waiver) return 'waiver';
    if (live?.status === 'paid') return 'finish';
    if (live?.status === 'issued') return r.invoice ? 'pay' : 'none';
    return r.invoice ? 'invoice' : 'none';
  }
  for (const status of statuses) for (const waiver of [false, true]) for (const [iname, inv] of Object.entries(INVOICES)) for (const [rname, r] of Object.entries(RIGHTS)) {
    it(`${status}, ${waiver ? 'signed' : 'not signed'}, invoice ${iname}, ${rname}`, () => {
      const s = nextStep(job(status, { waiver }), work, inv, r, ctx);
      expect(s.kind).toBe(expected(status, waiver, inv, r));
      if (s.kind === 'pay') expect(s.payLater).toBe(r.payLater);
      if (s.kind === 'pay') expect(s.due).toBeGreaterThan(0);
    });
  }
});

describe('draftIsStale', () => {
  it('compares the billable work with the lines of the draft', () => {
    const items = [item('a', 'planned'), item('b', 'approved'), item('c', 'declined'), item('d', 'proposed')];
    const draft = (ids: (string | undefined)[]) => ({ status: 'draft' as const, total_cents: 0, paid_cents: 0, lines: ids.map(line) });
    expect(draftIsStale(draft(['a', 'b']), items)).toBe(false);
    // a line typed by hand (no work behind it) does not make it stale
    expect(draftIsStale(draft(['a', 'b', undefined]), items)).toBe(false);
    expect(draftIsStale(draft(['a']), items)).toBe(true);
    expect(draftIsStale(draft(['a', 'b', 'c']), items)).toBe(true);
    expect(draftIsStale({ ...draft(['a']), status: 'issued' }, items)).toBe(false);
    expect(draftIsStale(null, items)).toBe(false);
  });
});
