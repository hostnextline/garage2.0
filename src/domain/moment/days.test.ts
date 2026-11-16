import { describe, it, expect } from 'vitest';
import { dayChips, defaultBlock, dayCounts, overviewPins, comingJobs, isOpen, type DayRow, type PinJob } from './days';
import type { Moment } from './logic';

const rows: DayRow[] = [
  { day: '2026-11-17', blocks: [{ key: 'am', state: 'started' }, { key: 'pm', state: 'ok' }, { key: 'eve', state: 'tight' }] },
  { day: '2026-11-18', blocks: [{ key: 'am', state: 'ok' }, { key: 'pm', state: 'ok' }, { key: 'eve', state: 'closed' }] },
  { day: '2026-11-19', blocks: [{ key: 'am', state: 'full' }, { key: 'pm', state: 'closed' }, { key: 'eve', state: 'closed' }] },
  { day: '2026-11-20', blocks: [{ key: 'am', state: 'closed' }, { key: 'pm', state: 'closed' }, { key: 'eve', state: 'closed' }] },
  { day: '2026-11-21', blocks: [{ key: 'am', state: 'ok' }, { key: 'pm', state: 'ok' }, { key: 'eve', state: 'ok' }] }
];
// the server's order: the good ones first, then what they add
const list: Moment[] = [
  { day: '2026-11-18', block: 'pm', add_min: 8, far: null },
  { day: '2026-11-18', block: 'am', add_min: 12, far: null },
  { day: '2026-11-19', block: 'am', add_min: 5, far: null },   // full on the phone: not counted
  { day: '2026-11-17', block: 'pm', add_min: 30, far: 'hop' },
  { day: '2026-11-17', block: 'eve', add_min: 44, far: 'day' }
];

describe('« Choisir sur la carte »: the day strip', () => {
  const chips = dayChips(rows, list, { '2026-11-17': 3, '2026-11-18': 1 });
  const of = (day: string) => chips.find((c) => c.day === day)!;
  it('says the appointments already there, and « libre » is zero', () => {
    expect(of('2026-11-17').jobs).toBe(3);
    expect(of('2026-11-21').jobs).toBe(0);
  });
  it('the best moment that is not far gives « +N de route »', () => {
    expect(of('2026-11-18').add).toBe(8);
    expect(of('2026-11-18').far).toBe(false);
  });
  it('a day whose every open moment is far is marked, and offers no « + »', () => {
    expect(of('2026-11-17')).toMatchObject({ open: true, far: true, add: null, best: false });
  });
  it('no open block: the day cannot be chosen (full, else closed)', () => {
    expect(of('2026-11-19')).toMatchObject({ open: false, shut: 'full', far: false, add: null });
    expect(of('2026-11-20')).toMatchObject({ open: false, shut: 'closed' });
    expect(isOpen({ state: 'full' })).toBe(false);
    expect(isOpen({ state: 'tight' })).toBe(true);
  });
  it('only the day of the server’s best moment is « Meilleur choix »', () => {
    expect(chips.filter((c) => c.best).map((c) => c.day)).toEqual(['2026-11-18']);
  });
  it('an older server (no score) and no network: open days, nothing said of the road', () => {
    const old = dayChips(rows, [{ day: '2026-11-21', block: 'am' }, { day: '2026-11-18', block: 'am' }], {});
    expect(old.find((c) => c.day === '2026-11-21')).toMatchObject({ open: true, far: false, add: null, best: true });
    const none = dayChips(rows, [], {});
    expect(none.every((c) => !c.far && c.add == null && !c.best)).toBe(true);
    expect(none.map((c) => c.open)).toEqual([true, true, false, false, true]);
  });
});

describe('the block shown first when a day is chosen', () => {
  it('the best open block by the server’s order', () => {
    expect(defaultBlock(rows[1].blocks, '2026-11-18', list)).toBe('pm');
    expect(defaultBlock(rows[0].blocks, '2026-11-17', list)).toBe('pm');
  });
  it('a moment the server offers in a block that is not open on the phone is skipped', () => {
    expect(defaultBlock(rows[2].blocks, '2026-11-19', list)).toBe(null);
  });
  it('no score: the first open block; none open: null', () => {
    expect(defaultBlock(rows[0].blocks, '2026-11-17', [])).toBe('pm');
    expect(defaultBlock(rows[4].blocks, '2026-11-21', [])).toBe('am');
    expect(defaultBlock(rows[3].blocks, '2026-11-20', [])).toBe(null);
  });
});

describe('the overview: the coming appointments around the new address', () => {
  const days = ['2026-11-17', '2026-11-18', '2026-11-19'];
  const j = (id: string, day: string, block: string, o: Partial<PinJob> = {}): PinJob => ({ id, day, block, status: 'booked', truck_id: 'T1', lat: 45.5, lng: -73.6, ...o });
  const jobs = [
    j('b', '2026-11-18', 'pm'), j('a', '2026-11-18', 'am', { truck_id: null }), j('c', '2026-11-17', 'eve', { status: 'en_route' }),
    j('gone', '2026-11-17', 'am', { status: 'cancelled' }), j('missed', '2026-11-17', 'am', { status: 'no_show' }), j('done', '2026-11-17', 'am', { status: 'done' }),
    j('later', '2026-12-25', 'am'), j('nopos', '2026-11-19', 'am', { lat: null, lng: null }), j('cust', '2026-11-19', 'pm', { lat: null, lng: null })
  ];
  const posOf = (x: PinJob) => (x.id === 'cust' ? { lat: 45.6, lng: -73.7 } : null);
  it('only what is still to come on these days, with a position, by day then block', () => {
    const pins = overviewPins(jobs, days, { posOf });
    expect(pins.map((p) => p.id)).toEqual(['c', 'a', 'b', 'cust']);
    expect(pins.find((p) => p.id === 'cust')).toMatchObject({ lat: 45.6, lng: -73.7, truckId: 'T1' });
    expect(pins.find((p) => p.id === 'a')!.truckId).toBe(null);
  });
  it('the appointment being moved is not drawn at its old place, nor counted', () => {
    expect(overviewPins(jobs, days, { posOf, exclude: 'b' }).map((p) => p.id)).toEqual(['c', 'a', 'cust']);
    expect(dayCounts(jobs, days, 'b')).toEqual({ '2026-11-17': 1, '2026-11-18': 1, '2026-11-19': 2 });
  });
  it('counts the appointments of a day even without a position', () => {
    expect(dayCounts(jobs, days)).toEqual({ '2026-11-17': 1, '2026-11-18': 2, '2026-11-19': 2 });
    expect(comingJobs(jobs, days).some((x) => x.id === 'later')).toBe(false);
  });
});
