import { describe, it, expect } from 'vitest';
import { fieldReducer, START, type FieldState, type FieldEvent } from './addressState';
import type { Suggestion } from './photon';

const s = (key: string, exact = true) => ({ key, exact, label: key, sub: '', house: '', street: '', areas: [],
  place: { address: key, unit: null, postal_code: null, lat: 45.5, lng: -73.6 } }) as Suggestion;
const run = (events: FieldEvent[], from: FieldState = START) => events.reduce(fieldReducer, from);

describe('the address field’s state', () => {
  it('suggestions open while the person is in the field', () => {
    const st = run([{ type: 'focus', located: false }, { type: 'busy' }, { type: 'suggestions', places: [s('a'), s('b')], offline: false, asked: false }]);
    expect(st).toMatchObject({ open: true, status: 'idle', active: 0 });
  });
  it('a late list never opens on a field that was left (customers-a-07)', () => {
    const st = run([{ type: 'focus', located: false }, { type: 'blur' }, { type: 'suggestions', places: [s('a')], offline: false, asked: false }]);
    expect(st.open).toBe(false);
    expect(st.items).toHaveLength(1);
  });
  it('« Chercher » opens the list without the focus', () => {
    expect(run([{ type: 'suggestions', places: [s('a')], offline: false, asked: true }]).open).toBe(true);
  });
  it('no answer or no signal says so', () => {
    expect(run([{ type: 'suggestions', places: [], offline: false, asked: false }]).status).toBe('none');
    expect(run([{ type: 'suggestions', places: [], offline: true, asked: false }]).status).toBe('offline');
  });
  it('the arrows go round the list', () => {
    const st = run([{ type: 'suggestions', places: [s('a'), s('b'), s('c')], offline: false, asked: true }, { type: 'move', by: -1 }]);
    expect(st.active).toBe(2);
    expect(fieldReducer(st, { type: 'move', by: 1 }).active).toBe(0);
  });
  it('a choice closes the list and is remembered until the person types again', () => {
    const st = run([{ type: 'suggestions', places: [s('a')], offline: false, asked: true }, { type: 'picked', s: s('a', false) }]);
    expect(st).toMatchObject({ open: false, items: [], picked: { key: 'a', exact: false } });
    expect(fieldReducer(st, { type: 'typed' }).picked).toBeNull();
  });
  it('several places fit: they wait, closed, for a choice', () => {
    const st = run([{ type: 'busy' }, { type: 'notLocated', status: 'choose', choices: [s('a'), s('b')] }]);
    expect(st).toMatchObject({ open: false, status: 'idle' });
    expect(st.items).toHaveLength(2);
  });
  it('nothing found: « none » only when there is no list to choose from', () => {
    expect(run([{ type: 'notLocated', status: 'none' }]).status).toBe('none');
    expect(run([{ type: 'suggestions', places: [s('a')], offline: false, asked: false }, { type: 'notLocated', status: 'none' }]).status).toBe('idle');
  });
  it('the focus opens a list left waiting, unless the address is placed', () => {
    const waiting = run([{ type: 'suggestions', places: [s('a')], offline: false, asked: false }]);
    expect(fieldReducer(waiting, { type: 'focus', located: false }).open).toBe(true);
    expect(fieldReducer(waiting, { type: 'focus', located: true }).open).toBe(false);
  });
  it('a value replaced from outside forgets the choice made for the other address (customers-a-19)', () => {
    const st = run([{ type: 'focus', located: false }, { type: 'picked', s: s('a', false) }, { type: 'reset' }]);
    expect(st).toEqual({ ...START, focused: true });
  });
});
