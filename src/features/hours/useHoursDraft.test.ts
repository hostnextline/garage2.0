import { describe, it, expect } from 'vitest';
import { follow } from './useHoursDraft';
import { weekToPanes, paintRect, changedDays } from './grid';

const usual = { 2: [[480, 1200]] as [number, number][] };
const start = follow({ truck: null, key: '', from: {}, draft: {} }, 't1', usual);

describe('the drawing follows what the truck has', () => {
  it('starts from the hours given', () => expect(start.draft[2]).toEqual(weekToPanes(usual)[2]));
  it('« one day »: that date’s real hours replace the usual ones while nothing is drawn (map-hours-04)', () => {
    const that = follow(start, 't1', { 2: [[480, 720]] });
    expect(that.draft[2]).toEqual(weekToPanes({ 2: [[480, 720]] })[2]);
    expect(that.from).toEqual(that.draft);
  });
  it('a drawing in progress stays when the hours change; another truck starts over', () => {
    const drawn = { ...start, draft: paintRect(start.draft, { d: 6, u: 600 }, { d: 6, u: 630 }, true) };
    const moved = follow(drawn, 't1', { 2: [[540, 1200]] });
    expect(moved.draft[6]).toEqual(drawn.draft[6]);
    expect(moved.from[2]).toEqual(weekToPanes({ 2: [[540, 1200]] })[2]);
    expect(follow(drawn, 't2', usual).draft).toEqual(weekToPanes(usual));
    expect(follow(start, 't1', usual)).toBe(start);
  });
  it('drawn on another weekday, then a date with its own hours: that date’s column takes them, the drawing stays (mh-3)', () => {
    const drawn = { ...start, draft: paintRect(start.draft, { d: 6, u: 600 }, { d: 6, u: 630 }, true) };
    const that = follow(drawn, 't1', { 2: [[480, 720]] });
    expect(that.draft[2]).toEqual(weekToPanes({ 2: [[480, 720]] })[2]);   // not the usual 8 h – 20 h any more
    expect(that.draft[6]).toEqual(drawn.draft[6]);
    expect(changedDays(that.draft, that.from)).toEqual([6]);
  });
  it('a weekday really drawn keeps its drawing when its hours change underneath', () => {
    const drawn = { ...start, draft: paintRect(start.draft, { d: 2, u: 1200 }, { d: 2, u: 1230 }, true) };
    const that = follow(drawn, 't1', { 2: [[540, 1200]] });
    expect(that.draft[2]).toEqual(drawn.draft[2]);
  });
});
