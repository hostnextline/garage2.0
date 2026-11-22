import { describe, it, expect } from 'vitest';
import type { Job } from '../../data/types';
import { toldOf, toldChanged, moveOutcome, textAfterMove, dropTruck, dropTells } from './moveRules';

const j = (o: Partial<Job>): Job => ({ id: 'j', day: '2026-11-16', block: 'day', win_start: 540, win_end: 780, win_flex: false, truck_id: 't1', truck_pinned: false, ...o } as Job);

describe('what the customer was told', () => {
  it('changes with another day, block, window, or fixed ↔ flexible', () => {
    expect(toldChanged(j({}), j({ win_start: 840, win_end: 1080 }))).toBe(true);    // same day, new window
    expect(toldChanged(j({}), j({ day: '2026-11-17' }))).toBe(true);
    expect(toldChanged(j({ block: 'am' }), j({ block: 'pm' }))).toBe(true);
    expect(toldChanged(j({}), j({ win_start: null, win_end: null, win_flex: true }))).toBe(true);
    expect(toldChanged(j({ win_start: null, win_end: null, win_flex: true }), j({}))).toBe(true);
  });
  it('does not change with another truck only', () => {
    expect(toldChanged(j({}), j({ truck_id: 't2' }))).toBe(false);
    expect(toldOf(j({ block: 'am', win_start: 480 }))).toBe(toldOf(j({ block: 'am', win_start: null })));
  });
});

describe('the answer of move_job and the « moved » text (agenda-01, agenda-07, x-contract-07)', () => {
  const before = j({});
  it('texts a same-day window change although the server says changed: false', () => {
    const after = j({ win_start: 840, win_end: 1080 });
    const o = moveOutcome({ queued: false, data: { ok: true, changed: false, rows: { jobs: [after] } } }, 'j');
    expect(o).toMatchObject({ kind: 'moved', after });
    expect(textAfterMove(o, before, after, true)).toBe(true);
    // the old rule: `changed !== false` → no text
    expect((o as { changed?: boolean }).changed !== false).toBe(false);
  });
  it('never texts an « unchanged » answer (it has no `changed` key)', () => {
    const o = moveOutcome({ queued: false, data: { ok: true, unchanged: true } }, 'j');
    expect(o.kind).toBe('unchanged');
    expect(textAfterMove(o, before, before, true)).toBe(false);
  });
  it('does not text another truck at the same window, nor when the garage does not text moves', () => {
    const after = j({ truck_id: 't2' });
    const o = moveOutcome({ queued: false, data: { ok: true, changed: false, rows: { jobs: [after] } } }, 'j');
    expect(textAfterMove(o, before, after, true)).toBe(false);
    const other = j({ day: '2026-11-18' });
    expect(textAfterMove(moveOutcome({ queued: false, data: { changed: true, rows: { jobs: [other] } } }, 'j'), before, other, false)).toBe(false);
  });
  it('falls back on the server’s « another day or block » when its answer has no row of the job', () => {
    const o = moveOutcome({ queued: false, data: { ok: true, changed: true } }, 'j');
    expect(textAfterMove(o, j({ block: 'am' }), j({ block: 'am' }), true)).toBe(true);
    expect(textAfterMove(moveOutcome({ queued: false, data: { ok: true, changed: false } }, 'j'), before, before, true)).toBe(false);
  });
  it('reads a move kept on the phone', () => {
    expect(moveOutcome({ queued: true }, 'j').kind).toBe('queued');
  });
});

describe('a drop on the time grid (agenda-08)', () => {
  // « exact move » (STATE.md A1, S2): « it stays on its truck unless he picks another »: its own column is its truck
  it('keeps its truck when the job only changes its time in its own column', () => {
    expect(dropTruck(j({}), 't1')).toBe('t1');
    expect(dropTruck(j({ truck_pinned: true }), 't1')).toBe('t1');
  });
  it('asks for the column’s truck when it is another one; the week’s column is a day, not a truck', () => {
    expect(dropTruck(j({}), 't2')).toBe('t2');
    expect(dropTruck(j({ truck_pinned: true }), null)).toBe(null);
  });
  it('promises a text only when the customer has something new to hear', () => {
    expect(dropTells(j({}), '2026-11-16', 540)).toBe(false);   // another truck, same window
    expect(dropTells(j({}), '2026-11-16', 840)).toBe(true);
    expect(dropTells(j({}), '2026-11-17', 540)).toBe(true);
    expect(dropTells(j({ win_start: null, win_flex: true }), '2026-11-16', 540)).toBe(true);
  });
});
