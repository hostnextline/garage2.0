/* The time calendar of the booking screen: which units are possible, unit ↔ arrival ↔ window, the days, the cache. */
import { describe, it, expect } from 'vitest';
import { windowFor, type Range } from '../../lib/dates';
import { unitMinutes } from './grid';
import { possibleUnits, rowsByStart, unitOfWindow, unitStates, pageDays, pageOf, lastPage, cacheKey, byHour, moveFocus, type WinRow } from './units';
import { floatPlace } from '../../features/booking/PickGrid';

const DAY: Range = [480, 1200];
const rule = (round: number, span: Range = DAY) => (eta: number): Range => windowFor(eta, { before: 60, after: 180, round, dayStart: span[0], dayEnd: span[1] });
const row = (win_start: number, eta = win_start + 60, truck: string | null = 'T1'): WinRow => ({ win_start, win_end: win_start + 240, eta, truck, drive_min: 10 });

describe('a unit is an arrival time; its window is the garage’s rule', () => {
  it('15 minutes: 14 h 15 → 13 h 15 to 17 h 15, one unit per window in the middle of the day', () => {
    const of = rule(15);
    expect(of(855)).toEqual([795, 1035]);
    const p = possibleUnits(DAY, [row(795)], of);
    expect([...p.keys()]).toEqual([855]);
    expect(p.get(855)?.win_start).toBe(795);
  });
  it('the ends of the day: the first hour shares the first window, the last three hours share the last one', () => {
    const of = rule(15);
    // 8 h to 9 h: all told « 8 h à 12 h »
    expect([...possibleUnits(DAY, [row(480)], of).keys()]).toEqual([480, 495, 510, 525, 540]);
    // 17 h to 19 h 45: all told « 16 h à 20 h » (a window never ends after the day)
    expect([...possibleUnits(DAY, [row(960)], of).keys()]).toEqual(unitMinutes(DAY).filter((m) => m >= 1020));
    expect(of(1185)).toEqual([960, 1200]);
  });
  it('30 and 60 minutes: several units share a window (the rounding), and all are possible when it is listed', () => {
    expect([...possibleUnits(DAY, [row(810)], rule(30)).keys()]).toEqual([855, 870]);          // 14 h 15, 14 h 30 → 13 h 30
    expect([...possibleUnits(DAY, [row(840)], rule(60)).keys()]).toEqual([870, 885, 900, 915]); // 14 h 30 … 15 h 15 → 14 h
    expect(possibleUnits(DAY, [row(840)], rule(60)).get(900)?.win_start).toBe(840);
  });
  it('an empty day lists every window: every unit is possible; a day with none: no unit', () => {
    const of = rule(15);
    const all = Array.from({ length: 33 }, (_, i) => row(480 + i * 15));
    expect(possibleUnits(DAY, all, of).size).toBe(48);
    expect(possibleUnits(DAY, [], of).size).toBe(0);
  });
  it('the rows by window start: the first of a start is kept (the best), a row without a start goes by its arrival', () => {
    const of = rule(15);
    const by = rowsByStart([row(600, 634, 'A'), row(600, 700, 'B'), { eta: 900, truck: 'C', drive_min: 5 }], of);
    expect(by.get(600)?.truck).toBe('A');
    expect(by.get(840)?.truck).toBe('C');
    expect(by.size).toBe(2);
  });
  it('a shorter day: the windows are clamped to it', () => {
    const span: Range = [540, 1020];
    const of = rule(15, span);
    expect(of(540)).toEqual([540, 780]);
    expect(of(1000)).toEqual([780, 1020]);
    expect([...possibleUnits(span, [row(780)], of).keys()]).toEqual(unitMinutes(span).filter((m) => m >= 840));
  });
});

describe('the unit that shows a window chosen', () => {
  it('with the arrival: the unit of that window nearest to it', () => {
    expect(unitOfWindow(DAY, 795, 855, rule(15))).toBe(855);
    expect(unitOfWindow(DAY, 480, 492, rule(15))).toBe(495);   // 8 h 12 → the unit 8 h 15 (the window is 8 h–12 h)
    expect(unitOfWindow(DAY, 480, 563, rule(15))).toBe(540);   // the planner arrives at 9 h 23: the last unit of that window
    expect(unitOfWindow(DAY, 840, 907, rule(60))).toBe(900);
  });
  it('without it (the address bar, a paste): an hour into the window', () => {
    expect(unitOfWindow(DAY, 795, null, rule(15))).toBe(855);
    expect(unitOfWindow(DAY, 480, null, rule(15))).toBe(540);
    expect(unitOfWindow(DAY, 960, null, rule(15))).toBe(1020);
    expect(unitOfWindow(DAY, 840, null, rule(60))).toBe(900);
    expect(unitOfWindow(DAY, 810, null, rule(30))).toBe(870);
  });
  it('a window no unit gives (off the rounding, outside the day): none', () => {
    expect(unitOfWindow(DAY, 850, null, rule(60))).toBeNull();
    expect(unitOfWindow(DAY, 1000, 1060, rule(15))).toBeNull();
  });
});

