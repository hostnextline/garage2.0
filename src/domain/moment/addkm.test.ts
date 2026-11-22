/* Moment.add_km is number | null (build-data L3): null while a trip of the day is not measured, or when a measured trip has
   no km (the server's day_drive F7). Every reader says no km then: never « 0 km », never « NaN ». A real 0 stays a real 0. */
import { describe, it, expect } from 'vitest';
import { roadWords, type Moment } from './logic';
import { addsFromRow, blockAdds, dayFromRow } from './serverPlace';
import type { Suggestion } from '../../data/api';

const NO_KM = /\b0 km\b|NaN|undefined|null/;

describe('a moment whose add_km is null (or not a number)', () => {
  it('roadWords: the minutes only, no km', () => {
    for (const add_km of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = roadWords({ drive_min: 12, add_min: 14, add_km }, 'fr');
      expect(w).toBe('14 min de route');
      expect(w).not.toMatch(NO_KM);
      expect(roadWords({ drive_min: 12, add_min: 14, add_km }, 'en')).not.toMatch(NO_KM);
    }
    expect(roadWords({ drive_min: 12, add_min: 14, add_km: 4.2 }, 'fr')).toBe('14 min de route (4,2 km)');
    expect(roadWords({ drive_min: 12, add_min: 14, add_km: 0 }, 'fr')).toBe('14 min de route (0 km)');   // a measured 0 is said
  });
  it('the server’s row (switch on): what it adds, the day, the block — no km, no NaN', () => {
    const row = { truck: 't1', block: 'day', add_min: 14, add_km: null, day_min: 80, day_km: null, unmeasured: 0 } as const;
    for (const l of ['fr', 'en'] as const) {
      expect(addsFromRow(row, l)).not.toMatch(NO_KM);
      expect(dayFromRow(row, l)).not.toMatch(NO_KM);
      expect(blockAdds(row, l)).not.toMatch(NO_KM);
    }
    expect(blockAdds(row, 'fr')).toBe('+14 min de route');
  });
  it('the types say it: a Suggestion and a Moment may carry add_km null', () => {
    const s: Pick<Suggestion, 'add_km'> = { add_km: null };
    const m: Pick<Moment, 'add_km'> = { add_km: null };
    expect(s.add_km ?? m.add_km).toBeNull();
  });
});
