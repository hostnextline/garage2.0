import { describe, it, expect } from 'vitest';
import { mapDayName } from './MapDay';

describe('mapDayName', () => {
  it('names yesterday, today and tomorrow; another day by its short date (the year only when not this year)', () => {
    expect(mapDayName('2026-11-10', '2026-11-10', 'fr')).toBe('Aujourd’hui');
    expect(mapDayName('2026-11-09', '2026-11-10', 'fr')).toBe('Hier');
    expect(mapDayName('2026-11-11', '2026-11-10', 'fr')).toBe('Demain');
    expect(mapDayName('2026-11-18', '2026-11-10', 'fr')).toMatch(/mer\.? 18 nov/);
    expect(mapDayName('2027-01-05', '2026-11-10', 'fr')).toMatch(/2027/);
    expect(mapDayName('2026-11-18', '2026-11-10', 'en')).toMatch(/Wed.*Nov.*18|Wed.*18.*Nov/);
  });
});
