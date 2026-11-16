import { describe, it, expect, beforeEach } from 'vitest';
import { windowFor } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import type { Suggestion } from '../../data/api';
import { farLimits } from '../../domain/moment/logic';
import { betterThan, betterWindowText, bestWindows, dayRows, dayScores, keptRows, lowerFirst, rowChoice, windowFar, anyFar } from './moments';

const windowOf = (eta: number) => windowFor(eta, { before: 60, after: 180, round: 60, dayStart: 480, dayEnd: 1200 });
const s = (day: string, o: Partial<Suggestion> = {}): Suggestion => ({ day, block: 'day', drive_min: 10, near: 1, truck: null, left: 300, eta: 900, win_start: 840, win_end: 1080, ...o });
const lim = farLimits({ max_hop_min: 35, max_day_drive_min: 105 });
beforeEach(() => { lang.value = 'fr'; });

describe('the rows a picker keeps', () => {
  it('a real day; with a vehicle chosen by hand, its rows and rows without a vehicle', () => {
    const list = [s('2026-11-20', { truck: 'A' }), s('2026-11-21', { truck: 'B' }), s('2026-11-22'), s('nope')];
    expect(keptRows(list, null).map((x) => x.day)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(keptRows(list, 'A').map((x) => x.day)).toEqual(['2026-11-20', '2026-11-22']);
  });
});

describe('« Plages d’arrivée »: the best moments', () => {
  it('a row has the server’s window, else the one of its estimated arrival; none: not offered', () => {
    const rows = dayRows([s('2026-11-20'), s('2026-11-21', { win_start: null, win_end: null, eta: 560 }), s('2026-11-22', { win_start: null, win_end: null, eta: null })], windowOf, 240);
    expect(rows.map((r) => r.win)).toEqual([[840, 1080], [480, 720]]);
    expect(rowChoice(rows[0])).toEqual({ day: '2026-11-20', block: 'day', win_start: 840, win_end: 1080, eta: 900, truck: null });
  });
  // booking-b-01 / x-dualmode-01: before, the first three rows were offered whatever their score; a far day got the ★
  // when fewer than three days were not far
  it('never a far day, the first three of the others', () => {
    const rows = dayRows([s('d1', { far: 'hop' }), s('d2'), s('d3', { far: 'day' }), s('d4'), s('d5'), s('d6')], windowOf, 240);
    expect(bestWindows(rows).map((r) => r.day)).toEqual(['d2', 'd4', 'd5']);
    expect(bestWindows(dayRows([s('d1', { far: 'hop' })], windowOf, 240))).toEqual([]);
  });
});

describe('« Plages d’arrivée »: garde-route of the moment chosen', () => {
  const dayScore = { ...s('2026-11-20', { far: 'hop', hop_min: 52, add_min: 40 }) };
  it('a window, « Flexible » or the day alone on a far day: warned, for the day (block « day »)', () => {
    const w = windowFar({ day: '2026-11-20', block: 'day', win_start: 840, win_end: 1080 }, dayScore, undefined, lim, 'fr');
    expect(w).toMatchObject({ day: '2026-11-20', block: 'day', kind: 'hop' });
    expect(w?.text).toContain('52 min');
    expect(windowFar({ day: '2026-11-20', block: 'day', win_flex: true }, dayScore, undefined, lim, 'fr')?.kind).toBe('hop');
    expect(windowFar({ day: '2026-11-20', block: 'day' }, dayScore, undefined, lim, 'fr')?.kind).toBe('hop');
  });
  it('a day not far, no score, a block: nothing', () => {
    expect(windowFar({ day: '2026-11-20', block: 'day', win_start: 840 }, s('2026-11-20'), undefined, lim, 'fr')).toBeNull();
    expect(windowFar({ day: '2026-11-20', block: 'day', win_start: 840 }, undefined, undefined, lim, 'fr')).toBeNull();
    expect(windowFar({ day: '2026-11-20', block: 'am' }, dayScore, undefined, lim, 'fr')).toBeNull();
    expect(windowFar(null, dayScore, undefined, lim, 'fr')).toBeNull();
  });
  it('the window’s own score wins when the server gives one', () => {
    const c = { day: '2026-11-20', block: 'day' as const, win_start: 540 };
    expect(windowFar(c, dayScore, s('2026-11-20', { far: null }), lim, 'fr')).toBeNull();
    expect(windowFar(c, s('2026-11-20'), s('2026-11-20', { far: 'day', day_min: 130 }), lim, 'fr')?.kind).toBe('day');
  });
  it('« Plutôt … »: other days that are not far, with the road saved, in words', () => {
    const rows = dayRows([s('2026-11-20', { far: 'hop', add_min: 40 }), s('2026-11-21', { add_min: 12 }), s('2026-11-23', { add_min: 50, win_start: 540, win_end: 780 })], windowOf, 240);
    const b = betterThan(rows[0], rows, null, rowChoice);
    expect(b.map((x) => [x.moment.day, x.saved])).toEqual([['2026-11-21', 28], ['2026-11-23', null]]);
    expect(betterWindowText(b[0], '2026-11-20', 'fr')).toBe('Plutôt demain, entre 14 h et 18 h : 28 min de route en moins');
    expect(betterWindowText(b[1], '2026-11-20', 'fr')).toBe('Plutôt lundi, entre 9 h et 13 h');
  });
  // booking-b-27: moving an appointment, the server lists the moment it is in now (often first); proposing it changed nothing
  it('never the moment the appointment being moved is in now', () => {
    const rows = dayRows([s('2026-11-21'), s('2026-11-22')], windowOf, 240);
    const far = { ...s('2026-11-25', { far: 'day' }) };
    const current = { day: '2026-11-21', block: 'day' as const, win_start: 840, win_flex: false };
    expect(betterThan(far, rows, current, rowChoice).map((x) => x.moment.day)).toEqual(['2026-11-22']);
    // blocks: the same rule
    const blocks = [{ day: '2026-11-21', block: 'am' as const }, { day: '2026-11-21', block: 'pm' as const }];
    expect(betterThan({ day: '2026-11-25', block: 'eve', far: 'hop' }, blocks, { day: '2026-11-21', block: 'am', win_start: null, win_flex: false }, (m) => m).map((x) => x.moment.block)).toEqual(['pm']);
  });
  it('the scores as whole-day moments; the legend when one is far', () => {
    expect(dayScores([s('d1', { block: 'am' })])[0].block).toBe('day');
    expect(anyFar([s('d1'), s('d2', { far: 'day' })])).toBe(true);
    expect(anyFar([s('d1')])).toBe(false);
  });
  it('inside a sentence: lower case, English weekdays keep their capital', () => {
    expect(lowerFirst('Demain, entre 9 h et 13 h', 'fr')).toBe('demain, entre 9 h et 13 h');
    expect(lowerFirst('Tomorrow, between 9 a.m. and 1 p.m.', 'en')).toBe('tomorrow, between 9 a.m. and 1 p.m.');
    expect(lowerFirst('Monday, between', 'en')).toBe('Monday, between');
  });
});
