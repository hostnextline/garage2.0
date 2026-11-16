import { describe, it, expect } from 'vitest';
import { UNIT, unitCount, unitMinute, unitIndex, unitMinutes, minuteAt, unitsAt, jobBox, jobMinute, overlapColumns, workedUnits, dropWindowStart, openingUnit } from './grid';
import { windowFor, type Range } from '../../lib/dates';
import { sameWindowPlace, refusalCode, FULL_CODES } from '../../features/agenda/move';
import { pasteHref, bookHref } from '../../features/agenda/copy';

const DAY: Range = [480, 1200];   // 8 h → 20 h

describe('units of 15 minutes', () => {
  it('cuts 8 h → 20 h in 48 units', () => {
    expect(UNIT).toBe(15);
    expect(unitCount(DAY)).toBe(48);
    expect(unitCount([480, 1190])).toBe(48);   // a day that ends at 19 h 50 keeps its last piece
    expect(unitMinutes(DAY)[0]).toBe(480);
    expect(unitMinutes(DAY)[47]).toBe(1185);
  });
  it('goes from a unit to its minute and back', () => {
    expect(unitMinute(DAY, 0)).toBe(480);
    expect(unitMinute(DAY, 25)).toBe(855);     // 14 h 15
    expect(unitIndex(DAY, 855)).toBe(25);
    expect(unitIndex(DAY, 869)).toBe(25);      // 14 h 29 is still the unit of 14 h 15
    expect(unitIndex(DAY, 870)).toBe(26);
    for (let i = 0; i < 48; i++) expect(unitIndex(DAY, unitMinute(DAY, i))).toBe(i);
  });
  it('keeps a minute outside the day on the first or the last unit', () => {
    expect(unitIndex(DAY, 300)).toBe(0);
    expect(unitIndex(DAY, 1200)).toBe(47);
    expect(unitIndex(DAY, 1400)).toBe(47);
  });
  it('finds the unit under the mouse', () => {
    expect(minuteAt(DAY, 0, 15)).toBe(480);
    expect(minuteAt(DAY, 14.9, 15)).toBe(480);
    expect(minuteAt(DAY, 15, 15)).toBe(495);
    expect(minuteAt(DAY, 25 * 16 + 3, 16)).toBe(855);
    expect(minuteAt(DAY, -40, 15)).toBe(480);
    expect(minuteAt(DAY, 9999, 15)).toBe(1185);
  });
  it('says where « now » is, or nothing outside the day', () => {
    expect(unitsAt(DAY, 480)).toBe(0);
    expect(unitsAt(DAY, 860)).toBeCloseTo(25.333, 2);
    expect(unitsAt(DAY, 1200)).toBe(48);
    expect(unitsAt(DAY, 479)).toBeNull();
    expect(unitsAt(DAY, 1201)).toBeNull();
  });
});

describe('a job as a block', () => {
  it('sits at its arrival and is as tall as its work', () => {
    expect(jobBox(DAY, 855, 60)).toEqual({ top: 25, height: 4 });
    const b = jobBox(DAY, 860, 90);
    expect(b.top).toBeCloseTo(25.333, 2);
    expect(b.height).toBe(6);
  });
  it('is never shorter than two units', () => {
    expect(jobBox(DAY, 600, 15)).toEqual({ top: 8, height: 2 });
    expect(jobBox(DAY, 600, 0)).toEqual({ top: 8, height: 2 });
  });
  it('stays inside the day', () => {
    expect(jobBox(DAY, 420, 60)).toEqual({ top: 0, height: 4 });           // planned before the first hour
    expect(jobBox(DAY, 1185, 60)).toEqual({ top: 44, height: 4 });         // would run past 20 h: pulled up
    expect(jobBox(DAY, 480, 2000)).toEqual({ top: 0, height: 48 });
  });
  it('is drawn at its arrival, else at its block or its window', () => {
    const blocks = [{ key: 'am' as const, start: 480 }, { key: 'pm' as const, start: 720 }, { key: 'eve' as const, start: 960 }];
    expect(jobMinute({ block: 'day', eta_min: 860, win_start: 780 }, blocks)).toBe(860);
    expect(jobMinute({ block: 'pm', eta_min: 800 }, blocks)).toBe(800);
    expect(jobMinute({ block: 'pm', eta_min: null }, blocks)).toBe(720);
    expect(jobMinute({ block: 'eve', eta_min: null }, blocks)).toBe(960);
    expect(jobMinute({ block: 'day', eta_min: null, win_start: 780 }, blocks)).toBe(780);
    expect(jobMinute({ block: 'day', eta_min: null, win_start: null }, blocks)).toBeNull();   // flexible, not planned
  });
});

