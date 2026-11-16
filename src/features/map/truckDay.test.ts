import { describe, it, expect } from 'vitest';
import { withStart, startTimes } from './truckDay';

describe('« Départ et heure »: a new start time keeps the end of the day', () => {
  it('later: the start moves, the end stays', () => expect(withStart([[480, 1200]], 600)).toEqual([[600, 1200]]));
  it('earlier: the day opens sooner', () => expect(withStart([[480, 1200]], 420)).toEqual([[420, 1200]]));
  it('past a break: what ends before it goes', () => expect(withStart([[480, 720], [780, 1200]], 750)).toEqual([[750, 1200]]));
  it('a day off: open from that time to 20 h', () => expect(withStart([], 540)).toEqual([[540, 1200]]));
});

describe('« Départ et heure »: the start times offered (map-hours-20)', () => {
  it('every half hour from 5 h to 19 h: an evening vehicle can start at 16 h', () => {
    const all = startTimes(480);
    expect(all[0]).toBe(300);
    expect(all[all.length - 1]).toBe(1140);
    expect(all).toContain(960);
  });
  it('a start that is not on a half hour is offered too, so the choice is never blank', () => {
    expect(startTimes(495)).toContain(495);
    expect(startTimes(null)).not.toContain(null);
  });
});
