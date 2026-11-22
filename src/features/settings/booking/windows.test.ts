import { describe, it, expect } from 'vitest';
import { spanOf, withDaySpan, exampleWindow, spanTooShort } from './windows';

describe('settings: « Plages d’arrivée »', () => {
  const blocks = [{ key: 'am' as const, start: 480, end: 720 }, { key: 'pm' as const, start: 720, end: 960 }, { key: 'eve' as const, start: 960, end: 1200 }];

  it('the example: an arrival at 3 pm is told 2 pm to 6 pm; the window stays inside the day', () => {
    expect(exampleWindow(900, { before: 60, after: 180, round: 60 }, [480, 1200])).toEqual([840, 1080]);
    expect(exampleWindow(900, { before: 30, after: 210, round: 60 }, [480, 1200])).toEqual([870, 1110]);
    expect(exampleWindow(900, { before: 60, after: 180, round: 60 }, [480, 1020])).toEqual([780, 1020]);
    // a number missing or wrong while typing: the usual one
    expect(exampleWindow(900, { before: null, after: Number.NaN, round: 45 }, [480, 1200])).toEqual([840, 1080]);
    // « Arrondi » on the quarter hour: an arrival at 14 h 15 is told 13 h 15 to 17 h 15 (14 h 20 too)
    expect(exampleWindow(855, { before: 60, after: 180, round: 15 }, [480, 1200])).toEqual([795, 1035]);
    expect(exampleWindow(860, { before: 60, after: 180, round: 15 }, [480, 1200])).toEqual([795, 1035]);
    expect(exampleWindow(855, { before: 60, after: 180, round: 30 }, [480, 1200])).toEqual([810, 1050]);
  });
  it('« Heures de la journée » keeps the stored blocks and moves only the first start and the last end', () => {
    expect(spanOf(blocks)).toEqual([480, 1200]);
    const later = withDaySpan(blocks, 540, 1140);
    expect(later.map((b) => [b.key, b.start, b.end])).toEqual([['am', 540, 720], ['pm', 720, 960], ['eve', 960, 1140]]);
    expect(blocks[0].start).toBe(480);
    // a day that no longer holds the old cuts: cut again in equal parts, still in order with no hole
    const short = withDaySpan(blocks, 780, 1020);
    expect(spanOf(short)).toEqual([780, 1020]);
    expect(short.map((b) => b.key)).toEqual(['am', 'pm', 'eve']);
    short.forEach((b, i) => { expect(b.end).toBeGreaterThan(b.start); if (i) expect(b.start).toBe(short[i - 1].end); });
    expect(withDaySpan(blocks, 900, 600)).toBe(blocks);
  });
  it('a day shorter than one window is refused', () => {
    expect(spanTooShort([480, 1200], { before: 60, after: 180, round: 60 })).toBe(false);
    expect(spanTooShort([480, 700], { before: 60, after: 180, round: 60 })).toBe(true);
    expect(spanTooShort([480, 720], { before: null, after: null, round: null })).toBe(false);
  });
});
