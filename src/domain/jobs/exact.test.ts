/* « exact move » (STATE.md A2): the server's preview read as the ONE question to ask, and the minute a picker showed. */
import { describe, it, expect } from 'vitest';
import type { ExactAnswer, ExactStop } from '../../data/exact';
import { exactCase, lateOkOf, keptTimeOf } from './exact';
import { exactAtOf } from '../moment/exactAt';

const stop = (o: Partial<ExactStop>): ExactStop => ({ id: 'x', day: '2026-11-26', truckId: 't1', orderBefore: 1, orderAfter: 1, etaBefore: 600, etaAfter: 600,
  winStart: 540, winEnd: 780, delay: 0, late: false, lateMin: 0, measured: null, ...o });
const answer = (o: Partial<ExactAnswer>): ExactAnswer => ({ exact: true, stops: [], overHours: 0, earliest: null, earliestKeep: null, refused: null, ...o });

describe('the one question of an exact move (A2)', () => {
  it('nobody late, nobody later: the plain question; a stop later inside its window is said, never hidden', () => {
    const moved = stop({ id: 'j1', etaBefore: 900, etaAfter: 780 });
    expect(exactCase(answer({ stops: [moved, stop({ id: 'a' })] }), 'j1')).toEqual({ kind: 'ok', pushed: [] });
    const b = stop({ id: 'b', etaBefore: 600, etaAfter: 640, delay: 40 });
    expect(exactCase(answer({ stops: [moved, b] }), 'j1')).toEqual({ kind: 'ok', pushed: [b] });
  });
  it('somebody late: who, and the truck past its hours', () => {
    const late = stop({ id: 'c', etaAfter: 820, delay: 60, late: true, lateMin: 40 });
    const pushed = stop({ id: 'b', delay: 20, etaAfter: 620 });
    expect(exactCase(answer({ stops: [stop({ id: 'j1' }), late, pushed] }), 'j1')).toEqual({ kind: 'late', late: [late], pushed: [pushed], overHours: 0 });
    expect(exactCase(answer({ stops: [stop({ id: 'j1' })], overHours: 25 }), 'j1')).toEqual({ kind: 'late', late: [], pushed: [], overHours: 25 });
    // « Déplacer quand même » accepts those; the truck past its hours goes with the moved one's own id
    expect(lateOkOf({ kind: 'late', late: [late], pushed: [], overHours: 0 }, 'j1')).toEqual(['c']);
    expect(lateOkOf({ kind: 'late', late: [late], pushed: [], overHours: 25 }, 'j1')).toEqual(['c', 'j1']);
    expect(lateOkOf({ kind: 'ok', pushed: [] }, 'j1')).toEqual([]);
  });
  it('the truck cannot be there at that minute: the earliest, answered or thrown', () => {
    expect(exactCase(answer({ refused: 'arrive_late', earliest: 622, earliestKeep: 700 }), 'j1')).toEqual({ kind: 'early', earliest: 622, keep: 700 });
    expect(exactCase(answer({ refused: 'pick_truck' }), 'j1')).toEqual({ kind: 'refused', code: 'pick_truck' });
  });
  it('a trip not measured, an older server, no answer: said plainly, never « late » from a guess (S8)', () => {
    const guess = stop({ id: 'c', measured: false, etaAfter: 820, delay: 60 });
    expect(exactCase(answer({ stops: [stop({ id: 'j1' }), guess] }), 'j1')).toEqual({ kind: 'unsure', why: 'unmeasured' });
    expect(exactCase(null, 'j1')).toEqual({ kind: 'unsure', why: 'unchecked' });
    expect(exactCase(answer({ exact: false }), 'j1')).toEqual({ kind: 'unsure', why: 'unchecked' });
    // a stop the server measured as late stays late even when another trip is not measured
    const late = stop({ id: 'd', late: true, lateMin: 10, measured: true });
    expect(exactCase(answer({ stops: [guess, late] }), 'j1').kind).toBe('late');
    // review T1 / M10: a « late » on a trip NOT measured is never said late (S8: the server should not send it; if it
    // does, it is a guess): the case is « not measured », never « late »
    const guessedLate = stop({ id: 'e', late: true, lateMin: 30, measured: false, etaAfter: 900, delay: 90 });
    expect(exactCase(answer({ stops: [stop({ id: 'j1' }), guessedLate] }), 'j1')).toEqual({ kind: 'unsure', why: 'unmeasured' });
  });
});

