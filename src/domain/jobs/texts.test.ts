import { describe, it, expect } from 'vitest';
import { arrivalTextWanted, textGaps } from './texts';

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
