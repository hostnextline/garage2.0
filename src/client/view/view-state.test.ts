/* The appointment page's rules that the rebuild fixed (each case failed on the old logic). */
import { describe, it, expect } from 'vitest';
import type { JobView } from '../api';
import { afterCheck, estimateSigned, explainKey, extraStatus, extrasToAnswer, isOnSiteBill, moneyIn, refusalKey, workLines } from './view-state';

function job(o: Partial<JobView> = {}, j: Partial<JobView['job']> = {}): JobView {
  return {
    ok: true, kind: 'job', garage: { name: 'Garage' }, lang: 'fr', customer: { first: 'Julie' },
    job: { number: 1, day: '2026-11-04', block: 'pm', start: 720, end: 960, status: 'booked', tracking: false, vehicle: null, waiver_signed: false, ...j },
    items: [{ id: 'a', description: 'Huile', qty: 1, unit_cents: 10000, status: 'planned' }],
    extras: [{ id: 'x2', description: 'Autre', qty: 1, unit_cents: 3000, total_cents: 3000, status: 'proposed', note: null, answered_via: null }],
    expected: { subtotal: 10000, tps: 500, tvq: 998, total: 11498 }, prepaid_cents: 0, invoice: null,
    pay: { available: true, amount_cents: 11498, kind: 'prepay', pending: false }, ...o
  };
}
const inv = (paid: number, total = 11498) => ({ number: 'F-0001', issued_at: null, due_on: null, status: 'issued', lines: [], subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: total, paid_cents: paid, notes: null });

describe('extra work (client-page-05)', () => {
  it('is answered only while the visit is coming or under way and not invoiced', () => {
    expect(extrasToAnswer(job()).map((x) => x.id)).toEqual(['x2']);
    expect(extrasToAnswer(job({}, { status: 'on_site' }))).toHaveLength(1);
    // finished, invoiced and paid a week ago: no « Accepter / Refuser » above the PAYÉ invoice
    expect(extrasToAnswer(job({ invoice: inv(11498) }, { status: 'done' }))).toEqual([]);
    expect(extrasToAnswer(job({}, { status: 'cancelled' }))).toEqual([]);
    expect(extrasToAnswer(job({ invoice: inv(0) }, { status: 'on_site' }))).toEqual([]);
  });
  it('tells a second phone’s answer apart (client-page-26)', () => {
    const v = job({ extras: [{ id: 'x2', description: 'Autre', qty: 1, unit_cents: 3000, total_cents: 3000, status: 'approved', note: null, answered_via: 'link' }] });
    expect(extraStatus(v, 'x2')).toBe('approved');
    expect(extraStatus(v, 'nope')).toBeNull();
  });
});

describe('the work panel (client-page-10)', () => {
  const bill = { lines: [{ description: 'Huile', qty: 1, unit_cents: 10000 }, { description: 'Rabais', qty: 1, unit_cents: 2000, kind: 'discount' }],
    subtotal_cents: 8000, tps_cents: 400, tvq_cents: 798, total_cents: 9198 };
  it('lists the draft invoice’s lines as soon as there is one, so the lines add up to the total shown', () => {
    const v = job({ bill, expected: { subtotal: 8000, tps: 400, tvq: 798, total: 9198 } });
    const w = workLines(v);
    expect(w.kind).toBe('bill');
    expect(w.lines.map((x) => x.description)).toEqual(['Huile', 'Rabais']);
    // booked, not on site: still the estimate's words (« Votre estimation », + tx), and no pay button
    expect(isOnSiteBill(v)).toBe(false);
    expect(isOnSiteBill(job({ bill }, { status: 'on_site' }))).toBe(true);
  });
  it('lists the planned work when there is no draft, and nothing of a draft once the invoice is finished', () => {
    expect(workLines(job()).kind).toBe('planned');
    expect(workLines(job({ bill, invoice: inv(0) })).kind).toBe('planned');
  });
});

describe('the sentence under the day (client-page-32)', () => {
  it('speaks of the window, or of the text to come, never of « ce bloc » for a « Plages d’arrivée » appointment', () => {
    expect(explainKey(job().job, false)).toBe('job.explain.booked');
    expect(explainKey(job({}, { block: 'day', start: 840, end: 1080 }).job, false)).toBe('job.explain.bookedWindow');
    expect(explainKey(job({}, { block: 'day', start: null, end: null, flex: true }).job, false)).toBe('job.explain.bookedFlex');
    expect(explainKey(job({}, { status: 'en_route' }).job, false)).toBe('job.explain.en_routeNoLink');
    expect(explainKey(job({}, { status: 'en_route', tracking: true }).job, true)).toBe('job.explain.en_route');
  });
});

describe('back from Stripe (client-page-07)', () => {
  it('a payment that came in is « reçu » even when a balance is left (the total rose meanwhile)', () => {
    // 229,94 $ paid ahead; meanwhile an extra was accepted: 80 $ still to pay
    const v = job({ prepaid_cents: 22994, expected: { subtotal: 27000, tps: 1350, tvq: 2693, total: 31043 }, pay: { available: true, amount_cents: 8049, kind: 'prepay', pending: true } });
    expect(moneyIn(v)).toBe(22994);
    expect(afterCheck(v, 1, 5, 0)).toBe('paid');
    // nothing came in yet: keep checking, then late
    expect(afterCheck(v, 1, 5, 22994)).toBe('checking');
    expect(afterCheck(v, 5, 5, 22994)).toBe('late');
    // without the note of this tab (Stripe opened elsewhere): the balances decide, as before
    expect(afterCheck(v, 1, 5, null)).toBe('checking');
  });
  it('counts the money paid on the invoice too', () => {
    expect(moneyIn(job({ prepaid_cents: 1000, invoice: inv(5000) }))).toBe(6000);
    expect(afterCheck(job({ invoice: inv(5000), pay: { available: true, amount_cents: 6498, kind: 'invoice', pending: true } }), 1, 5, 0)).toBe('paid');
  });
});

describe('a refused signature or answer (client-page-01, client-page-12)', () => {
  it('has the page’s own words for each code: never the server’s French sentence', () => {
    expect(refusalKey('sign', 'amount_changed')).toBe('sign.changedNow');
    expect(refusalKey('answer', 'amount_changed')).toBe('extras.changedNow');
    expect(refusalKey('sign', 'signed')).toBe('sign.already');
    expect(refusalKey('sign', 'network')).toBe('sign.fail');
    expect(refusalKey('answer', 'server')).toBe('errors.answer');
  });
  it('knows when the estimate is signed (a lost answer is checked before saying it failed)', () => {
    expect(estimateSigned(job({ estimate: { signed_at: '2026-11-04T15:00:00Z', signer: 'Julie', cents: 11498, changed: false, can_sign: false } }))).toBe(true);
    expect(estimateSigned(job({ estimate: { signed_at: null, signer: null, cents: null, changed: false, can_sign: true } }))).toBe(false);
    // signed, then the work changed: to sign again
    expect(estimateSigned(job({ estimate: { signed_at: '2026-11-04T15:00:00Z', signer: 'Julie', cents: 9000, changed: true, can_sign: true } }))).toBe(false);
  });
});
