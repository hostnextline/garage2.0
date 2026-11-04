import { describe, it, expect } from 'vitest';
import { addDays, weekStart, weekDays, dow, clock, clockRange, duration, parseHm, hm, isValidDay, mergeRanges, overlapMinutes,
  firstMinuteIn, cellsToRanges, rangesToCells, blockOf, daysBetween, longDay } from './dates';

describe('days', () => {
  it('adds days across months and the DST change (Nov 1 2026)', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('the week starts on Sunday', () => {
    expect(dow('2026-11-04')).toBe(3);
    expect(weekStart('2026-11-04')).toBe('2026-11-01');
    expect(weekDays('2026-11-04')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(weekStart('2026-11-01')).toBe('2026-11-01');
  });
  it('validates days', () => {
    expect(isValidDay('2026-02-29')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7);
  });
  it('writes days in French and English', () => {
    const now = new Date(2026, 10, 4);
    expect(longDay('2026-11-04', 'fr', now)).toBe('mercredi 4 novembre');
    expect(longDay('2026-11-04', 'en', now)).toBe('Wednesday, November 4');
    expect(longDay('2027-01-04', 'fr', now)).toContain('2027');
  });
});

describe('clock', () => {
  it('Québec French', () => {
    expect(clock(8 * 60)).toBe('8 h');
    expect(clock(13 * 60 + 30)).toBe('13 h 30');
    expect(clockRange(480, 720)).toBe('8 h à 12 h');
  });
  it('English', () => {
    expect(clock(8 * 60, 'en')).toBe('8 a.m.');
    expect(clock(12 * 60, 'en')).toBe('12 p.m.');
    expect(clock(13 * 60 + 5, 'en')).toBe('1:05 p.m.');
  });
  it('durations', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(90)).toBe('1 h 30');
    expect(duration(120)).toBe('2 h');
    expect(duration(90, 'en')).toBe('1 h 30 min');
  });
  it('reads times', () => {
    expect(parseHm('8')).toBe(480);
    expect(parseHm('8:30')).toBe(510);
    expect(parseHm('8h30')).toBe(510);
    expect(parseHm('13 h 30')).toBe(810);
    expect(parseHm('25')).toBeNull();
    expect(hm(510)).toBe('08:30');
  });
});

describe('blocks and ranges', () => {
  it('finds the block of a minute', () => {
    expect(blockOf(9 * 60)?.key).toBe('am');
    expect(blockOf(12 * 60)?.key).toBe('pm');
    expect(blockOf(19 * 60 + 59)?.key).toBe('eve');
    expect(blockOf(20 * 60)).toBeUndefined();
  });
  it('merges and measures ranges', () => {
    expect(mergeRanges([[600, 720], [480, 600], [800, 900]])).toEqual([[480, 720], [800, 900]]);
    expect(overlapMinutes([[480, 960]], 480, 720)).toBe(240);
    expect(overlapMinutes([[540, 660]], 480, 720)).toBe(120);
    expect(overlapMinutes([[700, 800]], 480, 720)).toBe(20);
    expect(firstMinuteIn([[540, 660]], 480, 720)).toBe(540);
    expect(firstMinuteIn([[730, 800]], 480, 720)).toBeNull();
  });
  it('turns selected cells into hours and back', () => {
    const r = cellsToRanges([480, 510, 540, 600], 30);
    expect(r).toEqual([[480, 570], [600, 630]]);
    expect(rangesToCells(r, 30, 420, 720)).toEqual([480, 510, 540, 600]);
  });
});
