import { describe, it, expect } from 'vitest';
import { windowFor, type Range } from '../../lib/dates';
import type { Suggestion } from '../../data/api';
import type { JobStatus } from '../../data/types';
import { gridJobs, listDay, openingMinute, pageSettled, windowDay, windowGone, workedOf, ofTruck, type DayWins, type GridDay } from './windowDays';

const span: Range = [480, 1200];
const windowOf = (eta: number) => windowFor(eta, { before: 60, after: 180, round: 60, dayStart: 480, dayEnd: 1200 });
const row = (win_start: number, truck: string | null = 'T1', eta = win_start + 60): Suggestion =>
  ({ day: '2026-11-20', block: 'day', drive_min: 10, near: 1, truck, left: 300, eta, win_start, win_end: win_start + 240 });
const allDay = Array(48).fill(true);
const day = (wins: DayWins, o: Partial<Parameters<typeof windowDay>[0]> = {}) => windowDay({
  day: '2026-11-20', today: '2026-11-16', now: 600, span, len: 240, windowOf, wins, worked: allDay, picked: null, moving: null, jobs: [], ...o
});

describe('a day of the time calendar', () => {
  it('the units whose window the server lists are open, the others refused', () => {
    const d = day({ status: 'ok', rows: [row(840), row(540)] });
    expect(d.open).toEqual([570, 585, 600, 615, 870, 885, 900, 915]);
    expect(d.kind).toBe('open');
    expect(d.windows).toBe(2);
    expect(d.states[unit(660)]).toBe('no');
  });
  it('no answer yet: waiting; an answer being replaced still shows, dimmed', () => {
    expect(day({ status: 'loading', rows: [] }).kind).toBe('loading');
    const stale = day({ status: 'loading', rows: [row(840)] });
    expect(stale.stale).toBe(true);
    expect(stale.open).toEqual([870, 885, 900, 915]);
  });
  it('failed, full, closed, past', () => {
    expect(day({ status: 'error', rows: [] }).kind).toBe('failed');
    expect(day({ status: 'ok', rows: [] }).kind).toBe('full');
    expect(day({ status: 'ok', rows: [row(840)] }, { worked: Array(48).fill(false) }).kind).toBe('closed');
    expect(day({ status: 'ok', rows: [row(840)] }, { day: '2026-11-15' }).kind).toBe('past');
  });
  it('a vehicle chosen by hand: the rows of another vehicle say nothing of it', () => {
    expect(day({ status: 'ok', rows: [row(840, 'T2'), row(540, null)] }, { truckId: 'T1' }).open).toEqual([570, 585, 600, 615]);
    expect(ofTruck([row(840, 'T2'), row(540, 'T1')], null)).toHaveLength(2);
  });
  it('the window chosen, its band, the best moment, the far mark', () => {
    const d = day({ status: 'ok', rows: [row(840)] }, { picked: { day: '2026-11-20', block: 'day', win_start: 840, win_end: 1080, eta: 885 }, best: { win: [840, 1080], eta: 900 }, far: true });
    expect(d.chosen).toBe(885);
    expect(d.band).toEqual([840, 1080]);
    expect(d.best).toBe(900);
    expect(d.far).toBe(true);
    // chosen on another day: nothing here
    expect(day({ status: 'ok', rows: [row(840)] }, { picked: { day: '2026-11-21', block: 'day', win_start: 840 } }).chosen).toBeNull();
  });
  it('moving an appointment: where it is now', () => {
    const d = day({ status: 'ok', rows: [] }, { moving: { day: '2026-11-20', block: 'day', eta_min: 610, win_start: 540, duration_min: 60 } });
    expect(d.currentM).toBe(600);
    expect(d.current).toEqual({ top: 130 / 15, height: 4 });
  });
  it('the hours worked by any vehicle that can take the job', () => {
    const w = workedOf([[[480, 600]], [[1080, 1200]]], span);
    expect(w.filter(Boolean)).toHaveLength(16);
    expect(w[0] && w[7] && !w[8] && w[40] && w[47]).toBe(true);
  });
  it('the appointments already booked, side by side where they share time; cancelled and the one moved left out', () => {
    const j = (id: string, eta: number, status: JobStatus = 'booked') => ({ id, status, number: 1, block: 'day' as const, eta_min: eta, win_start: null, duration_min: 60, truck_id: 'T1' });
    const out = gridJobs([j('a', 600), j('b', 630), j('c', 900, 'cancelled'), j('d', 960)], span, { exclude: 'd', blocks: [], nameOf: (x) => x.id, colorOf: () => '#000', labelOf: (n, at) => `${n}@${at}` });
    expect(out.map((x) => [x.id, x.col, x.cols, x.label])).toEqual([['a', 0, 2, 'a@600'], ['b', 1, 2, 'b@630']]);
  });
});

