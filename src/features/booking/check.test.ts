import { describe, it, expect } from 'vitest';
import { missing, showsFix, carBad, callerOk, type CheckInput } from './check';

const ok: CheckInput = {
  walkIn: false, quoteDone: false, customerId: 'c-1', newCaller: false, searchKnown: false, callerOk: false, callCars: [], planned: 1,
  truckNeeded: false, truckId: null, choice: { day: '2026-11-18', block: 'am' }
};

describe('what is missing before « Réserver »', () => {
  it('the customer first, then the work, then the moment (as before)', () => {
    expect(missing({ ...ok, customerId: null })).toBe('customer');
    expect(missing({ ...ok, planned: 0 })).toBe('work');
    expect(missing({ ...ok, choice: null })).toBe('block');
    expect(missing(ok)).toBeNull();
    expect(missing({ ...ok, walkIn: true, choice: null })).toBeNull();
  });
  it('an estimate already booked is not booked twice (booking-a-08)', () => {
    expect(missing({ ...ok, quoteDone: true })).toBe('quote');
  });
  it('a walk-in nobody drives names its vehicle (booking-a-13)', () => {
    expect(missing({ ...ok, walkIn: true, choice: null, truckNeeded: true })).toBe('truck');
    expect(missing({ ...ok, walkIn: true, choice: null, truckNeeded: true, truckId: 't-1' })).toBeNull();
  });
  it('a new caller: the name and number, then the cars; then the work and the moment', () => {
    const call: CheckInput = { ...ok, customerId: null, newCaller: true };
    expect(missing(call)).toBe('caller');
    expect(missing({ ...call, callerOk: true, callCars: [{ id: 'a', state: 'bad', work: 0 }] })).toBe('cars');
    expect(missing({ ...call, callerOk: true, callCars: [{ id: 'a', state: 'empty', work: 1 }] })).toBeNull();
    expect(missing({ ...call, callerOk: true, callCars: [{ id: 'a', state: 'ok', work: 1 }], planned: 0 })).toBe('work');
  });
  it('« Chercher un client qu’on connaît » open: somebody must be chosen, the hidden name never makes a file (booking-a-15)', () => {
    expect(missing({ ...ok, customerId: null, newCaller: true, callerOk: true, searchKnown: true })).toBe('customer');
  });
  it('the button can be tapped to show the name, number or car to fix (booking-a-11); otherwise it waits', () => {
    expect(showsFix('caller')).toBe(true);
    expect(showsFix('cars')).toBe(true);
    for (const m of ['customer', 'work', 'block', 'quote', 'truck', null] as const) expect(showsFix(m)).toBe(false);
  });
});

describe('a new caller’s fields', () => {
  it('one car may stay empty; with several, a car with work must be said', () => {
    expect(carBad({ id: 'a', state: 'empty', work: 1 }, 1)).toBe(false);
    expect(carBad({ id: 'a', state: 'empty', work: 1 }, 2)).toBe(true);
    expect(carBad({ id: 'a', state: 'empty', work: 0 }, 2)).toBe(false);
    expect(carBad({ id: 'a', state: 'bad', work: 0 }, 1)).toBe(true);
  });
  it('a first name and a full number', () => {
    const digits = (p: string) => (p.replace(/\D/g, '').length === 10 ? p.replace(/\D/g, '') : null);
    expect(callerOk({ first: 'Mario', last: '', phone: '438 555-0177' }, digits)).toBe(true);
    expect(callerOk({ first: ' ', last: '', phone: '438 555-0177' }, digits)).toBe(false);
    expect(callerOk({ first: 'Mario', last: '', phone: '438 555' }, digits)).toBe(false);
  });
});
