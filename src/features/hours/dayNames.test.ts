import { describe, it, expect, vi } from 'vitest';
import { weekdayName } from './dayNames';

describe('the names of the weekdays', () => {
  it('Sunday first, in each language, short without the dot', () => {
    expect(weekdayName(0, 'fr')).toBe('dimanche');
    expect(weekdayName(2, 'fr', 'short')).toBe('mar');
    expect(weekdayName(6, 'en')).toBe('Saturday');
  });
  it('one formatter per language and style, however many panes ask (map-hours-25)', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    for (let i = 0; i < 224; i++) weekdayName(i % 7, 'en', 'short');
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
  });
});
