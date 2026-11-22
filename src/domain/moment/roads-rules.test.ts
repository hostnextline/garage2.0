/* « Vraies routes » on: the pure rules of the pickers that read the server's rows — the day strip never says the
   « unknown » time as a fact (review-moments H3), the calendar's room comes from the rows (PE-09, M2), a better moment
   never claims minutes saved from an unmeasured trip. Switch off: the rows carry none of the new keys, so nothing changes
   (the old tests days.test.ts, logic.test.ts stay as they were). */
import { describe, it, expect } from 'vitest';
import { dayChips, isOpen, defaultBlock, type DayRow } from './days';
import { betterMoments, cellFromRows, isFar, roadWords, unmeasured, type Moment } from './logic';

const rows: DayRow[] = [
  { day: '2026-11-19', blocks: [{ key: 'am', state: 'ok' }, { key: 'pm', state: 'ok' }] },
  { day: '2026-11-20', blocks: [{ key: 'am', state: 'unknown' }, { key: 'pm', state: 'full' }] }
];

describe('the day strip (« Choisir sur la carte »)', () => {
  it('a moment whose trips are not all measured adds no « +N min de route »: its minutes are the unknown time', () => {
    const list: Moment[] = [{ day: '2026-11-19', block: 'am', add_min: 40, unmeasured: 2 }];
    const chip = dayChips(rows, list, {})[0];
    expect(chip.add).toBeNull();
    expect(chip.unmeasured).toBe(true);
    expect(chip.far).toBe(false);
  });
  it('a measured moment of the same day speaks for it; the unmeasured one is left out', () => {
    const list: Moment[] = [{ day: '2026-11-19', block: 'am', add_min: 40, unmeasured: 2 }, { day: '2026-11-19', block: 'pm', add_min: 12, unmeasured: 0 }];
    expect(dayChips(rows, list, {})[0]).toMatchObject({ add: 12, unmeasured: false, best: true });
  });
  it('switch off (no key unmeasured): as before', () => {
    expect(dayChips(rows, [{ day: '2026-11-19', block: 'am', add_min: 9 }], {})[0]).toMatchObject({ add: 9, unmeasured: false });
  });
  it('« Meilleur choix » never on a day whose best moment is not measured: the first MEASURED one gets it (decision 1, G2)', () => {
    const list: Moment[] = [{ day: '2026-11-19', block: 'am', add_min: 0, unmeasured: 2 }, { day: '2026-11-20', block: 'am', add_min: 3, unmeasured: 0 }];
    const chips = dayChips(rows, list, {});
    expect(chips[0].best).toBe(false);
    expect(chips[1].best).toBe(true);
    // nothing measured at all: no best day
    expect(dayChips(rows, [list[0]], {}).some((c) => c.best)).toBe(false);
  });
  it('a block « À vérifier » (the server has not answered) is open: the day can be chosen, and it is shown first if nothing better', () => {
    expect(isOpen({ state: 'unknown' })).toBe(true);
    expect(dayChips(rows, [], {})[1].open).toBe(true);
    expect(defaultBlock(rows[1].blocks, '2026-11-20', [])).toBe('am');
  });
});

describe('PE-09: the calendar cell from the rows (switch on)', () => {
  const ok = { state: 'ok' as const, left: 130 }, tight = { state: 'tight' as const, left: 110 }, full = { state: 'full' as const, left: 10 };
  const row: Moment = { day: '2026-11-19', block: 'am' };
  it('a row = it fits (the planner offers only blocks where the job fits): « ok », never « presque plein » from a fixed 20 min', () => {
    expect(cellFromRows(tight, true, row)).toEqual({ state: 'ok', left: 110 });
    expect(cellFromRows(full, true, row)).toEqual({ state: 'ok', left: 10 });
  });
  it('the page answered, no row for that block: it does not fit with the real roads → « Complet »', () => {
    expect(cellFromRows(ok, true, undefined)).toEqual({ state: 'full', left: 130 });
  });
  it('not answered (offline, still asking): « À vérifier », unless the phone already sees no room at all', () => {
    expect(cellFromRows(ok, false, undefined).state).toBe('unknown');
    expect(cellFromRows(tight, false, undefined).state).toBe('unknown');
    expect(cellFromRows(full, false, undefined).state).toBe('full');
  });
  it('a vehicle chosen by hand: no row says nothing of it (the server places on the one it prefers) → « À vérifier », never « Complet »', () => {
    expect(cellFromRows(ok, true, undefined, true).state).toBe('unknown');
  });
  it('closed and started stay what the hours say', () => {
    expect(cellFromRows({ state: 'closed', left: 0 }, true, row).state).toBe('closed');
    expect(cellFromRows({ state: 'started', left: 0 }, true, row).state).toBe('started');
  });
});

describe('nothing said from an unmeasured trip', () => {
  it('« route pas encore mesurée », never far, never « 40 min »', () => {
    const m = { day: 'x', block: 'am' as const, drive_min: 40, add_min: 40, add_km: null, unmeasured: 2, far: 'hop' as const };
    expect(roadWords(m, 'fr')).toBe('route pas encore mesurée');
    expect(roadWords(m, 'en')).toBe('road not measured yet');
    expect(isFar(m)).toBe(false);
    expect(unmeasured(m)).toBe(true);
    expect(unmeasured({ unmeasured: 0 })).toBe(false);
  });
  it('« Plutôt … » after a far moment: no minutes saved claimed against a moment whose trips are not measured', () => {
    const picked: Moment = { day: 'd', block: 'am', add_min: 60, far: 'day', unmeasured: 0 };
    const list: Moment[] = [{ day: 'd', block: 'pm', add_min: 40, unmeasured: 1 }, { day: 'e', block: 'am', add_min: 20, unmeasured: 0 }];
    // decision 1 (2026-11-21): the unmeasured moment is not offered as « Plutôt … » at all (it was, without minutes)
    expect(betterMoments(picked, list).map((b) => b.saved)).toEqual([40]);
  });
});

describe('« Plutôt … » (decision 1, final-guess G2)', () => {
  it('never offers a moment whose trips are not all measured as « better »: the measured ones only', () => {
    const picked: Moment = { day: '2026-11-19', block: 'am', far: 'hop', add_min: 60, unmeasured: 0 };
    const list: Moment[] = [{ day: '2026-11-20', block: 'am', add_min: 0, unmeasured: 2 }, { day: '2026-11-21', block: 'pm', add_min: 10, unmeasured: 0 }];
    const b = betterMoments(picked, list);
    expect(b.map((x) => x.moment.day)).toEqual(['2026-11-21']);
    expect(b[0].saved).toBe(50);
  });
});