describe('blocks side by side', () => {
  const slot = (m: Map<string, { col: number; cols: number }>, id: string) => m.get(id);
  it('leaves a block alone its whole width', () => {
    const m = overlapColumns([{ id: 'a', start: 540, end: 600 }, { id: 'b', start: 600, end: 660 }]);
    expect(slot(m, 'a')).toEqual({ col: 0, cols: 1 });
    expect(slot(m, 'b')).toEqual({ col: 0, cols: 1 });   // 10 h after 9 h–10 h: they do not touch
  });
  it('puts two trucks at the same hour side by side', () => {
    const m = overlapColumns([{ id: 'a', start: 540, end: 630 }, { id: 'b', start: 570, end: 660 }]);
    expect(slot(m, 'a')).toEqual({ col: 0, cols: 2 });
    expect(slot(m, 'b')).toEqual({ col: 1, cols: 2 });
  });
  it('uses a freed column again and cuts the whole group alike', () => {
    const m = overlapColumns([
      { id: 'a', start: 540, end: 660 }, { id: 'b', start: 550, end: 600 }, { id: 'c', start: 600, end: 650 },
      { id: 'd', start: 700, end: 760 }
    ]);
    expect(slot(m, 'a')).toEqual({ col: 0, cols: 2 });
    expect(slot(m, 'b')).toEqual({ col: 1, cols: 2 });
    expect(slot(m, 'c')).toEqual({ col: 1, cols: 2 });   // after b, beside a
    expect(slot(m, 'd')).toEqual({ col: 0, cols: 1 });   // later, alone
  });
  it('takes three at once, whatever the order given', () => {
    const m = overlapColumns([{ id: 'c', start: 560, end: 700 }, { id: 'a', start: 540, end: 700 }, { id: 'b', start: 550, end: 700 }]);
    expect([slot(m, 'a')?.col, slot(m, 'b')?.col, slot(m, 'c')?.col]).toEqual([0, 1, 2]);
    expect(slot(m, 'b')?.cols).toBe(3);
    expect(overlapColumns([]).size).toBe(0);
  });
});

describe('the hours a truck works', () => {
  it('marks the units inside its hours', () => {
    const on = workedUnits([[540, 720], [780, 1020]], DAY);
    expect(on.length).toBe(48);
    expect(on[3]).toBe(false);    // 8 h 45
    expect(on[4]).toBe(true);     // 9 h
    expect(on[15]).toBe(true);    // 11 h 45
    expect(on[16]).toBe(false);   // 12 h (lunch)
    expect(on[20]).toBe(true);    // 13 h
    expect(on[36]).toBe(false);   // 17 h
    expect(workedUnits([], DAY).some(Boolean)).toBe(false);
    expect(workedUnits([[490, 500]], DAY)[0]).toBe(true);   // a piece of a unit counts
  });
});

describe('a time let go on the grid', () => {
  const windowOf = (eta: number) => windowFor(eta, { dayStart: 480, dayEnd: 1200 });
  it('gives the window that goes with that arrival', () => {
    expect(dropWindowStart(900, windowOf)).toBe(840);    // 15 h → 14 h – 18 h
    expect(dropWindowStart(855, windowOf)).toBe(780);    // 14 h 15 → 13 h – 17 h
    expect(dropWindowStart(870, windowOf)).toBe(840);    // 14 h 30 rounds up → 14 h – 18 h
  });
  it('stays inside the day', () => {
    expect(dropWindowStart(480, windowOf)).toBe(480);    // 8 h → 8 h – 12 h
    expect(dropWindowStart(1185, windowOf)).toBe(960);   // 19 h 45 → 16 h – 20 h
  });
});

describe('where the grid opens', () => {
  it('an hour before now on today, else before the first job, else at the top', () => {
    expect(openingUnit(DAY, 860, 540)).toBe(21);    // now 14 h 20 → 13 h 15
    expect(openingUnit(DAY, null, 600)).toBe(4);    // first job 10 h → 9 h
    expect(openingUnit(DAY, null, 490)).toBe(0);
    expect(openingUnit(DAY, 300, 600)).toBe(4);     // before opening: the first job
    expect(openingUnit(DAY, null, null)).toBe(0);
  });
});

describe('a job let go on a unit', () => {
  const job = { day: '2026-11-16', block: 'day' as const, win_start: 840, truck_id: 't1' };
  it('has nothing to move when it is the same day, window and truck', () => {
    expect(sameWindowPlace(job, { day: '2026-11-16', truck: null, start: 840 })).toBe(true);    // the week: the app chooses
    expect(sameWindowPlace(job, { day: '2026-11-16', truck: 't1', start: 840 })).toBe(true);
    expect(sameWindowPlace(job, { day: '2026-11-16', truck: 't2', start: 840 })).toBe(false);   // another truck
    expect(sameWindowPlace(job, { day: '2026-11-16', truck: 't1', start: 780 })).toBe(false);   // another window
    expect(sameWindowPlace(job, { day: '2026-11-17', truck: null, start: 840 })).toBe(false);   // another day
    expect(sameWindowPlace({ ...job, block: 'pm', win_start: null }, { day: '2026-11-16', truck: null, start: 840 })).toBe(false);
  });
  it('reads the code of a refusal, and knows the ones that open the windows still possible', () => {
    expect(refusalCode({ hint: 'window_full', code: 'P0001', message: '…' })).toBe('window_full');
    expect(refusalCode({ code: 'truck_full' })).toBe('truck_full');
    expect(refusalCode(new Error('x'))).toBe('');
    expect(refusalCode(null)).toBe('');
    expect(FULL_CODES).toEqual(['window_full', 'block_full', 'truck_full']);
  });
  it('books and pastes with the window of the unit', () => {
    expect(bookHref('2026-11-16', 'day', 780)).toBe('#/book?day=2026-11-16&block=day&win=780');
    expect(bookHref('2026-11-16', 'day')).toBe('#/book?day=2026-11-16&block=day');
    expect(pasteHref('2026-11-16', 'day', '11111111-1111-4111-8111-111111111111', 840)).toBe('#/book?copy=11111111-1111-4111-8111-111111111111&day=2026-11-16&block=day&win=840');
    expect(pasteHref('2026-11-16', 'pm', '11111111-1111-4111-8111-111111111111')).toBe('#/book?copy=11111111-1111-4111-8111-111111111111&day=2026-11-16&block=pm');
  });
});
