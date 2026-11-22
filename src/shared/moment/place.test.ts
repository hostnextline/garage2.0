import { describe, it, expect } from 'vitest';
import { floatPlace, floatStyle, popPlace, POP, LABEL_H } from './place';

describe('the words of a time stay beside its column, inside the screen', () => {
  it('left of the column, else right, else under the unit', () => {
    const unit = { top: 300, bottom: 318 };
    expect(floatPlace(unit, { left: 900, right: 990 }, 1366, 800)).toEqual({ right: 478, top: 290 });
    expect(floatPlace(unit, { left: 200, right: 290 }, 1366, 800)).toEqual({ left: 302, top: 290 });
    expect(floatStyle({ right: 478, top: 290 })).toEqual({ top: '290px', right: '478px' });
    expect(floatStyle({ top: 10 })).toEqual({ top: '10px', left: '8px' });
  });
  it('a time at the bottom of the screen keeps its words beside it (only their own height is kept free)', () => {
    expect(floatPlace({ top: 760, bottom: 778 }, { left: 900, right: 990 }, 1366, 800, LABEL_H).top).toBe(800 - LABEL_H - 8);
    expect(floatPlace({ top: 600, bottom: 618 }, { left: 900, right: 990 }, 1366, 800, LABEL_H).top).toBe(590);
  });
});

describe('the map window: a real map, as big as the screen lets it be, never out of the screen', () => {
  const picker = { left: 747, right: 1387, top: 180, bottom: 1400 };
  const row = { left: 747, right: 955, top: 275, bottom: 347 };
  it('beside the whole picker when there is room: the same place for every moment of the picker', () => {
    const a = popPlace(row, picker, 1440, 900);
    expect(a).toEqual({ left: 747 - 12 - 640, top: 180, width: 640, mapH: 460, aside: true });
    // another moment of the same picker: the window does not move
    expect(popPlace({ left: 1180, right: 1387, top: 275, bottom: 347 }, picker, 1440, 900)).toEqual(a);
    expect(popPlace({ left: 1300, right: 1380, top: 700, bottom: 718 }, picker, 1440, 900)).toEqual(a);
  });
  it('on the side that has the most room, no wider than that room', () => {
    // a picker on the left of the screen: the window goes on its right
    expect(popPlace(row, { left: 40, right: 700, top: 100, bottom: 800 }, 1440, 900)).toMatchObject({ left: 712, width: 640, aside: true });
    // a narrower room: the window takes what there is
    expect(popPlace(row, { left: 520, right: 1272, top: 100, bottom: 800 }, 1280, 800)).toMatchObject({ left: 8, width: 500, aside: true });
  });
  it('a picker scrolled above the screen, or lower than the window can go: the window stays whole in the screen', () => {
    expect(popPlace(row, { ...picker, top: -300 }, 1440, 900).top).toBe(8);
    expect(popPlace(row, { ...picker, top: 700 }, 1440, 900).top).toBe(900 - 460 - POP.chrome - 8);
  });
  it('a short screen: a smaller map, never under its smallest', () => {
    expect(popPlace(row, picker, 1440, 560).mapH).toBe(560 - 16 - POP.chrome);
    expect(popPlace(row, picker, 1440, 300).mapH).toBe(POP.minMapH);
  });
  it('no room beside the picker (it takes the width): beside the moment itself, at its height', () => {
    const wide = { left: 301, right: 1000, top: 150, bottom: 1200 };
    const item = { left: 301, right: 519, top: 314, bottom: 386 };
    const a = popPlace(item, wide, 1024, 700);
    expect(a).toMatchObject({ left: 531, width: 485, aside: false });
    expect(a.top).toBeGreaterThanOrEqual(8);
    expect(a.top + a.mapH + POP.chrome).toBeLessThanOrEqual(700 - 8);
    // no picker known: the same rule from the moment alone
    expect(popPlace(item, null, 1024, 700)).toEqual(a);
  });
  it('no room beside the moment either (a narrow window): under it, else above it, across the screen', () => {
    const item = { left: 38, right: 662, top: 296, bottom: 414 };
    const under = popPlace(item, { left: 38, right: 662, top: 100, bottom: 2000 }, 700, 900);
    expect(under).toMatchObject({ left: 30, width: 640, top: 426, aside: false });
    expect(under.mapH).toBe(900 - 414 - 12 - 8 - POP.chrome);
    const above = popPlace({ ...item, top: 600, bottom: 718 }, null, 700, 900);
    expect(above.top + above.mapH + POP.chrome).toBe(600 - 12);
    expect(above.top).toBeGreaterThanOrEqual(8);
    // a very narrow screen: the window is as wide as the screen lets it be
    expect(popPlace(item, null, 420, 900)).toMatchObject({ left: 8, width: 404 });
  });
});
