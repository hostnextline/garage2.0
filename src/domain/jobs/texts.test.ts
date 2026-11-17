import { describe, it, expect } from 'vitest';
import { arrivalTextWanted, textGaps, textSays } from './texts';

describe('what a text tells the customer: a kept send is the same send only while this is the same (jobs-r2-1)', () => {
  const j = { day: '2026-11-17', block: 'am' as const, win_start: null, win_end: null, win_flex: false };
  const items = [{ id: 'i2', status: 'proposed' as const, qty: 1, unit_cents: 4500 }, { id: 'i1', status: 'planned' as const, qty: 1, unit_cents: 8999 }];
  it('the confirmation and « moved »: the day, the block, the window, the total', () => {
    const tue = textSays('moved', j, { items, total: 10345 });
    expect(textSays('moved', { ...j }, { items, total: 10345 })).toBe(tue);
    expect(textSays('moved', { ...j, day: '2026-11-19' }, { items, total: 10345 })).not.toBe(tue);
    expect(textSays('moved', { ...j, block: 'pm' }, { items, total: 10345 })).not.toBe(tue);
    expect(textSays('booking', { ...j, block: 'day', win_start: 840, win_end: 1080 }, { items, total: 10345 }))
      .not.toBe(textSays('booking', { ...j, block: 'day', win_start: 900, win_end: 1140 }, { items, total: 10345 }));
    expect(textSays('booking', { ...j, block: 'day', win_flex: true }, { items, total: 10345 })).not.toBe(textSays('booking', { ...j, block: 'day' }, { items, total: 10345 }));
    expect(textSays('booking', j, { items, total: 20000 })).not.toBe(textSays('booking', j, { items, total: 10345 }));
  });
  it('« extras »: the work proposed (in any order), not the rest', () => {
    const one = textSays('extras', j, { items, total: 0 });
    expect(one).toBe('i2:1:4500');
    expect(textSays('extras', j, { items: [...items, { id: 'i3', status: 'proposed', qty: 2, unit_cents: 100 }], total: 0 })).not.toBe(one);
    expect(textSays('extras', j, { items: [{ id: 'i3', status: 'proposed', qty: 2, unit_cents: 100 }, ...items], total: 0 }))
      .toBe(textSays('extras', j, { items: [...items, { id: 'i3', status: 'proposed', qty: 2, unit_cents: 100 }], total: 0 }));
  });
  it('« arrived »: the amount', () => {
    expect(textSays('arrived', j, { items, total: 10345 })).not.toBe(textSays('arrived', j, { items, total: 15000 }));
  });
});

describe('the invoice texted on arrival (jobs-a-10)', () => {
  const base = { on: true, coffre: false, phone: '5145551234', smsOk: true, total: 11498 };
  it('goes when switched on, to a number that takes texts, with something to bill', () => {
    expect(arrivalTextWanted(base)).toBe(true);
    expect(arrivalTextWanted({ ...base, smsOk: null })).toBe(true);
  });
  it('not with nothing priced (the server refuses an empty invoice and leaves an empty draft), nor for the Coffre', () => {
    expect(arrivalTextWanted({ ...base, total: 0 })).toBe(false);
    expect(arrivalTextWanted({ ...base, coffre: true })).toBe(false);
    expect(arrivalTextWanted({ ...base, on: false })).toBe(false);
    expect(arrivalTextWanted({ ...base, phone: null })).toBe(false);
    expect(arrivalTextWanted({ ...base, smsOk: false })).toBe(false);
  });
});

describe('the texts the customer did not get', () => {
  const base = { status: 'en_route' as const, act: true, msgs: [], trip: false, trackingSent: false, leaveWaiting: false, invoiceDone: false, arrivalOn: true };
  it('on the way with no trip and no text: offer the tracking text', () => {
    expect(textGaps(base).noTracking).toBe(true);
    expect(textGaps({ ...base, trip: true }).noTracking).toBe(false);
    expect(textGaps({ ...base, msgs: [{ kind: 'en_route' }] }).noTracking).toBe(false);
    expect(textGaps({ ...base, act: false }).noTracking).toBe(false);
  });
  it('not while « Je pars » still waits on the phone: a text then makes the job leave twice (jobs-a-25)', () => {
    expect(textGaps({ ...base, leaveWaiting: true }).noTracking).toBe(false);
  });
  it('on site: the invoice text until it went or the invoice is finished', () => {
    const site = { ...base, status: 'on_site' as const };
    expect(textGaps(site).noInvoiceText).toBe(true);
    expect(textGaps({ ...site, msgs: [{ kind: 'arrived' }] }).noInvoiceText).toBe(false);
    expect(textGaps({ ...site, invoiceDone: true }).noInvoiceText).toBe(false);
    expect(textGaps({ ...site, arrivalOn: false }).noInvoiceText).toBe(false);
  });
});
