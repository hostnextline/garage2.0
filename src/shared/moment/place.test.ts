import { describe, it, expect } from 'vitest';
import { besideRow, floatPlace, floatStyle, hoverBox } from './place';

describe('the small map windows stay beside what they are about, inside the screen', () => {
  it('the time grid’s window: left of the column, else right, else under the unit', () => {
    const unit = { top: 300, bottom: 318 };
    expect(floatPlace(unit, { left: 900, right: 990 }, 1366, 800)).toEqual({ right: 478, top: 290 });
    expect(floatPlace(unit, { left: 200, right: 290 }, 1366, 800)).toEqual({ left: 302, top: 290 });
    expect(floatStyle({ right: 478, top: 290 })).toEqual({ top: '290px', right: '478px' });
    expect(floatStyle({ top: 10 })).toEqual({ top: '10px', left: '8px' });
  });
  it('a best moment’s window: left of the row when there is room, else on its right; kept inside', () => {
    expect(besideRow({ left: 600, right: 800, top: 200, bottom: 260 }, 1366, 800)).toEqual({ left: 228, top: 160 });
    expect(besideRow({ left: 100, right: 300, top: 700, bottom: 760 }, 1366, 800)).toEqual({ left: 312, top: 462 });
  });
  it('the blocks picker’s window: right first, else left, else above or under', () => {
    expect(hoverBox({ left: 100, right: 300, top: 300, bottom: 360 }, 1366, 800)).toEqual({ left: 312, top: 154 });
    expect(hoverBox({ left: 900, right: 1300, top: 300, bottom: 360 }, 1366, 800)).toEqual({ left: 548, top: 154 });
    expect(hoverBox({ left: 10, right: 400, top: 500, bottom: 560 }, 420, 1000)).toEqual({ left: 10, top: 136 });
  });
});
