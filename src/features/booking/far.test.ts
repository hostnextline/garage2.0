import { describe, it, expect, vi } from 'vitest';
import { farOfAnswer, inTime } from './far';
import { farQuestion } from '../../domain/moment/logic';
import { readAddress, barChoice, openDayOf, backOf, callerOf } from './address';

const lim = { hop: 35, day: 105 };

describe('« garde-route » asked again at « Réserver » (booking-a-10)', () => {
  const rows = [
    { day: '2026-12-08', block: 'am' as const, truck: 't-1', far: null, add_min: 8, day_min: 60, hop_min: 12, stops: 2 },
    { day: '2026-12-08', block: 'pm' as const, truck: 't-2', far: 'hop' as const, add_min: 70, day_min: 150, hop_min: 62, stops: 3 }
  ];
  it('a moment after the picker’s 14 days, or a stale answer: the server’s score of exactly that moment', () => {
    const far = farOfAnswer(rows, { day: '2026-12-08', block: 'pm' }, null, lim, 'fr');
    expect(far).toMatchObject({ day: '2026-12-08', block: 'pm', kind: 'hop' });
    expect(farQuestion(far, { day: '2026-12-08', block: 'pm' }, 'book', 'fr')?.ok).toBe('Réserver quand même');
    expect(farOfAnswer(rows, { day: '2026-12-08', block: 'am' }, null, lim, 'fr')).toBeNull();
  });
  it('« Plages d’arrivée »: the day’s row (block « day »)', () => {
    const day = [{ day: '2026-12-08', block: 'day' as const, truck: 't-1', far: 'day' as const, day_min: 140, stops: 4 }];
    expect(farOfAnswer(day, { day: '2026-12-08', block: 'day' }, null, lim, 'fr')?.kind).toBe('day');
  });
  it('another vehicle’s score, or no score at all (a full block): nothing is said', () => {
    expect(farOfAnswer(rows, { day: '2026-12-08', block: 'pm' }, 't-1', lim, 'fr')).toBeNull();
    expect(farOfAnswer(rows, { day: '2026-12-08', block: 'eve' }, null, lim, 'fr')).toBeNull();
  });
  it('the booking does not wait for a slow or failing server', async () => {
    vi.useFakeTimers();
    const slow = inTime(new Promise<number[]>(() => undefined), 4000, []);
    vi.advanceTimersByTime(4000);
    expect(await slow).toEqual([]);
    vi.useRealTimers();
    expect(await inTime(Promise.reject(new Error('offline')), 4000, ['none'])).toEqual(['none']);
    expect(await inTime(Promise.resolve([1]), 4000, [])).toEqual([1]);
  });
});

describe('the address bar', () => {
  const q = (s: string) => readAddress(new URLSearchParams(s));
  const o = (windows: boolean, started = false) => ({ windows, len: 240, today: '2026-11-17', started: () => started });
  it('a block, unless it has started; a walk-in never has one', () => {
    expect(barChoice(q('day=2026-11-18&block=am'), o(false))).toEqual({ day: '2026-11-18', block: 'am' });
    expect(barChoice(q('day=2026-11-18&block=am'), o(false, true))).toBeNull();
    expect(barChoice(q('walkin=1&day=2026-11-18&block=am'), o(false))).toBeNull();
  });
  it('« Plages d’arrivée »: the window or flexible; the day alone and a copy open the day in the picker', () => {
    expect(barChoice(q('day=2026-11-18&block=day&win=840'), o(true))).toEqual({ day: '2026-11-18', block: 'day', win_start: 840, win_end: 1080 });
    expect(barChoice(q('day=2026-11-18&block=day&flex=1'), o(true))).toEqual({ day: '2026-11-18', block: 'day', win_flex: true });
    expect(barChoice(q('day=2026-11-18&block=day'), o(true))).toBeNull();
    expect(barChoice(q('copy=j-3&day=2026-11-18&block=day&win=840'), o(true))).toBeNull();
    expect(barChoice(q('day=2026-11-16&block=day&win=840'), o(true))).toBeNull();
    expect(openDayOf(q('day=2026-11-18&block=pm'), true)).toBe('2026-11-18');
    expect(openDayOf(q('day=2026-11-18&block=pm'), false)).toBeNull();
  });
  it('« Appel entrant »: the start (the address by default), the name GoHighLevel knows, the number', () => {
    expect(q('call=1&start=job&phone=438&name=Mario%20de%20la%20Rue')).toMatchObject({ call: true, start: 'job', caller: { first: 'Mario', last: 'de la Rue', phone: '438' } });
    expect(q('call=1&start=nope').start).toBe('address');
    expect(callerOf(null, null)).toEqual({ first: '', last: '', phone: '' });
  });
  it('« Retour » goes back where the booking came from', () => {
    expect(backOf(q('quote=q-1'), 'q-1')).toBe('/quote/q-1');
    expect(backOf(q('customer=c-1'), null)).toBe('/customer/c-1');
    expect(backOf(q('walkin=1'), null)).toBe('/');
    expect(backOf(q('call=1'), null)).toBe('/call');
    expect(backOf(q(''), null)).toBe('/agenda');
  });
});
