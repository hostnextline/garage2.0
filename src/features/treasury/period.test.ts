import { describe, it, expect } from 'vitest';
import { periodRange, addMonths, monthEnd, monthStart, daysInMonth, monthKey, inRange, rangeLabel } from './period';

describe('periods of the treasury report', () => {
  const ref = '2026-11-04';
  it('this month, last month, this quarter, this year', () => {
    expect(periodRange('month', ref)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('last_month', ref)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('quarter', ref)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('year', ref)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('across the new year and in a leap year', () => {
    expect(periodRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('quarter', '2026-01-15')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRange('last_month', '2024-03-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodRange('quarter', '2026-06-30')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodRange('quarter', '2026-07-01')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });
  it('chosen dates: put in order, completed when one is missing, refused when invalid', () => {
    expect(periodRange('custom', ref, { from: '2026-10-05', to: '2026-10-20' })).toEqual({ from: '2026-10-05', to: '2026-10-20' });
    expect(periodRange('custom', ref, { from: '2026-10-20', to: '2026-10-05' })).toEqual({ from: '2026-10-05', to: '2026-10-20' });
    expect(periodRange('custom', ref, { from: '2026-10-05' })).toEqual({ from: '2026-10-05', to: ref });
    expect(periodRange('custom', ref, { to: '2026-10-20' })).toEqual({ from: '2026-10-01', to: '2026-10-20' });
    expect(periodRange('custom', ref, { from: '2026-02-30', to: 'x' })).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('month arithmetic', () => {
    expect(addMonths('2026-11-04', -5)).toBe('2026-06-01');
    expect(addMonths('2026-11-04', 2)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
    expect(addMonths('2026-03-31', -13)).toBe('2025-02-01');
    expect(monthStart('2026-11-17')).toBe('2026-11-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(daysInMonth('2028-02-01')).toBe(29);
    expect(monthKey('2026-11-04')).toBe('2026-11');
    expect(monthKey('2026-13')).toBeNull();
    expect(monthKey(null)).toBeNull();
  });
  it('a day in a period', () => {
    const r = { from: '2026-11-01', to: '2026-11-30' };
    expect(inRange('2026-11-01', r)).toBe(true);
    expect(inRange('2026-11-30', r)).toBe(true);
    expect(inRange('2026-12-01', r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
  });
  it('says the period in words', () => {
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-30' }, 'fr').replace(/\s/g, ' ')).toBe('1 nov. 2026 au 30 nov. 2026');
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-30' }, 'en')).toBe('Nov 1, 2026 to Nov 30, 2026');
  });
});
