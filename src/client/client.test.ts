import { describe, it, expect } from 'vitest';
import { ct, translate, pickLang } from './i18n';
import { client as fr } from '../i18n/fr/client';
import { client as en } from '../i18n/en/client';
import { slotText, dayTitle, relDay, cad, lineCents, qtyText, telHref, localMinuteOf, localDayOf, clockOf } from './format';
import { parseLink, linkHash } from './link';
import { invoicePaid, nothingLeft, chargesTaxes, sections, afterCheck } from './view-state';
import type { JobView } from './api';

const sp = (s: string | null) => String(s).replace(/\s/g, ' ');   // no-break spaces read as spaces

function keys(d: unknown, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !('other' in (v as object))) out.push(...keys(v, p)); else out.push(p);
  }
  return out;
}
const ph = (s: unknown) => (JSON.stringify(s).match(/\{\w+\}/g) || []).sort().join(',');

describe('the words of the customer page', () => {
  it('has every French word in English, with the same {placeholders}', () => {
    const k = keys(fr);
    expect(keys(en)).toEqual(k);
    for (const key of k) {
      const a = key.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], fr);
      const b = key.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], en);
      expect(ph(b), key).toBe(ph(a));
    }
  });
  it('says the same thing in both languages', () => {
    expect(ct('fr', 'pay.button', { amount: '229,95 $' })).toBe('Payer 229,95 $ par carte');
    expect(ct('en', 'pay.button', { amount: '$229.95' })).toBe('Pay $229.95 by card');
    expect(ct('fr', 'hello', { name: 'Julie' })).toBe('Bonjour Julie,');
    expect(ct('en', 'job.status.en_route')).toBe('Your mechanic is on the way');
    expect(ct('fr', 'nope.nothing')).toBe('nope.nothing');
  });
  it('picks plural forms like the app (French: 0 and 1 are singular)', () => {
    const d = { fr: { n: { one: '{n} travail', other: '{n} travaux' } }, en: { n: { one: '{n} job', other: '{n} jobs' } } };
    expect(translate(d, 'fr', 'n', { n: 1 })).toBe('1 travail');
    expect(translate(d, 'fr', 'n', { n: 0 })).toBe('0 travail');
    expect(translate(d, 'fr', 'n', { n: 3 })).toBe('3 travaux');
    expect(translate(d, 'en', 'n', { n: 1 })).toBe('1 job');
    expect(translate(d, 'en', 'n', { n: 0 })).toBe('0 jobs');
    expect(translate({ fr: { a: 'oui' }, en: {} }, 'en', 'a')).toBe('oui');   // English missing: French
  });
  it('follows the link, then the customer file, then the phone', () => {
    expect(pickLang('en', 'fr', 'fr-CA')).toBe('en');
    expect(pickLang(null, 'en', 'fr-CA')).toBe('en');
    expect(pickLang(null, null, 'en-US')).toBe('en');
    expect(pickLang(null, 'xx', 'fr-CA')).toBe('fr');
    expect(pickLang(null, null, null)).toBe('fr');
  });
});

