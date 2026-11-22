import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../lib/i18n';
import { DEFAULT_SETTINGS } from '../../data/select';
import { viewOf, check, patchOf, nextNumber } from './billingModel';

beforeEach(() => { lang.value = 'fr'; });
const billing = { ...DEFAULT_SETTINGS.billing, travel: { cents: 2500, free_over_cents: 20000 }, terms_fr: 'Payable sur place' };

describe('Facturation', () => {
  it('the travel fee is no longer in the form, and a save keeps the stored one exactly (x-deadcode-01)', () => {
    expect('travel_cents' in viewOf(billing, {})).toBe(false);
    const p = patchOf({ due_days: 30, terms_fr: '  ' });
    expect(p).toEqual({ billing: { due_days: 30, terms_fr: '' } });
    expect({ ...billing, ...p.billing }.travel).toEqual({ cents: 2500, free_over_cents: 20000 });
  });
  it('the footer goes to the company part, only when it changed', () => {
    expect(patchOf({ footer_en: ' Thanks ' })).toEqual({ company: { footer_en: 'Thanks' } });
    expect(patchOf({})).toEqual({});
  });
  it('the next number with the prefix and digits being typed', () => {
    expect(nextNumber({ invoice_prefix: 'F-', pad: 4 }, 42)).toBe('F-0043');
    expect(nextNumber({ invoice_prefix: 'FAC', pad: null }, 0)).toBe('FAC0001');
    expect(nextNumber({ invoice_prefix: '', pad: 12 }, 9)).toBe('00000010');
  });
  it('digits 1 to 8, a prefix of 10 letters at most, a delay of 0 to 365 days', () => {
    const v = viewOf(billing, {});
    expect(check(v)).toEqual({});
    expect(Object.keys(check({ ...v, pad: 9, invoice_prefix: 'ABCDEFGHIJK', due_days: 1.5 })).sort()).toEqual(['due_days', 'invoice_prefix', 'pad']);
  });
});
