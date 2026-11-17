/* The words of a day, on the garage's clock (Montréal) whatever the phone's zone (R169): run with TZ=UTC and
   TZ=Asia/Tokyo too. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { dayOfIso, dateShort, stampDay, dayWord } from './dayWords';
import { lang } from '../../lib/i18n';

afterEach(() => { vi.useRealTimers(); lang.value = 'fr'; });

describe('a timestamp as a day of the garage (R169)', () => {
  it('a late evening in Montréal is still that day, on any phone', () => {
    // 22 h 30 in Montréal on Monday the 16th = 03:30 UTC on the 17th = 12:30 in Tokyo on the 17th
    expect(dayOfIso('2026-11-17T03:30:00Z')).toBe('2026-11-16');
    expect(dayOfIso('2026-11-16T05:00:00Z')).toBe('2026-11-16');
    expect(dayOfIso('2026-11-16T04:59:00Z')).toBe('2026-11-15');
    // summer time: Montréal is UTC−4
    expect(dayOfIso('2026-07-02T03:59:00Z')).toBe('2026-07-01');
  });
  it('nothing, or not a date: null', () => {
    expect(dayOfIso(null)).toBeNull();
    expect(dayOfIso(undefined)).toBeNull();
    expect(dayOfIso('')).toBeNull();
    expect(dayOfIso('pas une date')).toBeNull();
  });
  it('« Hier » / « Aujourd’hui » of a stamp counts on the garage’s day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T03:30:00Z')); // Monday the 16th, 22 h 30 in Montréal
    lang.value = 'fr';
    expect(stampDay('2026-11-17T02:00:00Z')).toBe('Aujourd’hui'); // 21 h the 16th in Montréal
    expect(stampDay('2026-11-16T03:00:00Z')).toBe('Hier');        // 22 h the 15th in Montréal
    expect(dayWord('2026-11-17')).toBe('Demain');
  });
});

describe('« 4 nov. » this year, the year written for another one (R169)', () => {
  it('New Year’s Eve in Montréal: still this year, even where it is already next year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T03:00:00Z')); // 22 h on 2026-12-31 in Montréal
    lang.value = 'fr';
    expect(dateShort('2026-12-05')).not.toMatch(/2026/);
    expect(dateShort('2027-01-05')).toMatch(/2027/);
    expect(dateShort('2025-12-05')).toMatch(/2025/);
  });
});
