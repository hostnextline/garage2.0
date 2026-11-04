import { describe, it, expect } from 'vitest';
import { UNITS, FROM, TO, STEP, weekToPanes, panesToRanges, paintRect, togglePane, changedDays, samePanes, applyPlan, emptyPanes, dayToPanes, type Panes } from './grid';
import { cellsToRanges, rangesToCells, dow } from '../../lib/dates';
import { hours as fr } from '../../i18n/fr/hours';
import { hours as en } from '../../i18n/en/hours';
import { sameShape } from '../booking/dict-check';

describe('the window of panes', () => {
  it('has 32 panes of 30 minutes from 6 h to 22 h', () => {
    expect(UNITS.length).toBe(32);
    expect(UNITS[0]).toBe(FROM);
    expect(UNITS[31] + STEP).toBe(TO);
  });
  it('turns a usual week into panes and back (same as lib/dates cellsToRanges / rangesToCells)', () => {
    const week = { 1: [[480, 720], [780, 1200]] as [number, number][], 6: [[540, 1020]] as [number, number][] };
    const p = weekToPanes(week);
    expect(p[0]).toEqual([]);
    expect(p[1]).toEqual(rangesToCells(week[1], 30, FROM, TO));
    expect(p[1][0]).toBe(480);
    expect(p[1]).not.toContain(720);       // 12 h to 13 h is the lunch break
    expect(panesToRanges(p[1])).toEqual(cellsToRanges(p[1], 30));
    expect(panesToRanges(p[1])).toEqual([[480, 720], [780, 1200]]);
    expect(panesToRanges(p[6])).toEqual([[540, 1020]]);
  });
  it('keeps the hours outside the window when a day is redrawn', () => {
    const before: [number, number][] = [[300, 600], [1260, 1380]];   // 5 h to 10 h, 21 h to 23 h
    const panes = dayToPanes(before);
    expect(panes[0]).toBe(360);
    expect(panesToRanges(panes, before)).toEqual([[300, 600], [1260, 1380]]);
    // the person erases the morning: what is before 6 h stays
    expect(panesToRanges(panes.filter((u) => u >= 600), before)).toEqual([[300, 360], [1260, 1380]]);
  });
  it('snaps a pane partly covered: it is lit only when fully covered', () => {
    expect(dayToPanes([[495, 720]])[0]).toBe(510);
  });
});

describe('painting', () => {
  it('lights a rectangle: the days between and the times between', () => {
    const p = paintRect(emptyPanes(), { d: 1, u: 480 }, { d: 5, u: 1170 }, true);
    for (const d of [1, 2, 3, 4, 5]) expect(panesToRanges(p[d])).toEqual([[480, 1200]]);
    expect(p[0]).toEqual([]);
    expect(p[6]).toEqual([]);
  });
  it('works whatever the direction of the drag', () => {
    const a = paintRect(emptyPanes(), { d: 5, u: 1170 }, { d: 1, u: 480 }, true);
    const b = paintRect(emptyPanes(), { d: 1, u: 480 }, { d: 5, u: 1170 }, true);
    expect(a).toEqual(b);
  });
  it('erases with the same gesture when the first pane was lit', () => {
    const full = paintRect(emptyPanes(), { d: 2, u: 480 }, { d: 2, u: 1170 }, true);
    const lunch = paintRect(full, { d: 2, u: 720 }, { d: 2, u: 750 }, false);
    expect(panesToRanges(lunch[2])).toEqual([[480, 720], [780, 1200]]);
  });
  it('follows the order of the columns on screen', () => {
    const lit = (p: Panes) => Object.entries(p).filter(([, v]) => v.length).map(([k]) => Number(k)).sort();
    // Monday first on screen: Saturday and Sunday are side by side
    expect(lit(paintRect(emptyPanes(), { d: 6, u: 600 }, { d: 0, u: 600 }, true, [1, 2, 3, 4, 5, 6, 0]))).toEqual([0, 6]);
    // Sunday first (the garage's week): from Saturday back to Sunday is the whole week
    expect(lit(paintRect(emptyPanes(), { d: 6, u: 600 }, { d: 0, u: 600 }, true))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('toggles one pane', () => {
    const p = togglePane(emptyPanes(), 3, 900);
    expect(p[3]).toEqual([900]);
    expect(togglePane(p, 3, 900)[3]).toEqual([]);
  });
  it('says which days changed', () => {
    const base = weekToPanes({ 1: [[480, 1200]] });
    const draft = paintRect(base, { d: 6, u: 540 }, { d: 6, u: 990 }, true);
    expect(changedDays(draft, base)).toEqual([6]);
    expect(samePanes([600, 630], [630, 600])).toBe(true);
  });
});

describe('what « Appliquer » sends', () => {
  const usual = { 1: [[480, 1200]] as [number, number][], 2: [[480, 1200]] as [number, number][], 3: [[480, 1200]] as [number, number][] };
  const today = '2026-11-04';   // a Wednesday
  it('in permanence: only the weekdays that changed, every coming one counted', () => {
    const base = weekToPanes(usual);
    const draft: Panes = { ...base, 6: rangesToCells([[540, 1020]], 30, FROM, TO), 2: [] };
    const plan = applyPlan('always', draft, usual, { from: today, weeks: 1, today, until: '2026-11-30' });
    expect(plan.dows.sort()).toEqual([2, 6]);
    expect(plan.week).toEqual({ 2: [], 6: [[540, 1020]] });
    expect(plan.dates[0]).toBe('2026-11-07');                      // the first Saturday
    expect(plan.dates.every((d) => [2, 6].includes(dow(d)))).toBe(true);
    expect(plan.empty).toBe(false);
  });
  it('for N weeks: the changed weekdays between the start and the end', () => {
    const base = weekToPanes(usual);
    const draft = paintRect(base, { d: 6, u: 540 }, { d: 6, u: 990 }, true);
    const plan = applyPlan('weeks', draft, usual, { from: '2026-11-05', weeks: 3, today, until: '2027-03-01' });
    expect(plan.week).toEqual({ 6: [[540, 1020]] });
    expect(plan.dates).toEqual(['2026-11-07', '2026-11-14', '2026-11-21']);
  });
  it('one day: the weekday of that date, compared with what that date has now', () => {
    const base = weekToPanes(usual);
    const closedTuesday = { ...base, 2: [] };
    const plan = applyPlan('day', closedTuesday, usual, { from: '2026-11-10', weeks: 1, today, until: today });
    expect(plan.week).toEqual({ 2: [] });
    expect(plan.dates).toEqual(['2026-11-10']);
    // that Tuesday is already closed (changed before): nothing to send
    const again = applyPlan('day', closedTuesday, usual, { from: '2026-11-10', weeks: 1, today, until: today, actual: [] });
    expect(again.empty).toBe(true);
  });
  it('nothing drawn, nothing sent', () => {
    const plan = applyPlan('always', weekToPanes(usual), usual, { from: today, weeks: 1, today, until: '2026-12-01' });
    expect(plan.empty).toBe(true);
    expect(plan.week).toEqual({});
  });
});

describe('words', () => {
  it('French and English have the same keys and the same {placeholders}', () => {
    expect(sameShape(fr, en)).toEqual([]);
  });
});
