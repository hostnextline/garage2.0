/* The rights matrix: what each role sees in the app (the server checks every action again). */
import { describe, it, expect, afterEach } from 'vitest';
import { may, isField } from './rights';
import { access } from '../data/auth';
import type { Access } from '../data/types';

const who = (roles: string[], rights: string[] = [], o: Partial<Access> = {}): Access => ({
  id: 'u1', full_name: 'T', short_name: 'T', email: null, phone: null, roles, owner: roles.includes('owner'), lang: 'fr', prefs: {}, color: null,
  rights: Object.fromEntries(rights.map((r) => [r, true])), trucks: [], ...o
} as unknown as Access);
afterEach(() => { access.value = null; });

describe('rights', () => {
  it('a treasurer with « clients » is not offered a new customer file or estimate: the server refuses both (is_field)', () => {
    access.value = who(['treasurer'], ['clients', 'invoices', 'treasury']);
    expect(isField()).toBe(false);
    expect(may.customers()).toBe(true);
    expect(may.newCustomer()).toBe(false);
    expect(may.newQuote()).toBe(false);
    expect(may.quotes()).toBe(true);          // the estimates are still read
    expect(may.treasury()).toBe(true);
  });
  it('the office with « book » makes customers and estimates; the owner sees the oil reminders', () => {
    access.value = who(['office'], ['book', 'agenda', 'clients']);
    expect(may.newCustomer()).toBe(true);
    expect(may.newQuote()).toBe(true);
    expect(may.oil()).toBe(true);
    access.value = who(['owner'], [], { owner: true });
    expect(may.oil()).toBe(true);
    expect(may.team()).toBe(true);
  });
  it('a mechanic: his day, the agenda, walk-ins, Horaires on his own truck only', () => {
    access.value = who(['mechanic'], [], { trucks: ['t1'] });
    expect(may.agenda()).toBe(true);
    expect(may.walkIn()).toBe(true);
    expect(may.hours()).toBe(true);
    expect(may.newCustomer()).toBe(false);    // neither « clients » nor « book »
    expect(may.settings()).toBe(true);
    expect(may.settingsEdit()).toBe(false);
    access.value = who(['mechanic']);
    expect(may.hours()).toBe(false);
  });
});
