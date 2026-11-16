import { describe, it, expect } from 'vitest';
import { chosenTotal, toggle, contactErrors, years, stepOfError, errorKey, nextFrom, mergeSlots, stepNumber, serviceName,
  EMPTY_CONTACT, windowMode, dayOffers, flexSlot, slotWindow, slotKey, bookWhen, afterPage, pastHorizon, whenWords, bookedWhen, type WebService, type WebSlot } from './book-state';
import { parseLink } from '../link';
import { ct } from '../i18n';
import { onTypedStreet } from './book-state';
import type { Suggestion } from '../../shared/places/photon';

const place = (label: string, street: string, lat: number | null = 45.5): Suggestion => ({ place: { address: label, unit: null, postal_code: null, lat, lng: lat == null ? null : -73.6 },
  label, sub: '', exact: true, key: label, house: '1250', street, areas: [] });

const svc = (id: string, price: number | null, min: number, extra: Partial<WebService> = {}): WebService =>
  ({ id, name_fr: `S ${id}`, name_en: `E ${id}`, category: 'x', price_cents: price, taxable: true, duration_min: min, promo: false, promo_until: null, includes: [], ...extra });
const ALL = [svc('a', 8999, 45), svc('b', 9999, 60), svc('c', null, 60), svc('d', 1000, 30, { taxable: false })];

