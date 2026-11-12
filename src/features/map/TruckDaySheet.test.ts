import { describe, it, expect } from 'vitest';
import { withStart } from './TruckDaySheet';

describe('« Départ et heure »: a new start time keeps the end of the day', () => {
  it('later: the start moves, the end stays', () => expect(withStart([[480, 1200]], 600)).toEqual([[600, 1200]]));
  it('earlier: the day opens sooner', () => expect(withStart([[480, 1200]], 420)).toEqual([[420, 1200]]));
  it('past a break: what ends before it goes', () => expect(withStart([[480, 720], [780, 1200]], 750)).toEqual([[750, 1200]]));
  it('a day off: open from that time to 20 h', () => expect(withStart([], 540)).toEqual([[540, 1200]]));
});