describe('a window chosen elsewhere that the server no longer lists', () => {
  const picked = { day: '2026-11-20', block: 'day' as const, win_start: 660, win_end: 900 };
  it('is gone once the day answered, not before', () => {
    expect(windowGone(picked, { status: 'ok' }, [row(840)], null, windowOf)).toBe(true);
    expect(windowGone(picked, { status: 'loading' }, [], null, windowOf)).toBe(false);
    expect(windowGone({ ...picked, win_start: 840 }, { status: 'ok' }, [row(840)], null, windowOf)).toBe(false);
    expect(windowGone(null, { status: 'ok' }, [], null, windowOf)).toBe(false);
  });
});

const g = (dayStr: string, kind: GridDay['kind'], open: number[] = [], status: GridDay['status'] = kind === 'loading' ? 'loading' : 'ok', stale = false) =>
  ({ day: dayStr, kind, open, status, stale, chosen: null as number | null });

describe('the phone’s list of times', () => {
  // booking-b-04: the 7 days are asked at once and answer in any order. Before, the first day with times was listed as
  // soon as it answered, then replaced by an earlier day answering later, under the person's thumb.
  it('a day still waiting before the first day with times is shown first (its skeleton), never a later day’s times', () => {
    expect(listDay([g('d1', 'past'), g('d2', 'loading'), g('d3', 'open', [600])], null)).toBe('d2');
    expect(listDay([g('d1', 'past'), g('d2', 'full'), g('d3', 'open', [600])], null)).toBe('d3');
  });
  it('the day chosen stays; nothing at all: the first day', () => {
    expect(listDay([g('d1', 'loading'), g('d3', 'open', [600])], 'd3')).toBe('d3');
    expect(listDay([g('d1', 'full'), g('d2', 'closed')], null)).toBe('d1');
    expect(listDay([g('d1', 'open', [600])], 'gone')).toBe('d1');
  });
});

describe('the hours brought into view when a page opens', () => {
  const o = { today: 'd1', now: 600, span };
  // booking-b-21: before, the first answer of any day decided (the grid opened at hours that changed with the order in
  // which the days answered)
  it('another page: waits until every day has answered, then the first possible time of the page', () => {
    const page = [g('d2', 'open', [870]), g('d3', 'loading'), g('d4', 'open', [570])];
    expect(pageSettled(page)).toBe(false);
    expect(openingMinute(page, o)).toBeNull();
    expect(openingMinute([g('d2', 'open', [870]), g('d3', 'full'), g('d4', 'open', [570])], o)).toBe(570);
  });
  it('the page of today: today’s first possible time as soon as today answered, whatever the others', () => {
    expect(openingMinute([g('d1', 'loading'), g('d2', 'open', [495])], o)).toBeNull();
    expect(openingMinute([g('d1', 'open', [645]), g('d2', 'loading')], o)).toBe(645);
    expect(openingMinute([g('d1', 'open', [645]), g('d2', 'open', [495])], o)).toBe(645);
    // nothing left today: the page decides once it is all in
    expect(openingMinute([g('d1', 'full'), g('d2', 'loading')], o)).toBeNull();
    expect(openingMinute([g('d1', 'full'), g('d2', 'open', [495])], o)).toBe(495);
  });
  it('the time chosen first; nothing possible: half an hour before now today, else the top of the day', () => {
    expect(openingMinute([{ ...g('d1', 'loading'), chosen: 885 }], o)).toBe(885);
    expect(openingMinute([g('d1', 'full')], o)).toBe(570);
    expect(openingMinute([g('d2', 'full')], o)).toBe(480);
    expect(pageSettled([g('d1', 'open', [600], 'loading', true)])).toBe(true);
  });
});

function unit(m: number) { return (m - 480) / 15; }
