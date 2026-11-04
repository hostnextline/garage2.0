import { describe, it, expect } from 'vitest';
import { fitSize, HIS_NIGHT, HIS_DAY } from './backdrop';

describe('behind the glass', () => {
  it('a photo is made smaller to at most 1600 px on its longest side, never bigger', () => {
    expect(fitSize(4032, 3024)).toEqual({ w: 1600, h: 1200 });
    expect(fitSize(3024, 4032)).toEqual({ w: 1200, h: 1600 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(5000, 10, 1600)).toEqual({ w: 1600, h: 3 });
    expect(fitSize(0, 600)).toEqual({ w: 0, h: 0 });
    expect(fitSize(NaN, 600)).toEqual({ w: 0, h: 0 });
  });
  it('the two H.I.S pictures come with the app', () => {
    expect(HIS_NIGHT).toMatch(/his-night.*\.webp/);
    expect(HIS_DAY).toMatch(/his-day.*\.webp/);
  });
});