describe('money, days and times for the customer', () => {
  it('writes money the Québec way in French and the Canadian way in English', () => {
    expect(sp(cad(22995, 'fr'))).toBe('229,95 $');
    expect(cad(22995, 'en')).toBe('$229.95');
    expect(sp(cad(123456, 'fr'))).toBe('1 234,56 $');
    expect(cad(0, 'en')).toBe('$0.00');
  });
  it('writes the time slot', () => {
    expect(sp(slotText(720, 960, 'fr'))).toBe('Entre 12 h et 16 h');
    expect(sp(slotText(480, 720, 'en'))).toBe('Between 8 a.m. and 12 p.m.');
    expect(slotText(null, 960, 'fr')).toBeNull();
    expect(slotText(720, 960, 'fr')).toContain('12 h');   // a time never breaks across two lines
  });
  it('writes the day, with the year only when it is not this year', () => {
    const now = new Date(2026, 10, 4, 9);
    expect(dayTitle('2026-11-05', 'fr', now)).toBe('Jeudi 5 novembre');
    expect(dayTitle('2026-11-05', 'en', now)).toBe('Thursday, November 5');
    expect(dayTitle('2027-01-06', 'fr', now)).toBe('Mercredi 6 janvier 2027');
    expect(relDay('2026-11-04', now)).toBe('today');
    expect(relDay('2026-11-05', now)).toBe('tomorrow');
    expect(relDay('2026-11-07', now)).toBeNull();
  });
  it('reads moments on Montréal’s clock (winter and summer time)', () => {
    expect(localMinuteOf('2026-11-04T17:40:00Z')).toBe(12 * 60 + 40);
    expect(localMinuteOf('2026-07-04T17:40:00Z')).toBe(13 * 60 + 40);
    expect(localDayOf('2026-11-05T03:30:00Z')).toBe('2026-11-04');
    expect(sp(clockOf('2026-11-04T17:40:00Z', 'fr'))).toBe('12 h 40');
    expect(sp(clockOf('2026-11-04T17:40:00Z', 'en'))).toBe('12:40 p.m.');
    expect(localMinuteOf('pas une date')).toBeNull();
  });
  it('counts lines, discounts and quantities', () => {
    expect(lineCents({ qty: 2, unit_cents: 2499 })).toBe(4998);
    expect(lineCents({ qty: 1, unit_cents: 2000, kind: 'discount' })).toBe(-2000);
    expect(lineCents({ qty: 1, unit_cents: -2000 })).toBe(-2000);
    expect(lineCents({ qty: 3, unit_cents: 100, total_cents: 250 })).toBe(250);
    expect(sp(qtyText({ qty: 2, unit_cents: 2499 }, 'fr'))).toBe('2 × 24,99 $');
    expect(qtyText({ qty: 1.5, unit_cents: 10000 }, 'en')).toBe('1.5 × $100.00');
    expect(qtyText({ qty: 1, unit_cents: 2499 }, 'fr')).toBeNull();
  });
  it('makes a phone link only of a real number', () => {
    expect(telHref('438 901-6606')).toBe('tel:+14389016606');
    expect(telHref('+1 (514) 555-1234')).toBe('tel:+15145551234');
    expect(telHref('901-6606')).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe('the link', () => {
  it('reads the appointment link, the language and the way back from Stripe', () => {
    expect(parseLink('#t=AbC_123-xyz&l=en&retour=paye')).toEqual({ kind: 't', token: 'AbC_123-xyz', l: 'en', retour: 'paye' });
    expect(parseLink('#suivi=Zz9')).toEqual({ kind: 'suivi', token: 'Zz9', l: null, retour: null });
    expect(parseLink('')).toEqual({ kind: null, token: '', l: null, retour: null });
    expect(parseLink('#t=abc&l=de').l).toBeNull();
  });
  it('forgives a period or a bracket glued to the link by a texting app', () => {
    expect(parseLink('#t=abcdef.').token).toBe('abcdef');
    expect(parseLink('#suivi=abcdef)').token).toBe('abcdef');
  });
  it('writes it back', () => {
    expect(linkHash('t', 'abc', 'en')).toBe('#t=abc&l=en');
    expect(linkHash('suivi', 'abc', null)).toBe('#suivi=abc');
    expect(linkHash('t', 'abc', null, { retour: 'paye' })).toBe('#t=abc&retour=paye');
  });
});

function job(o: Partial<JobView> = {}): JobView {
  return {
    ok: true, kind: 'job', garage: { name: 'Garage' }, lang: 'fr', customer: { first: 'Julie' },
    job: { number: 1, day: '2026-11-04', block: 'pm', start: 720, end: 960, status: 'booked', tracking: false, vehicle: null, waiver_signed: false },
    items: [{ id: 'a', description: 'Huile', qty: 1, unit_cents: 10000, status: 'planned' }, { id: 'x1', description: 'Extra', qty: 1, unit_cents: 5000, status: 'approved' }],
    extras: [{ id: 'x1', description: 'Extra', qty: 1, unit_cents: 5000, total_cents: 5000, status: 'approved', note: null, answered_via: 'link' },
      { id: 'x2', description: 'Autre', qty: 1, unit_cents: 3000, total_cents: 3000, status: 'proposed', note: 'Usé', answered_via: null },
      { id: 'x3', description: 'Non', qty: 1, unit_cents: 1000, total_cents: 1000, status: 'declined', note: null, answered_via: 'link' }],
    expected: { subtotal: 15000, tps: 750, tvq: 1496, total: 17246 }, prepaid_cents: 0, invoice: null,
    pay: { available: true, amount_cents: 17246, kind: 'prepay', pending: false }, ...o
  };
}
const inv = (paid: number, status = 'issued') => ({ number: 'F-0001', issued_at: null, due_on: null, status, lines: [], subtotal_cents: 15000, tps_cents: 750, tvq_cents: 1496, total_cents: 17246, paid_cents: paid, notes: null });

describe('what the appointment page shows', () => {
  it('sorts the extra work: to answer, refused, and accepted with the planned work', () => {
    const s = sections(job());
    expect(s.proposed.map((x) => x.id)).toEqual(['x2']);
    expect(s.declined.map((x) => x.id)).toEqual(['x3']);
    expect(s.planned.map((x) => x.id)).toEqual(['a', 'x1']);
  });
  it('knows when an invoice is paid', () => {
    expect(invoicePaid(inv(0))).toBe(false);
    expect(invoicePaid(inv(17246))).toBe(true);
    expect(invoicePaid(inv(0, 'paid'))).toBe(true);
    expect(invoicePaid(null)).toBe(false);
    expect(nothingLeft(job({ invoice: inv(10000) }))).toBe(false);
    expect(nothingLeft(job({ invoice: inv(17246) }))).toBe(true);
    expect(nothingLeft(job({ prepaid_cents: 17246 }))).toBe(true);
    expect(nothingLeft(job({ prepaid_cents: 5000 }))).toBe(false);
  });
  it('says « plus taxes » only when the garage charges taxes', () => {
    expect(chargesTaxes(job())).toBe(true);
    expect(chargesTaxes(job({ expected: { subtotal: 15000, tps: 0, tvq: 0, total: 15000 } }))).toBe(false);
    expect(chargesTaxes(job({ expected: { subtotal: 0, tps: 0, tvq: 0, total: 0 } }))).toBe(true);
  });
  it('after Stripe: paid when nothing is left, else checks again, then says it is late', () => {
    const unpaid = job({ invoice: inv(0), pay: { available: true, amount_cents: 17246, kind: 'invoice', pending: true } });
    expect(afterCheck(unpaid, 1, 5)).toBe('checking');
    expect(afterCheck(unpaid, 5, 5)).toBe('late');
    expect(afterCheck(job({ invoice: inv(17246, 'paid'), pay: { available: false, amount_cents: 0, kind: 'invoice', pending: false } }), 1, 5)).toBe('paid');
    expect(afterCheck(job({ prepaid_cents: 17246, pay: { available: false, amount_cents: 0, kind: 'prepay', pending: false } }), 2, 5)).toBe('paid');
  });
});