describe('the minute a « Déplacer » choice showed (A1)', () => {
  const windowOf = (m: number): [number, number] => { const s = Math.max(480, Math.round(m / 60) * 60 - 60); return [s, s + 240]; };
  const span: [number, number] = [480, 1200];
  it('a quarter hour of the calendar: that very minute; a best moment: the time the bar says (its nearest quarter hour)', () => {
    expect(exactAtOf({ day: 'd', block: 'day', win_start: 720, win_end: 960, eta: 795 }, span, windowOf)).toBe(795);
    // a row's arrival 13 h 07: « Vers 13 h » on the bar (the nearest unit of that window)
    expect(exactAtOf({ day: 'd', block: 'day', win_start: 720, win_end: 960, eta: 787 }, span, windowOf)).toBe(780);
  });
  it('no time pointed: flexible, the day alone, a block, a choice without arrival', () => {
    expect(exactAtOf({ day: 'd', block: 'day', win_flex: true }, span, windowOf)).toBe(null);
    expect(exactAtOf({ day: 'd', block: 'day' }, span, windowOf)).toBe(null);
    expect(exactAtOf({ day: 'd', block: 'am', eta: 600 }, span, windowOf)).toBe(null);
    expect(exactAtOf({ day: 'd', block: 'day', win_start: 720, win_end: 960, eta: null }, span, windowOf)).toBe(null);
  });
});

describe('« Changer de camion » keeps the appointment’s time (A1)', () => {
  const windowOf = (m: number): [number, number] => { const s = Math.max(480, Math.round(m / 60) * 60 - 60); return [s, s + 240]; };
  it('its pointed minute, else its arrival when that arrival’s window is the one the customer has', () => {
    expect(keptTimeOf({ block: 'day', win_start: 720, win_end: 960, eta_min: 790, arrive_at: 780 }, windowOf)).toBe(780);
    expect(keptTimeOf({ block: 'day', win_start: 720, win_end: 960, eta_min: 790 }, windowOf)).toBe(790);
    // 13 h 40 would cut 13 h – 17 h: the customer was told 12 h – 16 h, so the time is not kept that way (no new text)
    expect(keptTimeOf({ block: 'day', win_start: 720, win_end: 960, eta_min: 820 }, windowOf)).toBe(null);
    expect(keptTimeOf({ block: 'day', win_start: null, win_flex: true, eta_min: 790 }, windowOf)).toBe(null);
    expect(keptTimeOf({ block: 'am', eta_min: 600 }, windowOf)).toBe(null);
  });
  it('a flexible appointment whose window the evening lock fixed keeps « flexible »: no time kept, the 5-argument move of live (main 7118fb07, review F4)', () => {
    // the exact move writes win_flex = false, so keeping its time would take it out of the windows to text (« Fixer les
    // plages »: flexibleWithWindow) with no text: the customer would never hear the window. Its arrival fits its window here.
    expect(keptTimeOf({ block: 'day', win_start: 720, win_end: 960, win_flex: true, eta_min: 790 }, windowOf)).toBe(null);
    expect(keptTimeOf({ block: 'day', win_start: 720, win_end: 960, win_flex: true, eta_min: 790, arrive_at: 780 }, windowOf)).toBe(null);
    // the same window, not flexible: its time is kept as before
    expect(keptTimeOf({ block: 'day', win_start: 720, win_end: 960, win_flex: false, eta_min: 790 }, windowOf)).toBe(790);
  });
});
