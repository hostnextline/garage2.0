import { describe, it, expect } from 'vitest';
import { order, walk, choices, fits, endOf, type Stop } from './demo-plan';
import { windowFor } from '../lib/dates';

const stop = (id: string, win: [number, number] | null, o: Partial<Stop> = {}): Stop => ({ id, dur: 60, travel: 20, win, ...o });
const winOf = (eta: number) => windowFor(eta);
const ids = (s: { id: string }[]) => s.map((x) => x.id).join(' ');

describe('demo planner of « Plages d’arrivée »', () => {
  it('waits for a window to open and says « hors plage » after it', () => {
    const p = walk([stop('a', [600, 840]), stop('b', [480, 540], { dur: 30 })], 480);
    expect(p).toEqual([{ id: 'a', eta: 600, late: false }, { id: 'b', eta: 680, late: true }]);
  });
  it('orders: started, by hand, windows by their start, flexible where it costs least, forced last', () => {
    const seq = order([
      stop('forced', [480, 720], { forced: true }), stop('late', [840, 1080]), stop('flex', null), stop('early', [480, 720]),
      stop('hand', [960, 1200], { manual: 1 }), stop('done', null, { fixedEta: 470 })
    ], 480);
    expect(ids(seq).startsWith('done hand')).toBe(true);
    expect(ids(seq).endsWith('forced')).toBe(true);
    expect(seq.findIndex((s) => s.id === 'early')).toBeLessThan(seq.findIndex((s) => s.id === 'late'));
    // the forced stop, told the morning, is reached after its window
    expect(walk(seq, 480).find((x) => x.id === 'forced')!.late).toBe(true);
  });
  it('a flexible stop fills the hole before a window instead of pushing the day later', () => {
    const seq = order([stop('pm', [780, 1020]), stop('flex', null)], 480);
    expect(ids(seq)).toBe('flex pm');
    expect(endOf(seq, 480)).toBe(840);
  });
  it('offers several windows on an empty day, the earliest first, all inside the day', () => {
    const c = choices([], { id: 'n', dur: 60, travel: 20 }, 480, 1200, winOf);
    expect(c.length).toBeGreaterThan(3);
    expect(c[0].win).toEqual([480, 720]);
    expect(c[0].wait).toBe(0);
    for (const x of c) { expect(x.win[1] - x.win[0]).toBe(240); expect(x.win[0]).toBeGreaterThanOrEqual(480); expect(x.win[1]).toBeLessThanOrEqual(1200); expect(x.eta).toBeGreaterThanOrEqual(x.win[0]); expect(x.eta).toBeLessThanOrEqual(x.win[1]); }
    expect(new Set(c.map((x) => x.win[0])).size).toBe(c.length);
  });
  it('offers fewer windows on a busy day and never breaks a promised window', () => {
    const busy = order([stop('a', [480, 720], { dur: 200 }), stop('b', [720, 960], { dur: 200 }), stop('c', [960, 1200], { dur: 150 })], 480);
    const free = choices([], { id: 'n', dur: 60, travel: 20 }, 480, 1200, winOf);
    const few = choices(busy, { id: 'n', dur: 60, travel: 20 }, 480, 1200, winOf);
    expect(few.length).toBeLessThan(free.length);
    expect(few.length).toBeGreaterThan(0);
    for (const x of few) {
      const tryout = [...busy.slice(0, x.pos), stop('n', [x.eta, x.eta + 1440]), ...busy.slice(x.pos)];
      expect(walk(tryout, 480).some((p) => p.late)).toBe(false);
    }
  });
  it('a full day offers nothing', () => {
    const full = [stop('a', [480, 720], { dur: 340 }), stop('b', [840, 1080], { dur: 340 })];
    expect(choices(order(full, 480), { id: 'n', dur: 90, travel: 20 }, 480, 1200, winOf)).toEqual([]);
  });
  it('says whether a window asked for can still be kept', () => {
    const day = [stop('a', [480, 720], { dur: 230 })];
    expect(fits(day, stop('n', [720, 960]), 480, 1200)).toBe(true);
    // the same morning window: the truck would reach it after noon
    expect(fits(day, stop('n', [480, 720], { dur: 30 }), 480, 1200)).toBe(false);
    expect(fits([], stop('n', [960, 1200], { dur: 300 }), 480, 1200)).toBe(false);
  });
});
