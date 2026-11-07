import { describe, it, expect } from 'vitest';
import { chosenMinutes, chosenTotal, toggle, contactErrors, years, stepOfError, errorKey, nextFrom, mergeSlots, stepNumber, serviceName,
  EMPTY_CONTACT, type WebService } from './book-state';
import { parseLink } from './link';
import { ct } from './i18n';
import { onTypedStreet } from './book-state';
import type { Suggestion } from '../features/customers/photon';

const place = (label: string, street: string, lat: number | null = 45.5): Suggestion => ({ place: { address: label, unit: null, postal_code: null, lat, lng: lat == null ? null : -73.6 },
  label, sub: '', exact: true, key: label, house: '1250', street, areas: [] });

const svc = (id: string, price: number | null, min: number, extra: Partial<WebService> = {}): WebService =>
  ({ id, name_fr: `S ${id}`, name_en: `E ${id}`, category: 'x', price_cents: price, taxable: true, duration_min: min, promo: false, promo_until: null, includes: [], ...extra });
const ALL = [svc('a', 8999, 45), svc('b', 9999, 60), svc('c', null, 60), svc('d', 1000, 30, { taxable: false })];

describe('Réserver en ligne: what is chosen', () => {
  it('the minutes of the work: the sum, between 15 min and 8 h (as the server counts)', () => {
    expect(chosenMinutes(ALL, ['a', 'b'])).toBe(105);
    expect(chosenMinutes(ALL, [])).toBe(60);
    expect(chosenMinutes([svc('z', 10, 5)], ['z'])).toBe(15);
    expect(chosenMinutes([svc('y', 10, 300), svc('w', 10, 300)], ['y', 'w'])).toBe(480);
  });
  it('the total with the Québec taxes; work by the hour is not in it, and is said', () => {
    expect(chosenTotal(ALL, ['a'])).toEqual({ total: 10347, hourly: false, any: true });
    expect(chosenTotal(ALL, ['a', 'c'])).toEqual({ total: 10347, hourly: true, any: true });
    expect(chosenTotal(ALL, ['c'])).toEqual({ total: 0, hourly: true, any: false });
    expect(chosenTotal(ALL, ['d']).total).toBe(1000);           // not taxable
    expect(chosenTotal(ALL, ['a'], false).total).toBe(8999);    // taxes off in Réglages
  });
  it('a tap chooses, a second tap removes', () => {
    expect(toggle([], 'a')).toEqual(['a']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('the service in the customer’s language', () => {
    expect(serviceName(ALL[0], 'en')).toBe('E a');
    expect(serviceName({ ...ALL[0], name_en: '' }, 'en')).toBe('S a');
  });
  it('step numbers: 1 to 4', () => {
    expect([stepNumber('services'), stepNumber('address'), stepNumber('slots'), stepNumber('contact')]).toEqual([1, 2, 3, 4]);
  });
});

describe('Réserver en ligne: the form', () => {
  it('first name, a 10-digit phone, make and model are needed; email and last name are not', () => {
    expect(Object.keys(contactErrors(EMPTY_CONTACT)).sort()).toEqual(['first', 'make', 'model', 'phone']);
    const ok = { ...EMPTY_CONTACT, first: 'Sophie', phone: '(514) 555-1234', make: 'Toyota', model: 'RAV4' };
    expect(contactErrors(ok)).toEqual({});
    expect(contactErrors({ ...ok, phone: '555-1234' })).toEqual({ phone: 'errPhone' });
    expect(contactErrors({ ...ok, phone: '+1 438 901 6606' })).toEqual({});
    expect(contactErrors({ ...ok, email: 'pas un courriel' })).toEqual({ email: 'errEmail' });
    expect(contactErrors({ ...ok, email: 'sophie@exemple.ca' })).toEqual({});
  });
  it('years: next year down to 1980', () => {
    const y = years(new Date('2026-11-07T12:00:00'));
    expect(y[0]).toBe(2027);
    expect(y[y.length - 1]).toBe(1980);
  });
  it('every word of the form exists in French and English', () => {
    for (const k of ['errFirst', 'errPhone', 'errEmail', 'errMake', 'errModel']) {
      for (const l of ['fr', 'en'] as const) expect(ct(l, `book.contact.${k}`)).not.toBe(`book.contact.${k}`);
    }
  });
});

describe('Réserver en ligne: the answers of the server', () => {
  it('a refusal brings the customer back to the step to fix', () => {
    expect(stepOfError('block_full')).toBe('slots');
    expect(stepOfError('far')).toBe('address');
    expect(stepOfError('no_service')).toBe('services');
    expect(stepOfError('phone')).toBe('contact');
    expect(stepOfError('too_many')).toBe(null);
  });
  it('every refusal has words in both languages; an unknown one is « a problem on our side »', () => {
    for (const code of ['block_full', 'far', 'too_many', 'busy', 'network', 'phone', 'name', 'email', 'no_service', 'weird']) {
      const key = errorKey(code);
      expect(ct('fr', key)).not.toBe(key);
      expect(ct('en', key)).not.toBe(key);
    }
    expect(errorKey('weird')).toBe('book.errors.server');
  });
  it('« Voir d’autres dates »: the days after the ones asked, without twice the same moment', () => {
    expect(nextFrom('2026-11-07', 14)).toBe('2026-11-21');
    expect(nextFrom('2026-12-25', 14)).toBe('2027-01-08');
    const a = [{ day: '2026-11-08', block: 'am', near: true }];
    expect(mergeSlots(a, [{ day: '2026-11-08', block: 'am', near: false }, { day: '2026-11-22', block: 'pm', near: false }]).map((s) => s.block)).toEqual(['am', 'pm']);
  });
  it('the link client.html#reserver (and in English)', () => {
    expect(parseLink('#reserver').kind).toBe('reserver');
    expect(parseLink('#reserver&l=en')).toMatchObject({ kind: 'reserver', l: 'en' });
    expect(parseLink('#t=abc').kind).toBe('t');
  });
});

describe('Réserver en ligne: the address', () => {
  it('only the places on the street typed: never another street with the same door number', () => {
    const tmr = { ...place('1250 rue Graham', 'Rue Graham'), areas: ['Mont-Royal'] };
    const bell = { ...place('1250 rue Graham-Bell', 'rue Graham-Bell'), areas: ['Boucherville'] };
    const jt = { ...place('1250 rue Jean-Talon Ouest', 'rue Jean-Talon Ouest'), areas: ['Ville de Mont-Royal'] };
    expect(onTypedStreet([jt, bell, tmr], '1250 rue Graham, Mont-Royal').map((s) => s.label)).toEqual(['1250 rue Graham']);
    expect(onTypedStreet([jt, bell], '1250 rue Graham, Mont-Royal')).toEqual([]);          // wrong street, wrong town
    expect(onTypedStreet([jt, bell, tmr], '1250 rue Graham').map((s) => s.label)).toEqual(['1250 rue Graham']);
    expect(onTypedStreet([bell], '1250 rue Graham').map((s) => s.label)).toEqual(['1250 rue Graham-Bell']);   // no town typed: offered, the customer sees the town
    expect(onTypedStreet([{ ...place('144 58e Avenue', '58e Avenue'), areas: ['Laval'] }], '144 58e av., Laval')).toHaveLength(1);
    expect(onTypedStreet([place('4521 rue Fabre', 'Rue Fabre', null)], '4521 rue Fabre')).toEqual([]);   // no position: not offered
  });
});