describe('Réserver en ligne: what is chosen', () => {
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

describe('Réserver en ligne: « Plages d’arrivée »', () => {
  const w = (day: string, a: number, near = false): WebSlot => ({ day, block: 'day', near, win_start: a, win_end: a + 240 });
  it('the page offers windows when the garage says so, or when the moments are windows', () => {
    expect(windowMode({ windows: true }, [])).toBe(true);
    expect(windowMode({}, [w('2026-11-19', 540)])).toBe(true);
    expect(windowMode({ windows: false }, [{ day: '2026-11-19', block: 'am', near: false }])).toBe(false);
    expect(windowMode(null, null)).toBe(false);
  });
  it('by day, the first window is the best; the others are « Voir d’autres heures »', () => {
    const d = dayOffers([w('2026-11-19', 540, true), w('2026-11-20', 720), w('2026-11-19', 840), w('2026-11-19', 540), w('2026-11-19', 840)]);
    expect(d.map((x) => x.day)).toEqual(['2026-11-19', '2026-11-20']);
    expect(d[0].best.win_start).toBe(540);
    expect(d[0].near).toBe(true);
    expect(d[0].others.map((x) => x.win_start)).toEqual([840]);
    expect(d[1].others).toEqual([]);
  });
  it('« Voir d’autres dates » keeps two windows of the same day apart, never twice the same', () => {
    expect(mergeSlots([w('2026-11-19', 540)], [w('2026-11-19', 540), w('2026-11-19', 600), w('2026-12-03', 540)]).map(slotKey))
      .toEqual(['2026-11-19|day|540', '2026-11-19|day|600', '2026-12-03|day|540']);
    expect(slotKey({ day: '2026-11-19', block: 'am', near: false })).toBe('2026-11-19|am');
  });
  it('what is booked: a block as always, a window by its start, or flexible', () => {
    expect(bookWhen({ day: '2026-11-19', block: 'pm', near: true })).toEqual({ day: '2026-11-19', block: 'pm' });
    expect(bookWhen(w('2026-11-19', 540))).toEqual({ day: '2026-11-19', block: 'day', win_start: 540 });
    expect(bookWhen(flexSlot(w('2026-11-19', 540, true)))).toEqual({ day: '2026-11-19', block: 'day', win_flex: true });
    expect(flexSlot(w('2026-11-19', 540, true))).toEqual({ day: '2026-11-19', block: 'day', near: true, flex: true });
    expect(slotWindow(w('2026-11-19', 540))).toEqual([540, 780]);
    expect(slotWindow(flexSlot(w('2026-11-19', 540)))).toBe(null);
    expect(slotWindow({ block: 'am', win_start: 540, win_end: 780 })).toBe(null);
  });
  it('a window just taken: back to the windows, with clear words in both languages', () => {
    expect(stepOfError('window_full')).toBe('slots');
    expect(errorKey('window_full')).toBe('book.slots.windowTaken');
    expect(ct('fr', 'book.slots.windowTaken')).toMatch(/plage/);
    expect(ct('en', 'book.slots.windowTaken')).toMatch(/window/);
  });
  it('the words of the windows exist in both languages', () => {
    for (const k of ['flex', 'flexNote', 'book.slots.subWindows', 'book.slots.otherHours', 'book.slots.fewerHours', 'book.slots.flex', 'book.slots.flexNote', 'book.done.leadFlex']) {
      for (const l of ['fr', 'en'] as const) expect(ct(l, k)).not.toBe(k);
    }
    expect(ct('fr', 'book.slots.flex')).toBe('Je suis disponible toute la journée');
    expect(ct('fr', 'book.slots.otherHours')).toBe('Voir d’autres heures');
  });
});

describe('Réserver en ligne: « Voir d’autres dates » to the horizon (client-page-14)', () => {
  const T = '2026-12-14';
  it('a later fortnight with nothing free is skipped by itself, a few at a time', () => {
    // the holidays: the page of the 28th is empty; the page looks at the next fortnight at once
    expect(afterPage('2026-12-28', 0, T, 120, 0, 3)).toEqual({ next: '2027-01-11', again: true, end: false });
    // after a few skips the page stops asking (the server counts each ask) but « Voir d’autres dates » stays
    expect(afterPage('2027-01-11', 0, T, 120, 3, 3)).toEqual({ next: '2027-01-25', again: false, end: false });
  });
  it('says « Aucun autre moment libre » only past the garage’s horizon', () => {
    expect(afterPage('2027-04-05', 0, T, 120, 0, 3)).toEqual({ next: '2027-04-19', again: false, end: true });
    expect(pastHorizon('2027-04-19', T, 120)).toBe(true);
    expect(pastHorizon('2027-01-11', T, 120)).toBe(false);
    // an older server without horizon_days: 120 days
    expect(pastHorizon('2027-01-11', T, undefined)).toBe(false);
  });
  it('the first page, empty or not, is never skipped nor the end', () => {
    expect(afterPage(null, 0, T, 120, 0, 3)).toEqual({ next: '2026-12-28', again: false, end: false });
    expect(afterPage('2026-12-28', 2, T, 120, 0, 3)).toEqual({ next: '2027-01-11', again: false, end: false });
  });
});

describe('Réserver en ligne: the words of a moment', () => {
  const BLOCKS = [{ key: 'pm', start: 720, end: 960 }];
  const sp = (s: string) => s.replace(/\s/g, ' ');
  it('a block by its hours, a window, or « Dans la journée »', () => {
    expect(sp(whenWords({ block: 'pm' }, BLOCKS, 'fr'))).toBe('Entre 12 h et 16 h');
    expect(whenWords({ block: 'eve' }, BLOCKS, 'fr')).toBe('Soir');
    expect(sp(whenWords({ block: 'day', win_start: 540, win_end: 780 }, BLOCKS, 'fr'))).toBe('Entre 9 h et 13 h');
    expect(whenWords({ block: 'day', flex: true }, BLOCKS, 'en')).toBe('During the day');
  });
  it('the moment the server kept: its window, else the window chosen (older server), else flexible', () => {
    const chosen = { day: '2026-11-20', block: 'day', near: false, win_start: 540, win_end: 780 };
    const done = { ok: true as const, link: 'x', day: '2026-11-20', block: 'day', text: 'sent' };
    expect(bookedWhen({ ...done, win_start: 600, win_end: 840 }, chosen)).toEqual({ block: 'day', win_start: 600, win_end: 840 });
    expect(bookedWhen(done, chosen)).toBe(chosen);
    expect(bookedWhen({ ...done, flex: true }, chosen)).toEqual({ block: 'day', flex: true });
    expect(bookedWhen({ ...done, block: 'pm' }, null)).toMatchObject({ block: 'pm' });
  });
});
