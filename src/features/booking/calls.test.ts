import { describe, it, expect } from 'vitest';
import { callToShow, CALL_SHOWN_MS, callHref, callMatches, nextWhen, CALL_STARTS } from './calls';
import { callLink, type IncomingCall } from '../../services/bubbles';
import { searchDoc } from '../../shared/customers/search';
import type { Customer } from '../../data/types';

const now = Date.parse('2026-11-12T15:00:00Z');
const call = (id: string, agoMs: number, name: string | null = null): IncomingCall => ({ id, phone: '+15145550100', name, at: new Date(now - agoMs).toISOString() });

describe('« Appel entrant » banner', () => {
  it('the newest call, while it is fresh and not closed', () => {
    const list = [call('old', 60000), call('new', 5000), call('gone', CALL_SHOWN_MS + 1000)];
    expect(callToShow(list, new Set(), now)?.id).toBe('new');
    expect(callToShow(list, new Set(['new']), now)?.id).toBe('old');
    expect(callToShow(list, new Set(['new', 'old']), now)).toBeNull();
  });
  it('opens Appel entrant with the 10 digits and the name', () => {
    expect(callLink({ phone: '+15145550100', name: 'Julie Tremblay' })).toBe('/call?phone=5145550100&name=Julie%20Tremblay');
    expect(callLink({ phone: '+15145550100', name: null })).toBe('/call?phone=5145550100');
  });
});

describe('« Appel entrant » screen', () => {
  const julie = { id: 'c-1', first_name: 'Julie', last_name: 'Tremblay', phone: '514 555-0141' } as Customer;
  const marc = { id: 'c-2', first_name: 'Marc', last_name: 'Roy', phone: '438 555-0100' } as Customer;
  const docs = new Map([julie, marc].map((c) => [c.id, searchDoc(c)]));
  it('finds the customers by the digits typed, from 3 digits', () => {
    expect(callMatches([julie, marc], '51', (c) => docs.get(c.id))).toEqual([]);
    expect(callMatches([julie, marc], '514 555', (c) => docs.get(c.id)).map((c) => c.id)).toEqual(['c-1']);
    expect(callMatches([julie, marc], '(514) 555-0141', (c) => docs.get(c.id)).map((c) => c.id)).toEqual(['c-1']);
  });
  it('a new caller: the booking screen in the order of the call, the number and the name already there', () => {
    expect(CALL_STARTS).toEqual(['address', 'car', 'job']);
    expect(callHref('job', ' 438 555-0177 ', 'Nouveau Client')).toBe('#/book?call=1&start=job&phone=438%20555-0177&name=Nouveau%20Client');
    expect(callHref('address', '')).toBe('#/book?call=1&start=address');
  });
  it('says the next appointment: its block, its window, or flexible', () => {
    expect(nextWhen({ block: 'pm', win_start: null, win_end: null, win_flex: false }, 'fr')).toBe('après-midi');
    expect(nextWhen({ block: 'day', win_start: 600, win_end: 840, win_flex: false }, 'fr')).toBe('entre 10 h et 14 h');
    expect(nextWhen({ block: 'day', win_start: null, win_end: null, win_flex: true }, 'fr')).toBe('dans la journée (plage confirmée la veille)');
  });
});