describe('how the units of a day look', () => {
  const worked = unitMinutes(DAY).map((m) => m >= 540 && m < 1020);   // somebody works 9 h to 17 h
  const possible = new Set([600, 615]);
  it('past, closed, open, refused, not known yet', () => {
    const s = unitStates(DAY, { day: '2026-11-17', today: '2026-11-16', now: 700, worked, possible });
    expect(s[0]).toBe('off');                    // 8 h: nobody works
    expect(s[8]).toBe('open');                   // 10 h
    expect(s[9]).toBe('open');
    expect(s[10]).toBe('no');                    // 10 h 30: the server does not list it
    expect(s[47]).toBe('off');
    expect(unitStates(DAY, { day: '2026-11-17', today: '2026-11-16', now: 700, worked, possible: null })[8]).toBe('wait');
  });
  it('today: the units behind us are past (a unit under way is past once it ends)', () => {
    const s = unitStates(DAY, { day: '2026-11-16', today: '2026-11-16', now: 610, worked: null, possible });
    expect(s[7]).toBe('past');                   // 9 h 45 ended at 10 h
    expect(s[8]).toBe('open');                   // 10 h is under way until 10 h 15
    expect(unitStates(DAY, { day: '2026-11-16', today: '2026-11-16', now: 615, worked: null, possible })[8]).toBe('past');
    expect(unitStates(DAY, { day: '2026-11-15', today: '2026-11-16', now: 0, worked: null, possible }).every((x) => x === 'past')).toBe(true);
  });
});

describe('the days shown', () => {
  it('a page is 7 days from today, never after the last day that can be booked', () => {
    expect(pageDays('2026-11-15', '2027-03-15', 0)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(pageDays('2026-11-15', '2027-03-15', 1)[0]).toBe('2026-11-22');
    expect(pageDays('2026-11-15', '2026-11-24', 1)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24']);
    expect(pageDays('2026-11-15', '2026-11-24', -3)[0]).toBe('2026-11-15');
    expect(pageDays('2026-11-15', '2027-03-15', 1, 5)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']);
  });
  it('the page of a day; no page before today; the last page', () => {
    expect(pageOf('2026-11-15', '2026-11-21')).toBe(0);
    expect(pageOf('2026-11-15', '2026-11-22')).toBe(1);
    expect(pageOf('2026-11-15', '2026-11-10')).toBe(0);
    expect(pageOf('2026-11-15', '2026-11-22', 5)).toBe(1);
    expect(lastPage('2026-11-15', '2026-11-24')).toBe(1);
    expect(lastPage('2026-11-15', '2026-11-21')).toBe(0);
  });
});

describe('the answers kept', () => {
  const q = { day: '2026-11-17', lat: 45.5312898, lng: -73.6544639, duration: 60, kind: null, need: false, exclude: null };
  it('one key per day, place, work, kind of vehicle and job left out', () => {
    const k = cacheKey(q);
    expect(cacheKey({ ...q })).toBe(k);
    expect(cacheKey({ ...q, lat: 45.53129001 })).toBe(k);                 // the same place to a metre
    for (const other of [{ day: '2026-11-18' }, { lat: 45.6 }, { duration: 75 }, { kind: 'car' }, { need: true }, { exclude: 'J1' }, { lat: null, lng: null }]) {
      expect(cacheKey({ ...q, ...other })).not.toBe(k);
    }
    // work for the tire machine: the kind asked no longer counts
    expect(cacheKey({ ...q, need: true, kind: 'car' })).toBe(cacheKey({ ...q, need: true, kind: null }));
  });
});

describe('the phone’s list and the keyboard', () => {
  it('the arrival times by hour', () => {
    expect(byHour([855, 840, 900, 945])).toEqual([{ hour: 840, times: [840, 855] }, { hour: 900, times: [900, 945] }]);
    expect(byHour([])).toEqual([]);
  });
  it('the arrows: a unit up or down, a day left or right, kept inside the calendar', () => {
    expect(moveFocus(DAY, 7, { col: 2, m: 600 }, 'ArrowDown')).toEqual({ col: 2, m: 615 });
    expect(moveFocus(DAY, 7, { col: 2, m: 480 }, 'ArrowUp')).toEqual({ col: 2, m: 480 });
    expect(moveFocus(DAY, 7, { col: 2, m: 1185 }, 'ArrowDown')).toEqual({ col: 2, m: 1185 });
    expect(moveFocus(DAY, 7, { col: 6, m: 600 }, 'ArrowRight')).toEqual({ col: 6, m: 600 });
    expect(moveFocus(DAY, 7, { col: 1, m: 600 }, 'ArrowLeft')).toEqual({ col: 0, m: 600 });
    expect(moveFocus(DAY, 7, { col: 1, m: 600 }, 'PageDown')).toEqual({ col: 1, m: 660 });
    expect(moveFocus(DAY, 7, { col: 1, m: 600 }, 'End')).toEqual({ col: 1, m: 1185 });
    expect(moveFocus(DAY, 7, { col: 1, m: 600 }, 'a')).toBeNull();
  });
});

describe('the small map beside the unit pointed at', () => {
  const unit = { top: 300, bottom: 318 };
  it('on the left of the column when there is room, else on its right: never over the column', () => {
    expect(floatPlace(unit, { left: 900, right: 990 }, 1366, 800)).toEqual({ right: 1366 - 900 + 12, top: 290 });
    expect(floatPlace(unit, { left: 200, right: 290 }, 1366, 800)).toEqual({ left: 302, top: 290 });
  });
  it('kept inside the window; no room beside: under the unit', () => {
    expect(floatPlace({ top: 700, bottom: 718 }, { left: 900, right: 990 }, 1366, 800).top).toBe(800 - 420 - 8);
    const narrow = floatPlace({ top: 100, bottom: 118 }, { left: 150, right: 240 }, 420, 900);
    expect(narrow.top).toBe(130);
    expect(narrow.left).toBe(52);
  });
});
